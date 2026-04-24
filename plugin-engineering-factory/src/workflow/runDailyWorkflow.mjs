import path from "node:path";
import { nextTenDiscoveryQueries } from "../discovery/engine.mjs";
import { runDiscoveryLiveQueue, scoreDiscoveryQueue } from "../discovery/liveQueue.mjs";
import { runTargetedResearchBatch } from "../discovery/targetedResearchBatch.mjs";
import { runTargetedResearchRound2 } from "../discovery/targetedResearchRound2.mjs";
import { generateQueryExpansionPlan } from "../discovery/queryExpansion.mjs";
import { generateDiscoveryStrategyReview } from "../discovery/strategyReview.mjs";
import { runLiveQueueRound2 } from "../discovery/liveQueueRound2.mjs";
import { generateDiscoveryStrategyV2 } from "../discovery/strategyV2.mjs";
import { runStrategyV2Queries } from "../discovery/strategyV2Runner.mjs";
import { readJson } from "../utils/io.mjs";
import { resolveResearchMore } from "../discovery/researchResolution.mjs";
import { generateDiscoveryQualityReview } from "../review/discoveryQuality.mjs";
import {
  buildExtensionStage,
  buildGate,
  browserSmokeAndCaptureStage,
  clusterPainPoints,
  closeRunStage,
  decidePublishIntentStage,
  discoverCandidates,
  executePublishPlanStage,
  enrichFeedback,
  generateAssetsStage,
  humanApprovalGateStage,
  ingestTask,
  monitorPostReleaseStage,
  planImplementationStage,
  prepareListingPackageStage,
  reviewStatusStage,
  runPolicyGateStage,
  runQaStage,
  scoreOpportunities,
  writeBriefStage,
  writeFailure
} from "./stages.mjs";

export async function runDailyWorkflow({ projectRoot, taskPath, runsRoot, runIdentity }) {
  const absoluteTaskPath = path.resolve(taskPath);
  const absoluteRunsRoot = path.resolve(runsRoot);

  let runDir = path.join(absoluteRunsRoot, "unknown-run");
  let stage = "INGEST_TASK";

  try {
    const ingest = await ingestTask({
      projectRoot,
      taskPath: absoluteTaskPath,
      runsRoot: absoluteRunsRoot,
      runIdentity
    });
    runDir = ingest.runDir;
    const { runContext } = ingest;

    const discoveryMode = `${runContext.discovery?.mode ?? "fixture"}`.trim().toLowerCase();
    const usesLiveQueue = discoveryMode === "live_queue" || discoveryMode === "hybrid";

    let candidateReport;
    let evidenceReport;
    let clusterReport;
    let selectedReport;
    let gate;
    let targetedResearchBatch = null;
    let targetedResearchRound2 = null;
    let queryExpansion = null;
    let liveQueueRound2 = null;
    let strategyV2 = null;
    let strategyV2Execution = null;
    let strategyReview = null;

    if (usesLiveQueue) {
      stage = "DISCOVER_CANDIDATES";
      await runDiscoveryLiveQueue({
        runDir,
        runContext,
        queryConfigs: nextTenDiscoveryQueries().slice(0, runContext.discovery?.query_limit ?? 10),
        sourceRunId: runContext.run_id,
        maxCandidates: runContext.discovery?.max_candidates ?? 50
      });
      candidateReport = await readJson(path.join(runDir, "10_candidate_report.json"));
      evidenceReport = await readJson(path.join(runDir, "20_feedback_evidence.json"));
      clusterReport = await readJson(path.join(runDir, "21_feedback_clusters.json"));

      stage = "SCORE_OPPORTUNITIES";
      await scoreDiscoveryQueue({
        queueArtifactPath: path.join(runDir, "41_live_candidate_queue.json")
      });
      selectedReport = await readJson(path.join(runDir, "31_selected_candidate.json"));
      gate = await readJson(path.join(runDir, "32_build_gate_decision.json"));
    } else {
      stage = "DISCOVER_CANDIDATES";
      candidateReport = await discoverCandidates({ projectRoot, runDir, runContext });

      stage = "ENRICH_FEEDBACK";
      evidenceReport = await enrichFeedback({ projectRoot, runDir, candidateReport });

      stage = "CLUSTER_PAIN_POINTS";
      clusterReport = await clusterPainPoints({ runDir, candidateReport, evidenceReport });

      stage = "SCORE_OPPORTUNITIES";
      ({ selectedReport } = await scoreOpportunities({ runDir, runContext, candidateReport, clusterReport }));

      stage = "BUILD_GATE";
      gate = await buildGate({ runDir, runContext, selectedReport, clusterReport });
    }

    stage = "DISCOVERY_QUALITY_REVIEW";
    const discoveryReview = await generateDiscoveryQualityReview({ runDir });

    let effectiveGate = gate;
    let researchResolution = null;
    const buildReadyAfterResearch = runContext.allow_build_after_research_resolution === true;
    if (discoveryReview.review.build_recommendation === "research_more") {
      stage = "RESEARCH_MORE_RESOLUTION";
      researchResolution = await resolveResearchMore({ runDir });
      if (researchResolution.gate.final_recommendation === "build" && buildReadyAfterResearch) {
        effectiveGate = {
          ...gate,
          status: "passed",
          decision: "go",
          go_no_go: "go",
          blockers: [],
          warnings: researchResolution.gate.warnings ?? [],
          required_followup_research: researchResolution.gate.required_followup_research ?? [],
          decision_rationale: [
            ...(gate.decision_rationale ?? []),
            `research_resolution=${researchResolution.gate.final_recommendation}`
          ]
        };
      }
    }

    const autoBuildDisallowedByDiscovery = usesLiveQueue && runContext.discovery?.allow_auto_build !== true;
    if (usesLiveQueue && selectedReport.build_recommendation === "research_more") {
      stage = "TARGETED_RESEARCH_BATCH";
      targetedResearchBatch = await runTargetedResearchBatch({
        runDir,
        projectRoot: runContext.project_root,
        top: Math.min(10, runContext.discovery?.max_candidates ?? 10)
      });

      if ((targetedResearchBatch.batchReport?.build_ready_count ?? 0) === 0) {
        stage = "TARGETED_RESEARCH_ROUND_2";
        targetedResearchRound2 = await runTargetedResearchRound2({
          run: runDir,
          projectRoot: runContext.project_root,
          top: 5
        });

        if ((targetedResearchRound2.round2Report?.build_ready_count ?? 0) === 0) {
          stage = "QUERY_EXPANSION";
          queryExpansion = await generateQueryExpansionPlan({
            projectRoot: runContext.project_root,
            fromRun: runDir
          });

          if (runContext.discovery?.auto_run_live_queue_round2 === true) {
            stage = "LIVE_QUEUE_ROUND2";
            liveQueueRound2 = await runLiveQueueRound2({
              projectRoot: runContext.project_root,
              queries: path.join(runDir, "50_query_expansion_plan.json"),
              limit: 20,
              maxCandidates: 80
            });
          }

          if (liveQueueRound2?.runDir && runContext.discovery?.auto_generate_strategy_v2 !== false) {
            stage = "DISCOVERY_STRATEGY_V2";
            strategyV2 = await generateDiscoveryStrategyV2({
              projectRoot: runContext.project_root,
              fromRun: liveQueueRound2.runDir
            });

            if (runContext.discovery?.run_strategy_v2 === true) {
              stage = "RUN_STRATEGY_V2";
              strategyV2Execution = await runStrategyV2Queries({
                projectRoot: runContext.project_root,
                strategy: path.join(strategyV2.runDir, "57_low_overlap_search_map.json"),
                limit: runContext.discovery?.strategy_v2_query_limit ?? 30,
                maxCandidates: runContext.discovery?.strategy_v2_max_candidates ?? 120
              });

              if (
                strategyV2Execution?.noBuildTodayReport
                && runContext.discovery?.auto_generate_strategy_review !== false
              ) {
                stage = "DISCOVERY_STRATEGY_REVIEW";
                strategyReview = await generateDiscoveryStrategyReview({
                  projectRoot: runContext.project_root,
                  fromRun: strategyV2Execution.runDir
                });
              }
            }
          }
        }
      }
    }

    if (selectedReport.status === "no_go" || effectiveGate.go_no_go !== "go" || autoBuildDisallowedByDiscovery) {
      stage = "CLOSE_RUN";
      await closeRunStage({
        runDir,
        runContext,
        selectedReport
      });
      return {
        runDir,
        publishPlan: {
          publish_intent: "archive_no_publish",
          reason: autoBuildDisallowedByDiscovery
            ? (strategyV2Execution?.nextCandidateAlias?.selected
              ? "Strategy V2 found a build-ready candidate, but human candidate review is required before any build."
              : strategyReview
                ? "Strategy V2 still ended with no_build_today, so the factory generated a discovery strategy review and next-step decision package."
              : strategyV2Execution?.noBuildTodayReport
                ? "Strategy V2 widened the discovery search space and still ended with no_build_today."
                : strategyV2
                  ? "Query expansion escalated into Strategy V2 artifacts for the next discovery shift."
                  : targetedResearchRound2?.round2Report?.build_ready_count > 0
              ? "Round 2 targeted research found build-ready candidates, but human candidate review is required before any build."
              : queryExpansion
                ? "Round 2 still found no build-ready candidate, so the factory generated a low-overlap query expansion plan and stopped with no_build_today."
                : targetedResearchBatch?.batchReport?.build_ready_count > 0
                  ? "Targeted research found build-ready candidates, but human candidate review is required before any build."
                  : targetedResearchBatch?.batchReport?.research_more_count > 0
                    ? "Targeted research produced unresolved candidates, so the run stopped at the final research loop."
                    : "Discovery produced a queue candidate, but task.discovery.allow_auto_build=false so the run stopped at candidate review.")
            : (researchResolution?.resolution?.next_step ?? "Discovery gates did not approve a build.")
        },
        buildGate: effectiveGate,
        selectedReport
      };
    }

    stage = "WRITE_BRIEF";
    const brief = await writeBriefStage({ runDir, selectedReport });

    stage = "PLAN_IMPLEMENTATION";
    const plan = await planImplementationStage({ runDir, brief });

    stage = "BUILD_EXTENSION";
    const buildReport = await buildExtensionStage({ runDir, brief, plan });

    stage = "RUN_QA";
    const qaReport = await runQaStage({ runDir, brief, plan, buildReport });

    stage = "BROWSER_SMOKE_AND_CAPTURE";
    const { browserSmokeReport, screenshotManifest } = await browserSmokeAndCaptureStage({ runDir, runContext, brief, plan, buildReport, qaReport });

    stage = "GENERATE_ASSETS";
    const listingCopy = await generateAssetsStage({ runDir, runContext, brief, buildReport, qaReport, screenshotManifest });

    stage = "RUN_POLICY_GATE";
    const policyGate = await runPolicyGateStage({
      runDir,
      runContext,
      brief,
      plan,
      buildReport,
      qaReport,
      listingCopy,
      browserSmokeReport,
      screenshotManifest
    });

    stage = "DECIDE_PUBLISH_INTENT";
    const publishPlan = await decidePublishIntentStage({ runDir, runContext, selectedReport, qaReport, policyGate, buildGateReport: effectiveGate });

    stage = "PREPARE_LISTING_PACKAGE";
    const listingPackageReport = await prepareListingPackageStage({
      runDir,
      selectedReport,
      brief,
      plan,
      buildReport,
      qaReport,
      browserSmokeReport,
      screenshotManifest,
      listingCopy,
      policyGate,
      publishPlan
    });

    stage = "HUMAN_APPROVAL_GATE";
    await humanApprovalGateStage({
      runDir,
      runContext,
      buildReport,
      publishPlan
    });

    stage = "EXECUTE_PUBLISH_PLAN";
    const publishExecutionReport = await executePublishPlanStage({
      runDir,
      runContext,
      selectedReport,
      buildReport,
      publishPlan,
      listingPackageReport
    });

    stage = "REVIEW_STATUS";
    const reviewStatus = await reviewStatusStage({ runDir });

    stage = "MONITOR_POST_RELEASE";
    const monitoring = await monitorPostReleaseStage({
      runDir,
      runContext,
      publishExecution: publishExecutionReport,
      reviewStatus
    });
    if (runContext.monitoring?.required && monitoring.snapshot.status === "failed") {
      throw new Error(`MONITOR_POST_RELEASE failed: ${monitoring.snapshot.failure_reason}`);
    }

    stage = "CLOSE_RUN";
    await closeRunStage({
      runDir,
      runContext,
      selectedReport,
      brief,
      plan,
      screenshotManifest,
      publishPlan,
      publishExecution: publishExecutionReport,
      reviewStatus,
      monitoringSnapshot: monitoring.snapshot,
      learningUpdate: monitoring.learning,
      policyGate
    });

    return { runDir, publishPlan, publishExecutionReport };
  } catch (error) {
    await writeFailure(runDir, stage, error);
    throw error;
  }
}
