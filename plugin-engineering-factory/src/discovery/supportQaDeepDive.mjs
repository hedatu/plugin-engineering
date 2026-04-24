import fs from "node:fs/promises";
import path from "node:path";
import {
  collectLiveEvidenceForCandidate,
  fetchAllowedText,
  parseChromeListing
} from "../research/liveResearch.mjs";
import { loadPortfolioRegistry } from "../portfolio/registry.mjs";
import {
  buildSafeReport,
  markdownList,
  markdownSection,
  validateArtifact,
  writeManagedJsonArtifact,
  writeManagedMarkdownArtifact
} from "../review/helpers.mjs";
import { fileExists, nowIso, readJson } from "../utils/io.mjs";
import { upsertOpportunityEntries } from "./opportunityBacklog.mjs";

export const SUPPORT_QA_DEEP_DIVE_ARTIFACT = "76_support_qa_deep_dive.json";
export const SUPPORT_QA_EVIDENCE_PACK_ARTIFACT = "77_support_qa_evidence_pack.json";
export const SUPPORT_QA_FUNCTIONAL_TEST_PLAN_ARTIFACT = "78_support_qa_functional_test_plan.json";
export const SUPPORT_QA_HUMAN_REVIEW_QUEUE_ARTIFACT = "79_support_qa_human_review_queue.json";

const SUPPORT_SEED_ID = "seed-support-qa-handoff";
const TARGET_CANDIDATE_NAME_PATTERNS = [
  /jam/i,
  /betterbugs/i,
  /test capture/i,
  /screenshot analyzer/i,
  /productsights/i,
  /tickethop/i
];
const USER_VOICE_SOURCE_TYPES = new Set([
  "chrome_web_store_review",
  "github_issue",
  "forum_post",
  "reddit_post"
]);

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function lower(value) {
  return `${value ?? ""}`.trim().toLowerCase();
}

function normalizeText(value) {
  return `${value ?? ""}`.replace(/\s+/g, " ").trim();
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function extractExtensionId(candidateId) {
  return `${candidateId ?? ""}`.replace(/^cws-/, "");
}

function slugifyName(name) {
  return `${name ?? ""}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function candidateDisplayName(candidate) {
  return candidate?.candidate_name ?? candidate?.name ?? "Unknown candidate";
}

function scoreLookup(scores) {
  return new Map((scores.ranked_opportunities ?? []).map((item) => [item.candidate_id, item]));
}

function queueLookup(queue) {
  return new Map((queue.candidate_queue ?? []).map((item, index) => [item.candidate_id, {
    ...item,
    observed_position_in_seed: index + 1
  }]));
}

function backlogLookup(backlog) {
  return new Map((backlog.opportunities ?? []).map((item) => [item.candidate_id, item]));
}

function portfolioReferenceItems(portfolioRegistry) {
  return (portfolioRegistry.items ?? []).map((item) => ({
    item_id: item.item_id,
    wedge: item.wedge,
    family: item.family,
    overlap_tags: item.overlap_tags ?? []
  }));
}

function isTargetSupportCandidate(candidateName) {
  return TARGET_CANDIDATE_NAME_PATTERNS.some((pattern) => pattern.test(candidateName ?? ""));
}

function candidateKind(candidate, evidenceItems = []) {
  const text = lower([
    candidateDisplayName(candidate),
    candidate.live_summary,
    candidate.pain_summary,
    ...(candidate.top_pain_clusters ?? []),
    ...evidenceItems.map((item) => item.text_excerpt)
  ].join(" "));
  if (/jam|betterbugs|bug report|report bug|issue report|support ticket|qa/.test(text)) {
    return "bug_report_handoff";
  }
  if (/screenshot|screen capture|capture|annotat/.test(text)) {
    return "screenshot_capture";
  }
  if (/tickethop|azure devops|work item|notes|recall/.test(text)) {
    return "work_item_recall";
  }
  if (/productsights|feedback|product insights|product feedback/.test(text)) {
    return "product_feedback";
  }
  return "support_handoff";
}

function inferPainSignalType(text) {
  const normalized = lower(text);
  if (/privacy|local-only|local only|upload|sync|server|remote/.test(normalized)) {
    return "privacy_or_locality";
  }
  if (/jira|linear|github issue|ticket|zendesk|intercom|upload|share/.test(normalized)) {
    return "external_issue_flow";
  }
  if (/screenshot|capture|record|video|annotat/.test(normalized)) {
    return "capture_pressure";
  }
  if (/browser|os|environment|version|context|url|title/.test(normalized)) {
    return "missing_environment_context";
  }
  if (/repro|reproduce|steps|step by step|checklist/.test(normalized)) {
    return "missing_repro_steps";
  }
  if (/manual|copy|copy paste|copy-paste|handoff|report|template|markdown/.test(normalized)) {
    return "manual_handoff_friction";
  }
  if (/note|notes|recall|history/.test(normalized)) {
    return "note_recall_friction";
  }
  return "workflow_friction";
}

function normalizeEvidenceItem(item, candidateId) {
  return {
    candidate_id: candidateId,
    source_type: `${item.source_type ?? "unknown"}`.trim(),
    source_url: item.source_url ?? item.url ?? "",
    captured_at: item.captured_at ?? nowIso(),
    text_excerpt: normalizeText(item.text_excerpt ?? item.quote ?? item.topic ?? ""),
    pain_signal_type: inferPainSignalType(item.text_excerpt ?? item.quote ?? item.topic ?? ""),
    reliability_weight: round(Number(item.reliability_weight ?? item.evidence_weight ?? 0.55), 3),
    recency_weight: round(Number(item.recency_weight ?? 0.6), 3),
    limitations: item.limitations ?? null
  };
}

function dedupeEvidenceItems(items) {
  const seen = new Set();
  const result = [];
  for (const item of items ?? []) {
    const normalized = normalizeEvidenceItem(item, item.candidate_id);
    if (!normalized.text_excerpt) {
      continue;
    }
    const key = `${normalized.candidate_id}|${normalized.source_type}|${normalized.source_url}|${normalized.text_excerpt}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function hasUserVoiceEvidence(evidenceItems) {
  return (evidenceItems ?? []).some((item) => USER_VOICE_SOURCE_TYPES.has(item.source_type));
}

function supportOrReviewEvidence(evidenceItems) {
  const preferred = (evidenceItems ?? []).filter((item) => (
    item.source_type === "support_page"
    || USER_VOICE_SOURCE_TYPES.has(item.source_type)
  ));
  return (preferred.length > 0 ? preferred : (evidenceItems ?? [])).slice(0, 4);
}

function buildCandidateSourceUrl(candidateId, candidateName) {
  return `https://chromewebstore.google.com/detail/${slugifyName(candidateName)}/${extractExtensionId(candidateId)}`;
}

async function detectLatestSupportQaSeedRun(projectRoot) {
  const runsRoot = path.join(projectRoot, "runs");
  const entries = await fs.readdir(runsRoot, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const runDir = path.join(runsRoot, entry.name);
    if (
      !(await fileExists(path.join(runDir, "69_seed_discovery_results.json")))
      || !(await fileExists(path.join(runDir, "70_seed_candidate_queue.json")))
      || !(await fileExists(path.join(runDir, "71_seed_opportunity_scores.json")))
      || !(await fileExists(path.join(runDir, "72_seed_next_candidate.json")))
      || !(await fileExists(path.join(runDir, "74_seed_performance_report.json")))
      || !(await fileExists(path.join(runDir, "75_seed_human_candidate_review_queue.json")))
    ) {
      continue;
    }
    try {
      const results = await readJson(path.join(runDir, "69_seed_discovery_results.json"));
      if ((results.seed_results ?? []).some((item) => item.seed_id === SUPPORT_SEED_ID)) {
        matches.push(runDir);
      }
    } catch {
      // ignore malformed runs
    }
  }
  matches.sort((left, right) => path.basename(right).localeCompare(path.basename(left)));
  return matches[0] ?? null;
}

async function resolveRunDir(projectRoot, run) {
  if (run) {
    return path.resolve(projectRoot, run);
  }
  const detected = await detectLatestSupportQaSeedRun(projectRoot);
  if (!detected) {
    throw new Error("No seed discovery run containing support/QA handoff artifacts was found.");
  }
  return detected;
}

async function loadState(projectRoot, run) {
  const runDir = await resolveRunDir(projectRoot, run);
  const runContext = {
    ...(await readJson(path.join(runDir, "00_run_context.json"))),
    project_root: projectRoot
  };
  return {
    projectRoot,
    runDir,
    runContext,
    seedResults: await readJson(path.join(runDir, "69_seed_discovery_results.json")),
    candidateQueue: await readJson(path.join(runDir, "70_seed_candidate_queue.json")),
    scores: await readJson(path.join(runDir, "71_seed_opportunity_scores.json")),
    nextCandidate: await readJson(path.join(runDir, "72_seed_next_candidate.json")),
    performance: await readJson(path.join(runDir, "74_seed_performance_report.json")),
    reviewQueue: await readJson(path.join(runDir, "75_seed_human_candidate_review_queue.json")),
    backlog: await readJson(path.join(projectRoot, "state", "opportunity_backlog.json")),
    portfolioRegistry: await loadPortfolioRegistry(projectRoot)
  };
}

async function hydrateCandidateFromListing(state, scoreItem, backlogEntry, queueEntry) {
  const storeUrl = backlogEntry?.source_url ?? buildCandidateSourceUrl(scoreItem.candidate_id, scoreItem.candidate_name);
  const fallbackCandidate = {
    candidate_id: scoreItem.candidate_id,
    name: scoreItem.candidate_name,
    candidate_name: scoreItem.candidate_name,
    store_url: storeUrl,
    source_url: storeUrl,
    users: queueEntry?.users ?? backlogEntry?.users_estimate ?? 0,
    rating: queueEntry?.rating ?? backlogEntry?.rating ?? 0,
    reviews: queueEntry?.reviews ?? backlogEntry?.review_count ?? 0,
    category: backlogEntry?.category ?? "Productivity",
    support_url: "",
    website_url: "",
    github_repo: "",
    live_summary: scoreItem?.proposed_wedge ?? "",
    top_pain_clusters: [],
    pain_summary: scoreItem?.proposed_wedge ?? "",
    wedge_family: "support_debug_handoff",
    signals: ["support_debug_handoff"]
  };

  if ((state.runContext.research?.mode ?? "fixture") !== "live") {
    return {
      candidate: fallbackCandidate,
      listing_status: "skipped",
      listing_failure_reason: "Run is not configured for live research."
    };
  }

  try {
    const response = await fetchAllowedText(storeUrl, {
      timeoutMs: state.runContext.research?.timeout_ms ?? 15000
    });
    if (!response.ok) {
      return {
        candidate: fallbackCandidate,
        listing_status: "failed",
        listing_failure_reason: `HTTP ${response.status} while fetching ${storeUrl}`
      };
    }
    const parsed = parseChromeListing(storeUrl, response.text, state.runContext.builder?.allow_families ?? []);
    return {
      candidate: {
        ...fallbackCandidate,
        ...parsed,
        candidate_id: scoreItem.candidate_id,
        name: scoreItem.candidate_name,
        candidate_name: scoreItem.candidate_name,
        source_url: storeUrl,
        store_url: storeUrl,
        category: backlogEntry?.category ?? parsed.category ?? "Productivity",
        support_url: parsed.support_url || fallbackCandidate.support_url,
        website_url: parsed.website_url || fallbackCandidate.website_url,
        users: fallbackCandidate.users || parsed.users,
        rating: fallbackCandidate.rating || parsed.rating,
        reviews: fallbackCandidate.reviews || parsed.reviews,
        live_summary: parsed.live_summary || fallbackCandidate.live_summary,
        top_pain_clusters: [],
        wedge_family: "support_debug_handoff",
        signals: ["support_debug_handoff"]
      },
      listing_status: "passed",
      listing_failure_reason: null
    };
  } catch (error) {
    return {
      candidate: fallbackCandidate,
      listing_status: "failed",
      listing_failure_reason: error.message
    };
  }
}

async function collectCandidateEvidence(state, hydratedCandidate) {
  if ((state.runContext.research?.mode ?? "fixture") !== "live") {
    return {
      status: "skipped",
      live_unavailable: true,
      evidence: [],
      provenance: {
        support_requests: [],
        github_issue_requests: []
      },
      failure_reason: "Run is not configured for live research."
    };
  }

  try {
    const result = await collectLiveEvidenceForCandidate(hydratedCandidate, {
      timeoutMs: state.runContext.research?.timeout_ms ?? 15000,
      maxGithubIssues: state.runContext.research?.max_github_issues ?? 5
    });
    return {
      status: "passed",
      live_unavailable: false,
      evidence: dedupeEvidenceItems((result.evidence ?? []).map((item) => ({
        ...item,
        candidate_id: hydratedCandidate.candidate_id
      }))),
      provenance: result.provenance ?? {
        support_requests: [],
        github_issue_requests: []
      },
      failure_reason: null
    };
  } catch (error) {
    return {
      status: "skipped",
      live_unavailable: true,
      evidence: [],
      provenance: {
        support_requests: [],
        github_issue_requests: []
      },
      failure_reason: error.message
    };
  }
}

function inferEvidenceSummary(evidenceItems, candidate) {
  const sourceTypes = unique((evidenceItems ?? []).map((item) => item.source_type));
  return {
    source_types: sourceTypes,
    source_count: sourceTypes.length,
    evidence_count: evidenceItems.length,
    has_user_voice: hasUserVoiceEvidence(evidenceItems),
    summary: sourceTypes.length === 0
      ? "No live evidence could be added beyond the seed snapshot."
      : `${sourceTypes.length} source types and ${evidenceItems.length} evidence excerpts captured for ${candidateDisplayName(candidate)}.`
  };
}

function derivePainSignals(candidate, evidenceItems) {
  return unique([
    ...(candidate.top_pain_clusters ?? []),
    ...evidenceItems.map((item) => item.pain_signal_type)
  ]).slice(0, 8);
}

function permissionRiskLabel(score) {
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  return "low";
}

function complianceRiskLabel(score) {
  if (score >= 65) return "high";
  if (score >= 35) return "medium";
  return "low";
}

function complianceRiskScoreFromLabel(label) {
  if (label === "high") return 80;
  if (label === "medium") return 45;
  return 20;
}

function overlapScoreForWedge(wedgeId, candidateType) {
  const base = {
    local_bug_report_context_copier: 34,
    qa_handoff_snapshot_markdown: 38,
    support_ticket_environment_packet: 30,
    repro_steps_helper: 28,
    screenshot_annotation_handoff: 42
  }[wedgeId] ?? 40;
  if (candidateType === "screenshot_capture" && wedgeId === "screenshot_annotation_handoff") {
    return 44;
  }
  return base;
}

function wedgeSupportScore(wedgeId, candidateType, painSignals, evidenceItems) {
  const normalizedSignals = painSignals.map(lower);
  const texts = evidenceItems.map((item) => lower(item.text_excerpt)).join(" ");
  let score = 54;
  if (wedgeId === "local_bug_report_context_copier") {
    score += 16;
    if (candidateType === "bug_report_handoff") score += 12;
    if (normalizedSignals.some((item) => item.includes("manual_handoff") || item.includes("missing_environment_context"))) score += 8;
  }
  if (wedgeId === "qa_handoff_snapshot_markdown") {
    score += 12;
    if (/markdown|checklist|template|handoff/.test(texts)) score += 10;
  }
  if (wedgeId === "support_ticket_environment_packet") {
    score += 11;
    if (/browser|version|environment|context|url|title/.test(texts)) score += 10;
  }
  if (wedgeId === "repro_steps_helper") {
    score += 10;
    if (/repro|steps|step/.test(texts)) score += 12;
  }
  if (wedgeId === "screenshot_annotation_handoff") {
    score += candidateType === "screenshot_capture" ? 15 : 4;
    if (/screenshot|capture|record|annotat/.test(texts)) score += 8;
  }
  if (!hasUserVoiceEvidence(evidenceItems)) {
    score -= 8;
  }
  return clamp(score);
}

function permissionRiskScore(wedgeId, candidateType) {
  if (wedgeId === "screenshot_annotation_handoff") {
    return candidateType === "screenshot_capture" ? 56 : 46;
  }
  if (wedgeId === "support_ticket_environment_packet") {
    return 26;
  }
  return 18;
}

function complianceRiskScore(wedgeId, candidateType) {
  if (wedgeId === "screenshot_annotation_handoff") {
    return candidateType === "bug_report_handoff" ? 42 : 35;
  }
  return 18;
}

function builderFitForWedge(wedgeId) {
  if (wedgeId === "screenshot_annotation_handoff") {
    return {
      required_builder: "screenshot_annotation_handoff",
      current_builder_available: false,
      small_builder_adaptation: false,
      estimated_builder_cost: "medium",
      existing_builder_fit: "unsupported",
      rationale: "Screenshot capture and annotation are outside the current three builders."
    };
  }
  return {
    required_builder: "support_debug_handoff",
    current_builder_available: false,
    small_builder_adaptation: true,
    estimated_builder_cost: "small",
    existing_builder_fit: "small_popup_adaptation",
    rationale: "A local-only copy or download helper is close to the current popup-based builder patterns, but it is not a first-class builder yet."
  };
}

function expectedBrowserSmoke(wedgeId) {
  if (wedgeId === "repro_steps_helper") {
    return "Open popup, enter repro steps, generate markdown, and verify copy succeeds without any remote call.";
  }
  if (wedgeId === "screenshot_annotation_handoff") {
    return "Open popup, capture visible tab, annotate a mark, and export a local handoff package.";
  }
  return "Open popup on an active tab, generate a local markdown handoff note, and verify copy or download without remote calls.";
}

function whyNotClone(wedgeId) {
  if (wedgeId === "screenshot_annotation_handoff") {
    return "It would only be differentiated if the wedge stayed local-only and user-triggered, but that is still too close to generic screenshot bug tools.";
  }
  return "The wedge stops at local text generation and copy or download. It does not upload data, create issues, or automate external support systems.";
}

function triggerMomentForWedge(wedgeId) {
  if (wedgeId === "repro_steps_helper") {
    return "Right after a QA or support user reproduces an issue and needs to hand off precise steps.";
  }
  if (wedgeId === "support_ticket_environment_packet") {
    return "When a support ticket needs quick browser and page context without sending any data anywhere.";
  }
  if (wedgeId === "screenshot_annotation_handoff") {
    return "When a visual bug needs a screenshot-based handoff artifact.";
  }
  return "When someone needs a fast, copy-ready browser bug handoff note from the current page.";
}

function painAddressedForWedge(wedgeId) {
  if (wedgeId === "repro_steps_helper") {
    return "Unstructured repro notes, missing consistency, and too much manual formatting.";
  }
  if (wedgeId === "support_ticket_environment_packet") {
    return "Missing page and browser context in support handoffs.";
  }
  if (wedgeId === "screenshot_annotation_handoff") {
    return "Visual context is hard to explain without a marked screenshot.";
  }
  return "Manual copy-paste handoff work, missing context, and inconsistent bug report formatting.";
}

function oneSentenceValue(wedgeId) {
  const values = {
    local_bug_report_context_copier: "Generate a local-only Markdown bug handoff note with page title, URL, browser info, timestamp, and user-entered repro steps.",
    qa_handoff_snapshot_markdown: "Create a QA handoff snapshot with page metadata, a checklist, and paste-ready Markdown for Jira, Linear, or GitHub issues.",
    support_ticket_environment_packet: "Build a local support environment packet with current page context, browser details, extension version, and a short problem template.",
    repro_steps_helper: "Turn minimal user input into standardized repro steps and copy-ready Markdown without sending any data anywhere.",
    screenshot_annotation_handoff: "Capture and annotate the current page into a local screenshot handoff package without uploading anything."
  };
  return values[wedgeId];
}

function targetUserForWedge(wedgeId) {
  if (wedgeId === "support_ticket_environment_packet") {
    return "Support agents and internal QA operators.";
  }
  if (wedgeId === "repro_steps_helper") {
    return "QA testers, support agents, and product triage operators.";
  }
  return "QA testers, support agents, and bug reporters working inside the browser.";
}

function buildWedgeHypotheses(candidate, evidenceItems, scoreItem) {
  const kind = candidateKind(candidate, evidenceItems);
  const painSignals = derivePainSignals(candidate, evidenceItems);
  const wedgeIds = [
    "local_bug_report_context_copier",
    "qa_handoff_snapshot_markdown",
    "support_ticket_environment_packet",
    "repro_steps_helper",
    "screenshot_annotation_handoff"
  ];

  return wedgeIds.map((wedgeId) => {
    const supportScore = wedgeSupportScore(wedgeId, kind, painSignals, evidenceItems);
    const overlapScore = overlapScoreForWedge(wedgeId, kind);
    const permissionRiskScoreValue = permissionRiskScore(wedgeId, kind);
    const complianceRiskScoreValue = complianceRiskScore(wedgeId, kind);
    const builderFit = builderFitForWedge(wedgeId);
    const evidenceQualityScore = round(clamp(
      (Number(scoreItem?.evidence_quality_score ?? 0) * 0.7)
      + (unique(evidenceItems.map((item) => item.source_type)).length * 6)
      + (hasUserVoiceEvidence(evidenceItems) ? 10 : 0)
      + (supportOrReviewEvidence(evidenceItems).some((item) => item.source_type === "support_page") ? 4 : 0)
      - (builderFit.current_builder_available ? 0 : 4)
    ));
    const wedgeClarityScore = round(clamp(
      Number(scoreItem?.wedge_clarity_score ?? 0)
      + ((supportScore - 60) * 0.45)
      + (wedgeId === "screenshot_annotation_handoff" ? -4 : 3)
    ));
    const testabilityScore = round(clamp(
      Number(scoreItem?.testability_score ?? 0)
      + (wedgeId === "screenshot_annotation_handoff" ? -5 : 2)
      + (wedgeId === "repro_steps_helper" ? 3 : 0)
    ));
    const productAcceptancePassed = (
      evidenceQualityScore >= 78
      && wedgeClarityScore >= 80
      && overlapScore <= 45
      && complianceRiskScoreValue < 35
      && permissionRiskScoreValue < 35
      && wedgeId !== "screenshot_annotation_handoff"
    );
    const buildReadyCriteria = {
      evidence_quality_score: evidenceQualityScore >= 80,
      wedge_clarity_score: wedgeClarityScore >= 82,
      testability_score: testabilityScore >= 80,
      portfolio_overlap_score: overlapScore <= 45,
      compliance_risk: complianceRiskScoreValue < 65,
      permission_risk: permissionRiskScoreValue <= 45,
      product_acceptance_forecast: productAcceptancePassed,
      independent_sources: unique(evidenceItems.map((item) => item.source_type)).length >= 2,
      clear_happy_path: true,
      expected_functional_test_matrix: true,
      existing_builder_or_small_adaptation: builderFit.current_builder_available || builderFit.small_builder_adaptation,
      external_user_voice: hasUserVoiceEvidence(evidenceItems)
    };
    const failedReasons = Object.entries(buildReadyCriteria)
      .filter(([, passed]) => passed === false)
      .map(([key]) => key);
    return {
      wedge_id: wedgeId,
      one_sentence_value: oneSentenceValue(wedgeId),
      target_user: targetUserForWedge(wedgeId),
      trigger_moment: triggerMomentForWedge(wedgeId),
      pain_addressed: painAddressedForWedge(wedgeId),
      why_this_is_single_purpose: "It generates one bounded handoff artifact from the active page instead of managing the whole bug-reporting workflow.",
      why_this_is_not_a_clone: whyNotClone(wedgeId),
      evidence_support: supportOrReviewEvidence(evidenceItems).map((item) => item.source_url).filter(Boolean).slice(0, 4),
      testability_score: testabilityScore,
      permission_risk: permissionRiskLabel(permissionRiskScoreValue),
      compliance_risk: complianceRiskLabel(complianceRiskScoreValue),
      portfolio_overlap_score: overlapScore,
      required_builder: builderFit.required_builder,
      existing_builder_fit: builderFit.existing_builder_fit,
      expected_browser_smoke: expectedBrowserSmoke(wedgeId),
      product_acceptance_forecast: productAcceptancePassed ? "passed" : "failed",
      build_ready_criteria_result: {
        passed: failedReasons.length === 0,
        failed_reasons: failedReasons,
        evidence_quality_score: evidenceQualityScore,
        wedge_clarity_score: wedgeClarityScore
      }
    };
  });
}

function selectWedgeHypothesis(wedgeHypotheses, candidateType) {
  return [...(wedgeHypotheses ?? [])].sort((left, right) => {
    const leftScore = (
      left.build_ready_criteria_result.evidence_quality_score * 0.28
      + left.build_ready_criteria_result.wedge_clarity_score * 0.28
      + left.testability_score * 0.22
      - left.portfolio_overlap_score * 0.12
      - (left.permission_risk === "high" ? 20 : left.permission_risk === "medium" ? 8 : 0)
      - (left.compliance_risk === "high" ? 24 : left.compliance_risk === "medium" ? 8 : 0)
      - (left.wedge_id === "screenshot_annotation_handoff" ? 10 : 0)
      - (candidateType === "screenshot_capture" && left.wedge_id === "screenshot_annotation_handoff" ? 6 : 0)
    );
    const rightScore = (
      right.build_ready_criteria_result.evidence_quality_score * 0.28
      + right.build_ready_criteria_result.wedge_clarity_score * 0.28
      + right.testability_score * 0.22
      - right.portfolio_overlap_score * 0.12
      - (right.permission_risk === "high" ? 20 : right.permission_risk === "medium" ? 8 : 0)
      - (right.compliance_risk === "high" ? 24 : right.compliance_risk === "medium" ? 8 : 0)
      - (right.wedge_id === "screenshot_annotation_handoff" ? 10 : 0)
      - (candidateType === "screenshot_capture" && right.wedge_id === "screenshot_annotation_handoff" ? 6 : 0)
    );
    return rightScore - leftScore;
  })[0] ?? null;
}

function overlapAnalysis(selectedWedge, portfolioRegistry) {
  const portfolioItems = portfolioReferenceItems(portfolioRegistry);
  const similarExistingItems = portfolioItems
    .filter((item) => item.family === "tab_csv_window_export" || item.family === "single_profile_form_fill" || item.family === "gmail_snippet")
    .map((item) => ({
      item_id: item.item_id,
      wedge: item.wedge,
      family: item.family
    }))
    .slice(0, 3);
  return {
    overlap_score: selectedWedge?.portfolio_overlap_score ?? 100,
    overlap_reason: "The selected support or QA wedge does not overlap the current form-fill or tab-export portfolio on target user, trigger moment, or output artifact.",
    similar_existing_items: similarExistingItems,
    differentiation_angle: "Local-only issue handoff text for support and QA is different from form fill, tab export, and Gmail snippets.",
    acceptable_overlap: Number(selectedWedge?.portfolio_overlap_score ?? 100) <= 45
  };
}

function permissionRiskAnalysis(selectedWedge) {
  const requiredPermissions = [];
  if (selectedWedge?.wedge_id === "support_ticket_environment_packet") {
    requiredPermissions.push("activeTab", "storage", "downloads(optional)");
  } else if (selectedWedge?.wedge_id === "screenshot_annotation_handoff") {
    requiredPermissions.push("activeTab", "tabs", "downloads(optional)");
  } else {
    requiredPermissions.push("activeTab", "storage(optional)");
  }
  return {
    risk_level: selectedWedge?.permission_risk ?? "medium",
    required_permissions: requiredPermissions,
    host_permissions: [],
    local_only: true,
    rationale: selectedWedge?.wedge_id === "screenshot_annotation_handoff"
      ? "A screenshot flow is still user-triggered, but it introduces more capture surface and a higher implementation burden."
      : "The preferred wedge can stay user-triggered, local-only, and avoid persistent host permissions."
  };
}

function complianceAnalysis(selectedWedge) {
  return {
    risk_level: selectedWedge?.compliance_risk ?? "medium",
    no_auto_send: true,
    no_remote_upload: true,
    no_external_issue_creation: true,
    rationale: selectedWedge?.wedge_id === "screenshot_annotation_handoff"
      ? "Still local-only, but screenshot handling needs tighter privacy messaging and UI boundaries."
      : "The wedge stops at local text generation or local file download, which keeps compliance exposure low."
  };
}

function builderFitAnalysis(selectedWedge) {
  const base = builderFitForWedge(selectedWedge?.wedge_id);
  return {
    required_builder: base.required_builder,
    current_builder_available: base.current_builder_available,
    small_builder_adaptation: base.small_builder_adaptation,
    estimated_builder_cost: base.estimated_builder_cost,
    existing_builder_fit: base.existing_builder_fit,
    rationale: base.rationale
  };
}

function testabilityAnalysis(selectedWedge) {
  const expectedFunctionalTestMatrix = [
    "happy path markdown generation",
    "empty input or unsupported page state",
    "activeTab permission prompt and user-triggered data capture only",
    "copy-to-clipboard correctness",
    "no remote calls during handoff generation",
    "privacy disclosure copy matches actual behavior"
  ];
  if (selectedWedge?.wedge_id === "support_ticket_environment_packet") {
    expectedFunctionalTestMatrix.push("optional download flow");
  }
  if (selectedWedge?.wedge_id === "screenshot_annotation_handoff") {
    expectedFunctionalTestMatrix.push("screenshot capture and annotation flow");
  }
  return {
    testability_score: selectedWedge?.testability_score ?? 0,
    happy_path_test: selectedWedge?.expected_browser_smoke ?? "",
    clear_happy_path: true,
    expected_functional_test_matrix: expectedFunctionalTestMatrix
  };
}

function evidenceGaps(selectedWedge, evidenceItems, builderFit) {
  const gaps = [];
  if (!hasUserVoiceEvidence(evidenceItems)) {
    gaps.push("Need at least one external user-voice source that explicitly asks for the narrowed local-only support or QA handoff workflow.");
  }
  if ((selectedWedge?.build_ready_criteria_result?.evidence_quality_score ?? 0) < 80) {
    gaps.push("Need stronger evidence that users would install a text-first local-only handoff helper instead of a fuller screenshot or upload workflow.");
  }
  if (!(builderFit.current_builder_available || builderFit.small_builder_adaptation)) {
    gaps.push("Need builder fit to stay within a very small popup-style implementation, not a new screenshot platform.");
  }
  return unique(gaps);
}

function finalDecisionForCandidate({
  selectedWedge,
  candidateType,
  evidenceItems,
  builderFit,
  overlap,
  permission,
  compliance
}) {
  const criteria = selectedWedge?.build_ready_criteria_result ?? { passed: false, failed_reasons: ["unknown"] };
  const userVoiceMissing = !hasUserVoiceEvidence(evidenceItems);

  if (candidateType === "screenshot_capture") {
    return {
      final_recommendation: "skip",
      final_reason: "The strongest public signal still points toward screenshot capture or annotation, which is higher-permission and too close to generic bug-report tooling for this round.",
      next_step: "skip_support_qa_candidate",
      backlog_status: "skipped_high_compliance_risk",
      status_detail: "screenshot_capture_or_annotation_scope"
    };
  }

  if (selectedWedge?.wedge_id === "screenshot_annotation_handoff") {
    return {
      final_recommendation: "skip",
      final_reason: "The selected wedge still depends on screenshot capture and annotation instead of a lower-risk text-only handoff artifact.",
      next_step: "skip_support_qa_candidate",
      backlog_status: "skipped_high_compliance_risk",
      status_detail: "screenshot_builder_and_permission_risk"
    };
  }

  if (criteria.passed && !userVoiceMissing) {
    return {
      final_recommendation: "build_ready",
      final_reason: "The narrowed local-only support handoff wedge now clears evidence, clarity, overlap, permission, and testability gates.",
      next_step: "human_candidate_review_required",
      backlog_status: "build_ready",
      status_detail: "support_qa_low_permission_build_ready"
    };
  }

  if (
    overlap.overlap_score <= 45
    && permission.risk_level !== "high"
    && compliance.risk_level !== "high"
    && builderFit.small_builder_adaptation
  ) {
    return {
      final_recommendation: "research_more",
      final_reason: "The low-permission local-only wedge is promising, but the narrowed install-worthy pain still lacks enough user-voice evidence.",
      next_step: "continue_support_qa_research",
      backlog_status: "backlog_waiting_for_evidence",
      status_detail: "missing_external_user_voice_for_local_only_wedge"
    };
  }

  return {
    final_recommendation: "backlog_waiting_for_evidence",
    final_reason: "A differentiated local-only wedge exists in theory, but the current evidence is still too thin or too broad to keep pushing aggressively.",
    next_step: "hold_in_support_qa_backlog",
    backlog_status: "backlog_waiting_for_evidence",
    status_detail: "insufficient_specificity_for_support_handoff"
  };
}

function buildFunctionalTestPlan(runId, candidateEntry) {
  const selectedWedge = candidateEntry.selected_wedge_hypothesis;
  return buildSafeReport({
    stage: "SUPPORT_QA_FUNCTIONAL_TEST_PLAN",
    status: "passed",
    run_id: runId,
    candidate_id: candidateEntry.candidate_id,
    candidate_name: candidateEntry.candidate_name,
    proposed_wedge: selectedWedge?.one_sentence_value ?? "",
    happy_path: selectedWedge?.expected_browser_smoke ?? "",
    expected_functional_test_matrix: candidateEntry.testability_analysis.expected_functional_test_matrix,
    active_tab_permission_path: "The popup only reads the active page after the user opens the action and explicitly generates the handoff note.",
    local_only_storage_and_no_remote_calls: "No remote fetch, upload, or issue-creation flow is allowed in the happy path.",
    generated_markdown_correctness: "Verify the output contains URL, title, browser context, timestamp, and the entered repro steps in a stable Markdown template.",
    copy_to_clipboard_behavior: "Copy action returns success feedback and the clipboard payload matches the rendered Markdown exactly.",
    optional_download_behavior: selectedWedge?.wedge_id === "support_ticket_environment_packet"
      ? "Optional markdown download writes one local file with the same content as the copy payload."
      : "Not required for the preferred wedge.",
    screenshot_requirement: selectedWedge?.wedge_id === "screenshot_annotation_handoff"
      ? "Required and must stay local-only."
      : "Not required for the preferred wedge.",
    privacy_disclosure_check: "Privacy copy must explicitly state that data stays local and is only copied or downloaded on user action.",
    browser_smoke_plan: selectedWedge?.expected_browser_smoke ?? "",
    manual_product_acceptance_checklist: [
      "The value proposition is obvious in one sentence.",
      "The permission story is narrow and easy to trust.",
      "The output artifact is useful without extra integrations.",
      "No data leaves the browser unless the user manually copies or downloads it."
    ],
    next_step: candidateEntry.final_recommendation === "build_ready"
      ? "human_candidate_review_required"
      : "continue_support_qa_research"
  });
}

function supportCandidateMarkdown(entries, evidencePack, functionalPlan, humanQueue, report) {
  const candidateSections = (entries ?? []).map((entry) => {
    const selectedWedge = entry.selected_wedge_hypothesis;
    return markdownSection(
      `${entry.candidate_name}`,
      [
        `- Recommendation: \`${entry.final_recommendation}\``,
        `- Selected wedge: ${selectedWedge?.one_sentence_value ?? "n/a"}`,
        `- Overlap: ${entry.overlap_analysis.overlap_score}`,
        `- Permission risk: ${entry.permission_risk_analysis.risk_level}`,
        `- Compliance risk: ${entry.compliance_analysis.risk_level}`,
        `- Evidence summary: ${entry.evidence_summary.summary}`,
        `- Missing evidence: ${entry.unresolved_uncertainties.length > 0 ? entry.unresolved_uncertainties.join(" | ") : "none"}`,
        `- Next step: ${entry.next_step}`
      ].join("\n")
    );
  }).join("\n\n");

  const humanQueueLines = (humanQueue.entries ?? []).map((entry) => (
    `- ${entry.candidate_name}: ${entry.proposed_wedge} -> ${entry.recommended_decision}`
  )).join("\n");

  return [
    `# Support/QA Handoff Deep Dive`,
    ``,
    `- Run: \`${report.run_id}\``,
    `- Focus seed: \`${SUPPORT_SEED_ID}\``,
    `- Build ready: ${report.build_ready_count}`,
    `- Research more: ${report.research_more_count}`,
    `- Skip: ${report.skip_count}`,
    `- Backlog waiting: ${report.backlog_waiting_count}`,
    ``,
    markdownSection("Candidate Decisions", candidateSections),
    ``,
    markdownSection("Evidence Pack", `- Captured excerpts: ${evidencePack.evidence_items.length}\n- Live unavailable: ${evidencePack.live_unavailable === true}`),
    ``,
    markdownSection("Functional Plan", functionalPlan
      ? `- Candidate: ${functionalPlan.candidate_name}\n- Wedge: ${functionalPlan.proposed_wedge}\n- Happy path: ${functionalPlan.happy_path}`
      : "- No functional plan generated."),
    ``,
    markdownSection("Human Review Queue", humanQueueLines || "- none"),
    ``,
    markdownSection("Next Step", report.next_step)
  ].join("\n");
}

async function writeFunctionalPlanIfNeeded(state, candidateEntries) {
  const strongest = [...candidateEntries]
    .filter((entry) => entry.final_recommendation === "build_ready" || entry.final_recommendation === "research_more")
    .sort((left, right) => (
      Number(right.deep_dive_score_breakdown?.wedge_clarity_score ?? 0)
      - Number(left.deep_dive_score_breakdown?.wedge_clarity_score ?? 0)
    ))[0] ?? null;

  if (!strongest) {
    return null;
  }

  const functionalPlan = buildFunctionalTestPlan(state.runContext.run_id, strongest);
  await validateArtifact(state.projectRoot, "support_qa_functional_test_plan.schema.json", SUPPORT_QA_FUNCTIONAL_TEST_PLAN_ARTIFACT, functionalPlan);
  await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: SUPPORT_QA_FUNCTIONAL_TEST_PLAN_ARTIFACT,
    data: functionalPlan
  });

  const markdown = [
    `# Support/QA Functional Test Plan`,
    ``,
    `- Candidate: ${functionalPlan.candidate_name}`,
    `- Wedge: ${functionalPlan.proposed_wedge}`,
    `- Next step: ${functionalPlan.next_step}`,
    ``,
    markdownSection("Happy Path", functionalPlan.happy_path),
    ``,
    markdownSection("Expected Functional Test Matrix", markdownList(functionalPlan.expected_functional_test_matrix)),
    ``,
    markdownSection("Browser Smoke Plan", functionalPlan.browser_smoke_plan),
    ``,
    markdownSection("Manual Product Acceptance Checklist", markdownList(functionalPlan.manual_product_acceptance_checklist))
  ].join("\n");

  await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "78_support_qa_functional_test_plan.md",
    category: "support_qa_deep_dive",
    prefix: "78_support_qa_functional_test_plan",
    content: markdown
  });

  return functionalPlan;
}

function buildHumanReviewQueue(runId, candidateEntries) {
  const entries = [...candidateEntries]
    .filter((entry) => entry.final_recommendation === "build_ready" || entry.final_recommendation === "research_more")
    .sort((left, right) => (
      Number(right.deep_dive_score_breakdown?.evidence_quality_score ?? 0)
      - Number(left.deep_dive_score_breakdown?.evidence_quality_score ?? 0)
    ))
    .slice(0, 3)
    .map((entry) => ({
      candidate_name: entry.candidate_name,
      proposed_wedge: entry.selected_wedge_hypothesis?.one_sentence_value ?? "",
      why_build: `Low-overlap local-only wedge with ${entry.permission_risk_analysis.risk_level} permission risk and ${entry.testability_analysis.testability_score} testability.`,
      why_not_build: entry.unresolved_uncertainties.join(" | ") || "No major unresolved issue recorded.",
      evidence_summary: entry.evidence_summary.summary,
      overlap_risk: `portfolio_overlap_score=${entry.overlap_analysis.overlap_score}`,
      permission_risk: entry.permission_risk_analysis.risk_level,
      testability_summary: `testability_score=${entry.testability_analysis.testability_score}`,
      builder_fit: entry.builder_fit_analysis.existing_builder_fit,
      estimated_build_cost: entry.builder_fit_analysis.estimated_builder_cost,
      recommended_decision: entry.final_recommendation === "build_ready" ? "approve_build" : "research_more",
      human_question: entry.final_recommendation === "build_ready"
        ? "Does this local-only support handoff wedge feel differentiated enough to approve for build?"
        : "Is the narrowed local-only wedge worth one more evidence pass, or should it be parked?"
    }));

  return buildSafeReport({
    stage: "SUPPORT_QA_HUMAN_REVIEW_QUEUE",
    status: "passed",
    run_id: runId,
    no_build_today: entries.every((entry) => entry.recommended_decision !== "approve_build"),
    queue_count: entries.length,
    entries,
    next_step: entries.some((entry) => entry.recommended_decision === "approve_build")
      ? "human_candidate_review"
      : "continue_support_qa_research"
  });
}

function buildBacklogEntries(state, candidateEntries) {
  return candidateEntries.map((entry) => ({
    opportunity_id: entry.existing_opportunity_id,
    source_run_id: state.runContext.run_id,
    candidate_id: entry.candidate_id,
    candidate_name: entry.candidate_name,
    source_url: entry.source_url,
    category: "Productivity",
    users_estimate: entry.current_score_breakdown.users_estimate,
    rating: entry.current_score_breakdown.rating,
    review_count: entry.current_score_breakdown.review_count,
    pain_summary: entry.final_reason,
    top_pain_clusters: unique([
      ...(entry.pain_signals ?? []),
      ...(entry.unresolved_uncertainties ?? [])
    ]),
    evidence_quality_score: entry.deep_dive_score_breakdown.evidence_quality_score,
    testability_score: entry.deep_dive_score_breakdown.testability_score,
    wedge_clarity_score: entry.deep_dive_score_breakdown.wedge_clarity_score,
    portfolio_overlap_score: entry.overlap_analysis.overlap_score,
    compliance_risk: complianceRiskScoreFromLabel(entry.compliance_analysis.risk_level),
    build_recommendation: entry.final_recommendation === "build_ready"
      ? "build"
      : entry.final_recommendation === "skip"
        ? "skip"
        : entry.final_recommendation === "backlog_waiting_for_evidence"
          ? "backlog_waiting"
          : "research_more",
    decision_reason: entry.final_reason,
    status: entry.final_recommendation === "build_ready"
      ? "build_ready"
      : entry.final_recommendation === "skip"
        ? entry.backlog_status
        : "backlog_waiting_for_evidence",
    linked_run_ids: [state.runContext.run_id],
    linked_portfolio_items: (entry.overlap_analysis.similar_existing_items ?? []).map((item) => item.item_id),
    next_step: entry.final_recommendation === "build_ready"
      ? "human_candidate_review_required"
      : entry.next_step,
    selected_wedge: entry.selected_wedge_hypothesis?.one_sentence_value ?? null,
    research_rounds_completed: 1,
    evidence_requirements: entry.unresolved_uncertainties,
    status_detail: entry.status_detail,
    last_updated_at: nowIso()
  }));
}

function matchingSupportCandidates(state) {
  const scores = (state.scores.ranked_opportunities ?? []).filter((item) => (
    item.primary_seed_id === SUPPORT_SEED_ID
    && isTargetSupportCandidate(item.candidate_name)
  ));
  const queueMap = queueLookup(state.candidateQueue);
  return scores
    .map((item) => ({
      score: item,
      queue: queueMap.get(item.candidate_id) ?? null
    }))
    .sort((left, right) => (
      Number(left.queue?.observed_position_in_seed ?? 999)
      - Number(right.queue?.observed_position_in_seed ?? 999)
    ));
}

export async function runSupportQaDeepDive({ projectRoot, run = null }) {
  const state = await loadState(projectRoot, run);
  const scoreMap = scoreLookup(state.scores);
  const queueMap = queueLookup(state.candidateQueue);
  const backlogMap = backlogLookup(state.backlog);
  const candidates = matchingSupportCandidates(state);
  if (candidates.length === 0) {
    throw new Error("No support/QA handoff candidates were found in the seed run.");
  }

  const candidateEntries = [];
  const evidencePackItems = [];
  let liveEvidenceExecuted = false;

  for (const candidateState of candidates) {
    const scoreItem = scoreMap.get(candidateState.score.candidate_id) ?? candidateState.score;
    const queueEntry = queueMap.get(scoreItem.candidate_id) ?? candidateState.queue ?? {};
    const backlogEntry = backlogMap.get(scoreItem.candidate_id) ?? null;
    const hydrated = await hydrateCandidateFromListing(state, scoreItem, backlogEntry, queueEntry);
    const liveEvidence = await collectCandidateEvidence(state, hydrated.candidate);
    if (liveEvidence.status === "passed") {
      liveEvidenceExecuted = true;
    }
    const evidenceItems = liveEvidence.evidence;
    const candidateContext = {
      ...hydrated.candidate,
      pain_summary: scoreItem.proposed_wedge ?? hydrated.candidate.pain_summary ?? "",
      top_pain_clusters: []
    };
    const kind = candidateKind(candidateContext, evidenceItems);
    const wedgeHypotheses = buildWedgeHypotheses(candidateContext, evidenceItems, scoreItem);
    const selectedWedge = selectWedgeHypothesis(wedgeHypotheses, kind);
    const overlap = overlapAnalysis(selectedWedge, state.portfolioRegistry);
    const permission = permissionRiskAnalysis(selectedWedge);
    const compliance = complianceAnalysis(selectedWedge);
    const builderFit = builderFitAnalysis(selectedWedge);
    const testability = testabilityAnalysis(selectedWedge);
    const decision = finalDecisionForCandidate({
      selectedWedge,
      candidateType: kind,
      evidenceItems,
      builderFit,
      overlap,
      permission,
      compliance
    });
    const unresolved = evidenceGaps(selectedWedge, evidenceItems, builderFit);
    const deepDiveScores = {
      evidence_quality_score: selectedWedge?.build_ready_criteria_result?.evidence_quality_score ?? round(Number(scoreItem.evidence_quality_score ?? 0)),
      wedge_clarity_score: selectedWedge?.build_ready_criteria_result?.wedge_clarity_score ?? round(Number(scoreItem.wedge_clarity_score ?? 0)),
      testability_score: selectedWedge?.testability_score ?? round(Number(scoreItem.testability_score ?? 0)),
      portfolio_overlap_score: overlap.overlap_score,
      permission_risk: permission.risk_level,
      compliance_risk: compliance.risk_level
    };

    const candidateEntry = {
      candidate_id: scoreItem.candidate_id,
      candidate_name: scoreItem.candidate_name,
      existing_opportunity_id: backlogEntry?.opportunity_id ?? null,
      source_url: hydrated.candidate.store_url,
      observed_position_in_seed: queueEntry.observed_position_in_seed ?? null,
      current_build_recommendation: scoreItem.build_recommendation,
      current_score_breakdown: {
        demand_score: scoreItem.demand_score,
        pain_score: scoreItem.pain_score,
        evidence_quality_score: scoreItem.evidence_quality_score,
        wedge_clarity_score: scoreItem.wedge_clarity_score,
        testability_score: scoreItem.testability_score,
        compliance_score: scoreItem.compliance_score,
        portfolio_overlap_score: scoreItem.portfolio_overlap_score,
        total_score: scoreItem.total_score,
        users_estimate: queueEntry.users ?? backlogEntry?.users_estimate ?? 0,
        rating: queueEntry.rating ?? backlogEntry?.rating ?? 0,
        review_count: queueEntry.reviews ?? backlogEntry?.review_count ?? 0
      },
      evidence_summary: inferEvidenceSummary(evidenceItems, hydrated.candidate),
      pain_signals: derivePainSignals(candidateContext, evidenceItems),
      support_or_review_evidence: supportOrReviewEvidence(evidenceItems),
      wedge_hypotheses: wedgeHypotheses,
      selected_wedge_hypothesis: selectedWedge,
      overlap_analysis: overlap,
      compliance_analysis: compliance,
      permission_risk_analysis: permission,
      testability_analysis: testability,
      builder_fit_analysis: builderFit,
      deep_dive_score_breakdown: deepDiveScores,
      additional_evidence_status: liveEvidence.status,
      unresolved_uncertainties: unresolved,
      final_recommendation: decision.final_recommendation,
      final_reason: decision.final_reason,
      next_step: decision.next_step,
      backlog_status: decision.backlog_status,
      status_detail: decision.status_detail
    };

    candidateEntries.push(candidateEntry);

    for (const [index, evidence] of evidenceItems.entries()) {
      evidencePackItems.push({
        evidence_id: `${candidateEntry.candidate_id}-support-qa-${index + 1}`,
        candidate_id: candidateEntry.candidate_id,
        source_type: evidence.source_type,
        source_url: evidence.source_url,
        captured_at: evidence.captured_at,
        text_excerpt: evidence.text_excerpt,
        pain_signal_type: evidence.pain_signal_type,
        reliability_weight: evidence.reliability_weight,
        recency_weight: evidence.recency_weight,
        supports_which_wedge: wedgeHypotheses
          .filter((wedge) => (
            wedge.evidence_support.includes(evidence.source_url)
            || lower(evidence.text_excerpt).includes("repro")
            || lower(evidence.text_excerpt).includes("url")
            || lower(evidence.text_excerpt).includes("browser")
          ))
          .map((wedge) => wedge.wedge_id)
          .slice(0, 3),
        limitations: liveEvidence.failure_reason ?? evidence.limitations ?? null
      });
    }
  }

  const report = buildSafeReport({
    stage: "SUPPORT_QA_HANDOFF_DEEP_DIVE",
    status: "passed",
    run_id: state.runContext.run_id,
    source_run_id: state.runContext.source_run_id ?? null,
    focus_seed: SUPPORT_SEED_ID,
    candidate_count: candidateEntries.length,
    build_ready_count: candidateEntries.filter((entry) => entry.final_recommendation === "build_ready").length,
    research_more_count: candidateEntries.filter((entry) => entry.final_recommendation === "research_more").length,
    skip_count: candidateEntries.filter((entry) => entry.final_recommendation === "skip").length,
    backlog_waiting_count: candidateEntries.filter((entry) => entry.final_recommendation === "backlog_waiting_for_evidence").length,
    next_step: candidateEntries.some((entry) => entry.final_recommendation === "build_ready")
      ? "human_candidate_review"
      : candidateEntries.some((entry) => entry.final_recommendation === "research_more")
        ? "continue_support_qa_research"
        : "skip_support_qa_seed",
    candidates: candidateEntries
  });

  const evidencePack = buildSafeReport({
    stage: "SUPPORT_QA_EVIDENCE_PACK",
    status: liveEvidenceExecuted ? "passed" : "skipped",
    run_id: state.runContext.run_id,
    focus_seed: SUPPORT_SEED_ID,
    live_unavailable: liveEvidenceExecuted === false,
    evidence_items: evidencePackItems,
    next_step: report.next_step
  });

  const functionalPlan = await writeFunctionalPlanIfNeeded(state, candidateEntries);
  const humanReviewQueue = buildHumanReviewQueue(state.runContext.run_id, candidateEntries);

  await validateArtifact(state.projectRoot, "support_qa_deep_dive.schema.json", SUPPORT_QA_DEEP_DIVE_ARTIFACT, report);
  await validateArtifact(state.projectRoot, "support_qa_evidence_pack.schema.json", SUPPORT_QA_EVIDENCE_PACK_ARTIFACT, evidencePack);
  await validateArtifact(state.projectRoot, "support_qa_human_review_queue.schema.json", SUPPORT_QA_HUMAN_REVIEW_QUEUE_ARTIFACT, humanReviewQueue);

  await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: SUPPORT_QA_DEEP_DIVE_ARTIFACT,
    data: report
  });
  await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: SUPPORT_QA_EVIDENCE_PACK_ARTIFACT,
    data: evidencePack
  });
  await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: SUPPORT_QA_HUMAN_REVIEW_QUEUE_ARTIFACT,
    data: humanReviewQueue
  });

  const markdown = supportCandidateMarkdown(candidateEntries, evidencePack, functionalPlan, humanReviewQueue, report);
  await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "76_support_qa_deep_dive.md",
    category: "support_qa_deep_dive",
    prefix: "76_support_qa_deep_dive",
    content: markdown
  });
  await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "79_support_qa_human_review_queue.md",
    category: "support_qa_deep_dive",
    prefix: "79_support_qa_human_review_queue",
    content: [
      `# Support/QA Human Review Queue`,
      ``,
      `- Run: \`${humanReviewQueue.run_id}\``,
      `- Queue count: ${humanReviewQueue.queue_count}`,
      `- No build today: ${humanReviewQueue.no_build_today === true}`,
      ``,
      markdownSection("Entries", markdownList((humanReviewQueue.entries ?? []).map((entry) => (
        `${entry.candidate_name}: ${entry.proposed_wedge} -> ${entry.recommended_decision}`
      )))),
      ``,
      markdownSection("Next Step", humanReviewQueue.next_step)
    ].join("\n")
  });
  await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "77_support_qa_evidence_pack.md",
    category: "support_qa_deep_dive",
    prefix: "77_support_qa_evidence_pack",
    content: [
      `# Support/QA Evidence Pack`,
      ``,
      `- Run: \`${evidencePack.run_id}\``,
      `- Live unavailable: ${evidencePack.live_unavailable === true}`,
      `- Evidence excerpts: ${evidencePack.evidence_items.length}`,
      ``,
      markdownSection("Captured Evidence", markdownList((evidencePack.evidence_items ?? []).slice(0, 18).map((item) => (
        `${item.candidate_id} | ${item.source_type} | ${item.text_excerpt}`
      ))))
    ].join("\n")
  });

  await upsertOpportunityEntries(state.projectRoot, buildBacklogEntries(state, candidateEntries));

  return {
    runDir: state.runDir,
    report,
    evidencePack,
    functionalPlan,
    humanReviewQueue
  };
}
