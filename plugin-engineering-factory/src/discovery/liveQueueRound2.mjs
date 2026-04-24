import path from "node:path";
import {
  createDiscoveryLiveQueueRun,
  runDiscoveryLiveQueue,
  scoreDiscoveryQueue
} from "./liveQueue.mjs";
import {
  buildSafeReport,
  validateArtifact,
  writeManagedJsonArtifact
} from "../review/helpers.mjs";
import { fileExists, nowIso, readJson } from "../utils/io.mjs";

export const LIVE_QUEUE_ROUND2_RESULTS_ARTIFACT = "51_live_queue_round2_results.json";
export const LIVE_QUEUE_ROUND2_SCORES_ARTIFACT = "52_live_queue_round2_scores.json";
export const NEXT_CANDIDATE_ROUND2_ARTIFACT = "53_next_candidate_round2.json";

function inferRunIdFromArtifactPath(projectRoot, artifactPath) {
  const absolute = path.isAbsolute(artifactPath) ? artifactPath : path.resolve(projectRoot, artifactPath);
  const runsMarker = `${path.sep}runs${path.sep}`;
  if (!absolute.includes(runsMarker)) {
    return null;
  }
  return absolute.split(runsMarker)[1]?.split(path.sep)[0] ?? null;
}

async function resolveQueriesArtifact(projectRoot, queriesPath) {
  const directPath = path.isAbsolute(queriesPath)
    ? queriesPath
    : path.resolve(projectRoot, queriesPath);
  if (await fileExists(directPath)) {
    return directPath;
  }

  const sourceRunId = inferRunIdFromArtifactPath(projectRoot, directPath);
  if (!sourceRunId) {
    throw new Error(`Queries artifact not found: ${queriesPath}`);
  }

  const sidecarPath = path.join(projectRoot, "state", "run_events", sourceRunId, path.basename(directPath));
  if (await fileExists(sidecarPath)) {
    return sidecarPath;
  }

  throw new Error(`Queries artifact not found: ${queriesPath}`);
}

function normalizeQueries(plan, limit) {
  return (plan.queries ?? plan.next_10_search_queries ?? []).slice(0, Number(limit) || 20);
}

function aliasRound2Results({ runContext, queryReport, candidateQueue, lowOverlapReport }) {
  return buildSafeReport({
    stage: "LIVE_QUEUE_ROUND2_RESULTS",
    status: queryReport.status ?? "passed",
    run_id: runContext.run_id,
    source_run_id: runContext.source_run_id ?? null,
    checked_at: nowIso(),
    total_queries: candidateQueue.total_queries ?? 0,
    total_candidates_found: candidateQueue.total_candidates_found ?? 0,
    deduped_candidates: candidateQueue.deduped_candidates ?? 0,
    live_unavailable: queryReport.live_unavailable === true,
    filtered_high_overlap_count: lowOverlapReport?.rejected_candidates?.length ?? 0,
    query_results: queryReport.query_results ?? [],
    next_step: candidateQueue.total_candidates_found > 0
      ? "review_live_queue_round2_scores"
      : queryReport.live_unavailable === true
        ? "retry_live_queue_round2_when_network_is_available"
        : "no_build_today"
  });
}

function aliasRound2Scores({ runContext, scoredReport }) {
  const ranked = scoredReport.ranked_opportunities ?? [];
  return buildSafeReport({
    stage: "LIVE_QUEUE_ROUND2_SCORES",
    status: scoredReport.status ?? "passed",
    run_id: runContext.run_id,
    source_run_id: runContext.source_run_id ?? null,
    build_ready_count: ranked.filter((item) => item.build_recommendation === "build").length,
    research_more_count: ranked.filter((item) => item.build_recommendation === "research_more").length,
    skip_count: ranked.filter((item) => item.build_recommendation === "skip").length,
    top_ranked_opportunities: ranked.slice(0, 10),
    next_step: scoredReport.next_step ?? "select_next_round2_candidate"
  });
}

function aliasNextCandidate({ runContext, selectedCandidate }) {
  return buildSafeReport({
    stage: "NEXT_CANDIDATE_ROUND2",
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

function skippedRound2Scores(runContext) {
  return buildSafeReport({
    stage: "LIVE_QUEUE_ROUND2_SCORES",
    status: "skipped",
    run_id: runContext.run_id,
    source_run_id: runContext.source_run_id ?? null,
    build_ready_count: 0,
    research_more_count: 0,
    skip_count: 0,
    top_ranked_opportunities: [],
    next_step: "retry_live_queue_round2_when_network_is_available"
  });
}

function skippedNextCandidate(runContext) {
  return buildSafeReport({
    stage: "NEXT_CANDIDATE_ROUND2",
    status: "skipped",
    run_id: runContext.run_id,
    source_run_id: runContext.source_run_id ?? null,
    selected: false,
    candidate_id: null,
    candidate_name: null,
    selected_wedge: null,
    build_recommendation: "skip",
    reason: "Live queue round 2 was skipped because live research was unavailable.",
    confidence_score: 0,
    evidence_quality_score: 0,
    testability_score: 0,
    portfolio_overlap_score: 0,
    blockers: ["live_unavailable"],
    next_step: "retry_live_queue_round2_when_network_is_available"
  });
}

export async function runLiveQueueRound2({
  projectRoot = process.cwd(),
  queries,
  limit = 20,
  maxCandidates = 80
}) {
  const queriesArtifactPath = await resolveQueriesArtifact(projectRoot, queries);
  const plan = await readJson(queriesArtifactPath);
  const sourceRunId = plan.run_id ?? plan.source_run_id ?? inferRunIdFromArtifactPath(projectRoot, queriesArtifactPath);
  if (!sourceRunId) {
    throw new Error(`Could not infer source run id from ${queriesArtifactPath}.`);
  }

  const sourceRunContext = await readJson(path.join(projectRoot, "runs", sourceRunId, "00_run_context.json"));
  const queryConfigs = normalizeQueries(plan, limit);
  const { runDir, runContext } = await createDiscoveryLiveQueueRun({
    projectRoot,
    queriesArtifactPath,
    plan,
    sourceRunContext,
    runSlug: "live-queue-round2",
    queryLimit: queryConfigs.length,
    maxCandidates: Number(maxCandidates) || 80
  });

  const liveResult = await runDiscoveryLiveQueue({
    runDir,
    runContext,
    queryConfigs,
    sourceRunId,
    maxCandidates: Number(maxCandidates) || 80
  });

  let lowOverlapReport = null;
  let scoredReport = skippedRound2Scores(runContext);
  let selectedCandidate = skippedNextCandidate(runContext);

  if (!(liveResult.queryReport.live_unavailable === true && (liveResult.candidateQueue.total_candidates_found ?? 0) === 0)) {
    const scoreResult = await scoreDiscoveryQueue({
      queueArtifactPath: path.join(runDir, "41_live_candidate_queue.json")
    });
    lowOverlapReport = scoreResult.lowOverlapReport;
    scoredReport = aliasRound2Scores({
      runContext,
      scoredReport: scoreResult.scoredReport
    });
    selectedCandidate = aliasNextCandidate({
      runContext,
      selectedCandidate: scoreResult.selectedCandidate
    });
  }

  const resultsAlias = aliasRound2Results({
    runContext,
    queryReport: liveResult.queryReport,
    candidateQueue: liveResult.candidateQueue,
    lowOverlapReport
  });

  await validateArtifact(projectRoot, "live_queue_round2_results.schema.json", LIVE_QUEUE_ROUND2_RESULTS_ARTIFACT, resultsAlias);
  await validateArtifact(projectRoot, "live_queue_round2_scores.schema.json", LIVE_QUEUE_ROUND2_SCORES_ARTIFACT, scoredReport);
  await validateArtifact(projectRoot, "next_candidate_round2.schema.json", NEXT_CANDIDATE_ROUND2_ARTIFACT, selectedCandidate);

  const occurredAt = nowIso();
  const resultsWrite = await writeManagedJsonArtifact({
    runDir,
    runContext,
    artifactName: LIVE_QUEUE_ROUND2_RESULTS_ARTIFACT,
    data: resultsAlias,
    occurredAt
  });
  const scoresWrite = await writeManagedJsonArtifact({
    runDir,
    runContext,
    artifactName: LIVE_QUEUE_ROUND2_SCORES_ARTIFACT,
    data: scoredReport,
    occurredAt
  });
  const nextWrite = await writeManagedJsonArtifact({
    runDir,
    runContext,
    artifactName: NEXT_CANDIDATE_ROUND2_ARTIFACT,
    data: selectedCandidate,
    occurredAt
  });

  return {
    runDir,
    runContext,
    queryReport: liveResult.queryReport,
    candidateQueue: liveResult.candidateQueue,
    resultsAlias,
    scoresAlias: scoredReport,
    nextCandidateAlias: selectedCandidate,
    artifacts: {
      results: resultsWrite.artifactRelativePath,
      scores: scoresWrite.artifactRelativePath,
      next: nextWrite.artifactRelativePath
    }
  };
}
