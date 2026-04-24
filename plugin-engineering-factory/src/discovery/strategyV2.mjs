import fs from "node:fs/promises";
import path from "node:path";
import { buildSafeReport, validateArtifact, writeManagedJsonArtifact, writeManagedMarkdownArtifact } from "../review/helpers.mjs";
import { loadPortfolioRegistry } from "../portfolio/registry.mjs";
import { buildUniqueRunId } from "../workflow/runId.mjs";
import { ensureDir, fileExists, nowIso, readJson, writeJson } from "../utils/io.mjs";

export const DISCOVERY_STRATEGY_V2_ARTIFACT = "55_discovery_strategy_v2.json";
export const BUILDER_FIT_MAP_ARTIFACT = "56_builder_fit_map.json";
export const LOW_OVERLAP_SEARCH_MAP_ARTIFACT = "57_low_overlap_search_map.json";
export const SOURCE_PRIORITY_MODEL_ARTIFACT = "58_source_priority_model.json";

const CURRENT_BUILDERS = ["single_profile_form_fill", "tab_csv_window_export", "gmail_snippet"];

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

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

function normalizeText(value) {
  return `${value ?? ""}`.replace(/\s+/g, " ").trim();
}

function candidateText(candidate) {
  return normalizeText([
    candidate.candidate_name ?? candidate.name,
    candidate.selected_wedge,
    candidate.final_wedge,
    candidate.proposed_wedge,
    candidate.reason,
    candidate.decision_reason,
    ...(candidate.decision_rationale ?? [])
  ].join(" "));
}

function inferPattern(candidate) {
  const text = lower(candidateText(candidate));
  if (/amazon|review harvest|marketplace review|scrap/.test(text)) {
    return { key: "review_scraping", label: "Review scraping or marketplace data collection" };
  }
  if (/seo|directory submission|outreach|reddit/.test(text)) {
    return { key: "seo_agent", label: "Broad SEO or outreach automation" };
  }
  if (/json|schema|parse|diff|payload|formatter|compare/.test(text)) {
    return { key: "developer_json_tool", label: "Local JSON or payload developer utility" };
  }
  if (/screenshot|capture|annotat|highlight|feedback tool|visual/.test(text)) {
    return { key: "screenshot_annotation", label: "Screenshot, annotation, or QA support workflow" };
  }
  if (/csp|header|security|rdap|whois/.test(text)) {
    return { key: "security_diagnostics", label: "Security or diagnostics helper" };
  }
  if (/gmail|email|compose|reply|snippet|template|macro/.test(text)) {
    return { key: "email_template", label: "Email, template, or compose workflow" };
  }
  if (/form|fill|autofill|job|apply|profile|crm|intake/.test(text)) {
    return { key: "form_fill", label: "Form-fill or repeated entry workflow" };
  }
  if (/tab|window|link list|markdown links|session|full page|web highlighter|notes/.test(text)) {
    return { key: "tab_or_capture", label: "Tab, page-capture, or browser artifact workflow" };
  }
  if (/csv|table|cleanup|copy paste|clipboard/.test(text)) {
    return { key: "data_cleanup", label: "Data cleanup or copy-paste workflow" };
  }
  if (/handoff|debug|bug report|checklist|support/.test(text)) {
    return { key: "support_handoff", label: "Support, debug, or handoff workflow" };
  }
  return { key: "generic_productivity", label: "Generic productivity helper" };
}

function builderSuggestion(candidate) {
  const text = lower(candidateText(candidate));
  const pattern = inferPattern(candidate);

  if (pattern.key === "form_fill") {
    const vertical = /recruit|job|crm|support|customer|property|real estate|medical|internal/.test(text);
    return {
      suggested_archetype: vertical ? "single_profile_form_fill" : "generic_form_fill_overlap",
      current_builder_available: vertical,
      builder_gap_reason: vertical ? null : "Current form-fill candidates are still generic and overlap LeadFill One Profile.",
      can_fit_existing_builder_with_differentiation: vertical,
      future_builder_candidate: false,
      future_builder_name: null,
      estimated_builder_cost: vertical ? "small" : "n/a",
      should_expand_builder_library: false
    };
  }

  if (pattern.key === "email_template") {
    const lowRisk = !/send|automation|campaign|bulk/.test(text);
    return {
      suggested_archetype: lowRisk ? "gmail_snippet" : "email_workflow_other",
      current_builder_available: lowRisk,
      builder_gap_reason: lowRisk ? null : "The candidate drifts beyond insert-only snippet behavior.",
      can_fit_existing_builder_with_differentiation: lowRisk,
      future_builder_candidate: !lowRisk,
      future_builder_name: !lowRisk ? "low_risk_support_macro" : null,
      estimated_builder_cost: !lowRisk ? "medium" : "small",
      should_expand_builder_library: false
    };
  }

  if (pattern.key === "tab_or_capture") {
    const tabLike = /tab|window|link list|session|markdown links/.test(text);
    const captureLike = /screenshot|capture|full page|highlighter|notes/.test(text);
    if (tabLike && !captureLike) {
      return {
        suggested_archetype: "tab_csv_window_export",
        current_builder_available: true,
        builder_gap_reason: null,
        can_fit_existing_builder_with_differentiation: true,
        future_builder_candidate: false,
        future_builder_name: null,
        estimated_builder_cost: "small",
        should_expand_builder_library: false
      };
    }
    return {
      suggested_archetype: "screenshot_annotation",
      current_builder_available: false,
      builder_gap_reason: "Current builders do not cover screenshot, annotation, or page-capture workflows cleanly.",
      can_fit_existing_builder_with_differentiation: false,
      future_builder_candidate: true,
      future_builder_name: "screenshot_annotation",
      estimated_builder_cost: "medium",
      should_expand_builder_library: false
    };
  }

  if (pattern.key === "support_handoff") {
    return {
      suggested_archetype: "support_debug_handoff",
      current_builder_available: false,
      builder_gap_reason: "Support and debug handoff workflows do not map cleanly to existing builders.",
      can_fit_existing_builder_with_differentiation: false,
      future_builder_candidate: true,
      future_builder_name: "support_debug_handoff",
      estimated_builder_cost: "medium",
      should_expand_builder_library: false
    };
  }

  if (pattern.key === "data_cleanup") {
    return {
      suggested_archetype: "local_data_cleanup",
      current_builder_available: false,
      builder_gap_reason: "CSV, table cleanup, and clipboard normalization are outside current builders.",
      can_fit_existing_builder_with_differentiation: false,
      future_builder_candidate: true,
      future_builder_name: "local_data_cleanup",
      estimated_builder_cost: "small",
      should_expand_builder_library: false
    };
  }

  if (pattern.key === "developer_json_tool") {
    return {
      suggested_archetype: "developer_payload_utility",
      current_builder_available: false,
      builder_gap_reason: "Local developer utilities still require a dedicated builder family.",
      can_fit_existing_builder_with_differentiation: false,
      future_builder_candidate: true,
      future_builder_name: "developer_payload_utility",
      estimated_builder_cost: "small",
      should_expand_builder_library: false
    };
  }

  if (pattern.key === "security_diagnostics") {
    return {
      suggested_archetype: "security_diagnostics",
      current_builder_available: false,
      builder_gap_reason: "Security diagnostics need separate review and tighter policy boundaries.",
      can_fit_existing_builder_with_differentiation: false,
      future_builder_candidate: true,
      future_builder_name: "read_only_security_diagnostics",
      estimated_builder_cost: "medium",
      should_expand_builder_library: false
    };
  }

  return {
    suggested_archetype: "unsupported_strategy_target",
    current_builder_available: false,
    builder_gap_reason: "The candidate does not fit the current builder library cleanly.",
    can_fit_existing_builder_with_differentiation: false,
    future_builder_candidate: false,
    future_builder_name: null,
    estimated_builder_cost: "high",
    should_expand_builder_library: false
  };
}

function aggregateByPattern(items, patternField = "pattern_key") {
  const counts = new Map();
  for (const item of items ?? []) {
    const key = item[patternField];
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([key, count]) => ({ key, count }));
}

async function detectLatestStrategySource(projectRoot) {
  const runsRoot = path.join(projectRoot, "runs");
  const entries = await fs.readdir(runsRoot, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const runDir = path.join(runsRoot, entry.name);
    const hasRound2RunArtifacts = await fileExists(path.join(runDir, "51_live_queue_round2_results.json"))
      && await fileExists(path.join(runDir, "52_live_queue_round2_scores.json"));
    if (hasRound2RunArtifacts) {
      candidates.push(runDir);
    }
  }
  candidates.sort((left, right) => path.basename(right).localeCompare(path.basename(left)));
  return candidates[0] ?? null;
}

async function resolveStrategyChain(projectRoot, fromRun) {
  const primaryRunDir = fromRun
    ? path.resolve(projectRoot, fromRun)
    : await detectLatestStrategySource(projectRoot);
  if (!primaryRunDir) {
    throw new Error("No recent live-queue-round2 run was found for discovery:strategy-v2.");
  }

  const primaryRunContext = await readJson(path.join(primaryRunDir, "00_run_context.json"));
  const sourceRunId = primaryRunContext.source_run_id ?? null;
  const sourceRunDir = sourceRunId ? path.join(projectRoot, "runs", sourceRunId) : primaryRunDir;
  return {
    primaryRunDir,
    primaryRunContext,
    primaryRunId: path.basename(primaryRunDir),
    sourceRunDir,
    sourceRunId: path.basename(sourceRunDir),
    sourceRunContext: await readJson(path.join(sourceRunDir, "00_run_context.json"))
  };
}

async function readChainArtifact(chain, fileName) {
  const primaryPath = path.join(chain.primaryRunDir, fileName);
  if (await fileExists(primaryPath)) {
    return readJson(primaryPath);
  }
  const sourcePath = path.join(chain.sourceRunDir, fileName);
  if (await fileExists(sourcePath)) {
    return readJson(sourcePath);
  }
  throw new Error(`Required artifact ${fileName} was not found in ${chain.primaryRunId} or ${chain.sourceRunId}.`);
}

async function createStrategyRun(projectRoot, chain) {
  const runId = buildUniqueRunId({
    task: {
      mode: "daily",
      run_slug: "discovery-strategy-v2"
    },
    taskPath: "discovery_strategy_v2"
  });
  const runDir = path.join(projectRoot, "runs", runId);
  await ensureDir(runDir);
  const occurredAt = nowIso();
  const runContext = {
    ...chain.primaryRunContext,
    stage: "DISCOVERY_STRATEGY_V2",
    status: "passed",
    generated_at: occurredAt,
    run_id: runId,
    run_type: "daily",
    task_mode: "daily",
    run_id_strategy: "timestamp_slug_unique",
    allow_overwrite: false,
    overwrite_blocked: false,
    created_at: occurredAt,
    source_run_id: chain.primaryRunId,
    original_discovery_source_run_id: chain.sourceRunId,
    discovery: {
      ...(chain.primaryRunContext.discovery ?? {}),
      mode: "strategy_v2",
      allow_auto_build: false
    }
  };
  await writeJson(path.join(runDir, "00_run_context.json"), runContext);
  await writeJson(path.join(runDir, "run_status.json"), {
    stage: "DISCOVERY_STRATEGY_V2",
    status: "passed",
    generated_at: occurredAt,
    run_id: runId,
    run_id_strategy: "timestamp_slug_unique",
    allow_overwrite: false,
    overwrite_blocked: false,
    created_at: occurredAt,
    failure_reason: null
  });
  return { runDir, runContext };
}

function toCandidatePool(round2Report, round2Scores, nextCandidateRound2) {
  const pool = new Map();
  for (const entry of round2Report.entries ?? []) {
    pool.set(entry.candidate_id, {
      candidate_id: entry.candidate_id,
      candidate_name: entry.candidate_name,
      selected_wedge: entry.final_wedge,
      evidence_quality_score: entry.updated_score_breakdown?.evidence_quality_score ?? 0,
      testability_score: entry.updated_score_breakdown?.testability_score ?? 0,
      wedge_clarity_score: entry.updated_score_breakdown?.wedge_clarity_score ?? 0,
      portfolio_overlap_score: entry.updated_score_breakdown?.portfolio_overlap_score ?? 0,
      build_recommendation: entry.final_decision === "build_ready"
        ? "build"
        : entry.final_decision === "skip"
          ? "skip"
          : "backlog_waiting",
      decision_reason: entry.final_reason
    });
  }

  for (const entry of round2Scores.top_ranked_opportunities ?? []) {
    if (pool.has(entry.candidate_id)) {
      continue;
    }
    pool.set(entry.candidate_id, {
      candidate_id: entry.candidate_id,
      candidate_name: entry.name,
      selected_wedge: nextCandidateRound2.candidate_id === entry.candidate_id ? nextCandidateRound2.selected_wedge : null,
      evidence_quality_score: entry.evidence_quality_score ?? 0,
      testability_score: entry.testability_score ?? 0,
      wedge_clarity_score: entry.wedge_clarity_score ?? 0,
      portfolio_overlap_score: entry.portfolio_overlap_score ?? entry.portfolio_overlap_penalty ?? 0,
      build_recommendation: entry.build_recommendation,
      decision_reason: (entry.decision_rationale ?? []).join("; ")
    });
  }

  return [...pool.values()];
}

function buildBuilderFitMap(candidatePool) {
  const entries = candidatePool.slice(0, 20).map((candidate) => {
    const suggestion = builderSuggestion(candidate);
    const pattern = inferPattern(candidate);
    const lowOverlap = Number(candidate.portfolio_overlap_score ?? 100) <= 45;
    const builderFitScore = round(clamp(
      22
      + (suggestion.current_builder_available ? 28 : 0)
      + (suggestion.can_fit_existing_builder_with_differentiation ? 12 : 0)
      + (suggestion.future_builder_candidate ? 10 : 0)
      + ((candidate.evidence_quality_score ?? 0) * 0.18)
      + ((candidate.testability_score ?? 0) * 0.15)
      + ((candidate.wedge_clarity_score ?? 0) * 0.12)
      - ((candidate.portfolio_overlap_score ?? 0) * 0.22)
    ));
    return {
      candidate_id: candidate.candidate_id,
      candidate_name: candidate.candidate_name,
      pattern_key: pattern.key,
      pattern_label: pattern.label,
      suggested_archetype: suggestion.suggested_archetype,
      current_builder_available: suggestion.current_builder_available,
      builder_fit_score: builderFitScore,
      builder_gap_reason: suggestion.builder_gap_reason,
      can_fit_existing_builder_with_differentiation: suggestion.can_fit_existing_builder_with_differentiation && lowOverlap,
      future_builder_candidate: suggestion.future_builder_candidate,
      future_builder_name: suggestion.future_builder_name,
      estimated_builder_cost: suggestion.estimated_builder_cost,
      should_expand_builder_library: suggestion.should_expand_builder_library,
      evidence_quality_score: candidate.evidence_quality_score,
      testability_score: candidate.testability_score,
      wedge_clarity_score: candidate.wedge_clarity_score,
      portfolio_overlap_score: candidate.portfolio_overlap_score,
      build_recommendation: candidate.build_recommendation
    };
  });

  const futureBuilderCounts = aggregateByPattern(
    entries.filter((entry) => entry.future_builder_candidate === true),
    "future_builder_name"
  );
  const futureBuilderSummary = futureBuilderCounts.map((item) => ({
    future_builder_name: item.key,
    repeated_candidate_count: item.count,
    should_expand_builder_library: item.count >= 2
  }));
  const shouldExpandSet = new Set(
    futureBuilderSummary.filter((item) => item.should_expand_builder_library).map((item) => item.future_builder_name)
  );
  for (const entry of entries) {
    if (entry.future_builder_name && shouldExpandSet.has(entry.future_builder_name)) {
      entry.should_expand_builder_library = true;
    }
  }

  return buildSafeReport({
    stage: "BUILDER_FIT_MAP",
    status: "passed",
    generated_at: nowIso(),
    candidate_count: entries.length,
    current_builders: CURRENT_BUILDERS,
    candidates: entries,
    future_builder_summary: futureBuilderSummary,
    next_step: "review_builder_fit_before_expanding_builder_library"
  });
}

function buildFailureModes({ round1Batch, round2Report, round2Scores, builderFitMap, backlog }) {
  const evidenceFailures = [
    ...(round2Report.entries ?? []).filter((entry) => entry.build_ready_criteria?.failed_reasons?.includes("evidence_quality_score")),
    ...((round2Scores.top_ranked_opportunities ?? []).filter((entry) => Number(entry.evidence_quality_score ?? 0) < 80))
  ].slice(0, 8).map((entry) => ({
    candidate_id: entry.candidate_id,
    candidate_name: entry.candidate_name ?? entry.name,
    missing_sources: "Need more support, issue-tracker, or repeated complaint evidence.",
    single_source_risk: Number(entry.evidence_delta?.independent_source_count ?? 2) < 2,
    note: entry.final_reason ?? (entry.decision_rationale ?? []).join("; ")
  }));

  const wedgeFailures = [
    ...(round2Report.entries ?? []).filter((entry) => entry.build_ready_criteria?.failed_reasons?.includes("wedge_clarity_score")),
    ...((round2Scores.top_ranked_opportunities ?? []).filter((entry) => Number(entry.wedge_clarity_score ?? 0) < 82))
  ].slice(0, 8).map((entry) => ({
    candidate_id: entry.candidate_id,
    candidate_name: entry.candidate_name ?? entry.name,
    reason: "The user pain still does not convert into a narrow single-purpose wedge with a clear happy path.",
    note: entry.final_reason ?? (entry.decision_rationale ?? []).join("; ")
  }));

  const overlapFailures = [
    ...(round2Report.entries ?? []).filter((entry) => entry.backlog_status === "skipped_high_overlap"),
    ...((round2Scores.top_ranked_opportunities ?? []).filter((entry) => Number(entry.portfolio_overlap_score ?? 0) > 45))
  ].slice(0, 10).map((entry) => ({
    candidate_id: entry.candidate_id,
    candidate_name: entry.candidate_name ?? entry.name,
    overlap_family: /form|autofill|profile/i.test(candidateText(entry))
      ? "LeadFill One Profile"
      : "tab_csv_window_export family",
    note: entry.final_reason ?? `portfolio_overlap_score=${entry.portfolio_overlap_score}`
  }));

  const builderFitFailures = builderFitMap.candidates
    .filter((entry) => entry.current_builder_available === false)
    .slice(0, 10)
    .map((entry) => ({
      candidate_id: entry.candidate_id,
      candidate_name: entry.candidate_name,
      future_builder_name: entry.future_builder_name,
      builder_gap_reason: entry.builder_gap_reason
    }));

  const complianceFailures = [
    ...(backlog.opportunities ?? [])
      .filter((item) => item.status === "skipped_high_compliance_risk")
      .map((item) => ({
        candidate_id: item.candidate_id,
        candidate_name: item.candidate_name,
        pattern: item.status_detail ?? item.decision_reason
      })),
    ...((round1Batch.candidates ?? [])
      .filter((item) => /amazon|review|seo|outreach|scrap/i.test(candidateText(item)))
      .map((item) => ({
        candidate_id: item.candidate_id,
        candidate_name: item.candidate_name,
        pattern: item.final_decision_rationale ?? item.final_recommendation
      })))
  ].slice(0, 8);

  return {
    evidence_failure: evidenceFailures,
    wedge_failure: wedgeFailures,
    overlap_failure: overlapFailures,
    builder_fit_failure: builderFitFailures,
    compliance_failure: complianceFailures
  };
}

function buildLowOverlapSearchSeeds() {
  return [
    ["seed-001", "site:chromewebstore.google.com recruiter intake autofill local only review", "vertical form workflow", "recruiters", "repeat candidate intake fields", "single recruiter intake filler", "single_profile_form_fill", "Avoids generic autofill by locking to recruiter intake", ["generic autofill", "job application mega-suite"], "low", "controlled recruiter fixture", ["support site", "store reviews", "recruiter forums"], "vertical field-level pain repeated in two sources", "generic profile manager requests"],
    ["seed-002", "site:chromewebstore.google.com support ticket reply macro chrome extension review", "support workflow", "support agents", "repeat ticket replies without sending automation", "insert-only support macro", "gmail_snippet", "Avoids mailbox automation and generic email suites", ["auto-send", "broad campaign automation"], "low", "compose insert fixture", ["support docs", "store reviews", "forums"], "insert-only complaints with shortcut demand", "send automation or mailbox-wide permissions"],
    ["seed-003", "site:chromewebstore.google.com customer support textarea helper local only review", "vertical form workflow", "support operators", "repeat textarea and dropdown entry", "support form fill helper", "single_profile_form_fill", "Narrower than generic CRM fill", ["generic autofill", "multi-profile CRM automation"], "low", "textarea/select fixture", ["support site", "reviews"], "clear textarea/dropdown pain", "broad contact enrichment"],
    ["seed-004", "site:chromewebstore.google.com qa screenshot annotator chrome extension review", "QA support", "QA testers", "manual screenshot markup", "quick screenshot annotation", "screenshot_annotation", "Non-tab-export browser artifact workflow", ["full capture suites with cloud sync"], "medium-low", "capture and annotate fixture", ["reviews", "support site", "Product Hunt"], "annotation or bug handoff complaints", "requires remote upload by default"],
    ["seed-005", "site:chromewebstore.google.com bug report screenshot handoff chrome extension review", "debug handoff", "support engineers", "manual bug handoff packages", "bug handoff capture", "support_debug_handoff", "Different from tab export and generic notes", ["project management dashboards"], "medium-low", "capture plus note fixture", ["reviews", "support docs"], "handoff and reproduction workflow pain", "broad PM or ticketing platform"],
    ["seed-006", "site:chromewebstore.google.com browser checklist handoff extension review", "debug handoff", "operators", "manual handoff checklists", "browser handoff checklist", "support_debug_handoff", "Targets explicit handoff artifacts, not tabs", ["generic notes", "team chat integrations"], "low", "checklist state fixture", ["support docs", "reviews"], "handoff checklist pain", "cloud collaboration-first products"],
    ["seed-007", "site:chromewebstore.google.com csv cleanup browser extension local only review", "data cleanup", "operators", "manual cleanup before sharing CSV rows", "local CSV cleanup helper", "local_data_cleanup", "Not related to tab export despite CSV keyword", ["tab export", "sheet sync"], "low", "paste-transform-copy fixture", ["reviews", "GitHub issues"], "copy-paste cleanup complaints", "spreadsheet sync requirements"],
    ["seed-008", "site:chromewebstore.google.com table cleanup copy paste chrome extension review", "data cleanup", "ops analysts", "clean pasted tables quickly", "table cleanup helper", "local_data_cleanup", "A local paste cleanup tool is lower overlap", ["tab export", "sheet add-ons"], "low", "table parsing fixture", ["reviews", "GitHub repos"], "repeated cleanup verbs", "needs remote sync"],
    ["seed-009", "site:chromewebstore.google.com clipboard sanitizer extension local only review", "data cleanup", "support and ops", "messy pasted text", "clipboard cleanup utility", "local_data_cleanup", "Targets clipboard normalization, not export", ["clipboard manager suites"], "low", "copy-transform-paste fixture", ["reviews", "forums"], "repeat paste-clean pain", "always-on monitoring"],
    ["seed-010", "site:chromewebstore.google.com browser note to markdown extension local only review", "support handoff", "writers and support", "manual context sharing", "copy page context as markdown", "support_debug_handoff", "Single-page handoff differs from tab export", ["generic notes", "tab export"], "low", "current-page markdown fixture", ["reviews", "support docs"], "context-sharing pain", "multi-tab export requests"],
    ["seed-011", "site:chromewebstore.google.com current page markdown copy extension review", "browser workflow", "writers", "manual page-to-markdown copying", "copy current page as markdown", "support_debug_handoff", "Single-page artifact avoids tab-family overlap", ["tab export", "session export"], "low", "current-page only fixture", ["reviews", "forums"], "copy current page complaints", "window/session scope requests"],
    ["seed-012", "site:chromewebstore.google.com support debug handoff extension local only review", "support handoff", "support engineers", "manual environment notes", "support handoff bundle", "support_debug_handoff", "Low-overlap support workflow", ["tab export", "ticketing automation"], "medium-low", "bundle creation fixture", ["support docs", "reviews"], "handoff friction signals", "scraping or external upload"],
    ["seed-013", "site:chromewebstore.google.com json diff local only chrome extension review", "developer utility", "developers", "compare payloads locally", "local JSON diff helper", "developer_payload_utility", "Builder gap but low-risk local-only utility", ["generic formatter suites"], "low", "paste-diff fixture", ["GitHub repos", "issues", "reviews"], "deterministic compare pain", "broad IDE integrations"],
    ["seed-014", "site:github.com chrome extension json diff issue local only", "developer utility", "developers", "manual payload comparison pain", "local JSON compare", "developer_payload_utility", "Looks for corroborating non-store evidence", ["generic JSON formatter"], "low", "paste-diff fixture", ["GitHub issues", "repos"], "issue repetition on compare/diff", "stale or repo-only chatter"],
    ["seed-015", "site:chromewebstore.google.com json schema validate browser extension review", "developer utility", "developers", "quick schema mismatch checks", "JSON validation helper", "developer_payload_utility", "Builder gap but clear local-only workflow", ["broad API debugging suites"], "low", "schema validate fixture", ["GitHub repos", "reviews"], "validate/mismatch complaints", "needs backend integration"],
    ["seed-016", "site:chromewebstore.google.com browser response header analyzer review", "developer diagnostics", "developers", "slow manual header inspection", "read-only header analyzer", "read_only_security_diagnostics", "Targets read-only diagnostics, not scanners", ["security scanner", "request mutation"], "medium", "static header fixture", ["GitHub issues", "docs", "reviews"], "read-only diagnostics demand", "traffic interception"],
    ["seed-017", "site:github.com csp header analyzer browser extension issue", "developer diagnostics", "developers", "manual CSP inspection pain", "copyable CSP summary", "read_only_security_diagnostics", "Non-scanner diagnostics evidence", ["security scanner", "policy bypass"], "medium", "header parsing fixture", ["GitHub issues", "repos"], "repeated manual inspection pain", "mutation/bypass goals"],
    ["seed-018", "site:chromewebstore.google.com website feedback screenshot chrome extension review", "QA support", "PMs and QA", "annotated feedback capture", "web feedback capture", "screenshot_annotation", "Lower overlap than tab export", ["team collaboration platforms"], "medium-low", "capture-note fixture", ["reviews", "support site"], "screenshot plus note pain", "requires remote backend to function"],
    ["seed-019", "site:chromewebstore.google.com annotate web page screenshot extension review", "QA support", "QA and support", "manual page annotation", "page annotation helper", "screenshot_annotation", "QA artifact flow rather than tab/browser export", ["broad screenshot suites"], "medium-low", "annotation fixture", ["reviews", "docs"], "annotation verbs repeated", "requires account-first workflow"],
    ["seed-020", "site:chromewebstore.google.com developer copy response body helper review", "developer utility", "developers", "copy debug output from browser quickly", "copy debug payload helper", "developer_payload_utility", "Low-risk local copy workflow", ["network interception"], "low", "copy payload fixture", ["GitHub repos", "issues"], "copy/debug pain", "intercepts or modifies requests"],
    ["seed-021", "site:chromewebstore.google.com admin panel copy paste helper review", "small SaaS admin workflow", "ops admins", "repeat admin copy-paste steps", "admin copy helper", "local_data_cleanup", "Admin workflow helper differs from form-fill portfolio", ["generic autofill", "full workflow automation"], "low", "controlled admin fixture", ["reviews", "support docs"], "copy-paste repetition in admin panels", "multi-page automation requests"],
    ["seed-022", "site:chromewebstore.google.com backoffice text cleanup extension local only review", "small SaaS admin workflow", "backoffice operators", "cleanup text before paste", "backoffice text cleanup", "local_data_cleanup", "Low-overlap cleanup workflow", ["generic clipboard manager"], "low", "text cleanup fixture", ["reviews", "forums"], "cleanup before paste pain", "account-linked sync"],
    ["seed-023", "site:chromewebstore.google.com support canned reply shortcut extension review", "email workflow", "support agents", "slow canned reply insertion", "shortcut-first support replies", "gmail_snippet", "Stays insert-only and low-risk", ["campaign automation", "mailbox-wide access"], "low", "shortcut insert fixture", ["reviews", "forums"], "shortcut and compose friction", "auto-send or campaign features"],
    ["seed-024", "site:reddit.com support macro browser extension shortcut pain", "email workflow", "support agents", "compose interruption from heavy template tools", "support reply shortcut", "gmail_snippet", "Looks for external evidence for insert-only email workflows", ["marketing automation"], "low", "shortcut insert fixture", ["Reddit", "forums"], "repeat shortcut complaints", "only generic forum praise"],
    ["seed-025", "site:chromewebstore.google.com browser qa checklist extension review", "QA support", "QA testers", "manual checklist tracking", "browser QA checklist", "support_debug_handoff", "Checklist workflow is outside current overlap zones", ["project management suite"], "low", "checklist fixture", ["reviews", "support docs"], "repeated checklist pain", "cloud-first PM workflows"],
    ["seed-026", "site:chromewebstore.google.com browser support note helper local only review", "support handoff", "support agents", "manual note capture while browsing", "browser support notes", "support_debug_handoff", "Support-local note taking differs from generic notes", ["generic note managers"], "low", "note attach fixture", ["reviews", "support docs"], "support context capture pain", "full knowledge-base products"],
    ["seed-027", "site:chromewebstore.google.com local browser privacy notes extension review", "privacy local-only tools", "researchers", "private local context capture", "local browser notes", "support_debug_handoff", "Privacy-local context tool is low-risk and low-overlap", ["security scanner", "sync-first notes"], "low", "note save fixture", ["reviews", "privacy docs"], "private local-only note demand", "requires cloud sync"],
    ["seed-028", "site:chromewebstore.google.com browser form helper recruiter local only review", "vertical form workflow", "recruiters", "repeat structured entry with overwrite anxiety", "recruiter intake helper", "single_profile_form_fill", "Explicitly vertical to avoid generic overlap", ["generic autofill", "resume suite"], "low", "controlled recruiter fixture", ["reviews", "forums", "support site"], "structured field complaints", "broad autofill asks"],
    ["seed-029", "site:chromewebstore.google.com ticket field fill helper support dropdown review", "vertical form workflow", "support operations", "repeat dropdown and textarea entry", "support ticket field helper", "single_profile_form_fill", "Vertical support field workflow instead of generic fill", ["generic autofill", "CRM sync"], "low", "dropdown plus textarea fixture", ["reviews", "support docs"], "dropdown or textarea fill complaints", "full CRM integration"],
    ["seed-030", "site:chromewebstore.google.com browser data cleanup copy ready output extension review", "data cleanup", "operators", "produce copy-ready cleaned output", "copy-ready cleanup helper", "local_data_cleanup", "Focuses on output artifact, not generic automation", ["tab export", "spreadsheet sync"], "low", "input-output fixture", ["reviews", "GitHub repos"], "copy-ready output complaints", "multi-source ETL aspirations"]
  ].map((item) => ({
    seed_id: item[0],
    query: item[1],
    target_category: item[2],
    intended_user: item[3],
    intended_pain: item[4],
    expected_wedge: item[5],
    expected_archetype: item[6],
    overlap_avoidance_reason: item[7],
    excluded_patterns: item[8],
    compliance_risk_hypothesis: item[9],
    testability_hypothesis: item[10],
    evidence_sources_to_prioritize: item[11],
    build_if_signal_found: item[12],
    skip_if_signal_found: item[13]
  }));
}

function buildLowOverlapSearchMap(strategyReport) {
  const searchSeeds = buildLowOverlapSearchSeeds();
  return buildSafeReport({
    stage: "LOW_OVERLAP_SEARCH_MAP",
    status: "passed",
    source_run_id: strategyReport.source_run_id,
    query_count: searchSeeds.length,
    search_seeds: searchSeeds,
    excluded_query_patterns: strategyReport.excluded_query_patterns,
    next_step: "run_strategy_v2_queries"
  });
}

function buildSourcePriorityModel() {
  return buildSafeReport({
    stage: "SOURCE_PRIORITY_MODEL",
    status: "passed",
    generated_at: nowIso(),
    sources: [
      {
        source_type: "chrome_web_store_listing",
        priority: 1,
        expected_signal: "Candidate existence, permissions, update freshness, and top-line scope.",
        reliability_weight: 0.55,
        recency_weight: 0.8,
        cost: "low",
        failure_modes: ["marketing copy overstates differentiation", "negative pain is underexposed"],
        use_when: "Need broad candidate generation and first-pass fit checks.",
        avoid_when: "You need repeated complaint evidence by itself."
      },
      {
        source_type: "chrome_web_store_review_snippet",
        priority: 2,
        expected_signal: "Repeated verbs, workflow pain, breakage, confusion, and missing-feature clues.",
        reliability_weight: 0.72,
        recency_weight: 0.85,
        cost: "medium",
        failure_modes: ["sample bias", "limited snippet availability"],
        use_when: "Need direct user pain phrasing and review-density signals.",
        avoid_when: "No review text is accessible or review count is tiny."
      },
      {
        source_type: "support_site",
        priority: 3,
        expected_signal: "Specific workflows, exact feature explanations, and help-center failure clues.",
        reliability_weight: 0.86,
        recency_weight: 0.72,
        cost: "medium",
        failure_modes: ["support copy can be generic", "pages may be stale"],
        use_when: "You need exact workflow vocabulary or product scope clarification.",
        avoid_when: "The support surface is pure marketing without concrete steps."
      },
      {
        source_type: "github_issues",
        priority: 4,
        expected_signal: "Repro steps, repeated breakage, and developer-tool workflow pain.",
        reliability_weight: 0.9,
        recency_weight: 0.7,
        cost: "medium",
        failure_modes: ["repo chatter may reflect maintainer backlog, not user demand", "stale issues"],
        use_when: "The candidate is developer-facing or has an active public repo.",
        avoid_when: "The tracker is stale or irrelevant to end-user workflows."
      },
      {
        source_type: "public_docs_or_faq",
        priority: 5,
        expected_signal: "Feature boundary, permission model, workflow steps, and terminology.",
        reliability_weight: 0.74,
        recency_weight: 0.65,
        cost: "low",
        failure_modes: ["docs can lag product reality"],
        use_when: "You need to disambiguate wedge scope or verify low-risk behavior.",
        avoid_when: "There is no concrete workflow detail."
      },
      {
        source_type: "extension_support_page",
        priority: 6,
        expected_signal: "Category-specific pain wording, narrow feature descriptions, and release notes.",
        reliability_weight: 0.82,
        recency_weight: 0.68,
        cost: "medium",
        failure_modes: ["release notes may not reflect user pain"],
        use_when: "You need extension-specific operational context.",
        avoid_when: "The page is machine-generated or empty."
      },
      {
        source_type: "reddit_or_forum",
        priority: 7,
        expected_signal: "Practitioner language, workflow friction outside the store, and install-worthiness cues.",
        reliability_weight: 0.52,
        recency_weight: 0.78,
        cost: "medium",
        failure_modes: ["anecdotal", "one-off complaints", "hard to verify"],
        use_when: "You need corroboration for vertical workflows or user vocabulary.",
        avoid_when: "Forum chatter is the only evidence source."
      },
      {
        source_type: "product_hunt_or_indie_hackers_or_hn",
        priority: 8,
        expected_signal: "Trend direction, emerging workflow pain, and builder-gap opportunities.",
        reliability_weight: 0.48,
        recency_weight: 0.82,
        cost: "medium",
        failure_modes: ["hype bias", "weak reproducibility"],
        use_when: "Exploring new search spaces or future-builder opportunities.",
        avoid_when: "You need concrete build evidence today."
      },
      {
        source_type: "github_repo_readme_or_docs",
        priority: 9,
        expected_signal: "Developer utility workflows, supported inputs, and local-only scope.",
        reliability_weight: 0.76,
        recency_weight: 0.7,
        cost: "low",
        failure_modes: ["builder-fit may still be weak", "repo quality varies"],
        use_when: "Assessing developer utilities or future builder categories.",
        avoid_when: "The repo is inactive or not user-facing."
      }
    ]
  });
}

function renderStrategyMarkdown(report) {
  return [
    "# Discovery Strategy V2",
    "",
    `- Strategy source run: ${report.source_run_id}`,
    `- No-build reason: ${report.no_build_today_reason}`,
    `- Next step: ${report.next_step}`,
    "",
    "## Failure Modes",
    "",
    ...report.discovery_failure_modes.map((item) => `- ${item.mode}: ${item.summary}`)
  ].join("\n");
}

function renderBuilderFitMarkdown(report) {
  return [
    "# Builder Fit Map",
    "",
    `- Candidate count: ${report.candidate_count}`,
    `- Current builders: ${(report.current_builders ?? []).join(", ")}`,
    "",
    ...report.candidates.slice(0, 10).map((item) => `- ${item.candidate_name}: ${item.suggested_archetype} (fit ${item.builder_fit_score})`)
  ].join("\n");
}

function renderSearchMapMarkdown(report) {
  return [
    "# Low Overlap Search Map",
    "",
    `- Query count: ${report.query_count}`,
    `- Next step: ${report.next_step}`,
    "",
    ...report.search_seeds.slice(0, 15).map((item) => `- ${item.seed_id}: ${item.query}`)
  ].join("\n");
}

export async function generateDiscoveryStrategyV2({ projectRoot = process.cwd(), fromRun = null }) {
  const chain = await resolveStrategyChain(projectRoot, fromRun);
  const round1Batch = await readChainArtifact(chain, "46_targeted_research_batch.json");
  const round2Report = await readChainArtifact(chain, "49_targeted_research_round2.json");
  await readChainArtifact(chain, "50_query_expansion_plan.json");
  await readChainArtifact(chain, "51_live_queue_round2_results.json");
  const round2Scores = await readChainArtifact(chain, "52_live_queue_round2_scores.json");
  const nextCandidateRound2 = await readChainArtifact(chain, "53_next_candidate_round2.json");
  const humanQueueV2 = await readChainArtifact(chain, "54_human_candidate_review_queue_v2.json");
  const backlog = await readJson(path.join(projectRoot, "state", "opportunity_backlog.json"));
  await loadPortfolioRegistry(projectRoot);
  const { runDir, runContext } = await createStrategyRun(projectRoot, chain);
  const occurredAt = nowIso();

  const candidatePool = toCandidatePool(round2Report, round2Scores, nextCandidateRound2);
  const builderFitMap = buildBuilderFitMap(candidatePool);
  const failureModes = buildFailureModes({
    round1Batch,
    round2Report,
    round2Scores,
    builderFitMap,
    backlog
  });
  const repeatedPatterns = aggregateByPattern(builderFitMap.candidates).slice(0, 8);
  const highOverlapPatterns = aggregateByPattern(
    builderFitMap.candidates.filter((item) => Number(item.portfolio_overlap_score ?? 0) > 45)
  );
  const highCompliancePatterns = [
    "Amazon review scraping and marketplace data extraction",
    "Broad SEO or outreach automation",
    "High-permission security scanning or request mutation"
  ];
  const builderGapPatterns = aggregateByPattern(
    builderFitMap.candidates.filter((item) => item.future_builder_candidate === true)
  );
  const weakEvidencePatterns = [
    "Store-only evidence is still too common for same-family ideas.",
    "Support pages and issue trackers are missing from several high-scoring candidates.",
    "Negative review density is often too shallow to prove install-worthy pain."
  ];
  const lowWedgePatterns = [
    "Generic autofill still collapses into LeadFill overlap.",
    "Tab-export-like opportunities still fail differentiation.",
    "Several candidates are feature-rich products with no narrow trigger moment."
  ];

  const strategyReport = buildSafeReport({
    stage: "DISCOVERY_STRATEGY_V2",
    status: "passed",
    source_run_id: chain.primaryRunId,
    original_discovery_source_run_id: chain.sourceRunId,
    no_build_today_reason: round2Report.no_build_reason ?? nextCandidateRound2.reason,
    discovery_failure_modes: [
      {
        mode: "evidence_failure",
        summary: "Strong store presence is not enough; repeated support or issue evidence is still missing for many candidates.",
        examples: failureModes.evidence_failure
      },
      {
        mode: "wedge_failure",
        summary: "Several candidates remain too broad or map to fuzzy happy paths.",
        examples: failureModes.wedge_failure
      },
      {
        mode: "overlap_failure",
        summary: "Form-fill and tab-export families still dominate the queue and collide with the current portfolio.",
        examples: failureModes.overlap_failure
      },
      {
        mode: "builder_fit_failure",
        summary: "Promising local utilities often do not fit the current three builders.",
        examples: failureModes.builder_fit_failure
      },
      {
        mode: "compliance_failure",
        summary: "Marketplace scraping, SEO automation, and risky security ideas should stay excluded.",
        examples: failureModes.compliance_failure
      }
    ],
    repeated_candidate_patterns: repeatedPatterns,
    high_overlap_patterns: highOverlapPatterns,
    high_compliance_risk_patterns: highCompliancePatterns,
    builder_gap_patterns: builderGapPatterns,
    weak_evidence_patterns: weakEvidencePatterns,
    low_wedge_clarity_patterns: lowWedgePatterns,
    recommended_search_space_shift: [
      "Reduce generic form-fill and tab-export query volume unless the workflow is explicitly vertical and evidence-rich.",
      "Increase search coverage for support handoff, QA capture, local cleanup, and insert-only email workflows.",
      "Prefer workflows whose happy path can be validated with a controlled browser fixture or deterministic input-output check.",
      "Bias toward low-risk local-only utilities where support docs or issue trackers reveal repeat workflow pain."
    ],
    recommended_query_families: [
      "vertical_form_workflows",
      "support_debug_handoff",
      "qa_screenshot_annotation",
      "local_data_cleanup",
      "insert_only_email_templates",
      "local_developer_payload_utilities"
    ],
    excluded_query_patterns: [
      "generic autofill",
      "generic tab export",
      "Amazon review scraping",
      "broad SEO agent",
      "high-permission CSP or security scanner",
      "generic JSON formatter or compare unless a narrow local-only wedge appears"
    ],
    preferred_builder_fit_targets: [
      "single_profile_form_fill only for clearly vertical repeated-entry workflows",
      "gmail_snippet only for insert-only or shortcut-first support template flows",
      "Future builder candidates: screenshot_annotation, support_debug_handoff, local_data_cleanup, developer_payload_utility"
    ],
    next_discovery_plan: [
      "Use the low-overlap search map instead of re-querying generic high-overlap categories.",
      "Prioritize support pages, issue trackers, and public docs when early listing signals look promising.",
      "Keep future-builder candidates in the roadmap unless multiple low-overlap high-testability signals repeat."
    ],
    next_step: "run_strategy_v2_queries",
    supporting_runs: {
      round2_run_id: chain.sourceRunId,
      live_queue_round2_run_id: chain.primaryRunId,
      strategy_run_id: runContext.run_id
    },
    human_review_queue_count: humanQueueV2.queue_count ?? 0
  });

  const lowOverlapSearchMap = buildLowOverlapSearchMap(strategyReport);
  const sourcePriorityModel = buildSourcePriorityModel();

  await validateArtifact(projectRoot, "discovery_strategy_v2.schema.json", DISCOVERY_STRATEGY_V2_ARTIFACT, strategyReport);
  await validateArtifact(projectRoot, "builder_fit_map.schema.json", BUILDER_FIT_MAP_ARTIFACT, builderFitMap);
  await validateArtifact(projectRoot, "low_overlap_search_map.schema.json", LOW_OVERLAP_SEARCH_MAP_ARTIFACT, lowOverlapSearchMap);
  await validateArtifact(projectRoot, "source_priority_model.schema.json", SOURCE_PRIORITY_MODEL_ARTIFACT, sourcePriorityModel);

  const strategyWrite = await writeManagedJsonArtifact({
    runDir,
    runContext,
    artifactName: DISCOVERY_STRATEGY_V2_ARTIFACT,
    data: strategyReport,
    occurredAt
  });
  const builderWrite = await writeManagedJsonArtifact({
    runDir,
    runContext,
    artifactName: BUILDER_FIT_MAP_ARTIFACT,
    data: builderFitMap,
    occurredAt
  });
  const searchMapWrite = await writeManagedJsonArtifact({
    runDir,
    runContext,
    artifactName: LOW_OVERLAP_SEARCH_MAP_ARTIFACT,
    data: lowOverlapSearchMap,
    occurredAt
  });
  const sourceModelWrite = await writeManagedJsonArtifact({
    runDir,
    runContext,
    artifactName: SOURCE_PRIORITY_MODEL_ARTIFACT,
    data: sourcePriorityModel,
    occurredAt
  });

  await writeManagedMarkdownArtifact({
    runDir,
    runContext,
    fileName: "55_discovery_strategy_v2.md",
    category: "strategy_v2",
    prefix: "55_discovery_strategy_v2",
    content: renderStrategyMarkdown(strategyReport),
    occurredAt
  });
  await writeManagedMarkdownArtifact({
    runDir,
    runContext,
    fileName: "56_builder_fit_map.md",
    category: "strategy_v2",
    prefix: "56_builder_fit_map",
    content: renderBuilderFitMarkdown(builderFitMap),
    occurredAt
  });
  await writeManagedMarkdownArtifact({
    runDir,
    runContext,
    fileName: "57_low_overlap_search_map.md",
    category: "strategy_v2",
    prefix: "57_low_overlap_search_map",
    content: renderSearchMapMarkdown(lowOverlapSearchMap),
    occurredAt
  });

  return {
    runDir,
    runContext,
    strategyReport,
    builderFitMap,
    lowOverlapSearchMap,
    sourcePriorityModel,
    artifacts: {
      strategy: strategyWrite.artifactRelativePath,
      builder_fit: builderWrite.artifactRelativePath,
      low_overlap_search_map: searchMapWrite.artifactRelativePath,
      source_priority_model: sourceModelWrite.artifactRelativePath
    }
  };
}

export async function recordHumanStrategyReview({
  projectRoot = process.cwd(),
  run,
  decision,
  note,
  reviewer = "human"
}) {
  const runDir = path.resolve(projectRoot, run);
  const runContext = await readJson(path.join(runDir, "00_run_context.json"));
  const occurredAt = nowIso();
  const targetDir = path.join(projectRoot, "state", "discovery_strategy_reviews");
  const safeDecision = `${decision ?? ""}`.trim();
  const review = {
    reviewed_at: occurredAt,
    reviewer,
    run_id: runContext.run_id,
    decision: safeDecision,
    note: `${note ?? ""}`.trim(),
    approved_query_families: safeDecision === "continue_strategy"
      ? ["vertical_form_workflows", "support_debug_handoff", "qa_screenshot_annotation"]
      : [],
    rejected_query_families: safeDecision === "adjust_queries"
      ? ["generic_form_fill", "generic_tab_export"]
      : [],
    preferred_verticals: safeDecision === "manual_seed"
      ? ["manual_seed_required_from_user_note"]
      : [],
    future_builder_interest: safeDecision === "approve_future_builder"
      ? ["screenshot_annotation", "local_data_cleanup", "developer_payload_utility"]
      : [],
    next_step: safeDecision === "continue_strategy"
      ? "run_strategy_v2_queries"
      : safeDecision === "adjust_queries"
        ? "revise_low_overlap_search_map"
        : safeDecision === "approve_future_builder"
          ? "add_to_builder_roadmap_only"
          : "record_manual_seed_and_regenerate_strategy"
  };
  await ensureDir(targetDir);
  const stamp = occurredAt.replace(/[:.]/g, "-");
  const targetPath = path.join(targetDir, `${stamp}.json`);
  await writeJson(targetPath, review);
  return {
    review,
    reviewPath: targetPath
  };
}
