import path from "node:path";
import { supportedFamilies } from "../builders/index.mjs";
import { runDiscoveryLiveQueue, scoreDiscoveryQueue } from "./liveQueue.mjs";
import { upsertOpportunityEntries } from "./opportunityBacklog.mjs";
import { loadPortfolioRegistry, PORTFOLIO_REGISTRY_PATH, summarizePortfolioRegistry } from "../portfolio/registry.mjs";
import {
  buildSafeReport,
  validateArtifact,
  writeManagedJsonArtifact,
  writeManagedMarkdownArtifact
} from "../review/helpers.mjs";
import { buildUniqueRunId } from "../workflow/runId.mjs";
import { assertMatchesSchema } from "../utils/schema.mjs";
import {
  ensureDir,
  fileExists,
  nowIso,
  readJson,
  writeJson
} from "../utils/io.mjs";

export const SEED_DISCOVERY_RESULTS_ARTIFACT = "69_seed_discovery_results.json";
export const SEED_CANDIDATE_QUEUE_ARTIFACT = "70_seed_candidate_queue.json";
export const SEED_OPPORTUNITY_SCORES_ARTIFACT = "71_seed_opportunity_scores.json";
export const SEED_NEXT_CANDIDATE_ARTIFACT = "72_seed_next_candidate.json";
export const SEED_PERFORMANCE_REPORT_ARTIFACT = "74_seed_performance_report.json";
export const SEED_HUMAN_REVIEW_QUEUE_ARTIFACT = "75_seed_human_candidate_review_queue.json";

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function average(values) {
  const numeric = (values ?? []).map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (numeric.length === 0) {
    return 0;
  }
  return round(numeric.reduce((sum, value) => sum + value, 0) / numeric.length);
}

function normalizeRuntime(browserSmoke = {}) {
  const requested = browserSmoke?.runtime ?? "dedicated_chromium";
  return ["auto", "dedicated_chromium", "ixbrowser"].includes(requested)
    ? requested
    : "dedicated_chromium";
}

function relativePath(projectRoot, absolutePath) {
  return path.relative(projectRoot, absolutePath).replaceAll("\\", "/");
}

async function loadSeedTask(projectRoot, taskPath) {
  const absoluteTaskPath = path.isAbsolute(taskPath) ? taskPath : path.resolve(projectRoot, taskPath);
  const task = await readJson(absoluteTaskPath);
  await assertMatchesSchema({
    data: task,
    schemaPath: path.join(projectRoot, "schemas", "task.schema.json"),
    label: absoluteTaskPath
  });
  return {
    task,
    taskPath: absoluteTaskPath
  };
}

async function loadSeedQueryPlan(projectRoot, task, taskPath) {
  const configuredPath = task.discovery?.seed_query_plan_artifact
    ? path.resolve(projectRoot, task.discovery.seed_query_plan_artifact)
    : path.join(path.dirname(taskPath), "68_seed_query_plan.json");
  if (!(await fileExists(configuredPath))) {
    throw new Error(`Seed query plan not found: ${configuredPath}`);
  }
  return {
    seedQueryPlanPath: configuredPath,
    seedQueryPlan: await readJson(configuredPath)
  };
}

async function createSeedDiscoveryRun({ projectRoot, taskPath, task }) {
  const portfolioRegistry = await loadPortfolioRegistry(projectRoot);
  const portfolioSummary = summarizePortfolioRegistry(portfolioRegistry);
  const runId = buildUniqueRunId({
    task,
    taskPath
  });
  const runDir = path.join(projectRoot, "runs", runId);
  await ensureDir(runDir);
  const runContext = {
    stage: "SEED_DISCOVERY",
    status: "passed",
    generated_at: nowIso(),
    project_root: projectRoot,
    task_path: taskPath,
    task_mode: task.mode ?? "daily",
    run_type: task.mode ?? "daily",
    run_id: runId,
    run_id_strategy: "timestamp_slug_unique",
    allow_build_after_research_resolution: task.allow_build_after_research_resolution === true,
    allow_overwrite: false,
    overwrite_blocked: false,
    created_at: nowIso(),
    requested_task_run_id: task.run_id ?? null,
    source_run_id: task.source_strategy_review_run_id ?? null,
    source_strategy_decision_file: task.source_strategy_decision_file ?? null,
    date: task.date,
    allowed_categories: task.allowed_categories,
    blocked_categories: task.blocked_categories,
    thresholds: task.thresholds,
    publish: task.publish,
    browser_smoke: {
      runtime: normalizeRuntime(task.browser_smoke)
    },
    builder: task.builder,
    research: task.research ?? {
      mode: "live",
      fallback_to_fixture: false,
      max_github_issues: 5,
      timeout_ms: 15000
    },
    discovery: task.discovery ?? {
      mode: "live_queue",
      max_candidates: 80,
      query_limit: 30,
      allow_auto_build: false,
      min_evidence_quality_score: 80,
      max_portfolio_overlap_score: 45,
      min_testability_score: 75
    },
    supported_builder_families: supportedFamilies(),
    assets: task.assets,
    brand_rules: task.brand_rules,
    monitoring: task.monitoring ?? {
      enabled: false,
      required: false
    },
    portfolio_registry: {
      path: PORTFOLIO_REGISTRY_PATH,
      active_wedge_families: portfolioSummary.active_wedge_families,
      blocked_candidate_ids: portfolioSummary.blocked_candidate_ids,
      archetype_priors: portfolioSummary.archetype_priors,
      item_count: portfolioSummary.item_count
    }
  };
  await writeJson(path.join(runDir, "00_run_context.json"), runContext);
  await writeJson(path.join(runDir, "run_status.json"), {
    stage: "SEED_DISCOVERY",
    status: "passed",
    generated_at: nowIso(),
    run_id: runId,
    run_id_strategy: runContext.run_id_strategy,
    allow_overwrite: false,
    overwrite_blocked: false,
    created_at: runContext.created_at,
    failure_reason: null
  });
  return {
    runDir,
    runContext
  };
}

function queryLookup(seedQueryPlan) {
  return new Map((seedQueryPlan.queries ?? []).map((item) => [item.query, item]));
}

function seedDefinitionLookup(seedQueryPlan) {
  const map = new Map();
  for (const query of seedQueryPlan.queries ?? []) {
    if (!map.has(query.seed_id)) {
      map.set(query.seed_id, {
        seed_id: query.seed_id,
        target_user: query.target_user,
        expected_pain: query.expected_pain,
        expected_wedge: query.expected_wedge,
        preferred_archetype: query.preferred_archetype,
        builder_fit_assumption: query.builder_fit_assumption
      });
    }
  }
  return map;
}

function seedPriority(seedQueryPlan, task) {
  return task.discovery?.seed_priority ?? seedQueryPlan.seed_ids ?? task.discovery?.manual_seed_ids ?? [];
}

function candidateQueries(candidate) {
  return unique([
    candidate.source_query,
    ...(candidate.source_queries ?? [])
  ]);
}

function candidateSeedIds(candidate, queryConfigLookup) {
  return unique(candidateQueries(candidate).map((query) => queryConfigLookup.get(query)?.seed_id).filter(Boolean));
}

function primarySeedId(seedIds, priority) {
  for (const preferred of priority ?? []) {
    if ((seedIds ?? []).includes(preferred)) {
      return preferred;
    }
  }
  return (seedIds ?? [])[0] ?? null;
}

function evidenceSourceTypesForCandidate(candidateId, evidenceReport) {
  return unique((evidenceReport.evidence_by_candidate?.[candidateId] ?? []).map((item) => item.source_type));
}

function proposedWedge({ seedId, seedDefinitions, nextCandidate, candidateId, candidateName }) {
  if (nextCandidate?.candidate_id === candidateId && nextCandidate?.proposed_wedge) {
    return nextCandidate.proposed_wedge;
  }
  const seed = seedDefinitions.get(seedId);
  if (seed?.expected_wedge) {
    return seed.expected_wedge;
  }
  return `${candidateName ?? "Candidate"} narrowed into a single-purpose workflow.`;
}

function complianceRiskFromScore(scoreItem) {
  const riskScore = Math.max(0, 100 - Number(scoreItem?.compliance_score ?? 0));
  if (riskScore >= 60) return "high";
  if (riskScore >= 30) return "medium";
  return "low";
}

function complianceRiskSummary(items) {
  const counts = { low: 0, medium: 0, high: 0 };
  for (const item of items ?? []) {
    counts[complianceRiskFromScore(item)] += 1;
  }
  return counts;
}

function recommendationCounts(ranked = []) {
  return {
    build: ranked.filter((item) => item.build_recommendation === "build").length,
    research_more: ranked.filter((item) => item.build_recommendation === "research_more").length,
    skip: ranked.filter((item) => item.build_recommendation === "skip").length
  };
}

function buildSeedDiscoveredCandidateMap(candidateQueue, queryConfigLookup, priority) {
  const map = new Map();
  for (const candidate of candidateQueue.discovered_candidates ?? []) {
    const seedIds = candidateSeedIds(candidate, queryConfigLookup);
    map.set(candidate.candidate_id, {
      ...candidate,
      seed_ids: seedIds,
      primary_seed_id: primarySeedId(seedIds, priority)
    });
  }
  return map;
}

function attachSeedMetadataToScores(scoredReport, discoveredCandidateMap, seedDefinitions, nextCandidate) {
  const ranked = (scoredReport.ranked_opportunities ?? []).map((item) => {
    const discovered = discoveredCandidateMap.get(item.candidate_id) ?? {};
    return {
      ...item,
      seed_ids: discovered.seed_ids ?? [],
      primary_seed_id: discovered.primary_seed_id ?? null,
      proposed_wedge: proposedWedge({
        seedId: discovered.primary_seed_id ?? null,
        seedDefinitions,
        nextCandidate,
        candidateId: item.candidate_id,
        candidateName: item.name
      })
    };
  });
  return {
    ...scoredReport,
    ranked_opportunities: ranked,
    top_ranked_opportunities: ranked.slice(0, 10)
  };
}

function buildSeedDiscoveryResults({
  runContext,
  seedQueryPlan,
  queryReport,
  candidateQueue,
  scoredReport
}) {
  const counts = recommendationCounts(scoredReport.ranked_opportunities ?? []);
  const perSeed = (seedQueryPlan.seed_ids ?? []).map((seedId) => {
    const queries = (queryReport.query_results ?? []).filter((item) => seedQueryPlan.queries?.some((query) => query.seed_id === seedId && query.query === item.query));
    const deduped = unique((candidateQueue.discovered_candidates ?? [])
      .filter((candidate) => (candidate.seed_ids ?? []).includes(seedId))
      .map((candidate) => candidate.candidate_id));
    return {
      seed_id: seedId,
      queries_run: queries.length,
      candidates_found: queries.reduce((sum, item) => sum + Number(item.candidates_found ?? 0), 0),
      candidates_after_dedup: deduped.length
    };
  });
  return buildSafeReport({
    stage: "SEED_DISCOVERY_RESULTS",
    status: queryReport.live_unavailable === true ? "skipped" : "passed",
    run_id: runContext.run_id,
    source_run_id: runContext.source_run_id ?? null,
    checked_at: nowIso(),
    total_queries: seedQueryPlan.query_count ?? 0,
    seeds_reviewed: seedQueryPlan.seed_ids ?? [],
    live_unavailable: queryReport.live_unavailable === true,
    seed_results: perSeed,
    total_candidates_found: candidateQueue.total_candidates_found ?? 0,
    deduped_candidates: candidateQueue.deduped_candidates ?? 0,
    build_ready_count: counts.build,
    research_more_count: counts.research_more,
    skip_count: counts.skip,
    next_step: (scoredReport.build_ready_count ?? 0) > 0
      ? "human_candidate_review"
      : queryReport.live_unavailable === true
        ? "retry_seed_discovery_when_live_sources_return"
        : "continue_seed_discovery_or_no_build_today"
  });
}

function buildSeedCandidateQueueArtifact({
  runContext,
  candidateQueue,
  candidateReport,
  seedQueryPlan,
  discoveredCandidateMap
}) {
  return buildSafeReport({
    stage: "SEED_CANDIDATE_QUEUE",
    status: candidateQueue.live_unavailable === true ? "skipped" : "passed",
    run_id: runContext.run_id,
    total_queries: seedQueryPlan.query_count ?? 0,
    total_candidates_found: candidateQueue.total_candidates_found ?? 0,
    deduped_candidates: candidateQueue.deduped_candidates ?? 0,
    queue_quality_score: candidateQueue.queue_quality_score ?? 0,
    candidate_queue: (candidateReport.candidates ?? []).map((candidate) => {
      const discovered = discoveredCandidateMap.get(candidate.candidate_id) ?? {};
      return {
        candidate_id: candidate.candidate_id,
        candidate_name: candidate.name,
        seed_ids: discovered.seed_ids ?? [],
        primary_seed_id: discovered.primary_seed_id ?? null,
        wedge_family: candidate.wedge_family,
        users: candidate.users ?? null,
        rating: candidate.rating ?? null,
        reviews: candidate.reviews ?? null,
        support_site: candidate.has_support_site ?? false
      };
    }),
    rejected_candidates: candidateQueue.rejected_candidates ?? [],
    next_step: (candidateReport.candidate_count ?? 0) > 0
      ? "score_seed_candidates"
      : candidateQueue.live_unavailable === true
        ? "retry_seed_discovery_when_live_sources_return"
        : "refine_seed_queries"
  });
}

function buildSeedOpportunityScoresArtifact({
  runContext,
  scoredReport
}) {
  const counts = recommendationCounts(scoredReport.ranked_opportunities ?? []);
  return buildSafeReport({
    stage: "SEED_OPPORTUNITY_SCORES",
    status: scoredReport.status ?? "passed",
    run_id: runContext.run_id,
    total_ranked_candidates: (scoredReport.ranked_opportunities ?? []).length,
    build_ready_count: counts.build,
    research_more_count: counts.research_more,
    skip_count: counts.skip,
    ranked_opportunities: (scoredReport.ranked_opportunities ?? []).map((item) => ({
      candidate_id: item.candidate_id,
      candidate_name: item.name,
      seed_ids: item.seed_ids ?? [],
      primary_seed_id: item.primary_seed_id ?? null,
      proposed_wedge: item.proposed_wedge,
      build_recommendation: item.build_recommendation,
      demand_score: item.demand_score,
      pain_score: item.pain_score,
      evidence_quality_score: item.evidence_quality_score,
      wedge_clarity_score: item.wedge_clarity_score,
      testability_score: item.testability_score,
      compliance_score: item.compliance_score,
      portfolio_overlap_score: item.portfolio_overlap_score,
      confidence_score: item.confidence_score,
      total_score: item.total_score,
      supported_builder: item.supported_builder
    })),
    next_step: (scoredReport.build_ready_count ?? 0) > 0
      ? "review_seed_build_ready_candidates"
      : "review_seed_research_more_candidates"
  });
}

function buildSeedNextCandidateArtifact({
  runContext,
  selectedCandidate,
  scoredReport
}) {
  const scored = (scoredReport.ranked_opportunities ?? []).find((item) => item.candidate_id === selectedCandidate.candidate_id) ?? null;
  return buildSafeReport({
    stage: "SEED_NEXT_CANDIDATE",
    status: selectedCandidate.status ?? "passed",
    run_id: runContext.run_id,
    selected: selectedCandidate.selected === true,
    candidate_id: selectedCandidate.candidate_id ?? null,
    candidate_name: selectedCandidate.candidate_name ?? null,
    seed_id: scored?.primary_seed_id ?? null,
    proposed_wedge: scored?.proposed_wedge ?? null,
    build_recommendation: selectedCandidate.build_recommendation ?? scored?.build_recommendation ?? "skip",
    confidence_score: selectedCandidate.confidence_score ?? scored?.confidence_score ?? 0,
    evidence_quality_score: selectedCandidate.evidence_quality_score ?? scored?.evidence_quality_score ?? 0,
    testability_score: selectedCandidate.testability_score ?? scored?.testability_score ?? 0,
    portfolio_overlap_score: selectedCandidate.portfolio_overlap_score ?? scored?.portfolio_overlap_score ?? 0,
    blockers: selectedCandidate.blockers ?? [],
    next_step: selectedCandidate.next_step ?? "no_build_today"
  });
}

function buildSeedPerformanceReport({
  runContext,
  seedQueryPlan,
  queryReport,
  scoredReport,
  seedDefinitions
}) {
  const seeds = (seedQueryPlan.seed_ids ?? []).map((seedId) => {
    const queries = (queryReport.query_results ?? []).filter((item) => seedQueryPlan.queries?.some((query) => query.seed_id === seedId && query.query === item.query));
    const candidates = (scoredReport.ranked_opportunities ?? []).filter((item) => item.primary_seed_id === seedId);
    const bestCandidate = candidates[0] ?? null;
    const avgEvidence = average(candidates.map((item) => item.evidence_quality_score));
    const avgWedge = average(candidates.map((item) => item.wedge_clarity_score));
    const avgTestability = average(candidates.map((item) => item.testability_score));
    const avgOverlap = average(candidates.map((item) => item.portfolio_overlap_score));
    let recommendation = "pause_seed";
    if (candidates.some((item) => item.build_recommendation === "build")) {
      recommendation = "continue_seed";
    } else if (candidates.length > 0 && (avgOverlap > 45 || candidates.some((item) => Number(item.portfolio_overlap_score ?? 0) > 60))) {
      recommendation = "refine_seed";
    } else if (candidates.length > 0 && (avgEvidence >= 70 || avgTestability >= 75)) {
      recommendation = "continue_seed";
    }
    const futureBuilderSignal = seedId === "seed-developer-payload"
      && candidates.filter((item) => Number(item.evidence_quality_score ?? 0) >= 80 && Number(item.testability_score ?? 0) >= 75).length >= 2;
    return {
      seed_id: seedId,
      queries_run: queries.length,
      candidates_found: queries.reduce((sum, item) => sum + Number(item.candidates_found ?? 0), 0),
      candidates_after_dedup: candidates.length,
      avg_evidence_quality: avgEvidence,
      avg_wedge_clarity: avgWedge,
      avg_testability: avgTestability,
      avg_portfolio_overlap: avgOverlap,
      compliance_risk_summary: complianceRiskSummary(candidates),
      build_ready_count: candidates.filter((item) => item.build_recommendation === "build").length,
      research_more_count: candidates.filter((item) => item.build_recommendation === "research_more").length,
      skip_count: candidates.filter((item) => item.build_recommendation === "skip").length,
      best_candidate: bestCandidate ? {
        candidate_id: bestCandidate.candidate_id,
        candidate_name: bestCandidate.name,
        proposed_wedge: bestCandidate.proposed_wedge,
        build_recommendation: bestCandidate.build_recommendation,
        total_score: bestCandidate.total_score
      } : null,
      future_builder_signal: futureBuilderSignal,
      monitor_only: seedDefinitions.get(seedId)?.builder_fit_assumption?.includes("monitor_only") ?? false,
      recommendation
    };
  });
  return buildSafeReport({
    stage: "SEED_PERFORMANCE_REPORT",
    status: "passed",
    run_id: runContext.run_id,
    seeds
  });
}

function buildSeedHumanReviewQueue({
  runContext,
  scoredReport,
  evidenceReport,
  seedDefinitions
}) {
  const buildReady = (scoredReport.ranked_opportunities ?? []).filter((item) => item.build_recommendation === "build");
  const researchMore = (scoredReport.ranked_opportunities ?? []).filter((item) => item.build_recommendation === "research_more");
  const entries = [...buildReady, ...researchMore]
    .slice(0, 5)
    .map((item) => {
      const seed = seedDefinitions.get(item.primary_seed_id);
      const sourceTypes = evidenceSourceTypesForCandidate(item.candidate_id, evidenceReport);
      const builderFit = seed?.builder_fit_assumption
        ?? (item.supported_builder === true ? "current_builder_available" : "no_current_builder_fit");
      const forcedMonitorOnly = item.primary_seed_id === "seed-developer-payload"
        || `${builderFit}`.includes("monitor_only");
      return {
        candidate_id: item.candidate_id,
        candidate_name: item.name,
        seed_id: item.primary_seed_id ?? null,
        proposed_wedge: item.proposed_wedge,
        why_build: `Evidence ${round(item.evidence_quality_score)}, wedge clarity ${round(item.wedge_clarity_score)}, testability ${round(item.testability_score)}.`,
        why_not_build: forcedMonitorOnly
          ? `This seed is currently monitor-only. ${builderFit}.`
          : item.supported_builder === true
            ? `Overlap ${round(item.portfolio_overlap_score)} and compliance ${round(item.compliance_score)} still need human review.`
            : `Builder fit is not available yet. ${builderFit}.`,
        evidence_summary: `${sourceTypes.length} source types, evidence_quality_score=${round(item.evidence_quality_score)}.`,
        overlap_risk: `portfolio_overlap_score=${round(item.portfolio_overlap_score)}`,
        testability_summary: `testability_score=${round(item.testability_score)}`,
        compliance_summary: `compliance_risk=${complianceRiskFromScore(item)}`,
        builder_fit: builderFit,
        recommended_decision: item.build_recommendation === "build" && item.supported_builder === true && forcedMonitorOnly !== true
          ? "approve_build"
          : "research_more"
      };
    });
  return buildSafeReport({
    stage: "SEED_HUMAN_CANDIDATE_REVIEW_QUEUE",
    status: "passed",
    run_id: runContext.run_id,
    no_build_today: buildReady.length === 0,
    queue_count: entries.length,
    entries
  });
}

function renderSeedOpsMarkdown(report, performanceReport) {
  return [
    "# Seed Discovery Ops Report",
    "",
    `- Run id: ${report.run_id}`,
    `- Seeds reviewed: ${(report.seeds_reviewed ?? []).join(", ")}`,
    `- Total candidates found: ${report.total_candidates_found}`,
    `- Deduped candidates: ${report.deduped_candidates}`,
    `- Build ready: ${report.build_ready_count}`,
    `- Research more: ${report.research_more_count}`,
    `- Skip: ${report.skip_count}`,
    "",
    "## Seed Performance",
    "",
    ...(performanceReport.seeds ?? []).map((seed) => `- ${seed.seed_id}: candidates=${seed.candidates_after_dedup}, best=${seed.best_candidate?.candidate_name ?? "none"}, recommendation=${seed.recommendation}`)
  ].join("\n");
}

function renderSeedPerformanceMarkdown(report) {
  return [
    "# Seed Performance Report",
    "",
    ...(report.seeds ?? []).flatMap((seed) => [
      `## ${seed.seed_id}`,
      "",
      `- Queries run: ${seed.queries_run}`,
      `- Candidates after dedup: ${seed.candidates_after_dedup}`,
      `- Avg evidence quality: ${seed.avg_evidence_quality}`,
      `- Avg wedge clarity: ${seed.avg_wedge_clarity}`,
      `- Avg testability: ${seed.avg_testability}`,
      `- Avg overlap: ${seed.avg_portfolio_overlap}`,
      `- Recommendation: ${seed.recommendation}`,
      ""
    ])
  ].join("\n");
}

function renderSeedHumanQueueMarkdown(queue) {
  return [
    "# Seed Human Candidate Review Queue",
    "",
    `- no_build_today: ${queue.no_build_today === true}`,
    `- queue_count: ${queue.queue_count ?? 0}`,
    "",
    ...(queue.entries ?? []).map((entry) => `- ${entry.candidate_name} (${entry.seed_id}): ${entry.recommended_decision}`)
  ].join("\n");
}

async function applyDeveloperPayloadMonitorOnlyBacklog({
  projectRoot,
  runContext,
  scoredReport
}) {
  const entries = (scoredReport.ranked_opportunities ?? [])
    .filter((item) => item.primary_seed_id === "seed-developer-payload")
    .map((item) => ({
      opportunity_id: item.candidate_id,
      source_run_id: runContext.run_id,
      candidate_id: item.candidate_id,
      candidate_name: item.name,
      evidence_quality_score: item.evidence_quality_score,
      testability_score: item.testability_score,
      wedge_clarity_score: item.wedge_clarity_score,
      portfolio_overlap_score: item.portfolio_overlap_score,
      compliance_risk: Math.max(0, 100 - Number(item.compliance_score ?? 0)),
      build_recommendation: "backlog_waiting",
      decision_reason: `seed_developer_payload_monitor_only; supported_builder=false; ${item.decision_rationale?.join("; ") ?? "future builder fit required"}`,
      status: "backlog_waiting_for_builder",
      linked_run_ids: [runContext.run_id],
      linked_portfolio_items: [],
      next_step: "monitor_future_builder_signal_only",
      selected_wedge: item.proposed_wedge,
      status_detail: "monitor_only_seed_without_current_builder",
      last_updated_at: nowIso()
    }));
  if (entries.length > 0) {
    await upsertOpportunityEntries(projectRoot, entries);
  }
}

export async function runSeedTask({ projectRoot = process.cwd(), taskPath }) {
  const loaded = await loadSeedTask(projectRoot, taskPath);
  const { seedQueryPlanPath, seedQueryPlan } = await loadSeedQueryPlan(projectRoot, loaded.task, loaded.taskPath);
  const { runDir, runContext } = await createSeedDiscoveryRun({
    projectRoot,
    taskPath: loaded.taskPath,
    task: loaded.task
  });
  const queryConfigs = (seedQueryPlan.queries ?? []).slice(0, Number(loaded.task.discovery?.query_limit ?? seedQueryPlan.query_count ?? 30));
  const sourceRunId = loaded.task.source_strategy_review_run_id ?? path.basename(path.dirname(seedQueryPlanPath));

  const liveResult = await runDiscoveryLiveQueue({
    runDir,
    runContext,
    queryConfigs,
    sourceRunId,
    maxCandidates: Number(loaded.task.discovery?.max_candidates ?? 80)
  });
  const scoreResult = await scoreDiscoveryQueue({
    queueArtifactPath: path.join(runDir, "41_live_candidate_queue.json")
  });

  const queryReport = liveResult.queryReport;
  const candidateQueue = liveResult.candidateQueue;
  const candidateReport = await readJson(path.join(runDir, "10_candidate_report.json"));
  const evidenceReport = await readJson(path.join(runDir, "20_feedback_evidence.json"));
  const buildGate = await readJson(path.join(runDir, "32_build_gate_decision.json"));
  const queryConfigLookup = queryLookup(seedQueryPlan);
  const seedDefinitions = seedDefinitionLookup(seedQueryPlan);
  const priority = seedPriority(seedQueryPlan, loaded.task);
  const discoveredCandidateMap = buildSeedDiscoveredCandidateMap(candidateQueue, queryConfigLookup, priority);
  const seedAwareScores = attachSeedMetadataToScores(
    scoreResult.scoredReport,
    discoveredCandidateMap,
    seedDefinitions,
    null
  );
  const seedResults = buildSeedDiscoveryResults({
    runContext,
    seedQueryPlan,
    queryReport,
    candidateQueue: {
      ...candidateQueue,
      discovered_candidates: [...discoveredCandidateMap.values()]
    },
    scoredReport: seedAwareScores
  });
  const seedCandidateQueue = buildSeedCandidateQueueArtifact({
    runContext,
    candidateQueue: {
      ...candidateQueue,
      discovered_candidates: [...discoveredCandidateMap.values()]
    },
    candidateReport,
    seedQueryPlan,
    discoveredCandidateMap
  });
  const seedNextCandidate = buildSeedNextCandidateArtifact({
    runContext,
    selectedCandidate: scoreResult.selectedCandidate,
    scoredReport: seedAwareScores
  });
  const seedAwareScoresWithNext = {
    ...seedAwareScores,
    ranked_opportunities: (seedAwareScores.ranked_opportunities ?? []).map((item) => ({
      ...item,
      proposed_wedge: item.candidate_id === seedNextCandidate.candidate_id && seedNextCandidate.proposed_wedge
        ? seedNextCandidate.proposed_wedge
        : item.proposed_wedge
    })),
    top_ranked_opportunities: (seedAwareScores.ranked_opportunities ?? []).slice(0, 10)
  };
  const seedOpportunityScores = buildSeedOpportunityScoresArtifact({
    runContext,
    scoredReport: seedAwareScoresWithNext
  });
  const seedPerformanceReport = buildSeedPerformanceReport({
    runContext,
    seedQueryPlan,
    queryReport,
    scoredReport: seedAwareScoresWithNext,
    seedDefinitions
  });
  const seedHumanQueue = buildSeedHumanReviewQueue({
    runContext,
    scoredReport: seedAwareScoresWithNext,
    evidenceReport,
    seedDefinitions
  });

  await applyDeveloperPayloadMonitorOnlyBacklog({
    projectRoot,
    runContext,
    scoredReport: seedAwareScoresWithNext
  });

  const occurredAt = nowIso();
  await validateArtifact(projectRoot, "seed_discovery_results.schema.json", SEED_DISCOVERY_RESULTS_ARTIFACT, seedResults);
  await validateArtifact(projectRoot, "seed_candidate_queue.schema.json", SEED_CANDIDATE_QUEUE_ARTIFACT, seedCandidateQueue);
  await validateArtifact(projectRoot, "seed_opportunity_scores.schema.json", SEED_OPPORTUNITY_SCORES_ARTIFACT, seedOpportunityScores);
  await validateArtifact(projectRoot, "seed_next_candidate.schema.json", SEED_NEXT_CANDIDATE_ARTIFACT, seedNextCandidate);
  await validateArtifact(projectRoot, "seed_performance_report.schema.json", SEED_PERFORMANCE_REPORT_ARTIFACT, seedPerformanceReport);
  await validateArtifact(projectRoot, "seed_human_candidate_review_queue.schema.json", SEED_HUMAN_REVIEW_QUEUE_ARTIFACT, seedHumanQueue);

  await writeManagedJsonArtifact({
    runDir,
    runContext,
    artifactName: SEED_DISCOVERY_RESULTS_ARTIFACT,
    data: seedResults,
    occurredAt
  });
  await writeManagedJsonArtifact({
    runDir,
    runContext,
    artifactName: SEED_CANDIDATE_QUEUE_ARTIFACT,
    data: seedCandidateQueue,
    occurredAt
  });
  await writeManagedJsonArtifact({
    runDir,
    runContext,
    artifactName: SEED_OPPORTUNITY_SCORES_ARTIFACT,
    data: seedOpportunityScores,
    occurredAt
  });
  await writeManagedJsonArtifact({
    runDir,
    runContext,
    artifactName: SEED_NEXT_CANDIDATE_ARTIFACT,
    data: seedNextCandidate,
    occurredAt
  });
  await writeManagedJsonArtifact({
    runDir,
    runContext,
    artifactName: SEED_PERFORMANCE_REPORT_ARTIFACT,
    data: seedPerformanceReport,
    occurredAt
  });
  await writeManagedJsonArtifact({
    runDir,
    runContext,
    artifactName: SEED_HUMAN_REVIEW_QUEUE_ARTIFACT,
    data: seedHumanQueue,
    occurredAt
  });
  await writeManagedMarkdownArtifact({
    runDir,
    runContext,
    fileName: "73_seed_discovery_ops_report.md",
    category: "seed_discovery",
    prefix: "73_seed_discovery_ops_report",
    content: renderSeedOpsMarkdown(seedResults, seedPerformanceReport),
    occurredAt
  });
  await writeManagedMarkdownArtifact({
    runDir,
    runContext,
    fileName: "74_seed_performance_report.md",
    category: "seed_discovery",
    prefix: "74_seed_performance_report",
    content: renderSeedPerformanceMarkdown(seedPerformanceReport),
    occurredAt
  });
  await writeManagedMarkdownArtifact({
    runDir,
    runContext,
    fileName: "75_seed_human_candidate_review_queue.md",
    category: "seed_discovery",
    prefix: "75_seed_human_candidate_review_queue",
    content: renderSeedHumanQueueMarkdown(seedHumanQueue),
    occurredAt
  });

  await writeJson(path.join(runDir, "run_status.json"), {
    stage: "SEED_DISCOVERY",
    status: "passed",
    generated_at: nowIso(),
    run_id: runContext.run_id,
    run_id_strategy: runContext.run_id_strategy,
    allow_overwrite: false,
    overwrite_blocked: false,
    created_at: runContext.created_at,
    failure_reason: null
  });

  return {
    runDir,
    runContext,
    queryReport,
    candidateQueue: seedCandidateQueue,
    opportunityScores: seedOpportunityScores,
    nextCandidate: seedNextCandidate,
    seedPerformanceReport,
    seedHumanQueue,
    buildGate
  };
}
