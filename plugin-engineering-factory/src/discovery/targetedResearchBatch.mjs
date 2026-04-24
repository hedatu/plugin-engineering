import fs from "node:fs/promises";
import path from "node:path";
import { normalizeDiscoveryThresholds } from "./engine.mjs";
import { upsertOpportunityEntries } from "./opportunityBacklog.mjs";
import { loadPortfolioRegistry } from "../portfolio/registry.mjs";
import { collectLiveEvidenceForCandidate } from "../research/liveResearch.mjs";
import {
  buildSafeReport,
  loadOptionalManagedArtifact,
  markdownList,
  markdownSection,
  validateArtifact,
  writeManagedJsonArtifact,
  writeManagedMarkdownArtifact
} from "../review/helpers.mjs";
import { fileExists, nowIso, readJson } from "../utils/io.mjs";

export const TARGETED_RESEARCH_BATCH_ARTIFACT = "46_targeted_research_batch.json";
export const WEDGE_DECISION_BOARD_ARTIFACT = "47_wedge_decision_board.json";
export const HUMAN_CANDIDATE_REVIEW_QUEUE_ARTIFACT = "48_human_candidate_review_queue.json";

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function lower(value) {
  return `${value ?? ""}`.trim().toLowerCase();
}

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function average(values) {
  const filtered = (values ?? []).filter((value) => Number.isFinite(value));
  if (filtered.length === 0) {
    return 0;
  }
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function normalizeText(value) {
  return `${value ?? ""}`.replace(/\s+/g, " ").trim();
}

function candidateText(candidate) {
  return normalizeText([
    candidate.name,
    candidate.live_summary,
    candidate.category,
    ...(candidate.signals ?? [])
  ].join(" "));
}

function inferCandidateKind(candidate) {
  const text = lower(candidateText(candidate));
  if (/json|schema|parse|diff|formatter|compare/.test(text)) return "json_developer_utility";
  if (/csp|content security policy|header/.test(text)) return "security_csp";
  if (/amazon|review harvest|scrap/.test(text)) return "review_scraper";
  if (/form|fill|autofill|profile|intake/.test(text)) return "form_fill";
  if (/gmail|snippet|template|compose|reply/.test(text)) return "gmail_snippet";
  if (/tab|tabs|window|csv|export|session/.test(text)) return "tab_export";
  if (/apk|developer|debug|analyz/.test(text)) return "developer_utility";
  return "generic_productivity";
}

function deriveEstimatedArchetype(candidate, candidateKind) {
  if (candidate.wedge_family === "single_profile_form_fill" && candidateKind === "form_fill") {
    return "single_profile_form_fill";
  }
  if (candidate.wedge_family === "gmail_snippet" && candidateKind === "gmail_snippet") {
    return "gmail_snippet";
  }
  if (candidate.wedge_family === "tab_csv_window_export" && candidateKind === "tab_export") {
    return "tab_csv_window_export";
  }
  return "unsupported_research_only";
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function normalizeEvidenceItem(item) {
  return {
    source_type: `${item.source_type ?? item.type ?? "public_doc"}`.trim(),
    source_url: item.source_url ?? item.url ?? "",
    source_domain: extractDomain(item.source_url ?? item.url ?? ""),
    captured_at: item.captured_at ?? null,
    text_excerpt: normalizeText(item.text_excerpt ?? item.quote ?? item.topic ?? ""),
    reliability_weight: Number(item.reliability_weight ?? item.evidence_weight ?? 0.55),
    recency_weight: Number(item.recency_weight ?? 0.6),
    pain_signal_type: `${item.pain_signal_type ?? item.issue_type ?? "workflow_friction"}`.trim(),
    evidence_mode: item.evidence_mode ?? null
  };
}

function evidenceSpecificityScore(evidence) {
  const text = lower(evidence.text_excerpt);
  let score = 42;
  if (/current window|visible fields|readonly|disabled|select|textarea|csv|markdown|schema|csp|header/.test(text)) score += 26;
  if (/copy-paste|copy paste|compare|format|diff|one click|keyboard|overwrite|no matching/.test(text)) score += 18;
  if (/buggy|bad|doesn'?t work|does not work|broken/.test(text)) score -= 20;
  if (text.length >= 60) score += 8;
  return clamp(score);
}

function dedupeEvidence(items) {
  const seen = new Set();
  const result = [];
  for (const item of items ?? []) {
    const normalized = normalizeEvidenceItem(item);
    if (!normalized.text_excerpt) {
      continue;
    }
    const key = `${normalized.source_type}|${normalized.source_url}|${normalized.text_excerpt}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function analyzeEvidence(evidenceItems) {
  const normalized = dedupeEvidence(evidenceItems);
  const sourceTypes = unique(normalized.map((item) => item.source_type));
  const sourceDomains = unique(normalized.map((item) => item.source_domain).filter(Boolean));
  const externalDomains = sourceDomains.filter((domain) => !domain.includes("chromewebstore.google.com"));
  const complaintEvidence = normalized.filter((item) => /problem|slow|manual|broken|missing|need|want|export|fill|compare|diff|header|review|json|field/.test(lower(item.text_excerpt)));
  return {
    evidence_items: normalized,
    evidence_count: normalized.length,
    source_types: sourceTypes,
    source_domains: sourceDomains,
    independent_source_count: unique([...sourceTypes, ...externalDomains]).length,
    independent_external_source_count: externalDomains.length,
    repeated_pain_count: complaintEvidence.length,
    source_diversity_score: clamp((sourceTypes.length * 18) + (externalDomains.length * 16)),
    specificity_score: round(average(normalized.map(evidenceSpecificityScore))),
    reliability_score: round(average(normalized.map((item) => item.reliability_weight * 100))),
    recency_score: round(average(normalized.map((item) => item.recency_weight * 100))),
    independent_sources_ok: sourceTypes.length >= 2 || externalDomains.length >= 2,
    store_only: normalized.length > 0 && normalized.every((item) => item.source_type === "chrome_web_store_listing" || item.source_type === "chrome_web_store_review"),
    representative_evidence: normalized.slice(0, 6)
  };
}

function buildTargetedResearchQuestions(context) {
  const questions = [
    "What exact user action is failing or taking too many steps right now?",
    "Does that same complaint repeat across at least two independent sources?",
    "Can the pain narrow into a single-purpose wedge instead of a broad helper?",
    "What makes this candidate meaningfully different from the current portfolio?",
    "What deterministic browser happy path would prove the wedge works?",
    "Can the wedge stay within low-risk Chrome permissions only?",
    "Would a user install a dedicated extension just for this narrower job?"
  ];
  if (context.candidate_kind === "form_fill") {
    questions.push("Is this pain tied to a specific workflow such as recruiter intake, CRM entry, customer support, or job applications?");
    questions.push("Does the wedge clearly avoid overlap with LeadFill One Profile?");
  }
  if (context.candidate_kind === "json_developer_utility") {
    questions.push("Is the dominant pain compare, format, diff, schema validation, mock data, or API debugging?");
  }
  if (context.candidate_kind === "review_scraper") {
    questions.push("Does this workflow rely on scraping or platform terms that make the wedge risky to ship?");
  }
  if (context.candidate_kind === "security_csp") {
    questions.push("Can the wedge stay read-only, such as a header analyzer, instead of mutating requests?");
  }
  if (context.candidate_kind === "tab_export") {
    questions.push("Is the user pain about current-window export, session handoff, or output formatting?");
    questions.push("Does the wedge stay meaningfully different from tab_csv_window_export?");
  }
  return unique(questions).slice(0, 7);
}

function buildExpectedFunctionalTestMatrix(context, selectedWedge = null) {
  const wedge = lower(selectedWedge?.one_sentence_value);
  if (context.estimated_archetype === "single_profile_form_fill") {
    return [
      "empty form",
      "partially filled form",
      "readonly and disabled fields remain unchanged",
      "select field matching",
      "no matching fields feedback",
      "overwrite default=false",
      "popup feedback display"
    ];
  }
  if (context.estimated_archetype === "gmail_snippet") {
    return [
      "compose insert",
      "shortcut trigger",
      "empty compose guard",
      "snippet search",
      "permission boundary"
    ];
  }
  if (context.estimated_archetype === "tab_csv_window_export" || wedge.includes("tab")) {
    return [
      "current window only",
      "download success state",
      "CSV or selected output format stability",
      "empty window handling",
      "success feedback display"
    ];
  }
  if (context.candidate_kind === "json_developer_utility") {
    return [
      "paste valid JSON",
      "invalid JSON error feedback",
      "diff result determinism",
      "copy output action",
      "local-only permission boundary"
    ];
  }
  if (context.candidate_kind === "security_csp") {
    return [
      "read response headers",
      "decode CSP directives",
      "clear no-header feedback",
      "no content mutation",
      "low-permission boundary"
    ];
  }
  return [
    "happy path completes",
    "empty state feedback",
    "error feedback",
    "permission boundary"
  ];
}

function buildWedgeHypotheses(context, evidenceAnalysis) {
  const evidenceSupport = evidenceAnalysis.representative_evidence.map((item) => item.source_url).filter(Boolean).slice(0, 4);
  const overlap = context.original_overlap_score;

  if (context.candidate_kind === "form_fill") {
    return [
      ["Fill recruiter intake forms with one local profile and explicit overwrite protection.", 84, 90, 34, overlap + 6, "single_profile_form_fill", "Open a controlled recruiter-style form, fill blank fields, keep existing values unchanged, and verify popup counts.", "It narrows to a recruiter intake workflow instead of generic every-form autofill."],
      ["Fill only visible supported fields from one local profile with clear skipped-field feedback.", 82, 88, 32, overlap + 4, "single_profile_form_fill", "Verify visible-field matching, readonly skips, no-match feedback, and overwrite=false default on a controlled form.", "It is scoped by visible-field safety and explicit feedback, but it is still close to LeadFill unless workflow evidence sharpens."],
      ["Save one local profile for a narrow repeated form flow without templates, sync, or cloud storage.", 80, 84, 28, overlap + 2, "single_profile_form_fill", "Save one profile, edit it, fill supported fields, and confirm local-only behavior.", "The local-only minimalism is clearer, but differentiation is still weak if the target workflow is generic."]
    ].map((item, index) => ({
      wedge_id: `${context.candidate_id}-form-${index + 1}`,
      one_sentence_value: item[0],
      target_user: "Users repeating one narrow form workflow.",
      trigger_moment: "When a mostly blank repeated form should be filled fast and safely.",
      pain_addressed: "Repeated entry, overwrite anxiety, and unclear skipped-field feedback.",
      evidence_support: evidenceSupport,
      single_purpose_score: item[1],
      testability_score: item[2],
      permission_risk: item[3],
      portfolio_overlap_risk: clamp(item[4]),
      expected_archetype: item[5],
      happy_path_test: item[6],
      why_this_is_not_a_clone: item[7],
      build_recommendation: overlap <= 50 ? "research_more" : "skip"
    }));
  }

  if (context.candidate_kind === "tab_export") {
    return [
      ["Copy the current window's tabs as a markdown link list for writers and researchers.", 88, 90, 18, overlap - 18, "tab_csv_window_export", "Open a current window, export markdown links, and verify other windows are excluded.", "The output format and trigger moment differ from current-window CSV export."],
      ["Create a current-window session handoff snapshot for support or debug workflows.", 84, 88, 20, overlap - 10, "tab_csv_window_export", "Export current window snapshot and verify visible success state plus stable output.", "The workflow is handoff-first rather than generic CSV export, but evidence must prove that distinction."],
      ["Export only the active window with explicit privacy-bounded feedback and download confirmation.", 80, 86, 18, overlap - 8, "tab_csv_window_export", "Export active window only and verify clear feedback plus bounded output.", "The trust angle is sharper, but differentiation still needs stronger evidence."]
    ].map((item, index) => ({
      wedge_id: `${context.candidate_id}-tab-${index + 1}`,
      one_sentence_value: item[0],
      target_user: "Researchers or operators handing off a focused tab set.",
      trigger_moment: "When a current tab set needs a shareable output artifact.",
      pain_addressed: "CSV noise, weak scope trust, and manual handoff work.",
      evidence_support: evidenceSupport,
      single_purpose_score: item[1],
      testability_score: item[2],
      permission_risk: item[3],
      portfolio_overlap_risk: clamp(item[4]),
      expected_archetype: item[5],
      happy_path_test: item[6],
      why_this_is_not_a_clone: item[7],
      build_recommendation: overlap <= 55 ? "research_more" : "skip"
    }));
  }

  if (context.candidate_kind === "json_developer_utility") {
    return [
      ["Compare two pasted JSON payloads locally with deterministic diff output and copy-ready results.", 90, 92, 12, Math.max(18, overlap - 18), "unsupported_research_only", "Paste two JSON payloads, run compare, verify deterministic diff and copy action locally.", "It is local-only and developer-facing, but the factory does not yet have a JSON utility builder."],
      ["Parse broken JSON locally and explain the exact formatting error before reformatting.", 86, 88, 10, Math.max(15, overlap - 20), "unsupported_research_only", "Paste invalid JSON, show deterministic parse error, then reformat valid JSON locally.", "This is a pure local debugging wedge, but still outside current builder coverage."],
      ["Check pasted JSON against a local schema snippet and surface only the first blocking mismatch.", 82, 84, 12, Math.max(20, overlap - 16), "unsupported_research_only", "Paste JSON plus schema, validate locally, show first mismatch with copy-ready output.", "The user and trigger are clear, but builder support is still missing."]
    ].map((item, index) => ({
      wedge_id: `${context.candidate_id}-json-${index + 1}`,
      one_sentence_value: item[0],
      target_user: "Developers and operators debugging payloads.",
      trigger_moment: "When a small JSON task should stay local and fast.",
      pain_addressed: "Manual debugging and cleanup around JSON payloads.",
      evidence_support: evidenceSupport,
      single_purpose_score: item[1],
      testability_score: item[2],
      permission_risk: item[3],
      portfolio_overlap_risk: clamp(item[4]),
      expected_archetype: item[5],
      happy_path_test: item[6],
      why_this_is_not_a_clone: item[7],
      build_recommendation: "research_more"
    }));
  }

  if (context.candidate_kind === "security_csp") {
    return [
      ["Read and decode page CSP headers without modifying requests or bypassing site policy.", 88, 86, 22, Math.max(18, overlap - 20), "unsupported_research_only", "Open a page with known CSP headers, parse directives, and verify read-only analyzer output.", "It is a different developer wedge, but still outside the current three builders."],
      ["Generate a copyable human-readable CSP summary from page headers for debugging handoff.", 84, 82, 18, Math.max(16, overlap - 22), "unsupported_research_only", "Read a CSP header and output a plain-language summary plus copy action.", "The output is more specific than a generic tester, but builder support is absent."],
      ["Temporarily inject or mutate CSP headers to test alternate policies in-browser.", 74, 70, 68, Math.max(18, overlap - 18), "unsupported_research_only", "Modify page CSP and verify resource behavior changes predictably.", "Useful but higher risk because it mutates security behavior."]
    ].map((item, index) => ({
      wedge_id: `${context.candidate_id}-csp-${index + 1}`,
      one_sentence_value: item[0],
      target_user: "Developers or site owners debugging CSP configuration.",
      trigger_moment: "When a CSP issue needs immediate browser-side inspection.",
      pain_addressed: "Manual header inspection is slow and error-prone.",
      evidence_support: evidenceSupport,
      single_purpose_score: item[1],
      testability_score: item[2],
      permission_risk: item[3],
      portfolio_overlap_risk: clamp(item[4]),
      expected_archetype: item[5],
      happy_path_test: item[6],
      why_this_is_not_a_clone: item[7],
      build_recommendation: index === 2 ? "skip" : "research_more"
    }));
  }

  if (context.candidate_kind === "review_scraper") {
    return [
      ["Capture a local snapshot of currently visible reviews for manual analysis without bulk scraping.", 72, 78, 54, Math.max(24, overlap - 8), "unsupported_research_only", "Open a static review page fixture, capture visible rows only, and export them locally.", "The local-only wedge is narrower, but marketplace policy risk still dominates."],
      ["Harvest reviews in bulk across listing pages and export them for downstream analysis.", 82, 76, 82, overlap, "unsupported_research_only", "Traverse search pages and export reviews in bulk.", "The wedge is clear but too risky on compliance and platform terms."],
      ["Summarize visible review snippets already on the page into a local copy-ready brief.", 68, 72, 48, Math.max(20, overlap - 12), "unsupported_research_only", "On a static review fixture, summarize visible snippets locally without cross-page navigation.", "Safer than scraping, but current evidence does not prove install-worthiness."]
    ].map((item, index) => ({
      wedge_id: `${context.candidate_id}-review-${index + 1}`,
      one_sentence_value: item[0],
      target_user: "People manually evaluating marketplace reviews.",
      trigger_moment: "When visible review content needs a faster local summary or export.",
      pain_addressed: "Manual note-taking or bulk extraction pressure around review pages.",
      evidence_support: evidenceSupport,
      single_purpose_score: item[1],
      testability_score: item[2],
      permission_risk: item[3],
      portfolio_overlap_risk: clamp(item[4]),
      expected_archetype: item[5],
      happy_path_test: item[6],
      why_this_is_not_a_clone: item[7],
      build_recommendation: index === 1 ? "skip" : "research_more"
    }));
  }

  return [
    ["Narrow the workflow to one local-only repeatable action with clear success feedback.", 74, 72, 26, overlap, context.estimated_archetype, "Run one constrained local action and verify explicit success feedback.", "The wedge is workflow-first, but evidence is still generic."],
    ["Turn a repetitive browser task into a copy-ready local output instead of a heavy workflow.", 76, 74, 22, overlap, context.estimated_archetype, "Produce a deterministic output artifact locally and verify copy or download behavior.", "The artifact is narrower, but demand still needs clearer repetition."],
    ["This broad helper surface still feels too wide for a dedicated extension.", 48, 58, 60, overlap, "unsupported_research_only", "Undefined broad workflow.", "It is too broad to justify a new build."]
  ].map((item, index) => ({
    wedge_id: `${context.candidate_id}-generic-${index + 1}`,
    one_sentence_value: item[0],
    target_user: "Generic productivity users.",
    trigger_moment: "Whenever the workflow appears.",
    pain_addressed: "Broad workflow friction.",
    evidence_support: evidenceSupport,
    single_purpose_score: item[1],
    testability_score: item[2],
    permission_risk: item[3],
    portfolio_overlap_risk: clamp(item[4]),
    expected_archetype: item[5],
    happy_path_test: item[6],
    why_this_is_not_a_clone: item[7],
    build_recommendation: index === 2 ? "skip" : "research_more"
  }));
}

function selectBestWedge(wedgeHypotheses) {
  return [...(wedgeHypotheses ?? [])].sort((left, right) => {
    const leftScore = (left.single_purpose_score * 0.35)
      + (left.testability_score * 0.25)
      + ((left.evidence_support?.length ?? 0) * 7)
      - (left.portfolio_overlap_risk * 0.18)
      - (left.permission_risk * 0.1);
    const rightScore = (right.single_purpose_score * 0.35)
      + (right.testability_score * 0.25)
      + ((right.evidence_support?.length ?? 0) * 7)
      - (right.portfolio_overlap_risk * 0.18)
      - (right.permission_risk * 0.1);
    return rightScore - leftScore;
  })[0] ?? null;
}

function buildPortfolioOverlapAnalysis(context, selectedWedge) {
  const similarExistingItems = context.overlap_analysis?.similar_existing_items ?? [];
  const overlapScore = round(selectedWedge
    ? average([context.original_overlap_score, selectedWedge.portfolio_overlap_risk])
    : context.original_overlap_score);
  return {
    existing_related_items: similarExistingItems,
    overlap_tags: unique([
      ...(context.candidate.signals ?? []),
      context.estimated_archetype,
      context.candidate_kind,
      overlapScore >= 70 ? "high_overlap" : null
    ]),
    overlap_score: overlapScore,
    differentiation_required: context.overlap_analysis?.differentiation_required ?? [
      "Different target user or trigger moment than the existing portfolio.",
      "Different output artifact or workflow outcome than the closest portfolio item.",
      "Explain why this is not just a small surface variation."
    ],
    allowed_if_differentiated: overlapScore < 70,
    reject_if_too_similar: overlapScore >= 70,
    similar_existing_items: similarExistingItems,
    overlap_reason: context.overlap_analysis?.overlap_reason ?? "No explicit overlap analysis was available."
  };
}

function buildTestabilityAnalysis(context, selectedWedge) {
  const expectedFunctionalTestMatrix = buildExpectedFunctionalTestMatrix(context, selectedWedge);
  const existingBuilderSupported = context.estimated_archetype !== "unsupported_research_only";
  const clearHappyPath = expectedFunctionalTestMatrix.length >= 4 && Boolean(selectedWedge?.happy_path_test);
  return {
    existing_builder_supported: existingBuilderSupported,
    clear_happy_path: clearHappyPath,
    happy_path_test: selectedWedge?.happy_path_test ?? null,
    expected_functional_test_matrix: expectedFunctionalTestMatrix,
    testability_score: round(clamp(average([
      context.original_score?.testability_score ?? 0,
      selectedWedge?.testability_score ?? 0,
      existingBuilderSupported ? 86 : 68,
      clearHappyPath ? 90 : 55
    ]))),
    blockers: unique([
      !existingBuilderSupported ? "unsupported_archetype_without_builder_expansion" : null,
      !clearHappyPath ? "happy_path_not_clear_enough" : null
    ])
  };
}

function buildComplianceAnalysis(context, selectedWedge) {
  const text = lower(candidateText(context.candidate));
  let riskLevel = "low";
  let riskScore = clamp(selectedWedge?.permission_risk ?? 26);
  const requiredPermissions = [];
  const riskReasons = [];

  if (context.candidate_kind === "review_scraper") {
    riskLevel = "high";
    riskScore = 84;
    riskReasons.push("Marketplace review collection can create scraping and platform-terms risk.");
  } else if (context.candidate_kind === "security_csp" && /inject|override|disable|bypass/.test(text + lower(selectedWedge?.one_sentence_value))) {
    riskLevel = "high";
    riskScore = 78;
    riskReasons.push("Mutating CSP or security behavior is risky and easy to misrepresent.");
  } else if (context.candidate_kind === "form_fill") {
    riskLevel = /crm|recruit|job|apply/.test(text) ? "medium" : "low";
    riskScore = clamp(Math.max(riskScore, riskLevel === "medium" ? 42 : 30));
    riskReasons.push("Form-fill flows must avoid transmitting sensitive profile data and keep permissions minimal.");
    requiredPermissions.push("storage");
  } else if (context.candidate_kind === "tab_export") {
    riskLevel = "low";
    riskScore = clamp(Math.max(18, riskScore));
    requiredPermissions.push("tabs");
    if (/download|csv|markdown|snapshot/.test(lower(selectedWedge?.one_sentence_value))) {
      requiredPermissions.push("downloads");
    }
  } else if (context.candidate_kind === "json_developer_utility") {
    riskLevel = "low";
    riskScore = 12;
    riskReasons.push("This can remain local-only without host permissions.");
  } else if (context.candidate_kind === "security_csp") {
    riskLevel = "medium";
    riskScore = clamp(Math.max(32, riskScore));
    riskReasons.push("The wedge should stay read-only to remain acceptable.");
  }

  if (context.estimated_archetype === "unsupported_research_only") {
    riskReasons.push("Current factory builder coverage does not match this wedge.");
  }

  return {
    risk_level: riskLevel,
    risk_score: riskScore,
    compliance_score: round(clamp(100 - riskScore)),
    required_permissions: unique(requiredPermissions),
    risk_reasons: unique(riskReasons),
    low_permission_only: riskScore <= 40,
    allowed_for_build_ready: riskLevel !== "high"
  };
}

function computeBuildReadyThresholds(runContext) {
  const thresholds = normalizeDiscoveryThresholds(runContext.thresholds ?? {});
  return {
    min_evidence_quality_score: Math.max(75, runContext.discovery?.min_evidence_quality_score ?? thresholds.min_evidence_quality_score ?? 75),
    min_wedge_clarity_score: Math.max(80, thresholds.min_single_purpose_score ?? 80),
    min_testability_score: Math.max(75, runContext.discovery?.min_testability_score ?? thresholds.min_testability_score ?? 75),
    max_portfolio_overlap_score: Math.min(50, runContext.discovery?.max_portfolio_overlap_score ?? thresholds.max_portfolio_overlap_penalty ?? 50),
    max_permission_risk_score: Math.min(45, thresholds.max_permission_risk_score ?? 45)
  };
}

function buildEvidenceGaps(context, evidenceAnalysis) {
  return unique([
    evidenceAnalysis.evidence_count < 4 ? "Evidence volume is still thin for a confident product decision." : null,
    evidenceAnalysis.store_only ? "Evidence still leans too heavily on Chrome Web Store controlled sources." : null,
    evidenceAnalysis.independent_source_count < 2 ? "Need at least two independent evidence sources before build_ready." : null,
    evidenceAnalysis.specificity_score < 70 ? "Pain descriptions remain too generic to lock a single-purpose wedge." : null,
    context.original_overlap_score >= 50 ? "Differentiation from the current portfolio is still not obvious." : null
  ]);
}

function buildOriginalBlockers(context) {
  return unique([
    ...(context.original_score?.decision_rationale ?? []),
    context.original_recommendation === "research_more" ? "Original live queue decision remained research_more." : null,
    context.original_overlap_score >= 50 ? `portfolio_overlap_score=${context.original_overlap_score}` : null
  ]);
}

function buildAdditionalEvidenceCollected(existingEvidence, additionalEvidence) {
  const existingKeys = new Set(dedupeEvidence(existingEvidence).map((item) => `${item.source_type}|${item.source_url}|${item.text_excerpt}`));
  return dedupeEvidence(additionalEvidence)
    .filter((item) => !existingKeys.has(`${item.source_type}|${item.source_url}|${item.text_excerpt}`))
    .slice(0, 8);
}

async function collectAdditionalEvidence(context) {
  if ((context.runContext.research?.mode ?? "fixture") !== "live") {
    return {
      status: "skipped",
      live_unavailable: true,
      reason: "Run is not configured for live research.",
      additional_evidence: []
    };
  }

  try {
    const result = await collectLiveEvidenceForCandidate(context.candidate, {
      timeoutMs: context.runContext.research?.timeout_ms ?? 15000,
      maxGithubIssues: context.runContext.research?.max_github_issues ?? 5
    });
    return {
      status: "passed",
      live_unavailable: false,
      reason: null,
      additional_evidence: result.evidence ?? []
    };
  } catch (error) {
    return {
      status: "skipped",
      live_unavailable: true,
      reason: error.message,
      additional_evidence: []
    };
  }
}

function buildUpdatedScoreBreakdown(context, evidenceAnalysis, selectedWedge, overlapAnalysis, testabilityAnalysis, complianceAnalysis) {
  const original = context.original_score ?? {};
  const demandScore = round(clamp(average([
    original.demand_score ?? 0,
    evidenceAnalysis.repeated_pain_count >= 4 ? 78 : 66,
    evidenceAnalysis.source_diversity_score
  ])));
  const painScore = round(clamp(average([
    original.pain_score ?? 0,
    evidenceAnalysis.specificity_score,
    evidenceAnalysis.reliability_score
  ])));
  const evidenceQualityScore = round(clamp(average([
    original.evidence_quality_score ?? 0,
    evidenceAnalysis.reliability_score,
    evidenceAnalysis.source_diversity_score,
    evidenceAnalysis.specificity_score,
    evidenceAnalysis.recency_score
  ])));
  const wedgeClarityScore = round(clamp(average([
    original.wedge_clarity_score ?? 0,
    selectedWedge.single_purpose_score,
    evidenceAnalysis.specificity_score
  ])));
  const feasibilityScore = round(clamp(average([
    original.feasibility_score ?? 0,
    context.estimated_archetype === "unsupported_research_only" ? 58 : 88,
    selectedWedge.permission_risk <= 40 ? 86 : 62
  ])));
  const testabilityScore = round(clamp(average([
    original.testability_score ?? 0,
    selectedWedge.testability_score,
    testabilityAnalysis.testability_score
  ])));
  const complianceScore = round(clamp(average([
    original.compliance_score ?? 0,
    complianceAnalysis.compliance_score
  ])));
  const differentiationScore = round(clamp(average([
    original.differentiation_score ?? 0,
    100 - overlapAnalysis.overlap_score
  ])));
  const maintenanceRiskScore = round(clamp(average([
    original.maintenance_risk_score ?? 0,
    context.candidate_kind === "form_fill" ? 52 : context.candidate_kind === "gmail_snippet" ? 48 : 34,
    complianceAnalysis.risk_score * 0.45
  ])));
  const confidenceScore = round(clamp(average([
    original.confidence_score ?? 0,
    evidenceQualityScore,
    testabilityScore,
    evidenceAnalysis.source_diversity_score
  ])));
  const totalScore = round(clamp(
    (demandScore * 0.16)
    + (painScore * 0.18)
    + (evidenceQualityScore * 0.15)
    + (wedgeClarityScore * 0.12)
    + (feasibilityScore * 0.1)
    + (testabilityScore * 0.11)
    + (complianceScore * 0.08)
    + (differentiationScore * 0.06)
    + (confidenceScore * 0.1)
    - (overlapAnalysis.overlap_score * 0.05)
    - (maintenanceRiskScore * 0.03)
  ));
  const preliminaryRecommendation = overlapAnalysis.reject_if_too_similar || complianceAnalysis.risk_level === "high"
    ? "skip"
    : evidenceQualityScore >= 75 && wedgeClarityScore >= 80 && testabilityScore >= 75 && overlapAnalysis.overlap_score <= 50
      ? "build"
      : "research_more";

  return {
    candidate_id: context.candidate_id,
    selected_wedge_hypothesis: selectedWedge.one_sentence_value,
    demand_score: demandScore,
    pain_score: painScore,
    evidence_quality_score: evidenceQualityScore,
    wedge_clarity_score: wedgeClarityScore,
    feasibility_score: feasibilityScore,
    testability_score: testabilityScore,
    compliance_score: complianceScore,
    differentiation_score: differentiationScore,
    portfolio_overlap_penalty: overlapAnalysis.overlap_score,
    maintenance_risk_score: maintenanceRiskScore,
    confidence_score: confidenceScore,
    total_score: totalScore,
    build_recommendation: preliminaryRecommendation,
    score_delta_from_original: round(totalScore - (context.original_score?.total_score ?? 0)),
    decision_rationale: unique([
      `evidence_quality=${evidenceQualityScore}`,
      `wedge_clarity=${wedgeClarityScore}`,
      `testability=${testabilityScore}`,
      `portfolio_overlap=${overlapAnalysis.overlap_score}`,
      `compliance_risk=${complianceAnalysis.risk_level}`
    ])
  };
}

function buildBuildReadyCriteria(context, updatedScore, overlapAnalysis, testabilityAnalysis, complianceAnalysis, evidenceAnalysis) {
  const thresholds = computeBuildReadyThresholds(context.runContext);
  const failures = [];
  if (updatedScore.evidence_quality_score < thresholds.min_evidence_quality_score) failures.push(`evidence_quality_score=${updatedScore.evidence_quality_score}`);
  if (updatedScore.wedge_clarity_score < thresholds.min_wedge_clarity_score) failures.push(`wedge_clarity_score=${updatedScore.wedge_clarity_score}`);
  if (updatedScore.testability_score < thresholds.min_testability_score) failures.push(`testability_score=${updatedScore.testability_score}`);
  if (overlapAnalysis.overlap_score > thresholds.max_portfolio_overlap_score) failures.push(`portfolio_overlap_score=${overlapAnalysis.overlap_score}`);
  if (complianceAnalysis.risk_level === "high" || complianceAnalysis.risk_score > thresholds.max_permission_risk_score) failures.push(`compliance_risk=${complianceAnalysis.risk_level}`);
  if (!testabilityAnalysis.clear_happy_path || !testabilityAnalysis.existing_builder_supported || !complianceAnalysis.allowed_for_build_ready) failures.push("product_acceptance_forecast_failed");
  if (!evidenceAnalysis.independent_sources_ok) failures.push("independent_sources_below_two");
  if (!testabilityAnalysis.clear_happy_path) failures.push("clear_happy_path_missing");
  if ((testabilityAnalysis.expected_functional_test_matrix?.length ?? 0) === 0) failures.push("expected_functional_test_matrix_missing");
  if (context.estimated_archetype === "unsupported_research_only") failures.push("current_factory_has_no_matching_builder");

  return {
    thresholds,
    passed: failures.length === 0,
    failed_reasons: unique(failures),
    human_candidate_review_required: context.runContext.allow_auto_build_after_human_review !== true
  };
}

function chooseFinalRecommendation(buildReadyCriteria, overlapAnalysis, complianceAnalysis, evidenceAnalysis) {
  if (buildReadyCriteria.passed) {
    return "build_ready";
  }
  if (overlapAnalysis.reject_if_too_similar || complianceAnalysis.risk_level === "high") {
    return "skip";
  }
  if (evidenceAnalysis.store_only) {
    return "research_more";
  }
  return "research_more";
}

function buildFinalDecisionRationale(context, finalRecommendation, buildReadyCriteria, overlapAnalysis, complianceAnalysis, evidenceAnalysis, selectedWedge) {
  const rationale = [
    `best_wedge=${selectedWedge.one_sentence_value}`,
    `portfolio_overlap_score=${overlapAnalysis.overlap_score}`,
    `independent_source_count=${evidenceAnalysis.independent_source_count}`,
    `compliance_risk=${complianceAnalysis.risk_level}`
  ];
  if (finalRecommendation === "build_ready") {
    rationale.push("All strict build-ready gates passed, but human candidate review is still required before any build.");
  } else if (finalRecommendation === "skip" && overlapAnalysis.reject_if_too_similar) {
    rationale.push("This candidate is clear enough to evaluate and should be skipped because it is too close to the existing portfolio.");
  } else if (finalRecommendation === "skip") {
    rationale.push("Compliance or platform-risk blockers dominate the opportunity.");
  } else {
    rationale.push(`Still missing gates: ${buildReadyCriteria.failed_reasons.join(", ")}`);
  }
  return rationale;
}

function buildNextStep(finalRecommendation, targetedResearchQuestions, buildReadyCriteria) {
  if (finalRecommendation === "build_ready") {
    return buildReadyCriteria.human_candidate_review_required
      ? "human_candidate_review_required"
      : "human_candidate_review_required_before_build";
  }
  if (finalRecommendation === "skip") {
    return "continue_live_discovery_for_lower_overlap_candidates";
  }
  return `continue_targeted_research: ${targetedResearchQuestions.slice(0, 3).join(" | ")}`;
}

function summarizeCandidate(entry) {
  return {
    candidate_id: entry.candidate_id,
    candidate_name: entry.candidate_name,
    proposed_wedge: entry.best_wedge_if_any?.one_sentence_value ?? null,
    final_recommendation: entry.final_recommendation,
    confidence_score: entry.updated_score_breakdown.confidence_score,
    evidence_quality_score: entry.updated_score_breakdown.evidence_quality_score,
    testability_score: entry.updated_score_breakdown.testability_score,
    portfolio_overlap_score: entry.portfolio_overlap_analysis.overlap_score
  };
}

function buildDecisionBoard(runContext, entries) {
  const buildReadyCandidates = entries.filter((entry) => entry.final_recommendation === "build_ready");
  const researchMoreCandidates = entries.filter((entry) => entry.final_recommendation === "research_more");
  const skippedCandidates = entries.filter((entry) => entry.final_recommendation === "skip");
  const highestConfidence = [...entries].sort((left, right) => right.updated_score_breakdown.confidence_score - left.updated_score_breakdown.confidence_score)[0] ?? null;
  const lowestOverlap = [...entries].sort((left, right) => left.portfolio_overlap_analysis.overlap_score - right.portfolio_overlap_analysis.overlap_score)[0] ?? null;
  const bestTestability = [...entries].sort((left, right) => right.testability_analysis.testability_score - left.testability_analysis.testability_score)[0] ?? null;
  const highestComplianceRisk = [...entries].sort((left, right) => right.compliance_analysis.risk_score - left.compliance_analysis.risk_score)[0] ?? null;

  return buildSafeReport({
    stage: "WEDGE_DECISION_BOARD",
    status: "passed",
    run_id: runContext.run_id,
    top_candidates_reviewed: entries.length,
    build_ready_candidates: buildReadyCandidates.map(summarizeCandidate),
    research_more_candidates: researchMoreCandidates.map(summarizeCandidate),
    skipped_candidates: skippedCandidates.map(summarizeCandidate),
    highest_confidence_candidate: highestConfidence ? summarizeCandidate(highestConfidence) : null,
    lowest_overlap_candidate: lowestOverlap ? summarizeCandidate(lowestOverlap) : null,
    best_testability_candidate: bestTestability ? summarizeCandidate(bestTestability) : null,
    highest_compliance_risk_candidate: highestComplianceRisk ? summarizeCandidate(highestComplianceRisk) : null,
    recommended_human_review_candidates: [...buildReadyCandidates, ...researchMoreCandidates].slice(0, 5).map((entry) => ({
      candidate_id: entry.candidate_id,
      candidate_name: entry.candidate_name,
      proposed_wedge: entry.best_wedge_if_any?.one_sentence_value ?? null,
      recommended_decision: entry.final_recommendation === "build_ready" ? "approve_build" : "research_more",
      reason: entry.final_decision_rationale.at(-1) ?? entry.final_recommendation
    })),
    no_build_reason_if_none: buildReadyCandidates.length > 0 ? null : "No candidate met evidence + wedge + overlap + testability gates."
  });
}

function buildHumanReviewQueue(runContext, entries) {
  const queueEntries = [
    ...entries.filter((entry) => entry.final_recommendation === "build_ready"),
    ...entries.filter((entry) => entry.final_recommendation === "research_more")
  ].slice(0, 5);

  return buildSafeReport({
    stage: "HUMAN_CANDIDATE_REVIEW_QUEUE",
    status: "passed",
    run_id: runContext.run_id,
    queue_count: queueEntries.length,
    entries: queueEntries.map((entry) => ({
      candidate_id: entry.candidate_id,
      candidate_name: entry.candidate_name,
      proposed_wedge: entry.best_wedge_if_any?.one_sentence_value ?? null,
      why_it_might_be_worth_building: entry.final_recommendation === "build_ready"
        ? "This candidate cleared the strict targeted-research gates and has a testable single-purpose wedge."
        : "This candidate looks promising but still needs sharper evidence or differentiation.",
      why_it_might_not_be: entry.final_decision_rationale.at(-1) ?? entry.final_recommendation,
      evidence_summary: entry.additional_evidence_collected.slice(0, 3).map((item) => item.text_excerpt),
      overlap_risk: `portfolio_overlap_score=${entry.portfolio_overlap_analysis.overlap_score}`,
      testability_summary: `testability_score=${entry.testability_analysis.testability_score}; happy_path=${entry.testability_analysis.happy_path_test ?? "unknown"}`,
      compliance_summary: `risk=${entry.compliance_analysis.risk_level}; permissions=${(entry.compliance_analysis.required_permissions ?? []).join(", ") || "none declared"}`,
      estimated_build_archetype: entry.best_wedge_if_any?.expected_archetype ?? entry.estimated_archetype,
      recommended_decision: entry.final_recommendation === "build_ready" ? "approve_build" : "research_more",
      human_question: entry.final_recommendation === "build_ready"
        ? "Do we agree the proposed wedge is sufficiently differentiated from the current portfolio?"
        : entry.targeted_research_questions[0] ?? "What evidence is still missing before we can build this?"
    }))
  });
}

function renderBatchMarkdown(batchReport) {
  return [
    "# Targeted Research Batch",
    "",
    `- Run: ${batchReport.run_id}`,
    `- Reviewed: ${batchReport.top_candidate_count}`,
    `- Build ready: ${batchReport.build_ready_count}`,
    `- Research more: ${batchReport.research_more_count}`,
    `- Skip: ${batchReport.skip_count}`,
    `- No build reason: ${batchReport.no_build_reason ?? "n/a"}`,
    "",
    markdownSection("Top Candidates", markdownList((batchReport.candidates ?? []).map((entry) => (
      `${entry.original_rank}. ${entry.candidate_name} - ${entry.final_recommendation} - ${entry.best_wedge_if_any?.one_sentence_value ?? "no wedge selected"}`
    )))),
    "",
    markdownSection("Next Step", batchReport.next_step)
  ].join("\n");
}

function renderDecisionBoardMarkdown(decisionBoard) {
  return [
    "# Wedge Decision Board",
    "",
    markdownSection("Build Ready", markdownList((decisionBoard.build_ready_candidates ?? []).map((entry) => `${entry.candidate_name} (${entry.candidate_id})`))),
    "",
    markdownSection("Research More", markdownList((decisionBoard.research_more_candidates ?? []).slice(0, 5).map((entry) => `${entry.candidate_name} (${entry.candidate_id})`))),
    "",
    markdownSection("Skipped", markdownList((decisionBoard.skipped_candidates ?? []).slice(0, 5).map((entry) => `${entry.candidate_name} (${entry.candidate_id})`))),
    "",
    `No build reason: ${decisionBoard.no_build_reason_if_none ?? "n/a"}`
  ].join("\n");
}

function renderHumanQueueMarkdown(queueReport) {
  return [
    "# Human Candidate Review Queue",
    "",
    markdownList((queueReport.entries ?? []).map((entry) => (
      `${entry.candidate_name} - ${entry.recommended_decision} - ${entry.proposed_wedge ?? "no wedge"}`
    )))
  ].join("\n");
}

async function detectLatestScoredLiveQueueRun(projectRoot) {
  const runsRoot = path.join(projectRoot, "runs");
  const entries = await fs.readdir(runsRoot, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const runDir = path.join(runsRoot, entry.name);
    const scorePath = path.join(runDir, "43_batch_opportunity_scores.json");
    const contextPath = path.join(runDir, "00_run_context.json");
    if (!(await fileExists(scorePath)) || !(await fileExists(contextPath))) {
      continue;
    }
    const runContext = await readJson(contextPath);
    const discoveryMode = `${runContext.discovery?.mode ?? ""}`.trim().toLowerCase();
    if (discoveryMode !== "live_queue" && discoveryMode !== "hybrid") {
      continue;
    }
    candidates.push(runDir);
  }
  candidates.sort((left, right) => path.basename(right).localeCompare(path.basename(left)));
  return candidates[0] ?? null;
}

async function resolveRunDir(projectRoot, run) {
  if (run) {
    return path.resolve(projectRoot, run);
  }
  const latest = await detectLatestScoredLiveQueueRun(projectRoot);
  if (!latest) {
    throw new Error("No live queue run with 43_batch_opportunity_scores.json was found.");
  }
  return latest;
}

async function loadImprovementPlan(projectRoot, sourceRunId, runContext) {
  if (sourceRunId) {
    const directPath = path.join(projectRoot, "runs", sourceRunId, "34_demand_discovery_improvement_plan.json");
    const sidecarPath = path.join(projectRoot, "state", "run_events", sourceRunId, "34_demand_discovery_improvement_plan.json");
    if (await fileExists(directPath)) return readJson(directPath);
    if (await fileExists(sidecarPath)) return readJson(sidecarPath);
  }
  const queriesFrom = runContext.discovery?.queries_from;
  if (queriesFrom) {
    const directPath = path.resolve(projectRoot, queriesFrom);
    if (await fileExists(directPath)) {
      return readJson(directPath);
    }
  }
  return { next_10_search_queries: [] };
}

async function loadTargetedResearchState(runDir) {
  const absoluteRunDir = path.resolve(runDir);
  const runContext = await readJson(path.join(absoluteRunDir, "00_run_context.json"));
  const projectRoot = runContext.project_root;
  const scoresArtifact = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    artifactName: "43_batch_opportunity_scores.json",
    runContext
  });
  const overlapArtifact = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    artifactName: "42_low_overlap_filter_report.json",
    runContext
  });
  if (!scoresArtifact || !overlapArtifact) {
    throw new Error(`Run ${runContext.run_id} is missing live queue scoring artifacts.`);
  }
  return {
    runDir: absoluteRunDir,
    runContext,
    projectRoot,
    sourceRunId: runContext.source_run_id ?? null,
    improvementPlan: await loadImprovementPlan(projectRoot, runContext.source_run_id ?? null, runContext),
    candidateQueue: await readJson(path.join(absoluteRunDir, "41_live_candidate_queue.json")),
    candidateReport: await readJson(path.join(absoluteRunDir, "10_candidate_report.json")),
    evidenceReport: await readJson(path.join(absoluteRunDir, "20_feedback_evidence.json")),
    clusterReport: await readJson(path.join(absoluteRunDir, "21_feedback_clusters.json")),
    scoresReport: scoresArtifact,
    nextBuildCandidate: await readJson(path.join(absoluteRunDir, "44_next_build_candidate.json")),
    lowOverlapReport: overlapArtifact,
    portfolioRegistry: await loadPortfolioRegistry(projectRoot)
  };
}

async function buildCandidateBatchEntry(state, scoredOpportunity, originalRank) {
  const candidate = (state.candidateReport.candidates ?? []).find((item) => item.candidate_id === scoredOpportunity.candidate_id)
    ?? (state.candidateQueue.discovered_candidates ?? []).find((item) => item.candidate_id === scoredOpportunity.candidate_id)
    ?? {};
  const overlapAnalysisFromReport = (state.lowOverlapReport.analyses ?? []).find((item) => item.candidate_id === scoredOpportunity.candidate_id) ?? null;
  const context = {
    candidate_id: scoredOpportunity.candidate_id,
    candidate,
    candidate_kind: inferCandidateKind(candidate),
    estimated_archetype: deriveEstimatedArchetype(candidate, inferCandidateKind(candidate)),
    overlap_analysis: overlapAnalysisFromReport,
    original_overlap_score: Number(overlapAnalysisFromReport?.portfolio_overlap_score ?? scoredOpportunity.portfolio_overlap_score ?? 0),
    original_recommendation: scoredOpportunity.build_recommendation,
    original_score: scoredOpportunity,
    runContext: state.runContext
  };

  const targetedResearchQuestions = buildTargetedResearchQuestions(context);
  const additionalEvidenceResult = await collectAdditionalEvidence(context);
  const mergedEvidence = dedupeEvidence([
    ...(state.evidenceReport.evidence_by_candidate?.[scoredOpportunity.candidate_id] ?? []),
    ...(additionalEvidenceResult.additional_evidence ?? [])
  ]);
  const evidenceAnalysis = analyzeEvidence(mergedEvidence);
  const wedgeHypotheses = buildWedgeHypotheses(context, evidenceAnalysis);
  const bestWedge = selectBestWedge(wedgeHypotheses);
  const portfolioOverlapAnalysis = buildPortfolioOverlapAnalysis(context, bestWedge);
  const testabilityAnalysis = buildTestabilityAnalysis(context, bestWedge);
  const complianceAnalysis = buildComplianceAnalysis(context, bestWedge);
  const updatedScoreBreakdown = buildUpdatedScoreBreakdown(context, evidenceAnalysis, bestWedge, portfolioOverlapAnalysis, testabilityAnalysis, complianceAnalysis);
  const buildReadyCriteria = buildBuildReadyCriteria(context, updatedScoreBreakdown, portfolioOverlapAnalysis, testabilityAnalysis, complianceAnalysis, evidenceAnalysis);
  const finalRecommendation = chooseFinalRecommendation(buildReadyCriteria, portfolioOverlapAnalysis, complianceAnalysis, evidenceAnalysis);

  return {
    candidate_id: scoredOpportunity.candidate_id,
    candidate_name: candidate.name ?? scoredOpportunity.name ?? null,
    estimated_archetype: context.estimated_archetype,
    candidate_kind: context.candidate_kind,
    original_rank: originalRank,
    original_build_recommendation: scoredOpportunity.build_recommendation,
    original_score: scoredOpportunity.total_score,
    original_blockers: buildOriginalBlockers(context),
    targeted_research_questions: targetedResearchQuestions,
    additional_evidence_collected: buildAdditionalEvidenceCollected(
      state.evidenceReport.evidence_by_candidate?.[scoredOpportunity.candidate_id] ?? [],
      additionalEvidenceResult.additional_evidence ?? []
    ),
    additional_evidence_status: {
      status: additionalEvidenceResult.status,
      live_unavailable: additionalEvidenceResult.live_unavailable,
      reason: additionalEvidenceResult.reason
    },
    evidence_gaps: buildEvidenceGaps(context, evidenceAnalysis),
    wedge_hypotheses: wedgeHypotheses,
    best_wedge_if_any: bestWedge,
    portfolio_overlap_analysis: portfolioOverlapAnalysis,
    testability_analysis: testabilityAnalysis,
    compliance_analysis: complianceAnalysis,
    updated_score_breakdown: updatedScoreBreakdown,
    build_ready_criteria: buildReadyCriteria,
    final_recommendation: finalRecommendation,
    final_decision_rationale: buildFinalDecisionRationale(context, finalRecommendation, buildReadyCriteria, portfolioOverlapAnalysis, complianceAnalysis, evidenceAnalysis, bestWedge),
    next_step: buildNextStep(finalRecommendation, targetedResearchQuestions, buildReadyCriteria)
  };
}

function mapBacklogEntries(state, entries) {
  return entries.map((entry) => {
    const candidate = (state.candidateReport.candidates ?? []).find((item) => item.candidate_id === entry.candidate_id)
      ?? (state.candidateQueue.discovered_candidates ?? []).find((item) => item.candidate_id === entry.candidate_id)
      ?? {};
    return {
      opportunity_id: entry.candidate_id,
      discovered_at: nowIso(),
      source_run_id: state.runContext.run_id,
      candidate_id: entry.candidate_id,
      candidate_name: entry.candidate_name,
      source_url: candidate.store_url ?? null,
      category: candidate.category ?? null,
      users_estimate: candidate.users ?? null,
      rating: candidate.rating ?? null,
      review_count: candidate.reviews ?? null,
      latest_update: candidate.updated ?? null,
      pain_summary: normalizeText([
        entry.best_wedge_if_any?.pain_addressed ?? "",
        ...(entry.final_decision_rationale ?? [])
      ].join("; ")),
      top_pain_clusters: (entry.targeted_research_questions ?? []).slice(0, 3),
      evidence_quality_score: entry.updated_score_breakdown.evidence_quality_score,
      testability_score: entry.updated_score_breakdown.testability_score,
      wedge_clarity_score: entry.updated_score_breakdown.wedge_clarity_score,
      portfolio_overlap_score: entry.portfolio_overlap_analysis.overlap_score,
      compliance_risk: entry.compliance_analysis.risk_score,
      build_recommendation: entry.final_recommendation === "build_ready" ? "build" : entry.final_recommendation === "research_more" ? "research_more" : "skip",
      decision_reason: (entry.final_decision_rationale ?? []).join("; "),
      status: entry.final_recommendation === "build_ready" ? "build_ready" : entry.final_recommendation === "research_more" ? "research_more" : "skipped",
      linked_run_ids: [state.runContext.run_id, ...(state.sourceRunId ? [state.sourceRunId] : [])],
      linked_portfolio_items: unique((entry.portfolio_overlap_analysis.similar_existing_items ?? []).map((item) => item.item_id)),
      next_step: entry.next_step,
      selected_wedge: entry.best_wedge_if_any?.one_sentence_value ?? null
    };
  });
}

export async function runTargetedResearchBatch({ runDir, top = 10, projectRoot = process.cwd() }) {
  const resolvedRunDir = await resolveRunDir(projectRoot, runDir);
  const state = await loadTargetedResearchState(resolvedRunDir);
  const occurredAt = nowIso();
  const ranked = (state.scoresReport.ranked_opportunities ?? []).slice(0, Math.max(1, Number(top) || 10));
  const entries = [];
  for (let index = 0; index < ranked.length; index += 1) {
    entries.push(await buildCandidateBatchEntry(state, ranked[index], index + 1));
  }

  const buildReadyCount = entries.filter((entry) => entry.final_recommendation === "build_ready").length;
  const researchMoreCount = entries.filter((entry) => entry.final_recommendation === "research_more").length;
  const skipCount = entries.filter((entry) => entry.final_recommendation === "skip").length;
  const decisionBoard = buildDecisionBoard(state.runContext, entries);
  const humanReviewQueue = buildHumanReviewQueue(state.runContext, entries);
  const batchReport = buildSafeReport({
    stage: "TARGETED_RESEARCH_BATCH",
    status: "passed",
    run_id: state.runContext.run_id,
    source_run_id: state.sourceRunId,
    top_candidate_count: ranked.length,
    build_ready_count: buildReadyCount,
    research_more_count: researchMoreCount,
    skip_count: skipCount,
    no_build_reason: buildReadyCount > 0 ? null : "No candidate met evidence + wedge + overlap + testability gates.",
    next_step: buildReadyCount > 0 ? "human_candidate_review_required" : researchMoreCount > 0 ? "continue_targeted_research" : "no_build_today",
    candidates: entries
  });

  await validateArtifact(state.projectRoot, "targeted_research_batch.schema.json", TARGETED_RESEARCH_BATCH_ARTIFACT, batchReport);
  await validateArtifact(state.projectRoot, "wedge_decision_board.schema.json", WEDGE_DECISION_BOARD_ARTIFACT, decisionBoard);
  await validateArtifact(state.projectRoot, "human_candidate_review_queue.schema.json", HUMAN_CANDIDATE_REVIEW_QUEUE_ARTIFACT, humanReviewQueue);

  const batchWrite = await writeManagedJsonArtifact({ runDir: state.runDir, runContext: state.runContext, artifactName: TARGETED_RESEARCH_BATCH_ARTIFACT, data: batchReport, occurredAt });
  const boardWrite = await writeManagedJsonArtifact({ runDir: state.runDir, runContext: state.runContext, artifactName: WEDGE_DECISION_BOARD_ARTIFACT, data: decisionBoard, occurredAt });
  const queueWrite = await writeManagedJsonArtifact({ runDir: state.runDir, runContext: state.runContext, artifactName: HUMAN_CANDIDATE_REVIEW_QUEUE_ARTIFACT, data: humanReviewQueue, occurredAt });
  const batchMarkdownWrite = await writeManagedMarkdownArtifact({ runDir: state.runDir, runContext: state.runContext, fileName: "46_targeted_research_batch.md", category: "targeted_research", prefix: "46_targeted_research_batch", content: renderBatchMarkdown(batchReport), occurredAt });
  const boardMarkdownWrite = await writeManagedMarkdownArtifact({ runDir: state.runDir, runContext: state.runContext, fileName: "47_wedge_decision_board.md", category: "targeted_research", prefix: "47_wedge_decision_board", content: renderDecisionBoardMarkdown(decisionBoard), occurredAt });
  const queueMarkdownWrite = await writeManagedMarkdownArtifact({ runDir: state.runDir, runContext: state.runContext, fileName: "48_human_candidate_review_queue.md", category: "targeted_research", prefix: "48_human_candidate_review_queue", content: renderHumanQueueMarkdown(humanReviewQueue), occurredAt });

  await upsertOpportunityEntries(state.projectRoot, mapBacklogEntries(state, entries));

  return {
    batchReport,
    decisionBoard,
    humanReviewQueue,
    artifacts: {
      batch: batchWrite.artifactRelativePath,
      board: boardWrite.artifactRelativePath,
      queue: queueWrite.artifactRelativePath,
      batch_markdown: batchMarkdownWrite.artifactRelativePath,
      board_markdown: boardMarkdownWrite.artifactRelativePath,
      queue_markdown: queueMarkdownWrite.artifactRelativePath
    }
  };
}
