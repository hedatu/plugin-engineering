import path from "node:path";
import { buildSafeReport, validateArtifact, writeManagedJsonArtifact, writeManagedMarkdownArtifact } from "../review/helpers.mjs";
import { createDiscoveryLiveQueueRun, runDiscoveryLiveQueue, scoreDiscoveryQueue } from "./liveQueue.mjs";
import { upsertOpportunityEntries } from "./opportunityBacklog.mjs";
import { fileExists, nowIso, readJson } from "../utils/io.mjs";

export const STRATEGY_V2_QUERY_RESULTS_ARTIFACT = "59_strategy_v2_query_results.json";
export const STRATEGY_V2_CANDIDATE_SCORES_ARTIFACT = "60_strategy_v2_candidate_scores.json";
export const STRATEGY_V2_NEXT_CANDIDATE_ARTIFACT = "61_strategy_v2_next_candidate.json";
export const NO_BUILD_TODAY_REPORT_ARTIFACT = "62_no_build_today_report.json";

const STRATEGY_V2_STRICT_THRESHOLDS = {
  min_evidence_quality_score: 80,
  min_wedge_clarity_score: 82,
  min_testability_score: 75,
  max_portfolio_overlap_score: 45,
  min_confidence_score: 65,
  min_independent_sources: 2
};

const EXPECTED_TEST_MATRIX_BY_FAMILY = {
  single_profile_form_fill: [
    "empty form",
    "partially filled form",
    "readonly field",
    "select field",
    "no matching fields",
    "overwrite default=false",
    "popup feedback display"
  ],
  tab_csv_window_export: [
    "current window only",
    "download success state",
    "CSV column stability",
    "pinned tab filtering",
    "empty window handling"
  ],
  gmail_snippet: [
    "compose insert",
    "keyboard-first selection",
    "empty compose guard",
    "snippet search",
    "permission boundary"
  ]
};

async function resolveStrategyArtifact(projectRoot, strategyPath) {
  const directPath = path.isAbsolute(strategyPath)
    ? strategyPath
    : path.resolve(projectRoot, strategyPath);
  if (await fileExists(directPath)) {
    return directPath;
  }
  throw new Error(`Strategy artifact not found: ${strategyPath}`);
}

async function loadStrategyState(projectRoot, strategyPath) {
  const strategyArtifactPath = await resolveStrategyArtifact(projectRoot, strategyPath);
  const runDir = path.dirname(strategyArtifactPath);
  const runContext = await readJson(path.join(runDir, "00_run_context.json"));
  const strategyReport = await readJson(path.join(runDir, "55_discovery_strategy_v2.json"));
  return {
    strategyArtifactPath,
    runDir,
    runContext,
    strategyReport,
    strategyPlan: await readJson(strategyArtifactPath)
  };
}

function normalizeQueryConfigs(strategyPlan, limit) {
  return (strategyPlan.search_seeds ?? strategyPlan.queries ?? []).slice(0, Number(limit) || 30).map((item) => ({
    query: item.query,
    target_category: item.target_category
  }));
}

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

async function loadExecutionArtifacts(runDir) {
  return {
    candidateReport: await readJson(path.join(runDir, "10_candidate_report.json")),
    evidenceReport: await readJson(path.join(runDir, "20_feedback_evidence.json")),
    clusterReport: await readJson(path.join(runDir, "21_feedback_clusters.json"))
  };
}

function strictStrategyAssessment({
  score,
  candidate,
  evidence,
  clusters,
  runContext
}) {
  const permissionRiskThreshold = Number(runContext.thresholds?.max_permission_risk_score ?? 55);
  const permissionRiskScore = Number(candidate?.permission_risk_score ?? 100);
  const weakClusters = (clusters ?? []).filter((item) => item.weak_cluster_reason);
  const sourceTypes = unique((evidence ?? []).map((item) => item.source_type));
  const expectedTestMatrix = EXPECTED_TEST_MATRIX_BY_FAMILY[candidate?.wedge_family] ?? [];
  const criteria = {
    evidence_quality_score: Number(score.evidence_quality_score ?? 0) >= STRATEGY_V2_STRICT_THRESHOLDS.min_evidence_quality_score,
    wedge_clarity_score: Number(score.wedge_clarity_score ?? 0) >= STRATEGY_V2_STRICT_THRESHOLDS.min_wedge_clarity_score,
    testability_score: Number(score.testability_score ?? 0) >= STRATEGY_V2_STRICT_THRESHOLDS.min_testability_score,
    portfolio_overlap_score: Number(score.portfolio_overlap_score ?? score.portfolio_overlap_penalty ?? 100) <= STRATEGY_V2_STRICT_THRESHOLDS.max_portfolio_overlap_score,
    confidence_score: Number(score.confidence_score ?? 0) >= STRATEGY_V2_STRICT_THRESHOLDS.min_confidence_score,
    supported_builder: score.supported_builder === true,
    independent_sources: sourceTypes.length >= STRATEGY_V2_STRICT_THRESHOLDS.min_independent_sources,
    permissions_risk_gate: Number(score.compliance_score ?? 0) >= 50 && permissionRiskScore <= permissionRiskThreshold,
    clear_happy_path: weakClusters.length === 0,
    expected_functional_test_matrix: expectedTestMatrix.length > 0,
    product_acceptance_forecast: weakClusters.length === 0
      && expectedTestMatrix.length > 0
      && score.supported_builder === true
      && Number(score.compliance_score ?? 0) >= 50
      && permissionRiskScore <= permissionRiskThreshold
  };
  const failedReasons = Object.entries(criteria)
    .filter(([, passed]) => passed !== true)
    .map(([key]) => key);

  let strictRecommendation = "research_more";
  if (
    criteria.permissions_risk_gate !== true
    || Number(score.portfolio_overlap_score ?? score.portfolio_overlap_penalty ?? 0) >= 70
  ) {
    strictRecommendation = "skip";
  } else if (failedReasons.length === 0) {
    strictRecommendation = "build";
  }

  return {
    strict_recommendation: strictRecommendation,
    strategy_v2_build_ready_criteria: {
      passed: strictRecommendation === "build",
      failed_reasons: failedReasons,
      criteria
    },
    evidence_source_types: sourceTypes,
    weak_cluster_count: weakClusters.length,
    permission_risk_score: permissionRiskScore,
    expected_test_matrix: expectedTestMatrix
  };
}

function applyStrictStrategyV2Gate({
  scoredReport,
  runContext,
  candidateReport,
  evidenceReport,
  clusterReport
}) {
  const candidatesById = new Map((candidateReport.candidates ?? []).map((item) => [item.candidate_id, item]));
  const rankedOpportunities = (scoredReport.ranked_opportunities ?? []).map((item) => {
    const candidate = candidatesById.get(item.candidate_id) ?? null;
    const evidence = evidenceReport.evidence_by_candidate?.[item.candidate_id] ?? [];
    const clusters = clusterReport.clusters_by_candidate?.[item.candidate_id] ?? [];
    const strictAssessment = strictStrategyAssessment({
      score: item,
      candidate,
      evidence,
      clusters,
      runContext
    });
    return {
      ...item,
      build_recommendation: strictAssessment.strict_recommendation,
      strategy_v2_build_ready_criteria: strictAssessment.strategy_v2_build_ready_criteria,
      evidence_source_types: strictAssessment.evidence_source_types,
      weak_cluster_count: strictAssessment.weak_cluster_count,
      permission_risk_score: strictAssessment.permission_risk_score,
      expected_test_matrix: strictAssessment.expected_test_matrix,
      decision_rationale: [
        ...(item.decision_rationale ?? []),
        `strategy_v2_strict_gate=${strictAssessment.strict_recommendation}`,
        strictAssessment.strategy_v2_build_ready_criteria.failed_reasons.length > 0
          ? `strict_gate_failures=${strictAssessment.strategy_v2_build_ready_criteria.failed_reasons.join(",")}`
          : "strict_gate_failures=none"
      ]
    };
  });

  return {
    ...scoredReport,
    ranked_opportunities: rankedOpportunities,
    top_ranked_opportunities: rankedOpportunities.slice(0, 10),
    build_ready_count: rankedOpportunities.filter((item) => item.build_recommendation === "build").length,
    next_step: rankedOpportunities.some((item) => item.build_recommendation === "build")
      ? "human_strategy_review"
      : "continue_strategy_v2"
  };
}

function buildQueryResultsAlias({ runContext, queryReport, candidateQueue }) {
  return buildSafeReport({
    stage: "STRATEGY_V2_QUERY_RESULTS",
    status: queryReport.status ?? "passed",
    run_id: runContext.run_id,
    source_run_id: runContext.source_run_id ?? null,
    checked_at: nowIso(),
    total_queries: candidateQueue.total_queries ?? 0,
    total_candidates_found: candidateQueue.total_candidates_found ?? 0,
    deduped_candidates: candidateQueue.deduped_candidates ?? 0,
    live_unavailable: queryReport.live_unavailable === true,
    query_results: (queryReport.query_results ?? []).map((item) => ({
      query: item.query,
      target_category: item.target_category,
      executed: item.executed,
      skipped: item.executed !== true,
      failure_reason: item.failure_reason ?? null,
      candidates_found: item.candidates_found ?? 0
    })),
    next_step: (candidateQueue.total_candidates_found ?? 0) > 0
      ? "review_strategy_v2_scores"
      : queryReport.live_unavailable === true
        ? "retry_strategy_v2_when_live_sources_return"
        : "no_build_today"
  });
}

function buildCandidateScoresAlias({ runContext, scoredReport }) {
  const ranked = scoredReport.ranked_opportunities ?? [];
  return buildSafeReport({
    stage: "STRATEGY_V2_CANDIDATE_SCORES",
    status: scoredReport.status ?? "passed",
    run_id: runContext.run_id,
    source_run_id: runContext.source_run_id ?? null,
    candidates_seen: ranked.length,
    build_ready_count: ranked.filter((item) => item.build_recommendation === "build").length,
    research_more_count: ranked.filter((item) => item.build_recommendation === "research_more").length,
    skip_count: ranked.filter((item) => item.build_recommendation === "skip").length,
    top_ranked_opportunities: ranked.slice(0, 10).map((item) => ({
      candidate_id: item.candidate_id,
      candidate_name: item.name,
      build_recommendation: item.build_recommendation,
      evidence_quality_score: item.evidence_quality_score,
      testability_score: item.testability_score,
      wedge_clarity_score: item.wedge_clarity_score,
      portfolio_overlap_score: item.portfolio_overlap_score,
      supported_builder: item.supported_builder,
      decision_rationale: item.decision_rationale
    })),
    next_step: scoredReport.next_step ?? "select_strategy_v2_candidate"
  });
}

function buildNextCandidateAlias({ runContext, selectedCandidate }) {
  return buildSafeReport({
    stage: "STRATEGY_V2_NEXT_CANDIDATE",
    status: selectedCandidate.status ?? "passed",
    run_id: runContext.run_id,
    source_run_id: runContext.source_run_id ?? null,
    selected: selectedCandidate.selected,
    candidate_id: selectedCandidate.candidate_id ?? null,
    candidate_name: selectedCandidate.candidate_name ?? null,
    selected_wedge: selectedCandidate.selected_wedge ?? null,
    build_recommendation: selectedCandidate.build_recommendation,
    reason: selectedCandidate.reason,
    confidence_score: selectedCandidate.confidence_score,
    evidence_quality_score: selectedCandidate.evidence_quality_score,
    testability_score: selectedCandidate.testability_score,
    portfolio_overlap_score: selectedCandidate.portfolio_overlap_score,
    blockers: selectedCandidate.blockers ?? [],
    next_step: selectedCandidate.next_step ?? "no_build_today"
  });
}

function deriveStrategySelectedWedge(selectedCandidate, fallbackSelectedCandidate) {
  if (
    fallbackSelectedCandidate?.selected_wedge
    && fallbackSelectedCandidate?.candidate_id === selectedCandidate?.candidate_id
  ) {
    return fallbackSelectedCandidate.selected_wedge;
  }
  if (selectedCandidate?.wedge_family === "gmail_snippet") {
    return "A lightweight compose-time snippet insertion flow.";
  }
  if (selectedCandidate?.wedge_family === "single_profile_form_fill") {
    return "A low-permission local-only helper for one repetitive browser form workflow.";
  }
  if (selectedCandidate?.wedge_family === "tab_csv_window_export") {
    return "One-click current-window tab export with a clearly bounded output.";
  }
  return `${selectedCandidate?.name ?? "Selected candidate"} with a narrower single-purpose wedge.`;
}

function buildStrictStrategySelectedCandidate({ strictScoredReport, fallbackSelectedCandidate, runContext }) {
  const selected = (strictScoredReport.ranked_opportunities ?? []).find((item) => item.build_recommendation === "build") ?? null;
  if (selected) {
    return {
      stage: "NEXT_BUILD_CANDIDATE_SELECTION",
      status: "passed",
      run_id: runContext.run_id,
      selected: true,
      candidate_id: selected.candidate_id,
      candidate_name: selected.name,
      selected_wedge: deriveStrategySelectedWedge(selected, fallbackSelectedCandidate),
      build_recommendation: "build",
      reason: "This candidate cleared the stricter Strategy V2 build-ready gate.",
      confidence_score: selected.confidence_score,
      evidence_quality_score: selected.evidence_quality_score,
      testability_score: selected.testability_score,
      portfolio_overlap_score: selected.portfolio_overlap_score,
      blockers: [],
      next_step: "human_review_candidate_or_auto_build_if_task_allows"
    };
  }

  const topRanked = strictScoredReport.ranked_opportunities?.[0] ?? null;
  return {
    stage: "NEXT_BUILD_CANDIDATE_SELECTION",
    status: "passed",
    run_id: runContext.run_id,
    selected: false,
    candidate_id: topRanked?.candidate_id ?? null,
    candidate_name: topRanked?.name ?? null,
    selected_wedge: null,
    build_recommendation: topRanked?.build_recommendation ?? "skip",
    reason: topRanked
      ? `Top ranked candidate is ${topRanked.build_recommendation} after the stricter Strategy V2 gate, so no build-ready candidate was selected.`
      : "No candidate survived Strategy V2 scoring.",
    confidence_score: topRanked?.confidence_score ?? 0,
    evidence_quality_score: topRanked?.evidence_quality_score ?? 0,
    testability_score: topRanked?.testability_score ?? 0,
    portfolio_overlap_score: topRanked?.portfolio_overlap_score ?? 0,
    blockers: topRanked?.strategy_v2_build_ready_criteria?.failed_reasons ?? ["no_build_ready_candidate"],
    next_step: "continue_strategy_v2"
  };
}

function renderNoBuildTodayMarkdown(report) {
  return [
    "# No Build Today Report",
    "",
    `- Date: ${report.date}`,
    `- Candidates seen: ${report.candidates_seen}`,
    `- Build ready: ${report.build_ready_count}`,
    `- Research more: ${report.research_more_count}`,
    `- Skipped: ${report.skipped_count}`,
    `- Backlog waiting: ${report.backlog_waiting_count}`,
    "",
    "## Top Failure Reasons",
    "",
    ...(report.top_failure_reasons ?? []).map((item) => `- ${item}`)
  ].join("\n");
}

async function readRound2BacklogWaiting(projectRoot, executionRunContext) {
  const originalRunId = executionRunContext.original_discovery_source_run_id ?? null;
  if (!originalRunId) {
    return 0;
  }
  const artifactPath = path.join(projectRoot, "runs", originalRunId, "49_targeted_research_round2.json");
  if (!(await fileExists(artifactPath))) {
    return 0;
  }
  const report = await readJson(artifactPath);
  return report.backlog_waiting_count ?? 0;
}

async function syncStrategyBacklog({
  projectRoot,
  runContext,
  candidateReport,
  scoredReport,
  nextCandidateAlias
}) {
  const candidatesById = new Map((candidateReport.candidates ?? []).map((item) => [item.candidate_id, item]));
  const topCandidates = scoredReport.ranked_opportunities?.slice(0, 10) ?? [];
  if (topCandidates.length === 0) {
    return;
  }

  await upsertOpportunityEntries(projectRoot, topCandidates.map((item) => {
    const candidate = candidatesById.get(item.candidate_id) ?? {};
    const strictGate = item.strategy_v2_build_ready_criteria ?? { failed_reasons: [] };
    const buildRecommendation = item.build_recommendation === "build"
      ? "build"
      : item.build_recommendation === "research_more"
        ? "research_more"
        : "skip";
    return {
      opportunity_id: item.candidate_id,
      discovered_at: nowIso(),
      source_run_id: runContext.run_id,
      candidate_id: item.candidate_id,
      candidate_name: item.name,
      source_url: candidate.store_url ?? null,
      category: candidate.category ?? null,
      users_estimate: candidate.users ?? null,
      rating: candidate.rating ?? null,
      review_count: candidate.reviews ?? null,
      latest_update: candidate.updated ?? null,
      pain_summary: strictGate.failed_reasons?.length > 0
        ? `Strategy V2 strict gate blockers: ${strictGate.failed_reasons.join(", ")}`
        : "Strategy V2 strict gate passed.",
      top_pain_clusters: (candidate.signals ?? []).slice(0, 3),
      evidence_quality_score: item.evidence_quality_score,
      testability_score: item.testability_score,
      wedge_clarity_score: item.wedge_clarity_score,
      portfolio_overlap_score: item.portfolio_overlap_score,
      compliance_risk: Math.max(0, 100 - Number(item.compliance_score ?? 0)),
      build_recommendation: buildRecommendation,
      decision_reason: (item.decision_rationale ?? []).join("; "),
      status: buildRecommendation === "build"
        ? "build_ready"
        : buildRecommendation === "research_more"
          ? "research_more"
          : item.portfolio_overlap_score >= 70
            ? "skipped_high_overlap"
            : "skipped",
      linked_run_ids: [runContext.run_id],
      linked_portfolio_items: (item.similar_existing_items ?? []).map((entry) => entry.item_id),
      next_step: item.candidate_id === nextCandidateAlias.candidate_id
        ? nextCandidateAlias.next_step
        : buildRecommendation === "build"
          ? "human_candidate_review_required"
          : buildRecommendation === "research_more"
            ? "continue_strategy_v2"
            : "no_build_today",
      selected_wedge: nextCandidateAlias.candidate_id === item.candidate_id ? nextCandidateAlias.selected_wedge : null,
      evidence_requirements: strictGate.failed_reasons ?? [],
      status_detail: strictGate.failed_reasons?.length > 0
        ? `strategy_v2_strict_gate:${strictGate.failed_reasons.join(",")}`
        : null,
      last_updated_at: nowIso()
    };
  }));
}

async function buildNoBuildTodayReport({
  projectRoot,
  runDir,
  runContext,
  strategyState,
  resultsAlias,
  scoresAlias,
  nextCandidateAlias
}) {
  const backlogWaitingCount = await readRound2BacklogWaiting(projectRoot, runContext);
  const lastFailureReason = nextCandidateAlias.build_recommendation === "skip"
    ? "The best strategy-v2 candidate still failed the stricter gate and was downgraded to skip."
    : "The best strategy-v2 candidate still resolved to research_more rather than build.";
  const report = buildSafeReport({
    stage: "NO_BUILD_TODAY_REPORT",
    status: "passed",
    date: nowIso().slice(0, 10),
    runs_considered: [
      strategyState.strategyReport.original_discovery_source_run_id,
      strategyState.strategyReport.source_run_id,
      strategyState.runContext.run_id,
      runContext.run_id
    ].filter(Boolean),
    candidates_seen: scoresAlias.candidates_seen ?? resultsAlias.deduped_candidates ?? 0,
    build_ready_count: scoresAlias.build_ready_count ?? 0,
    research_more_count: scoresAlias.research_more_count ?? 0,
    skipped_count: scoresAlias.skip_count ?? 0,
    backlog_waiting_count: backlogWaitingCount,
    top_failure_reasons: [
      "High overlap with existing form-fill and tab-export portfolio families remained common.",
      "Several promising candidates still mapped to future builder categories instead of current builders.",
      "Evidence quality was often strong enough to research but not enough to justify a build.",
      lastFailureReason
    ],
    what_to_change_next: strategyState.strategyReport.next_discovery_plan,
    recommended_human_action: "Review the strategy-v2 query families and decide whether to keep pushing low-overlap search spaces or approve future-builder roadmap exploration.",
    next_discovery_plan: nextCandidateAlias.selected
      ? ["Human review the selected candidate before any build."]
      : strategyState.strategyReport.next_discovery_plan,
    next_step: nextCandidateAlias.selected
      ? "human_strategy_review"
      : "continue_strategy_v2"
  });

  await validateArtifact(projectRoot, "no_build_today_report.schema.json", NO_BUILD_TODAY_REPORT_ARTIFACT, report);
  await writeManagedJsonArtifact({
    runDir,
    runContext,
    artifactName: NO_BUILD_TODAY_REPORT_ARTIFACT,
    data: report,
    occurredAt: nowIso()
  });
  await writeManagedMarkdownArtifact({
    runDir,
    runContext,
    fileName: "62_no_build_today_report.md",
    category: "strategy_v2_run",
    prefix: "62_no_build_today_report",
    content: renderNoBuildTodayMarkdown(report),
    occurredAt: nowIso()
  });

  return report;
}

export async function runStrategyV2Queries({
  projectRoot = process.cwd(),
  strategy,
  limit = 30,
  maxCandidates = 120
}) {
  const strategyState = await loadStrategyState(projectRoot, strategy);
  const queryConfigs = normalizeQueryConfigs(strategyState.strategyPlan, limit);
  const { runDir, runContext } = await createDiscoveryLiveQueueRun({
    projectRoot,
    queriesArtifactPath: strategyState.strategyArtifactPath,
    plan: strategyState.strategyPlan,
    sourceRunContext: strategyState.runContext,
    runSlug: "strategy-v2",
    queryLimit: queryConfigs.length,
    maxCandidates: Number(maxCandidates) || 120
  });

  const liveResult = await runDiscoveryLiveQueue({
    runDir,
    runContext,
    queryConfigs,
    sourceRunId: strategyState.runContext.run_id,
    maxCandidates: Number(maxCandidates) || 120
  });

  const resultsAlias = buildQueryResultsAlias({
    runContext,
    queryReport: liveResult.queryReport,
    candidateQueue: liveResult.candidateQueue
  });

  let scoresAlias = buildSafeReport({
    stage: "STRATEGY_V2_CANDIDATE_SCORES",
    status: "skipped",
    run_id: runContext.run_id,
    source_run_id: runContext.source_run_id ?? null,
    candidates_seen: 0,
    build_ready_count: 0,
    research_more_count: 0,
    skip_count: 0,
    top_ranked_opportunities: [],
    next_step: "no_build_today"
  });
  let nextCandidateAlias = buildSafeReport({
    stage: "STRATEGY_V2_NEXT_CANDIDATE",
    status: "skipped",
    run_id: runContext.run_id,
    source_run_id: runContext.source_run_id ?? null,
    selected: false,
    candidate_id: null,
    candidate_name: null,
    selected_wedge: null,
    build_recommendation: "skip",
    reason: liveResult.queryReport.live_unavailable === true
      ? "Strategy V2 live discovery was skipped because live research was unavailable."
      : "No strategy-v2 candidates survived query execution.",
    confidence_score: 0,
    evidence_quality_score: 0,
    testability_score: 0,
    portfolio_overlap_score: 0,
    blockers: liveResult.queryReport.live_unavailable === true ? ["live_unavailable"] : ["no_candidates_found"],
    next_step: "no_build_today"
  });

  if ((liveResult.candidateQueue.deduped_candidates ?? 0) > 0) {
    const scoreResult = await scoreDiscoveryQueue({
      queueArtifactPath: path.join(runDir, "41_live_candidate_queue.json")
    });
    const executionArtifacts = await loadExecutionArtifacts(runDir);
    const strictScoredReport = applyStrictStrategyV2Gate({
      scoredReport: scoreResult.scoredReport,
      runContext,
      candidateReport: executionArtifacts.candidateReport,
      evidenceReport: executionArtifacts.evidenceReport,
      clusterReport: executionArtifacts.clusterReport
    });
    scoresAlias = buildCandidateScoresAlias({
      runContext,
      scoredReport: strictScoredReport
    });
    nextCandidateAlias = buildNextCandidateAlias({
      runContext,
      selectedCandidate: buildSafeReport(buildStrictStrategySelectedCandidate({
        strictScoredReport,
        fallbackSelectedCandidate: scoreResult.selectedCandidate,
        runContext
      }))
    });
    await syncStrategyBacklog({
      projectRoot,
      runContext,
      candidateReport: executionArtifacts.candidateReport,
      scoredReport: strictScoredReport,
      nextCandidateAlias
    });
  }

  const occurredAt = nowIso();
  await validateArtifact(projectRoot, "strategy_v2_query_results.schema.json", STRATEGY_V2_QUERY_RESULTS_ARTIFACT, resultsAlias);
  await validateArtifact(projectRoot, "strategy_v2_candidate_scores.schema.json", STRATEGY_V2_CANDIDATE_SCORES_ARTIFACT, scoresAlias);
  await validateArtifact(projectRoot, "strategy_v2_next_candidate.schema.json", STRATEGY_V2_NEXT_CANDIDATE_ARTIFACT, nextCandidateAlias);

  await writeManagedJsonArtifact({
    runDir,
    runContext,
    artifactName: STRATEGY_V2_QUERY_RESULTS_ARTIFACT,
    data: resultsAlias,
    occurredAt
  });
  await writeManagedJsonArtifact({
    runDir,
    runContext,
    artifactName: STRATEGY_V2_CANDIDATE_SCORES_ARTIFACT,
    data: scoresAlias,
    occurredAt
  });
  await writeManagedJsonArtifact({
    runDir,
    runContext,
    artifactName: STRATEGY_V2_NEXT_CANDIDATE_ARTIFACT,
    data: nextCandidateAlias,
    occurredAt
  });

  let noBuildTodayReport = null;
  if ((scoresAlias.build_ready_count ?? 0) === 0) {
    noBuildTodayReport = await buildNoBuildTodayReport({
      projectRoot,
      runDir,
      runContext,
      strategyState,
      resultsAlias,
      scoresAlias,
      nextCandidateAlias
    });
  }

  return {
    runDir,
    runContext,
    resultsAlias,
    scoresAlias,
    nextCandidateAlias,
    noBuildTodayReport
  };
}
