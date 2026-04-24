import fs from "node:fs/promises";
import path from "node:path";
import { collectLiveEvidenceForCandidate } from "../research/liveResearch.mjs";
import { loadPortfolioRegistry } from "../portfolio/registry.mjs";
import {
  buildSafeReport,
  validateArtifact,
  writeManagedJsonArtifact,
  writeManagedMarkdownArtifact
} from "../review/helpers.mjs";
import { fileExists, nowIso, readJson } from "../utils/io.mjs";
import { upsertOpportunityEntries } from "./opportunityBacklog.mjs";

export const TARGETED_RESEARCH_ROUND2_ARTIFACT = "49_targeted_research_round2.json";
export const HUMAN_CANDIDATE_REVIEW_QUEUE_V2_ARTIFACT = "54_human_candidate_review_queue_v2.json";

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

function normalizeText(value) {
  return `${value ?? ""}`.replace(/\s+/g, " ").trim();
}

function buildCandidateText(candidate = {}, round1Entry = {}) {
  return normalizeText([
    candidate.name,
    candidate.live_summary,
    candidate.category,
    ...(candidate.signals ?? []),
    round1Entry.candidate_name,
    round1Entry.best_wedge_if_any?.one_sentence_value,
    round1Entry.final_decision_rationale,
    ...(round1Entry.targeted_research_questions ?? []),
    ...(round1Entry.evidence_gaps ?? [])
  ].join(" "));
}

function candidateKind(candidate = {}, round1Entry = {}) {
  const text = lower(buildCandidateText(candidate, round1Entry));
  if (/amazon|review harvest|review scraper|scrap/.test(text)) return "review_scraper";
  if (/json|schema|parse|diff|formatter|compare|payload/.test(text)) return "json_developer_utility";
  if (/csp|content security policy|header/.test(text)) return "security_csp";
  if (/form|fill|autofill|profile|crm|recruit|intake/.test(text)) return "form_fill";
  if (/seo|agent|directory submission|outreach|reddit/.test(text)) return "seo_or_agent";
  if (/tab|tabs|window|csv|markdown|session/.test(text)) return "tab_export";
  return "generic";
}

function normalizeEvidence(item) {
  return {
    source_type: item.source_type ?? "unknown",
    source_url: item.source_url ?? item.url ?? "",
    captured_at: item.captured_at ?? null,
    text_excerpt: normalizeText(item.text_excerpt ?? item.quote ?? item.topic ?? ""),
    reliability_weight: Number(item.reliability_weight ?? item.evidence_weight ?? 0.55),
    recency_weight: Number(item.recency_weight ?? 0.6)
  };
}

function evidenceKey(item) {
  return [
    item.source_type ?? "unknown",
    item.source_url ?? "",
    normalizeText(item.text_excerpt ?? "")
  ].join("|");
}

function hasVerticalFormSignal(text) {
  return /crm|recruit|job|support|customer|real estate|property|medical|internal|backoffice|back office/.test(lower(text));
}

function scoreDelta(round1Entry, round2Additional, liveUnavailable) {
  const sourceTypes = unique(round2Additional.map((item) => item.source_type));
  return {
    evidenceQuality: round(clamp(
      Number(round1Entry.updated_score_breakdown?.evidence_quality_score ?? 0)
      + Math.min(6, round2Additional.length * 1.4)
      + Math.min(5, sourceTypes.length * 1.8)
      - (liveUnavailable ? 2 : 0)
    )),
    wedgeClarity: round(clamp(
      Number(round1Entry.updated_score_breakdown?.wedge_clarity_score ?? 0)
      + (round2Additional.length > 0 ? 2.5 : 0.5)
    ))
  };
}

function expectedTestMatrix(round1Entry) {
  return round1Entry.testability_analysis?.expected_functional_test_matrix ?? [];
}

function productAcceptanceForecastPassed({ hasMatchingBuilder, happyPathDefined, complianceRisk }) {
  return hasMatchingBuilder && happyPathDefined && complianceRisk !== "high";
}

function determineDecision(context) {
  const {
    kind,
    text,
    overlapScore,
    evidenceQualityScore,
    wedgeClarityScore,
    testabilityScore,
    complianceRisk,
    independentSources,
    happyPathDefined,
    testMatrixExists,
    hasMatchingBuilder,
    productAcceptancePassed
  } = context;

  if (kind === "review_scraper") {
    return {
      finalDecision: "skip",
      backlogStatus: "skipped_high_compliance_risk",
      statusDetail: "marketplace_review_collection_policy_risk",
      finalReason: "Marketplace review collection still implies scraping or terms-of-service risk."
    };
  }

  if (kind === "seo_or_agent") {
    return {
      finalDecision: "skip",
      backlogStatus: "skipped_high_compliance_risk",
      statusDetail: "broad_seo_or_outreach_automation_risk",
      finalReason: "SEO or outreach automation remains too policy-risky and too broad for a safe factory wedge."
    };
  }

  if (kind === "form_fill" && !hasVerticalFormSignal(text)) {
    return {
      finalDecision: "skip",
      backlogStatus: "skipped_high_overlap",
      statusDetail: "generic_form_fill_overlap_with_leadfill",
      finalReason: "The form-fill wedge is still generic and overlaps too heavily with LeadFill One Profile."
    };
  }

  if (kind === "security_csp" && (complianceRisk === "high" || /inject|mutate|override|disable|bypass/.test(text))) {
    return {
      finalDecision: "skip",
      backlogStatus: "skipped_high_compliance_risk",
      statusDetail: "security_mutation_or_policy_risk",
      finalReason: "The security wedge still implies risky traffic mutation or policy-bypass behavior."
    };
  }

  if (kind === "json_developer_utility" && !hasMatchingBuilder) {
    return {
      finalDecision: "backlog_waiting_for_evidence",
      backlogStatus: "backlog_waiting_for_builder",
      statusDetail: "future_builder_opportunity",
      finalReason: "The wedge is promising and local-only, but the current factory has no matching builder."
    };
  }

  if (kind === "security_csp" && !hasMatchingBuilder) {
    return {
      finalDecision: "backlog_waiting_for_evidence",
      backlogStatus: "backlog_waiting_for_policy_review",
      statusDetail: "builder_and_policy_review_required",
      finalReason: "A read-only security wedge may be viable later, but it still needs builder support and policy review."
    };
  }

  if (overlapScore > 45) {
    return {
      finalDecision: "skip",
      backlogStatus: "skipped_high_overlap",
      statusDetail: "portfolio_overlap_above_round2_threshold",
      finalReason: "Round 2 still could not reduce portfolio overlap below the stricter build-ready threshold."
    };
  }

  if (complianceRisk === "high") {
    return {
      finalDecision: "skip",
      backlogStatus: "skipped_high_compliance_risk",
      statusDetail: "compliance_risk_high",
      finalReason: "Compliance risk remains high after round 2."
    };
  }

  if (evidenceQualityScore < 80 || independentSources < 2) {
    return {
      finalDecision: "backlog_waiting_for_evidence",
      backlogStatus: "backlog_waiting_for_evidence",
      statusDetail: "insufficient_independent_evidence",
      finalReason: "The wedge still needs stronger evidence from at least two independent sources."
    };
  }

  if (wedgeClarityScore < 82) {
    return {
      finalDecision: "skip",
      backlogStatus: "skipped_low_wedge_clarity",
      statusDetail: "wedge_still_too_broad_after_round2",
      finalReason: "The wedge is still not specific enough after the final research round."
    };
  }

  if (!happyPathDefined || !testMatrixExists || testabilityScore < 75 || !productAcceptancePassed) {
    return {
      finalDecision: "backlog_waiting_for_evidence",
      backlogStatus: "backlog_waiting_for_evidence",
      statusDetail: "testability_or_acceptance_forecast_gap",
      finalReason: "The wedge still lacks a clean, testable happy path or a passing product-acceptance forecast."
    };
  }

  return {
    finalDecision: "build_ready",
    backlogStatus: "build_ready",
    statusDetail: "ready_for_human_candidate_review",
    finalReason: "Round 2 now satisfies the stricter build-ready criteria."
  };
}

async function detectLatestRound2Run(projectRoot) {
  const runsRoot = path.join(projectRoot, "runs");
  const entries = await fs.readdir(runsRoot, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const runDir = path.join(runsRoot, entry.name);
    if (
      await fileExists(path.join(runDir, "46_targeted_research_batch.json"))
      && await fileExists(path.join(runDir, "48_human_candidate_review_queue.json"))
    ) {
      matches.push(runDir);
    }
  }
  matches.sort((left, right) => path.basename(right).localeCompare(path.basename(left)));
  return matches[0] ?? null;
}

async function resolveRunDir(projectRoot, run) {
  if (run) {
    return path.resolve(projectRoot, run);
  }
  const detected = await detectLatestRound2Run(projectRoot);
  if (!detected) {
    throw new Error("No run containing 46_targeted_research_batch.json and 48_human_candidate_review_queue.json was found.");
  }
  return detected;
}

async function loadState(projectRoot, run) {
  const runDir = await resolveRunDir(projectRoot, run);
  const runContext = await readJson(path.join(runDir, "00_run_context.json"));
  return {
    projectRoot,
    runDir,
    runContext,
    batch: await readJson(path.join(runDir, "46_targeted_research_batch.json")),
    board: await readJson(path.join(runDir, "47_wedge_decision_board.json")),
    queue: await readJson(path.join(runDir, "48_human_candidate_review_queue.json")),
    backlog: await readJson(path.join(projectRoot, "state", "opportunity_backlog.json")),
    portfolioRegistry: await loadPortfolioRegistry(projectRoot),
    candidateReport: await readJson(path.join(runDir, "10_candidate_report.json")),
    candidateQueue: await readJson(path.join(runDir, "41_live_candidate_queue.json"))
  };
}

function round2ResearchQuestions(kind, round1Gaps) {
  const questions = [
    "What concrete user action still lacks strong evidence after round 1?",
    "What would prove the wedge is install-worthy rather than just easy to build?",
    "What clearly differentiates this wedge from the current portfolio?"
  ];

  if (kind === "form_fill") {
    questions.push("Is this still generic autofill, or is the workflow now narrow enough to be vertical?");
  }
  if (kind === "json_developer_utility") {
    questions.push("Is this strong enough to justify a future builder, or should it stay in the backlog?");
  }
  if (kind === "security_csp") {
    questions.push("Can this stay read-only, or does it drift into risky request mutation?");
  }
  if (kind === "review_scraper" || kind === "seo_or_agent") {
    questions.push("Can this be reframed without scraping, platform automation, or policy risk?");
  }

  return unique([...questions, ...(round1Gaps ?? []).slice(0, 2)]).slice(0, 6);
}

async function collectRound2Evidence(runContext, candidate) {
  if ((runContext.research?.mode ?? "fixture") !== "live") {
    return {
      status: "skipped",
      live_unavailable: true,
      evidence: [],
      reason: "Run is not configured for live research."
    };
  }

  try {
    const result = await collectLiveEvidenceForCandidate(candidate, {
      timeoutMs: runContext.research?.timeout_ms ?? 15000,
      maxGithubIssues: runContext.research?.max_github_issues ?? 5
    });
    return {
      status: "passed",
      live_unavailable: false,
      evidence: (result.evidence ?? []).map(normalizeEvidence),
      reason: null
    };
  } catch (error) {
    return {
      status: "skipped",
      live_unavailable: true,
      evidence: [],
      reason: error.message
    };
  }
}

function candidateLookup(state, candidateId) {
  return (state.candidateReport.candidates ?? []).find((item) => item.candidate_id === candidateId)
    ?? (state.candidateQueue.discovered_candidates ?? []).find((item) => item.candidate_id === candidateId)
    ?? {};
}

function buildRound2Entry(state, round1Entry, queueEntry, candidate, round2Evidence) {
  const kind = candidateKind(candidate, round1Entry);
  const candidateText = buildCandidateText(candidate, round1Entry);
  const round1Additional = (round1Entry.additional_evidence_collected ?? []).map(normalizeEvidence);
  const round2Additional = (round2Evidence.evidence ?? []).filter((item) => !round1Additional.some((existing) => evidenceKey(existing) === evidenceKey(item)));
  const score = scoreDelta(round1Entry, round2Additional, round2Evidence.live_unavailable);
  const round1Overlap = Number(round1Entry.portfolio_overlap_analysis?.overlap_score ?? 0);
  let overlapScore = round(round1Overlap);
  let wedgeClarityScore = score.wedgeClarity;

  if (kind === "form_fill" && !hasVerticalFormSignal(candidateText)) {
    overlapScore = round(clamp(overlapScore + 4));
    wedgeClarityScore = round(clamp(wedgeClarityScore - 5));
  }
  if (kind === "tab_export") {
    overlapScore = round(clamp(Math.max(48, overlapScore + 2)));
  }
  if (kind === "seo_or_agent") {
    wedgeClarityScore = round(clamp(wedgeClarityScore - 4));
  }
  if (kind === "json_developer_utility") {
    overlapScore = round(clamp(Math.max(24, overlapScore - 4)));
    wedgeClarityScore = round(clamp(wedgeClarityScore + 2));
  }

  const finalWedge = round1Entry.best_wedge_if_any?.one_sentence_value ?? queueEntry?.proposed_wedge ?? null;
  const hasMatchingBuilder = round1Entry.estimated_archetype && round1Entry.estimated_archetype !== "unsupported_research_only";
  const testabilityScore = Number(round1Entry.updated_score_breakdown?.testability_score ?? 0);
  const complianceRisk = round1Entry.compliance_analysis?.risk_level ?? "low";
  const happyPathDefined = Boolean(round1Entry.testability_analysis?.happy_path_test);
  const testMatrix = expectedTestMatrix(round1Entry);
  const existingSourceTypes = unique([
    ...(round1Additional.map((item) => item.source_type)),
    ...(round2Additional.map((item) => item.source_type))
  ]);
  const independentSources = existingSourceTypes.length;
  const productAcceptancePassed = productAcceptanceForecastPassed({
    hasMatchingBuilder,
    happyPathDefined,
    complianceRisk
  });

  const buildReadyCriteria = {
    evidence_quality_score: score.evidenceQuality >= 80,
    wedge_clarity_score: wedgeClarityScore >= 82,
    testability_score: testabilityScore >= 75,
    portfolio_overlap_score: overlapScore <= 45,
    compliance_risk: complianceRisk !== "high",
    product_acceptance_forecast: productAcceptancePassed,
    independent_sources: independentSources >= 2,
    clear_happy_path: happyPathDefined,
    expected_functional_test_matrix: testMatrix.length > 0,
    matching_builder_or_small_builder_cost: hasMatchingBuilder,
    human_candidate_review_required: true
  };

  const decision = determineDecision({
    kind,
    text: `${candidateText} ${finalWedge ?? ""}`,
    overlapScore,
    evidenceQualityScore: score.evidenceQuality,
    wedgeClarityScore,
    testabilityScore,
    complianceRisk,
    independentSources,
    happyPathDefined,
    testMatrixExists: testMatrix.length > 0,
    hasMatchingBuilder,
    productAcceptancePassed
  });

  const failedReasons = Object.entries(buildReadyCriteria)
    .filter(([key, passed]) => key !== "human_candidate_review_required" && passed === false)
    .map(([key]) => key);

  return {
    candidate_id: round1Entry.candidate_id,
    candidate_name: round1Entry.candidate_name,
    round1_recommendation: round1Entry.final_recommendation,
    round1_gaps: unique([
      ...(round1Entry.evidence_gaps ?? []),
      ...(round1Entry.build_ready_criteria?.failed_reasons ?? [])
    ]),
    round2_research_questions: round2ResearchQuestions(kind, round1Entry.evidence_gaps ?? []),
    round2_additional_evidence: round2Additional,
    round2_additional_evidence_status: {
      status: round2Evidence.status,
      live_unavailable: round2Evidence.live_unavailable,
      reason: round2Evidence.reason
    },
    evidence_delta: {
      round1_evidence_quality_score: Number(round1Entry.updated_score_breakdown?.evidence_quality_score ?? 0),
      round2_evidence_quality_score: score.evidenceQuality,
      new_evidence_count: round2Additional.length,
      independent_source_count: independentSources
    },
    wedge_clarity_delta: round(wedgeClarityScore - Number(round1Entry.updated_score_breakdown?.wedge_clarity_score ?? 0)),
    overlap_delta: round(overlapScore - round1Overlap),
    final_wedge: finalWedge,
    updated_score_breakdown: {
      evidence_quality_score: score.evidenceQuality,
      wedge_clarity_score: wedgeClarityScore,
      testability_score: testabilityScore,
      portfolio_overlap_score: overlapScore,
      confidence_score: Number(round1Entry.updated_score_breakdown?.confidence_score ?? 0)
    },
    build_ready_criteria: {
      passed: decision.finalDecision === "build_ready",
      failed_reasons: failedReasons,
      criteria: buildReadyCriteria
    },
    final_gate_result: {
      passed: decision.finalDecision === "build_ready",
      gate_checks: buildReadyCriteria,
      failed_reasons: failedReasons
    },
    final_decision: decision.finalDecision,
    backlog_status: decision.backlogStatus,
    status_detail: decision.statusDetail,
    final_reason: decision.finalReason,
    next_step: decision.finalDecision === "build_ready"
      ? "human_candidate_review_required"
      : decision.finalDecision === "skip"
        ? "no_build_today"
        : decision.backlogStatus === "backlog_waiting_for_builder"
          ? "future_builder_opportunity"
          : decision.backlogStatus === "backlog_waiting_for_policy_review"
            ? "security_or_policy_review_before_revisit"
            : "wait_for_better_external_evidence"
  };
}

function buildQueueV2(runContext, round2Entries) {
  const buildReady = round2Entries.filter((entry) => entry.final_decision === "build_ready");
  const backlogWaiting = round2Entries.filter((entry) => entry.final_decision === "backlog_waiting_for_evidence");
  const selected = [...buildReady, ...backlogWaiting].slice(0, 5);

  return buildSafeReport({
    stage: "HUMAN_CANDIDATE_REVIEW_QUEUE_V2",
    status: "passed",
    run_id: runContext.run_id,
    no_build_today: buildReady.length === 0,
    queue_count: selected.length,
    entries: selected.map((entry) => ({
      candidate_id: entry.candidate_id,
      candidate_name: entry.candidate_name,
      proposed_wedge: entry.final_wedge,
      why_build: entry.final_decision === "build_ready"
        ? "This candidate cleared the final research round and is ready for human candidate review."
        : "This is the strongest remaining backlog candidate if a human wants to keep it warm.",
      why_not_build: entry.final_reason,
      what_evidence_is_missing: entry.build_ready_criteria.failed_reasons,
      what_human_should_decide: entry.final_decision === "build_ready"
        ? "Approve build or reject on differentiation or portfolio grounds."
        : "Decide whether this stays in the backlog until more evidence or builder support appears."
    }))
  });
}

function mapBacklogEntries(state, entries) {
  return entries.map((entry) => {
    const candidate = candidateLookup(state, entry.candidate_id);
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
      pain_summary: entry.final_reason,
      top_pain_clusters: entry.round2_research_questions.slice(0, 3),
      evidence_quality_score: entry.updated_score_breakdown.evidence_quality_score,
      testability_score: entry.updated_score_breakdown.testability_score,
      wedge_clarity_score: entry.updated_score_breakdown.wedge_clarity_score,
      portfolio_overlap_score: entry.updated_score_breakdown.portfolio_overlap_score,
      compliance_risk: entry.final_gate_result.gate_checks.compliance_risk ? 20 : 80,
      build_recommendation: entry.final_decision === "build_ready"
        ? "build"
        : entry.final_decision === "backlog_waiting_for_evidence"
          ? "backlog_waiting"
          : "skip",
      decision_reason: entry.final_reason,
      status: entry.backlog_status,
      linked_run_ids: [state.runContext.run_id],
      linked_portfolio_items: unique(
        (state.batch.candidates ?? [])
          .find((item) => item.candidate_id === entry.candidate_id)
          ?.portfolio_overlap_analysis?.similar_existing_items?.map((item) => item.item_id) ?? []
      ),
      next_step: entry.next_step,
      selected_wedge: entry.final_wedge,
      research_rounds_completed: 2,
      evidence_requirements: entry.final_decision === "backlog_waiting_for_evidence"
        ? entry.build_ready_criteria.failed_reasons
        : [],
      status_detail: entry.status_detail
    };
  });
}

function renderRound2Markdown(report) {
  return [
    "# Targeted Research Round 2",
    "",
    `- Run: ${report.run_id}`,
    `- Reviewed: ${report.reviewed_count}`,
    `- Build ready: ${report.build_ready_count}`,
    `- Skip: ${report.skip_count}`,
    `- Backlog waiting: ${report.backlog_waiting_count}`,
    `- Research more residual: ${report.research_more_count}`,
    `- No build today: ${report.no_build_today}`,
    "",
    ...report.entries.map((entry) => `- ${entry.candidate_name}: ${entry.final_decision} (${entry.final_reason})`)
  ].join("\n");
}

function renderQueueV2Markdown(queue) {
  return [
    "# Human Candidate Review Queue V2",
    "",
    `- no_build_today: ${queue.no_build_today}`,
    ...((queue.entries ?? []).map((entry) => `- ${entry.candidate_name}: ${entry.proposed_wedge}`))
  ].join("\n");
}

export async function runTargetedResearchRound2({ projectRoot = process.cwd(), run, top = 5 }) {
  const state = await loadState(projectRoot, run);
  const occurredAt = nowIso();
  const queueEntries = (state.queue.entries ?? []).slice(0, Math.max(1, Number(top) || 5));
  const round2Entries = [];

  for (const queueEntry of queueEntries) {
    const round1Entry = (state.batch.candidates ?? []).find((item) => item.candidate_id === queueEntry.candidate_id);
    if (!round1Entry) {
      continue;
    }
    const candidate = candidateLookup(state, queueEntry.candidate_id);
    const round2Evidence = await collectRound2Evidence(state.runContext, candidate);
    round2Entries.push(buildRound2Entry(state, round1Entry, queueEntry, candidate, round2Evidence));
  }

  const buildReadyCount = round2Entries.filter((entry) => entry.final_decision === "build_ready").length;
  const skipCount = round2Entries.filter((entry) => entry.final_decision === "skip").length;
  const backlogWaitingCount = round2Entries.filter((entry) => entry.final_decision === "backlog_waiting_for_evidence").length;

  const round2Report = buildSafeReport({
    stage: "TARGETED_RESEARCH_ROUND_2",
    status: "passed",
    run_id: state.runContext.run_id,
    reviewed_count: round2Entries.length,
    build_ready_count: buildReadyCount,
    skip_count: skipCount,
    backlog_waiting_count: backlogWaitingCount,
    research_more_count: 0,
    no_build_today: buildReadyCount === 0,
    no_build_reason: buildReadyCount === 0
      ? "No candidate cleared round 2 evidence, wedge, overlap, compliance, and builder gates."
      : null,
    entries: round2Entries
  });

  const queueV2 = buildQueueV2(state.runContext, round2Entries);

  await validateArtifact(state.projectRoot, "targeted_research_round2.schema.json", TARGETED_RESEARCH_ROUND2_ARTIFACT, round2Report);
  await validateArtifact(state.projectRoot, "human_candidate_review_queue_v2.schema.json", HUMAN_CANDIDATE_REVIEW_QUEUE_V2_ARTIFACT, queueV2);

  const round2Write = await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: TARGETED_RESEARCH_ROUND2_ARTIFACT,
    data: round2Report,
    occurredAt
  });
  const queueWrite = await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: HUMAN_CANDIDATE_REVIEW_QUEUE_V2_ARTIFACT,
    data: queueV2,
    occurredAt
  });
  const round2MarkdownWrite = await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "49_targeted_research_round2.md",
    category: "targeted_research",
    prefix: "49_targeted_research_round2",
    content: renderRound2Markdown(round2Report),
    occurredAt
  });
  const queueMarkdownWrite = await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "54_human_candidate_review_queue_v2.md",
    category: "targeted_research",
    prefix: "54_human_candidate_review_queue_v2",
    content: renderQueueV2Markdown(queueV2),
    occurredAt
  });

  await upsertOpportunityEntries(state.projectRoot, mapBacklogEntries(state, round2Entries));

  return {
    round2Report,
    queueV2,
    artifacts: {
      round2: round2Write.artifactRelativePath,
      queue: queueWrite.artifactRelativePath,
      round2_markdown: round2MarkdownWrite.artifactRelativePath,
      queue_markdown: queueMarkdownWrite.artifactRelativePath
    }
  };
}
