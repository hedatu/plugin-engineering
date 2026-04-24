import fs from "node:fs/promises";
import path from "node:path";
import {
  collectLiveEvidenceForCandidate,
  extractDetailUrlsFromSearchHtml,
  fetchAllowedText,
  parseChromeListing
} from "../research/liveResearch.mjs";
import {
  buildSafeReport,
  loadOptionalManagedArtifact,
  markdownList,
  markdownSection,
  validateArtifact,
  writeManagedJsonArtifact,
  writeManagedMarkdownArtifact
} from "../review/helpers.mjs";
import { ensureDir, fileExists, nowIso, readJson, writeJson } from "../utils/io.mjs";
import { upsertOpportunityEntries } from "./opportunityBacklog.mjs";
import { recordManualEvidence as recordManualEvidenceFromDemandValidationLoop } from "./demandValidationLoop.mjs";

export const SUPPORT_QA_EVIDENCE_SPRINT_ARTIFACT = "80_support_qa_evidence_sprint.json";
export const SUPPORT_QA_CANDIDATE_TEST_PLAN_ARTIFACT = "81_support_qa_candidate_test_plan.json";

const DEEP_DIVE_ARTIFACT = "76_support_qa_deep_dive.json";
const EVIDENCE_PACK_ARTIFACT = "77_support_qa_evidence_pack.json";
const FUNCTIONAL_PLAN_ARTIFACT = "78_support_qa_functional_test_plan.json";
const HUMAN_QUEUE_ARTIFACT = "79_support_qa_human_review_queue.json";
const MANUAL_EVIDENCE_DIR = path.join("state", "manual_evidence");
const DEFAULT_CANDIDATE = "Jam";
const MAX_CWS_FETCHES = 6;
const MAX_GITHUB_FETCHES = 6;

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function normalizeText(value) {
  return `${value ?? ""}`.replace(/\s+/g, " ").trim();
}

function lower(value) {
  return normalizeText(value).toLowerCase();
}

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function stripSitePrefix(query) {
  return `${query ?? ""}`.replace(/site:[^\s]+\s*/i, "").trim();
}

function extractQueryDomain(query) {
  const match = `${query ?? ""}`.match(/site:([^\s/]+)/i);
  return `${match?.[1] ?? ""}`.trim().toLowerCase();
}

function stripHtml(value) {
  return normalizeText(`${value ?? ""}`.replace(/<[^>]+>/g, " "));
}

function extractMeta(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escaped}["']`, "i")
  ];
  for (const pattern of patterns) {
    const match = `${html ?? ""}`.match(pattern);
    if (match) {
      return normalizeText(match[1]);
    }
  }
  return "";
}

function extractTitle(html) {
  const match = `${html ?? ""}`.match(/<title>([\s\S]*?)<\/title>/i);
  return match ? stripHtml(match[1]) : "";
}

function extractGithubIssueUrls(html) {
  return unique([...(`${html ?? ""}`).matchAll(/\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/\d+/g)]
    .map((match) => `https://github.com${match[0]}`));
}

async function detectLatestRun(projectRoot) {
  const runsRoot = path.join(projectRoot, "runs");
  const entries = await fs.readdir(runsRoot, { withFileTypes: true });
  const names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort((a, b) => b.localeCompare(a));
  for (const name of names) {
    const runDir = path.join(runsRoot, name);
    const contextPath = path.join(runDir, "00_run_context.json");
    if (!(await fileExists(contextPath))) {
      continue;
    }
    const runContext = { ...(await readJson(contextPath)), project_root: projectRoot };
    const required = await Promise.all([
      loadOptionalManagedArtifact({ runDir, artifactName: DEEP_DIVE_ARTIFACT, runContext }),
      loadOptionalManagedArtifact({ runDir, artifactName: EVIDENCE_PACK_ARTIFACT, runContext }),
      loadOptionalManagedArtifact({ runDir, artifactName: FUNCTIONAL_PLAN_ARTIFACT, runContext }),
      loadOptionalManagedArtifact({ runDir, artifactName: HUMAN_QUEUE_ARTIFACT, runContext })
    ]);
    if (required.every(Boolean)) {
      return runDir;
    }
  }
  return null;
}

async function resolveRunDir(projectRoot, run) {
  if (run) {
    return path.resolve(projectRoot, run);
  }
  const detected = await detectLatestRun(projectRoot);
  if (!detected) {
    throw new Error("No support/QA run containing 76-79 artifacts was found.");
  }
  return detected;
}

async function loadArtifact(runDir, runContext, artifactName) {
  const artifact = await loadOptionalManagedArtifact({ runDir, artifactName, runContext });
  if (!artifact) {
    throw new Error(`Missing ${artifactName} in ${runDir}.`);
  }
  return artifact;
}

async function loadState(projectRoot, run) {
  const runDir = await resolveRunDir(projectRoot, run);
  const runContext = { ...(await readJson(path.join(runDir, "00_run_context.json"))), project_root: projectRoot };
  return {
    projectRoot,
    runDir,
    runContext,
    deepDive: await loadArtifact(runDir, runContext, DEEP_DIVE_ARTIFACT),
    evidencePack: await loadArtifact(runDir, runContext, EVIDENCE_PACK_ARTIFACT),
    functionalPlan: await loadArtifact(runDir, runContext, FUNCTIONAL_PLAN_ARTIFACT),
    humanQueue: await loadArtifact(runDir, runContext, HUMAN_QUEUE_ARTIFACT),
    backlog: await readJson(path.join(projectRoot, "state", "opportunity_backlog.json"))
  };
}

function selectCandidate(deepDive, candidateInput) {
  const candidates = deepDive.candidates ?? [];
  const key = lower(candidateInput);
  return candidates.find((item) => lower(item.candidate_id) === key || lower(item.candidate_name) === key)
    ?? candidates.find((item) => lower(item.candidate_name).includes(key))
    ?? candidates.find((item) => /jam/i.test(item.candidate_name ?? ""))
    ?? [...candidates].sort((a, b) => (
      Number(b.deep_dive_score_breakdown?.evidence_quality_score ?? 0) - Number(a.deep_dive_score_breakdown?.evidence_quality_score ?? 0)
    ))[0]
    ?? null;
}

function evidenceLookup(evidencePack, candidateId) {
  return (evidencePack.evidence_items ?? []).filter((item) => item.candidate_id === candidateId);
}

async function loadManualEvidence(projectRoot, candidateId) {
  const targetDir = path.join(projectRoot, MANUAL_EVIDENCE_DIR);
  if (!(await fileExists(targetDir))) {
    return [];
  }
  const entries = await fs.readdir(targetDir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(`${candidateId}-`) || !entry.name.endsWith(".json")) {
      continue;
    }
    results.push(await readJson(path.join(targetDir, entry.name)));
  }
  return results;
}

function buildTargetedQueries() {
  return [
    { query_id: "cws-1", query: "site:chromewebstore.google.com Chrome extension copy bug report context", source_type: "chrome_web_store_search" },
    { query_id: "cws-2", query: "site:chromewebstore.google.com copy browser environment to bug report extension", source_type: "chrome_web_store_search" },
    { query_id: "cws-3", query: "site:chromewebstore.google.com support ticket browser context helper extension", source_type: "chrome_web_store_search" },
    { query_id: "cws-4", query: "site:chromewebstore.google.com copy page URL title browser info markdown extension", source_type: "chrome_web_store_search" },
    { query_id: "gh-1", query: "site:github.com bug report browser version url issue", source_type: "github_issue_search" },
    { query_id: "gh-2", query: "site:github.com repro steps issue template browser info issue", source_type: "github_issue_search" },
    { query_id: "gh-3", query: "site:github.com copy current page url title bug report issue", source_type: "github_issue_search" },
    { query_id: "optional-1", query: "site:reddit.com local only bug report helper", source_type: "optional_public_forum" },
    { query_id: "optional-2", query: "site:news.ycombinator.com copy browser context bug report", source_type: "optional_public_forum" }
  ];
}

function normalizeExistingEvidence(item) {
  return {
    evidence_id: item.evidence_id,
    source_type: item.source_type,
    source_url: item.source_url,
    text_excerpt: normalizeText(item.text_excerpt),
    source_query: null,
    source_candidate_name: null
  };
}

function normalizeManualEvidence(item, index) {
  return {
    evidence_id: `${item.candidate_id}-manual-${index + 1}`,
    source_type: "manual_evidence",
    source_url: item.source,
    text_excerpt: normalizeText(item.note),
    source_query: null,
    source_candidate_name: null
  };
}

function likelySupportQaCandidate(candidate) {
  const text = lower([candidate.name, candidate.live_summary, candidate.store_url].join(" "));
  return /bug|report|support|qa|ticket|issue|repro|jam|betterbugs|capture|diagnostic/.test(text);
}

async function runCwsQuery(queryConfig, runContext, seenIds) {
  const queryText = stripSitePrefix(queryConfig.query);
  const searchUrl = `https://chromewebstore.google.com/search/${encodeURIComponent(queryText)}`;
  const searchResponse = await fetchAllowedText(searchUrl, { timeoutMs: runContext.research?.timeout_ms ?? 15000 });
  const detailUrls = searchResponse.ok ? extractDetailUrlsFromSearchHtml(searchResponse.text) : [];
  const evidence = [];
  let fetched = 0;

  for (const detailUrl of detailUrls) {
    if (fetched >= MAX_CWS_FETCHES || seenIds.size >= MAX_CWS_FETCHES) {
      break;
    }
    try {
      const listingResponse = await fetchAllowedText(detailUrl, { timeoutMs: runContext.research?.timeout_ms ?? 15000 });
      if (!listingResponse.ok) {
        continue;
      }
      const candidate = parseChromeListing(detailUrl, listingResponse.text, runContext.builder?.allow_families ?? []);
      if (!likelySupportQaCandidate(candidate)) {
        continue;
      }
      fetched += 1;
      if (seenIds.has(candidate.candidate_id)) {
        continue;
      }
      seenIds.add(candidate.candidate_id);
      const liveEvidence = await collectLiveEvidenceForCandidate(candidate, { timeoutMs: runContext.research?.timeout_ms ?? 15000, maxGithubIssues: 3 });
      evidence.push(...(liveEvidence.evidence ?? []).map((item, index) => ({
        evidence_id: `${queryConfig.query_id}-${candidate.candidate_id}-${index + 1}`,
        source_type: item.source_type,
        source_url: item.url ?? candidate.store_url,
        text_excerpt: normalizeText(item.quote ?? item.topic ?? item.text_excerpt ?? ""),
        source_query: queryConfig.query,
        source_candidate_name: candidate.name
      })).filter((item) => item.text_excerpt));
    } catch {
      // best effort
    }
  }

  return {
    query_id: queryConfig.query_id,
    query: queryConfig.query,
    source_type: queryConfig.source_type,
    attempted: true,
    executed: true,
    live_unavailable: false,
    result_count: detailUrls.length,
    failure_reason: searchResponse.ok ? null : `search_http_${searchResponse.status}`,
    evidence
  };
}

async function runGithubQuery(queryConfig, runContext) {
  const queryText = stripSitePrefix(queryConfig.query);
  const searchUrl = `https://github.com/search?q=${encodeURIComponent(queryText)}&type=issues`;
  const response = await fetchAllowedText(searchUrl, { timeoutMs: runContext.research?.timeout_ms ?? 15000 });
  const issueUrls = response.ok ? extractGithubIssueUrls(response.text).slice(0, MAX_GITHUB_FETCHES) : [];
  const evidence = [];

  for (const issueUrl of issueUrls) {
    try {
      const issueResponse = await fetchAllowedText(issueUrl, { timeoutMs: runContext.research?.timeout_ms ?? 15000 });
      if (!issueResponse.ok) {
        continue;
      }
      const excerpt = normalizeText([
        extractMeta(issueResponse.text, "og:title") || extractTitle(issueResponse.text),
        extractMeta(issueResponse.text, "description") || extractMeta(issueResponse.text, "og:description")
      ].filter(Boolean).join(" - "));
      if (!excerpt) {
        continue;
      }
      evidence.push({
        evidence_id: `${queryConfig.query_id}-${Buffer.from(issueUrl).toString("base64url").slice(0, 10)}`,
        source_type: "github_issue",
        source_url: issueUrl,
        text_excerpt: excerpt,
        source_query: queryConfig.query,
        source_candidate_name: null
      });
    } catch {
      // best effort
    }
  }

  return {
    query_id: queryConfig.query_id,
    query: queryConfig.query,
    source_type: queryConfig.source_type,
    attempted: true,
    executed: true,
    live_unavailable: false,
    result_count: issueUrls.length,
    failure_reason: response.ok ? null : `github_search_http_${response.status}`,
    evidence
  };
}

async function executeQueries(runContext, queryPlan) {
  const results = [];
  const seenIds = new Set();
  for (const queryConfig of queryPlan) {
    const domain = extractQueryDomain(queryConfig.query);
    if (domain === "chromewebstore.google.com") {
      results.push(await runCwsQuery(queryConfig, runContext, seenIds));
      continue;
    }
    if (domain === "github.com") {
      results.push(await runGithubQuery(queryConfig, runContext));
      continue;
    }
    results.push({
      query_id: queryConfig.query_id,
      query: queryConfig.query,
      source_type: queryConfig.source_type,
      attempted: true,
      executed: false,
      live_unavailable: false,
      result_count: 0,
      failure_reason: "source_not_supported_by_live_research_allowlist",
      evidence: []
    });
  }
  return results;
}

function dedupeEvidence(items) {
  const seen = new Set();
  const result = [];
  for (const item of items ?? []) {
    const key = `${item.source_type}|${item.source_url}|${normalizeText(item.text_excerpt)}`;
    if (!item.text_excerpt || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function classifyEvidence(item) {
  const text = lower(item.text_excerpt);
  const userVoice = item.source_type === "github_issue" || item.source_type === "manual_evidence";
  const userVoiceSpecific = /manual|copy|paste|clipboard|context-switch|navigate to github|issue template|auto-file|diagnostic|look up the application version|os details|browser info|report bugs/.test(text);
  const handoffSpecific = /manual|copy|paste|clipboard|markdown|template|context-switch|navigate to github|issue template|report bugs|bug report|support ticket|diagnostic|browser info|version|os details|url|title|repro|steps/.test(text);
  const textFirst = /copy|clipboard|markdown|template|repro|steps|url|title|browser info|version|environment|timestamp/.test(text);
  const localOnly = /local only|local-only|privacy|no upload|without upload|clipboard only|offline/.test(text) && /bug|report|support|qa|diagnostic|context/.test(text);
  const uploadHeavy = /screenshot|screen capture|video|record|annotat|share|upload|cloud/.test(text);
  const installIntent = (item.source_type === "chrome_web_store_listing" || item.source_type === "support_page")
    && /helper|bug report|support|qa|ticket|context|issue copier/.test(text)
    && !/join \d|users building the future|loved by developers|^\d[\d\s,.]+$/.test(text);
  const relevant = handoffSpecific || localOnly || uploadHeavy;
  if (!relevant) {
    return { accepted: false, reason: "off_target_or_marketing", userVoice, textFirst, localOnly, uploadHeavy, installIntent };
  }
  if (userVoice && !userVoiceSpecific) {
    return { accepted: false, reason: "user_voice_not_specific_to_handoff_context", userVoice, textFirst, localOnly, uploadHeavy, installIntent };
  }
  if (uploadHeavy && !textFirst && !localOnly && item.source_type !== "manual_evidence") {
    return { accepted: false, reason: "leans_toward_screenshot_or_upload", userVoice, textFirst, localOnly, uploadHeavy, installIntent };
  }
  return { accepted: true, reason: userVoice ? "direct_user_voice" : "supporting_signal", userVoice, textFirst, localOnly, uploadHeavy, installIntent };
}

function serializeEvidence(item, meta) {
  return {
    evidence_id: item.evidence_id,
    source_type: item.source_type,
    source_url: item.source_url,
    text_excerpt: item.text_excerpt,
    source_query: item.source_query ?? null,
    source_candidate_name: item.source_candidate_name ?? null,
    decision_reason: meta.reason
  };
}

function refineWedge(candidateEntry) {
  const wedgeId = candidateEntry.selected_wedge_hypothesis?.wedge_id ?? "local_bug_report_context_copier";
  const wedgeName = wedgeId === "support_ticket_environment_packet"
    ? "Support Ticket Context Packet"
    : wedgeId === "repro_steps_helper"
      ? "QA Repro Steps Clipboard Helper"
      : "Page Context to Markdown";
  return {
    wedge_name: wedgeName,
    one_sentence_value: candidateEntry.selected_wedge_hypothesis?.one_sentence_value
      ?? "One-click local-only copy of current page URL, title, browser info, timestamp, and repro-step prompts into Markdown.",
    target_user: candidateEntry.selected_wedge_hypothesis?.target_user ?? "QA testers and support agents",
    trigger_moment: candidateEntry.selected_wedge_hypothesis?.trigger_moment ?? "When a browser issue needs a clean handoff note",
    included_fields: ["URL", "page title", "browser info", "timestamp", "user-entered repro steps"],
    explicitly_excluded_features: ["automatic sending", "automatic issue creation", "remote upload", "video recording", "host permissions"],
    why_not_clone_jam: "This wedge ends at local text generation and copy, not hosted screenshot or upload workflows.",
    why_low_permission: "It can stay inside a user-triggered popup with activeTab only.",
    happy_path_test: "Open action, enter repro steps, generate Markdown, copy locally, and verify no network calls.",
    product_acceptance_forecast: "pending_external_user_voice",
    expected_builder: "support_context_clipboard_builder",
    builder_gap: "small_new_builder_not_implemented",
    final_recommendation: null
  };
}

function buildScores(candidateEntry, localOnlyCount, textFirstCount, installIntentCount, uploadCount, userVoiceCount, localOnlyUserVoiceCount) {
  const baseEvidence = Number(candidateEntry.deep_dive_score_breakdown?.evidence_quality_score ?? 0);
  let updatedEvidence = clamp(
    baseEvidence
    + (userVoiceCount * 1.5)
    + (textFirstCount * 0.75)
    + (localOnlyCount * 1.25)
    + Math.min(1.5, installIntentCount * 0.5)
    - Math.max(0, uploadCount - textFirstCount) * 1.5
  );
  if (localOnlyUserVoiceCount === 0) {
    updatedEvidence = Math.min(updatedEvidence, 79);
  }
  return {
    updated_evidence_quality_score: round(updatedEvidence),
    updated_wedge_clarity_score: round(clamp(Number(candidateEntry.deep_dive_score_breakdown?.wedge_clarity_score ?? 0) + 1.5)),
    updated_portfolio_overlap_score: Number(candidateEntry.overlap_analysis?.overlap_score ?? 0),
    updated_testability_score: round(clamp(Number(candidateEntry.deep_dive_score_breakdown?.testability_score ?? 0) + 0.8)),
    updated_compliance_risk: candidateEntry.compliance_analysis?.risk_level ?? "low"
  };
}

function buildDecision(scores, localOnlySignals, textFirstSignals, uploadSignals, installIntentSignals, userVoiceSignals) {
  if (
    scores.updated_evidence_quality_score >= 80
    && scores.updated_wedge_clarity_score >= 82
    && scores.updated_testability_score >= 80
    && scores.updated_portfolio_overlap_score <= 45
    && scores.updated_compliance_risk !== "high"
    && userVoiceSignals.length > 0
    && localOnlySignals.length > 0
    && textFirstSignals.length >= 2
    && installIntentSignals.length >= 2
  ) {
    return {
      final_decision: "human_candidate_review_ready",
      final_reason: "The sprint found enough direct external voice for the narrowed local-only text-first support handoff wedge.",
      next_step: "human_candidate_review"
    };
  }
  if (uploadSignals.length >= 3 && textFirstSignals.length === 0 && localOnlySignals.length === 0) {
    return {
      final_decision: "skip",
      final_reason: "The strongest available signal still leans toward screenshot or upload-heavy workflows instead of the local-only text-first wedge.",
      next_step: "skip_support_qa_candidate"
    };
  }
  return {
    final_decision: "backlog_waiting_for_evidence",
    final_reason: "The wedge is still low-overlap, low-permission, and testable, but this sprint still lacks explicit user voice proving demand for a local-only text-first support/QA handoff helper.",
    next_step: "manual_evidence_input"
  };
}

function buildQuestionAnswers(accepted, localOnly, textFirst, upload, installIntent, candidateEntry) {
  return [
    { question: "用户是否抱怨 support / QA handoff 信息整理麻烦？", answer: accepted.length >= 3 ? "yes" : "partial", rationale: "The sprint found repeated handoff or bug-report context signals." },
    { question: "用户是否需要把当前页面上下文复制到工单、bug report、Slack、GitHub issue、Linear、Jira？", answer: textFirst.length > 0 ? "partial" : "no", rationale: "Context-copy demand appears, but clipboard-first workflow demand is still limited." },
    { question: "用户是否明确需要 browser environment / URL / page title / repro steps / metadata？", answer: textFirst.length > 0 ? "yes" : "partial", rationale: "The accepted signals repeatedly mention metadata or repro steps." },
    { question: "用户是否不想上传截图、视频或页面内容到第三方服务？", answer: localOnly.length > 0 ? "partial" : upload.length > 0 ? "no" : "partial", rationale: "Privacy-first signals exist, but they are still weaker than general bug-report workflow signals." },
    { question: "用户是否接受 text-first / clipboard-first workflow？", answer: textFirst.length >= 2 ? "partial" : textFirst.length > 0 ? "partial" : "no", rationale: "Some text-first behavior appears, but install intent is still not explicit enough." },
    { question: "用户是否愿意为了这个动作安装一个小扩展？", answer: installIntent.length >= 2 ? "partial" : "no", rationale: "The market proves demand for bug-report helpers, not yet for the narrowed local-only wedge." },
    { question: "这个需求是 QA、support、developer、PM、customer success 中哪类用户最强？", answer: "yes", rationale: "Current evidence clusters most clearly around QA and support handoff workflows." },
    { question: "是否能和 Jam 形成清晰差异，而不是 clone？", answer: Number(candidateEntry.overlap_analysis?.overlap_score ?? 100) <= 45 ? "yes" : "no", rationale: "The refined wedge excludes screenshot capture, upload, and external issue creation." },
    { question: "是否只需要低风险权限？", answer: candidateEntry.permission_risk_analysis?.risk_level === "low" ? "yes" : "partial", rationale: "The proposed flow can stay inside user-triggered activeTab access." },
    { question: "是否有清晰 browser smoke happy path？", answer: "yes", rationale: "The happy path is deterministic and local-only." }
  ];
}

function buildTestPlan(runId, candidateEntry, refinedWedge, finalDecision) {
  return buildSafeReport({
    stage: "SUPPORT_QA_CANDIDATE_TEST_PLAN",
    status: "passed",
    run_id: runId,
    candidate_id: candidateEntry.candidate_id,
    candidate_name: candidateEntry.candidate_name,
    wedge_name: refinedWedge.wedge_name,
    happy_path: "Open the action on the active page, enter repro steps, generate Markdown, and copy it locally with no network request.",
    expected_functional_test_matrix: [
      "activeTab permission path",
      "current page URL and title capture",
      "browser or user-agent info capture",
      "timestamp capture",
      "user-entered repro steps",
      "Markdown generation correctness",
      "copy-to-clipboard behavior",
      "no network requests",
      "no automatic sending",
      "unsupported page handling",
      "empty input handling",
      "privacy disclosure check"
    ],
    browser_smoke_plan: "Open popup, generate the handoff Markdown on an active tab, copy it, and verify there are no network requests.",
    next_step: finalDecision === "human_candidate_review_ready" ? "human_candidate_review" : "manual_evidence_input"
  });
}

function buildHumanQueue(runId, candidateEntry, refinedWedge, finalDecision, finalReason, scores) {
  return buildSafeReport({
    stage: "SUPPORT_QA_HUMAN_REVIEW_QUEUE",
    status: "passed",
    run_id: runId,
    no_build_today: finalDecision !== "human_candidate_review_ready",
    queue_count: 1,
    entries: [
      {
        candidate_id: candidateEntry.candidate_id,
        candidate_name: candidateEntry.candidate_name,
        proposed_wedge: refinedWedge.one_sentence_value,
        why_build: `Low-overlap (${scores.updated_portfolio_overlap_score}), low-permission, text-first handoff wedge.`,
        why_not_build: finalReason,
        evidence_summary: candidateEntry.evidence_summary?.summary ?? "",
        overlap_risk: `portfolio_overlap_score=${scores.updated_portfolio_overlap_score}`,
        permission_risk: candidateEntry.permission_risk_analysis?.risk_level ?? "low",
        testability_summary: `testability_score=${scores.updated_testability_score}`,
        builder_fit: "support_context_clipboard_builder",
        estimated_build_cost: "small",
        recommended_decision: finalDecision === "human_candidate_review_ready" ? "human_review_required" : finalDecision === "skip" ? "skip" : "continue_later",
        human_question: finalDecision === "human_candidate_review_ready"
          ? "Do we want to build a local-only Page Context to Markdown / Support Ticket Context Packet extension as the next product?"
          : finalDecision === "backlog_waiting_for_evidence"
            ? "Do we have a manual source or customer workflow that proves this support handoff pain?"
            : "Is this wedge too biased toward screenshot or upload workflows to keep alive?"
      }
    ],
    next_step: finalDecision === "human_candidate_review_ready" ? "human_candidate_review" : finalDecision === "skip" ? "skip_support_qa_candidate" : "manual_evidence_input"
  });
}

function buildBacklogEntry(runId, candidateEntry, refinedWedge, finalDecision, finalReason, scores) {
  return {
    opportunity_id: candidateEntry.existing_opportunity_id ?? null,
    source_run_id: runId,
    candidate_id: candidateEntry.candidate_id,
    candidate_name: candidateEntry.candidate_name,
    source_url: candidateEntry.source_url,
    category: "Productivity",
    users_estimate: candidateEntry.current_score_breakdown?.users_estimate ?? null,
    rating: candidateEntry.current_score_breakdown?.rating ?? null,
    review_count: candidateEntry.current_score_breakdown?.review_count ?? null,
    latest_update: nowIso(),
    pain_summary: finalReason,
    top_pain_clusters: unique([...(candidateEntry.pain_signals ?? [])]),
    evidence_quality_score: scores.updated_evidence_quality_score,
    testability_score: scores.updated_testability_score,
    wedge_clarity_score: scores.updated_wedge_clarity_score,
    portfolio_overlap_score: scores.updated_portfolio_overlap_score,
    compliance_risk: scores.updated_compliance_risk === "low" ? 20 : scores.updated_compliance_risk === "medium" ? 45 : 80,
    build_recommendation: finalDecision === "human_candidate_review_ready" ? "build" : finalDecision === "skip" ? "skip" : "backlog_waiting",
    decision_reason: finalReason,
    status: finalDecision === "human_candidate_review_ready" ? "human_candidate_review_ready" : finalDecision === "skip" ? "skipped" : "backlog_waiting_for_evidence",
    linked_run_ids: [runId],
    linked_portfolio_items: (candidateEntry.overlap_analysis?.similar_existing_items ?? []).map((item) => item.item_id),
    next_step: finalDecision === "human_candidate_review_ready" ? "human_candidate_review" : finalDecision === "skip" ? "skip_support_qa_candidate" : "manual_evidence_input",
    selected_wedge: refinedWedge.one_sentence_value,
    research_rounds_completed: 2,
    evidence_requirements: finalDecision === "backlog_waiting_for_evidence"
      ? [
          "At least one real customer or practitioner source explicitly asking for local-only text-first support or QA handoff context.",
          "Evidence that users would install a clipboard-first helper rather than preferring screenshot or upload-heavy tools."
        ]
      : [],
    status_detail: finalDecision === "skip" ? "counter_signal_prefers_screenshot_or_upload" : finalDecision === "human_candidate_review_ready" ? "ready_for_human_candidate_review" : "awaiting_explicit_local_only_user_voice",
    last_updated_at: nowIso()
  };
}

function buildMarkdown(report, testPlan, humanQueue) {
  return [
    "# Support/QA Evidence Sprint",
    "",
    `- Candidate: ${report.candidate_name}`,
    `- Final decision: ${report.final_decision}`,
    `- Target wedge: ${report.target_micro_wedge}`,
    "",
    markdownSection("Final Reason", report.final_reason),
    "",
    markdownSection("Strongest Evidence", report.strongest_evidence ? report.strongest_evidence.text_excerpt : "No strong evidence captured."),
    "",
    markdownSection("Collected Evidence", markdownList((report.evidence_collected ?? []).slice(0, 10).map((item) => `${item.source_type} | ${item.text_excerpt}`))),
    "",
    markdownSection("Rejected Evidence", markdownList((report.evidence_rejected ?? []).slice(0, 8).map((item) => `${item.source_type} | ${item.text_excerpt}`))),
    "",
    markdownSection("Test Plan", markdownList(testPlan.expected_functional_test_matrix ?? [])),
    "",
    markdownSection("Human Queue", markdownList((humanQueue.entries ?? []).map((entry) => `${entry.candidate_name}: ${entry.recommended_decision}`)))
  ].join("\n");
}

export async function recordManualEvidence({ projectRoot, candidateId, source, note, supportsWedge }) {
  return recordManualEvidenceFromDemandValidationLoop({
    projectRoot,
    candidateId,
    source,
    note,
    supportsWedge
  });
}

export async function runSupportQaEvidenceSprint({ projectRoot, run = null, candidate = null }) {
  const state = await loadState(projectRoot, run);
  const candidateEntry = selectCandidate(state.deepDive, candidate ?? DEFAULT_CANDIDATE);
  if (!candidateEntry) {
    throw new Error("No support/QA candidate found for evidence sprint.");
  }

  const refinedWedge = refineWedge(candidateEntry);
  const existingEvidence = evidenceLookup(state.evidencePack, candidateEntry.candidate_id).map(normalizeExistingEvidence);
  const manualEvidence = (await loadManualEvidence(projectRoot, candidateEntry.candidate_id)).map(normalizeManualEvidence);
  const queryPlan = buildTargetedQueries();
  const queryResults = (state.runContext.research?.mode ?? "fixture") === "live"
    ? await executeQueries(state.runContext, queryPlan)
    : queryPlan.map((query) => ({
        query_id: query.query_id,
        query: query.query,
        source_type: query.source_type,
        attempted: true,
        executed: false,
        live_unavailable: true,
        result_count: 0,
        failure_reason: "run_not_configured_for_live_research",
        evidence: []
      }));

  const allEvidence = dedupeEvidence([
    ...existingEvidence,
    ...manualEvidence,
    ...queryResults.flatMap((item) => item.evidence ?? [])
  ]);
  const meta = new Map(allEvidence.map((item) => [item.evidence_id, classifyEvidence(item)]));
  const accepted = allEvidence.filter((item) => meta.get(item.evidence_id)?.accepted);
  const rejected = allEvidence.filter((item) => !meta.get(item.evidence_id)?.accepted);
  const userVoice = accepted.filter((item) => meta.get(item.evidence_id)?.userVoice);
  const localOnly = accepted.filter((item) => meta.get(item.evidence_id)?.localOnly);
  const localOnlyUserVoice = userVoice.filter((item) => meta.get(item.evidence_id)?.localOnly);
  const textFirst = accepted.filter((item) => meta.get(item.evidence_id)?.textFirst);
  const upload = allEvidence.filter((item) => meta.get(item.evidence_id)?.uploadHeavy);
  const installIntent = accepted.filter((item) => meta.get(item.evidence_id)?.installIntent);
  const scores = buildScores(candidateEntry, localOnly.length, textFirst.length, installIntent.length, upload.length, userVoice.length, localOnlyUserVoice.length);
  const decision = buildDecision(scores, localOnly, textFirst, upload, installIntent, userVoice);
  refinedWedge.final_recommendation = decision.final_decision;
  const strongest = userVoice[0] ?? accepted[0] ?? null;

  const report = buildSafeReport({
    stage: "SUPPORT_QA_EVIDENCE_SPRINT",
    status: accepted.length > 0 || rejected.length > 0 ? "passed" : "skipped",
    run_id: state.runContext.run_id,
    candidate_name: candidateEntry.candidate_name,
    candidate_id: candidateEntry.candidate_id,
    target_micro_wedge: refinedWedge.wedge_name,
    evidence_questions: buildQuestionAnswers(accepted, localOnly, textFirst, upload, installIntent, candidateEntry),
    evidence_sources_attempted: queryResults.map((item) => ({
      query_id: item.query_id,
      query: item.query,
      source_type: item.source_type,
      attempted: item.attempted,
      executed: item.executed,
      live_unavailable: item.live_unavailable,
      result_count: item.result_count,
      failure_reason: item.failure_reason
    })),
    evidence_collected: accepted.map((item) => serializeEvidence(item, meta.get(item.evidence_id))).slice(0, 20),
    evidence_rejected: rejected.map((item) => serializeEvidence(item, meta.get(item.evidence_id))).slice(0, 20),
    user_voice_summary: {
      direct_user_voice_count: userVoice.length,
      summary: userVoice.length > 0
        ? "External user voice confirms bug-report context pain, but not yet enough explicit local-only install intent."
        : "External user voice for the narrowed local-only text-first wedge remains weak.",
      strongest_excerpt: strongest?.text_excerpt ?? "No accepted evidence captured."
    },
    install_intent_signals: installIntent.map((item) => serializeEvidence(item, meta.get(item.evidence_id))).slice(0, 8),
    local_only_preference_signals: localOnly.map((item) => serializeEvidence(item, meta.get(item.evidence_id))).slice(0, 8),
    screenshot_or_upload_preference_signals: upload.map((item) => serializeEvidence(item, meta.get(item.evidence_id))).slice(0, 8),
    text_first_handoff_signals: textFirst.map((item) => serializeEvidence(item, meta.get(item.evidence_id))).slice(0, 8),
    strongest_evidence: strongest ? serializeEvidence(strongest, meta.get(strongest.evidence_id)) : null,
    refined_wedge: refinedWedge,
    builder_fit_check: {
      builder_needed: true,
      builder_name: "support_context_clipboard_builder",
      estimated_builder_cost: "small",
      can_reuse_existing_browser_smoke: true,
      permissions_needed: ["activeTab"],
      implementation_modules: ["popup input", "page metadata capture", "markdown generator", "clipboard copy"],
      future_reuse_count: 2,
      should_build_builder_now: false
    },
    updated_evidence_quality_score: scores.updated_evidence_quality_score,
    updated_wedge_clarity_score: scores.updated_wedge_clarity_score,
    updated_portfolio_overlap_score: scores.updated_portfolio_overlap_score,
    updated_testability_score: scores.updated_testability_score,
    updated_compliance_risk: scores.updated_compliance_risk,
    final_decision: decision.final_decision,
    final_reason: decision.final_reason,
    next_step: decision.next_step
  });

  const testPlan = buildTestPlan(state.runContext.run_id, candidateEntry, refinedWedge, decision.final_decision);
  const humanQueue = buildHumanQueue(state.runContext.run_id, candidateEntry, refinedWedge, decision.final_decision, decision.final_reason, scores);

  await validateArtifact(state.projectRoot, "support_qa_evidence_sprint.schema.json", SUPPORT_QA_EVIDENCE_SPRINT_ARTIFACT, report);
  await validateArtifact(state.projectRoot, "support_qa_candidate_test_plan.schema.json", SUPPORT_QA_CANDIDATE_TEST_PLAN_ARTIFACT, testPlan);
  await validateArtifact(state.projectRoot, "support_qa_human_review_queue.schema.json", HUMAN_QUEUE_ARTIFACT, humanQueue);

  await writeManagedJsonArtifact({ runDir: state.runDir, runContext: state.runContext, artifactName: SUPPORT_QA_EVIDENCE_SPRINT_ARTIFACT, data: report });
  await writeManagedJsonArtifact({ runDir: state.runDir, runContext: state.runContext, artifactName: SUPPORT_QA_CANDIDATE_TEST_PLAN_ARTIFACT, data: testPlan });
  await writeManagedJsonArtifact({ runDir: state.runDir, runContext: state.runContext, artifactName: HUMAN_QUEUE_ARTIFACT, data: humanQueue });

  await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "80_support_qa_evidence_sprint.md",
    category: "support_qa_evidence_sprint",
    prefix: "80_support_qa_evidence_sprint",
    content: buildMarkdown(report, testPlan, humanQueue)
  });
  await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "81_support_qa_candidate_test_plan.md",
    category: "support_qa_evidence_sprint",
    prefix: "81_support_qa_candidate_test_plan",
    content: [
      "# Support/QA Candidate Test Plan",
      "",
      `- Candidate: ${testPlan.candidate_name}`,
      `- Wedge: ${testPlan.wedge_name}`,
      "",
      markdownSection("Happy Path", testPlan.happy_path),
      "",
      markdownSection("Tests", markdownList(testPlan.expected_functional_test_matrix ?? []))
    ].join("\n")
  });
  await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "79_support_qa_human_review_queue.md",
    category: "support_qa_deep_dive",
    prefix: "79_support_qa_human_review_queue",
    content: [
      "# Support/QA Human Review Queue",
      "",
      `- Candidate: ${candidateEntry.candidate_name}`,
      `- Recommended decision: ${(humanQueue.entries ?? [])[0]?.recommended_decision ?? "continue_later"}`,
      "",
      markdownSection("Question", (humanQueue.entries ?? [])[0]?.human_question ?? "")
    ].join("\n")
  });

  await upsertOpportunityEntries(state.projectRoot, [
    buildBacklogEntry(state.runContext.run_id, candidateEntry, refinedWedge, decision.final_decision, decision.final_reason, scores)
  ]);

  return { runDir: state.runDir, report, testPlan, humanQueue };
}
