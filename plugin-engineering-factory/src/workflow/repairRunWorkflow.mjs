import fs from "node:fs/promises";
import path from "node:path";
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
import { ensureDir, fileExists, nowIso, readJson } from "../utils/io.mjs";
import { appendRunEventLog, loadManagedRunArtifact } from "./runEventArtifacts.mjs";

const REPAIRABLE_STAGES = [
  "DISCOVER_CANDIDATES",
  "ENRICH_FEEDBACK",
  "CLUSTER_PAIN_POINTS",
  "SCORE_OPPORTUNITIES",
  "BUILD_GATE",
  "DISCOVERY_QUALITY_REVIEW",
  "RESEARCH_MORE_RESOLUTION",
  "WRITE_BRIEF",
  "PLAN_IMPLEMENTATION",
  "BUILD_EXTENSION",
  "RUN_QA",
  "BROWSER_SMOKE_AND_CAPTURE",
  "GENERATE_ASSETS",
  "RUN_POLICY_GATE",
  "DECIDE_PUBLISH_INTENT",
  "PREPARE_LISTING_PACKAGE",
  "EXECUTE_PUBLISH_PLAN",
  "REVIEW_STATUS",
  "MONITOR_POST_RELEASE",
  "CLOSE_RUN"
];

const LISTING_PACKAGE_ARTIFACTS = [
  "81_listing_package",
  "81_listing_package.zip",
  "81_listing_package_report.json"
];

const PUBLISH_EXECUTION_ARTIFACTS = [
  "90_publish_execution.json"
];

const REVIEW_STATUS_ARTIFACTS = [
  "91_review_status.json"
];

const MONITORING_ARTIFACTS = [
  "95_monitoring_snapshot.json",
  "96_learning_update.json"
];

const CLOSE_RUN_ARTIFACTS = [
  "99_close_run.json"
];

const BROWSER_SMOKE_ARTIFACTS = [
  "61_browser_smoke.json",
  "61_browser_smoke_downloads",
  "70_screenshot_manifest.json"
];

const DISCOVERY_REVIEW_ARTIFACTS = [
  "33_discovery_quality_review.json",
  "33_discovery_quality_review.md",
  "34_demand_discovery_improvement_plan.json",
  "34_demand_discovery_improvement_plan.md"
];

const RESEARCH_RESOLUTION_ARTIFACTS = [
  "36_research_more_resolution.json",
  "36_research_more_resolution.md",
  "37_refined_pain_clusters.json",
  "38_updated_opportunity_score.json",
  "39_research_resolution_gate.json",
  "40_next_query_results.json"
];

const GENERATED_LISTING_ASSET_FILES = [
  "70_listing_assets/asset_manifest.json",
  "70_listing_assets/icon16.png",
  "70_listing_assets/icon48.png",
  "70_listing_assets/icon128.png",
  "70_listing_assets/promo_440x280.png",
  "70_listing_assets/promo_1400x560.png"
];

const STAGE_CLEANUP = {
  DISCOVER_CANDIDATES: [
    "09_live_research_report.json",
    "10_candidate_report.json",
    "20_feedback_evidence.json",
    "21_feedback_clusters.json",
    "30_opportunity_scores.json",
    "31_selected_candidate.json",
    "32_build_gate_decision.json",
    "41_product_brief.json",
    "41_product_brief.md",
    "42_implementation_plan.json",
    "50_build_report.json",
    "60_qa_report.json",
    "70_listing_assets",
    "71_listing_copy.json",
    "72_policy_gate.json",
    "80_publish_plan.json",
    "workspace",
    "run_status.json"
  ],
  ENRICH_FEEDBACK: [
    "20_feedback_evidence.json",
    "21_feedback_clusters.json",
    "30_opportunity_scores.json",
    "31_selected_candidate.json",
    "32_build_gate_decision.json",
    "41_product_brief.json",
    "41_product_brief.md",
    "42_implementation_plan.json",
    "50_build_report.json",
    "60_qa_report.json",
    "70_listing_assets",
    "71_listing_copy.json",
    "72_policy_gate.json",
    "80_publish_plan.json",
    "workspace",
    "run_status.json"
  ],
  CLUSTER_PAIN_POINTS: [
    "21_feedback_clusters.json",
    "30_opportunity_scores.json",
    "31_selected_candidate.json",
    "32_build_gate_decision.json",
    "41_product_brief.json",
    "41_product_brief.md",
    "42_implementation_plan.json",
    "50_build_report.json",
    "60_qa_report.json",
    "70_listing_assets",
    "71_listing_copy.json",
    "72_policy_gate.json",
    "80_publish_plan.json",
    "workspace",
    "run_status.json"
  ],
  SCORE_OPPORTUNITIES: [
    "30_opportunity_scores.json",
    "31_selected_candidate.json",
    "32_build_gate_decision.json",
    "41_product_brief.json",
    "41_product_brief.md",
    "42_implementation_plan.json",
    "50_build_report.json",
    "60_qa_report.json",
    "70_listing_assets",
    "71_listing_copy.json",
    "72_policy_gate.json",
    "80_publish_plan.json",
    "workspace",
    "run_status.json"
  ],
  BUILD_GATE: [
    "32_build_gate_decision.json",
    "33_discovery_quality_review.json",
    "33_discovery_quality_review.md",
    "34_demand_discovery_improvement_plan.json",
    "34_demand_discovery_improvement_plan.md",
    "36_research_more_resolution.json",
    "36_research_more_resolution.md",
    "37_refined_pain_clusters.json",
    "38_updated_opportunity_score.json",
    "39_research_resolution_gate.json",
    "40_next_query_results.json",
    "41_product_brief.json",
    "41_product_brief.md",
    "42_implementation_plan.json",
    "50_build_report.json",
    "60_qa_report.json",
    "70_listing_assets",
    "71_listing_copy.json",
    "72_policy_gate.json",
    "80_publish_plan.json",
    "workspace",
    "run_status.json"
  ],
  DISCOVERY_QUALITY_REVIEW: [
    "33_discovery_quality_review.json",
    "33_discovery_quality_review.md",
    "34_demand_discovery_improvement_plan.json",
    "34_demand_discovery_improvement_plan.md",
    "36_research_more_resolution.json",
    "36_research_more_resolution.md",
    "37_refined_pain_clusters.json",
    "38_updated_opportunity_score.json",
    "39_research_resolution_gate.json",
    "40_next_query_results.json",
    "41_product_brief.json",
    "41_product_brief.md",
    "42_implementation_plan.json",
    "50_build_report.json",
    "60_qa_report.json",
    "70_listing_assets",
    "71_listing_copy.json",
    "72_policy_gate.json",
    "80_publish_plan.json",
    "workspace",
    "run_status.json"
  ],
  RESEARCH_MORE_RESOLUTION: [
    "36_research_more_resolution.json",
    "36_research_more_resolution.md",
    "37_refined_pain_clusters.json",
    "38_updated_opportunity_score.json",
    "39_research_resolution_gate.json",
    "40_next_query_results.json",
    "41_product_brief.json",
    "41_product_brief.md",
    "42_implementation_plan.json",
    "50_build_report.json",
    "60_qa_report.json",
    "70_listing_assets",
    "71_listing_copy.json",
    "72_policy_gate.json",
    "80_publish_plan.json",
    "workspace",
    "run_status.json"
  ],
  WRITE_BRIEF: [
    "41_product_brief.json",
    "41_product_brief.md",
    "42_implementation_plan.json",
    "50_build_report.json",
    "60_qa_report.json",
    "70_listing_assets",
    "71_listing_copy.json",
    "72_policy_gate.json",
    "80_publish_plan.json",
    "workspace",
    "run_status.json"
  ],
  PLAN_IMPLEMENTATION: [
    "42_implementation_plan.json",
    "50_build_report.json",
    "60_qa_report.json",
    "70_listing_assets",
    "71_listing_copy.json",
    "72_policy_gate.json",
    "80_publish_plan.json",
    "workspace",
    "run_status.json"
  ],
  BUILD_EXTENSION: [
    "50_build_report.json",
    "60_qa_report.json",
    "70_listing_assets",
    "71_listing_copy.json",
    "72_policy_gate.json",
    "80_publish_plan.json",
    "workspace",
    "run_status.json"
  ],
  RUN_QA: [
    "60_qa_report.json",
    "70_listing_assets",
    "71_listing_copy.json",
    "72_policy_gate.json",
    "80_publish_plan.json",
    "run_status.json"
  ],
  GENERATE_ASSETS: [
    ...GENERATED_LISTING_ASSET_FILES,
    "71_listing_copy.json",
    "72_policy_gate.json",
    "80_publish_plan.json",
    "run_status.json"
  ],
  RUN_POLICY_GATE: [
    "72_policy_gate.json",
    "80_publish_plan.json",
    "run_status.json"
  ],
  DECIDE_PUBLISH_INTENT: [
    "80_publish_plan.json",
    "run_status.json"
  ],
  EXECUTE_PUBLISH_PLAN: [
    "90_publish_execution.json",
    "run_status.json"
  ],
  REVIEW_STATUS: [
    ...REVIEW_STATUS_ARTIFACTS,
    ...MONITORING_ARTIFACTS,
    ...CLOSE_RUN_ARTIFACTS,
    "run_status.json"
  ],
  MONITOR_POST_RELEASE: [
    ...MONITORING_ARTIFACTS,
    ...CLOSE_RUN_ARTIFACTS,
    "run_status.json"
  ],
  CLOSE_RUN: [
    ...CLOSE_RUN_ARTIFACTS,
    "run_status.json"
  ]
};

STAGE_CLEANUP.BROWSER_SMOKE_AND_CAPTURE = [
  ...BROWSER_SMOKE_ARTIFACTS,
  "70_listing_assets",
  "71_listing_copy.json",
  "72_policy_gate.json",
  "80_publish_plan.json",
  "run_status.json"
];

for (const stageName of [
  "DISCOVER_CANDIDATES",
  "ENRICH_FEEDBACK",
  "CLUSTER_PAIN_POINTS",
  "SCORE_OPPORTUNITIES",
  "BUILD_GATE",
  "WRITE_BRIEF",
  "PLAN_IMPLEMENTATION",
  "BUILD_EXTENSION",
  "RUN_QA"
]) {
  STAGE_CLEANUP[stageName].push(...BROWSER_SMOKE_ARTIFACTS);
}

for (const stageName of [
  "DISCOVER_CANDIDATES",
  "ENRICH_FEEDBACK",
  "CLUSTER_PAIN_POINTS",
  "SCORE_OPPORTUNITIES",
  "BUILD_GATE",
  "DISCOVERY_QUALITY_REVIEW",
  "RESEARCH_MORE_RESOLUTION"
]) {
  STAGE_CLEANUP[stageName].push(...DISCOVERY_REVIEW_ARTIFACTS);
  STAGE_CLEANUP[stageName].push(...RESEARCH_RESOLUTION_ARTIFACTS);
}

for (const cleanupList of Object.values(STAGE_CLEANUP)) {
  cleanupList.push(...LISTING_PACKAGE_ARTIFACTS);
  cleanupList.push(...PUBLISH_EXECUTION_ARTIFACTS);
  cleanupList.push(...REVIEW_STATUS_ARTIFACTS);
  cleanupList.push(...MONITORING_ARTIFACTS);
  cleanupList.push(...CLOSE_RUN_ARTIFACTS);
}

STAGE_CLEANUP.PREPARE_LISTING_PACKAGE = [
  ...LISTING_PACKAGE_ARTIFACTS,
  ...PUBLISH_EXECUTION_ARTIFACTS,
  "run_status.json"
];

STAGE_CLEANUP.EXECUTE_PUBLISH_PLAN = [
  ...PUBLISH_EXECUTION_ARTIFACTS,
  ...REVIEW_STATUS_ARTIFACTS,
  ...MONITORING_ARTIFACTS,
  ...CLOSE_RUN_ARTIFACTS,
  "run_status.json"
];
STAGE_CLEANUP.REVIEW_STATUS = [
  ...REVIEW_STATUS_ARTIFACTS,
  ...MONITORING_ARTIFACTS,
  ...CLOSE_RUN_ARTIFACTS,
  "run_status.json"
];
STAGE_CLEANUP.MONITOR_POST_RELEASE = [
  ...MONITORING_ARTIFACTS,
  ...CLOSE_RUN_ARTIFACTS,
  "run_status.json"
];
STAGE_CLEANUP.CLOSE_RUN = [
  ...CLOSE_RUN_ARTIFACTS,
  "run_status.json"
];
const PRE_REPAIR_INPUTS = {
  DISCOVER_CANDIDATES: [],
  ENRICH_FEEDBACK: [
    "10_candidate_report.json"
  ],
  CLUSTER_PAIN_POINTS: [
    "10_candidate_report.json",
    "20_feedback_evidence.json"
  ],
  SCORE_OPPORTUNITIES: [
    "10_candidate_report.json",
    "20_feedback_evidence.json",
    "21_feedback_clusters.json"
  ],
  BUILD_GATE: [
    "10_candidate_report.json",
    "20_feedback_evidence.json",
    "21_feedback_clusters.json",
    "31_selected_candidate.json"
  ],
  DISCOVERY_QUALITY_REVIEW: [
    "10_candidate_report.json",
    "20_feedback_evidence.json",
    "21_feedback_clusters.json",
    "31_selected_candidate.json",
    "32_build_gate_decision.json"
  ],
  RESEARCH_MORE_RESOLUTION: [
    "10_candidate_report.json",
    "12_candidate_shortlist_quality.json",
    "20_feedback_evidence.json",
    "21_feedback_clusters.json",
    "30_opportunity_scores.json",
    "31_selected_candidate.json",
    "32_build_gate_decision.json"
  ],
  WRITE_BRIEF: [
    "10_candidate_report.json",
    "20_feedback_evidence.json",
    "21_feedback_clusters.json",
    "31_selected_candidate.json",
    "32_build_gate_decision.json"
  ],
  PLAN_IMPLEMENTATION: [
    "10_candidate_report.json",
    "20_feedback_evidence.json",
    "21_feedback_clusters.json",
    "31_selected_candidate.json",
    "32_build_gate_decision.json",
    "41_product_brief.json"
  ],
  BUILD_EXTENSION: [
    "10_candidate_report.json",
    "20_feedback_evidence.json",
    "21_feedback_clusters.json",
    "31_selected_candidate.json",
    "32_build_gate_decision.json",
    "41_product_brief.json",
    "42_implementation_plan.json"
  ],
  RUN_QA: [
    "10_candidate_report.json",
    "20_feedback_evidence.json",
    "21_feedback_clusters.json",
    "31_selected_candidate.json",
    "32_build_gate_decision.json",
    "41_product_brief.json",
    "42_implementation_plan.json",
    "50_build_report.json"
  ],
  BROWSER_SMOKE_AND_CAPTURE: [
    "10_candidate_report.json",
    "20_feedback_evidence.json",
    "21_feedback_clusters.json",
    "31_selected_candidate.json",
    "32_build_gate_decision.json",
    "41_product_brief.json",
    "42_implementation_plan.json",
    "50_build_report.json",
    "60_qa_report.json"
  ],
  GENERATE_ASSETS: [
    "10_candidate_report.json",
    "20_feedback_evidence.json",
    "21_feedback_clusters.json",
    "31_selected_candidate.json",
    "32_build_gate_decision.json",
    "41_product_brief.json",
    "42_implementation_plan.json",
    "50_build_report.json",
    "60_qa_report.json",
    "70_screenshot_manifest.json"
  ],
  RUN_POLICY_GATE: [
    "10_candidate_report.json",
    "20_feedback_evidence.json",
    "21_feedback_clusters.json",
    "31_selected_candidate.json",
    "32_build_gate_decision.json",
    "41_product_brief.json",
    "42_implementation_plan.json",
    "50_build_report.json",
    "60_qa_report.json",
    "61_browser_smoke.json",
    "70_screenshot_manifest.json",
    "71_listing_copy.json"
  ],
  PREPARE_LISTING_PACKAGE: [
    "31_selected_candidate.json",
    "32_build_gate_decision.json",
    "61_browser_smoke.json",
    "70_screenshot_manifest.json",
    "80_publish_plan.json"
  ],
  EXECUTE_PUBLISH_PLAN: [
    "31_selected_candidate.json",
    "80_publish_plan.json",
    "81_listing_package_report.json"
  ],
  REVIEW_STATUS: [
    "31_selected_candidate.json",
    "80_publish_plan.json",
    "90_publish_execution.json"
  ],
  MONITOR_POST_RELEASE: [
    "31_selected_candidate.json",
    "80_publish_plan.json",
    "90_publish_execution.json",
    "91_review_status.json"
  ],
  CLOSE_RUN: [
    "31_selected_candidate.json",
    "80_publish_plan.json",
    "90_publish_execution.json",
    "91_review_status.json",
    "95_monitoring_snapshot.json",
    "96_learning_update.json"
  ]
};

function artifactPath(runDir, fileName) {
  return path.join(runDir, fileName);
}

function normalizeRepairStage(value) {
  const normalized = `${value ?? ""}`.trim().toUpperCase();
  if (!REPAIRABLE_STAGES.includes(normalized)) {
    throw new Error(`Unsupported repair stage: ${value}. Expected one of: ${REPAIRABLE_STAGES.join(", ")}`);
  }
  return normalized;
}

function stageIndex(stage) {
  return REPAIRABLE_STAGES.indexOf(stage);
}

function shouldRunStage(fromStage, targetStage) {
  return stageIndex(fromStage) <= stageIndex(targetStage);
}

function isSandboxValidationRun(runContext) {
  return runContext?.run_type === "sandbox_validation" || runContext?.task_mode === "sandbox_validation";
}

async function loadRequiredJson(runDir, fileName, label) {
  const filePath = artifactPath(runDir, fileName);
  if (!(await fileExists(filePath))) {
    throw new Error(`Cannot repair from current state. Missing ${label}: ${fileName}`);
  }
  return readJson(filePath);
}

async function loadOptionalJson(runDir, fileName) {
  const filePath = artifactPath(runDir, fileName);
  if (!(await fileExists(filePath))) {
    return null;
  }
  return readJson(filePath);
}

async function loadOptionalManagedJson(runDir, fileName, runContext = null) {
  const loaded = await loadManagedRunArtifact({
    runDir,
    artifactName: fileName,
    runContext
  });
  return loaded?.data ?? null;
}

async function requireArtifact(runDir, relativePath, label) {
  if (!(await fileExists(artifactPath(runDir, relativePath)))) {
    throw new Error(`Cannot repair from current state. Missing ${label}: ${relativePath}`);
  }
}

async function cleanupForRepair(runDir, fromStage) {
  const targets = STAGE_CLEANUP[fromStage] ?? [];
  for (const relativePath of targets) {
    await fs.rm(artifactPath(runDir, relativePath), { recursive: true, force: true });
  }
  return targets;
}

async function appendRepairLog(runDir, entry, runContext = null) {
  if (isSandboxValidationRun(runContext)) {
    await appendRunEventLog({
      projectRoot: runContext.project_root,
      runId: runContext.run_id,
      category: "repair_logs",
      prefix: "01_repair_log",
      data: {
        stage: "REPAIR_RUN",
        generated_at: nowIso(),
        attempt: entry
      },
      occurredAt: entry.completed_at ?? entry.started_at ?? nowIso()
    });
    return;
  }
  const logPath = artifactPath(runDir, "01_repair_log.json");
  await ensureDir(runDir);
  const current = (await fileExists(logPath))
    ? await readJson(logPath)
    : {
        stage: "REPAIR_RUN",
        status: "passed",
        generated_at: nowIso(),
        attempts: []
      };
  current.generated_at = nowIso();
  current.status = entry.status;
  current.attempts.push(entry);
  await fs.writeFile(logPath, `${JSON.stringify(current, null, 2)}\n`, "utf8");
}

async function ensurePassedGate(runDir) {
  const gate = await loadRequiredJson(runDir, "32_build_gate_decision.json", "build gate artifact");
  if (gate.decision !== "go") {
    throw new Error(`Repair from downstream stages requires a passed build gate. Current gate decision: ${gate.decision}`);
  }
  return gate;
}

async function preflightRepair(runDir, fromStage) {
  const inputs = PRE_REPAIR_INPUTS[fromStage] ?? [];
  for (const fileName of inputs) {
    await loadRequiredJson(runDir, fileName, `repair input for ${fromStage}`);
  }

  if (fromStage === "PREPARE_LISTING_PACKAGE") {
    const publishPlan = await loadRequiredJson(runDir, "80_publish_plan.json", "publish plan");
    if (publishPlan.publish_intent === "archive_no_publish") {
      return;
    }

    await ensurePassedGate(runDir);
    for (const fileName of [
      "41_product_brief.json",
      "42_implementation_plan.json",
      "50_build_report.json",
      "60_qa_report.json",
      "61_browser_smoke.json",
      "70_screenshot_manifest.json",
      "71_listing_copy.json",
      "72_policy_gate.json"
    ]) {
      await loadRequiredJson(runDir, fileName, "repair input for PREPARE_LISTING_PACKAGE");
    }
    await requireArtifact(runDir, "70_listing_assets", "listing assets directory");
    return;
  }

  if (fromStage === "EXECUTE_PUBLISH_PLAN") {
    const publishPlan = await loadRequiredJson(runDir, "80_publish_plan.json", "publish plan");
    if (publishPlan.publish_intent !== "archive_no_publish") {
      await loadRequiredJson(runDir, "50_build_report.json", "repair input for EXECUTE_PUBLISH_PLAN");
    }
    return;
  }

  const isBuildDownstream = stageIndex(fromStage) > stageIndex("BUILD_GATE");
  if (isBuildDownstream && fromStage !== "DECIDE_PUBLISH_INTENT") {
    await ensurePassedGate(runDir);
  }

  if (fromStage !== "DECIDE_PUBLISH_INTENT") {
    return;
  }

  const gate = await loadRequiredJson(runDir, "32_build_gate_decision.json", "build gate artifact");
  await loadRequiredJson(runDir, "31_selected_candidate.json", "selected candidate");
  if (gate.decision !== "go") {
    return;
  }

  for (const fileName of [
    "41_product_brief.json",
    "42_implementation_plan.json",
    "50_build_report.json",
    "60_qa_report.json",
    "71_listing_copy.json",
    "72_policy_gate.json"
  ]) {
    await loadRequiredJson(runDir, fileName, "repair input for DECIDE_PUBLISH_INTENT");
  }
}

export async function repairDailyWorkflow({ runDir, fromStage }) {
  const absoluteRunDir = path.resolve(runDir);
  const normalizedStage = normalizeRepairStage(fromStage);
  let stage = normalizedStage;
  const repairAttempt = {
    started_at: nowIso(),
    stage: normalizedStage,
    from_stage: normalizedStage,
    status: "running",
    cleaned_paths: []
  };

  try {
    const runContext = await loadRequiredJson(absoluteRunDir, "00_run_context.json", "run context");
    const projectRoot = runContext.project_root;
    if (isSandboxValidationRun(runContext)) {
      if (!["REVIEW_STATUS", "MONITOR_POST_RELEASE", "CLOSE_RUN"].includes(normalizedStage)) {
        throw new Error("sandbox_validation repairs are restricted to REVIEW_STATUS, MONITOR_POST_RELEASE, and CLOSE_RUN.");
      }

      const selectedReport = await loadRequiredJson(absoluteRunDir, "31_selected_candidate.json", "selected candidate");
      const publishPlan = await loadRequiredJson(absoluteRunDir, "80_publish_plan.json", "publish plan");
      const publishExecutionReport = await loadOptionalManagedJson(absoluteRunDir, "90_publish_execution.json", runContext);

      stage = "REVIEW_STATUS";
      const reviewStatus = shouldRunStage(normalizedStage, "REVIEW_STATUS")
        ? await reviewStatusStage({ runDir: absoluteRunDir })
        : await loadOptionalManagedJson(absoluteRunDir, "91_review_status.json", runContext);

      stage = "MONITOR_POST_RELEASE";
      const monitoring = shouldRunStage(normalizedStage, "MONITOR_POST_RELEASE")
        ? await monitorPostReleaseStage({
            runDir: absoluteRunDir,
            runContext,
            publishExecution: publishExecutionReport,
            reviewStatus
          })
        : {
            snapshot: await loadOptionalManagedJson(absoluteRunDir, "95_monitoring_snapshot.json", runContext),
            learning: await loadOptionalManagedJson(absoluteRunDir, "96_learning_update.json", runContext)
          };
      if (runContext.monitoring?.required && monitoring.snapshot?.status === "failed") {
        throw new Error(`MONITOR_POST_RELEASE failed: ${monitoring.snapshot.failure_reason}`);
      }

      stage = "CLOSE_RUN";
      await loadRequiredJson(absoluteRunDir, "99_close_run.json", "close run report");

      repairAttempt.status = "passed";
      repairAttempt.completed_at = nowIso();
      repairAttempt.publish_intent = publishPlan.publish_intent;
      await appendRepairLog(absoluteRunDir, repairAttempt, runContext);
      return {
        runDir: absoluteRunDir,
        publishPlan,
        publishExecutionReport,
        selectedReport,
        reviewStatus,
        monitoring
      };
    }
    await preflightRepair(absoluteRunDir, normalizedStage);
    repairAttempt.cleaned_paths = await cleanupForRepair(absoluteRunDir, normalizedStage);

    if (stageIndex(normalizedStage) >= stageIndex("REVIEW_STATUS")) {
      const selectedReport = await loadRequiredJson(absoluteRunDir, "31_selected_candidate.json", "selected candidate");
      const publishPlan = await loadRequiredJson(absoluteRunDir, "80_publish_plan.json", "publish plan");
      const publishExecutionReport = await loadRequiredJson(absoluteRunDir, "90_publish_execution.json", "publish execution report");
      const brief = await loadOptionalJson(absoluteRunDir, "41_product_brief.json");
      const plan = await loadOptionalJson(absoluteRunDir, "42_implementation_plan.json");
      const screenshotManifest = await loadOptionalJson(absoluteRunDir, "70_screenshot_manifest.json");
      const policyGate = await loadOptionalJson(absoluteRunDir, "72_policy_gate.json");

      stage = "REVIEW_STATUS";
      const reviewStatus = shouldRunStage(normalizedStage, "REVIEW_STATUS")
        ? await reviewStatusStage({ runDir: absoluteRunDir })
        : await loadRequiredJson(absoluteRunDir, "91_review_status.json", "review status report");

      stage = "MONITOR_POST_RELEASE";
      const monitoring = shouldRunStage(normalizedStage, "MONITOR_POST_RELEASE")
        ? await monitorPostReleaseStage({
            runDir: absoluteRunDir,
            runContext,
            publishExecution: publishExecutionReport,
            reviewStatus
          })
        : {
            snapshot: await loadRequiredJson(absoluteRunDir, "95_monitoring_snapshot.json", "monitoring snapshot"),
            learning: await loadRequiredJson(absoluteRunDir, "96_learning_update.json", "learning update")
          };

      if (runContext.monitoring?.required && monitoring.snapshot.status === "failed") {
        throw new Error(`MONITOR_POST_RELEASE failed: ${monitoring.snapshot.failure_reason}`);
      }

      stage = "CLOSE_RUN";
      await (shouldRunStage(normalizedStage, "CLOSE_RUN")
        ? closeRunStage({
            runDir: absoluteRunDir,
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
          })
        : loadRequiredJson(absoluteRunDir, "99_close_run.json", "close run report"));

      repairAttempt.status = "passed";
      repairAttempt.completed_at = nowIso();
      repairAttempt.publish_intent = publishPlan.publish_intent;
      await appendRepairLog(absoluteRunDir, repairAttempt, runContext);
      return {
        runDir: absoluteRunDir,
        publishPlan,
        publishExecutionReport
      };
    }

    let candidateReport = shouldRunStage(normalizedStage, "DISCOVER_CANDIDATES")
      ? await discoverCandidates({ projectRoot, runDir: absoluteRunDir, runContext })
      : await loadRequiredJson(absoluteRunDir, "10_candidate_report.json", "candidate report");

    stage = "ENRICH_FEEDBACK";
    let evidenceReport = shouldRunStage(normalizedStage, "ENRICH_FEEDBACK")
      ? await enrichFeedback({ projectRoot, runDir: absoluteRunDir, candidateReport })
      : await loadRequiredJson(absoluteRunDir, "20_feedback_evidence.json", "feedback evidence");

    stage = "CLUSTER_PAIN_POINTS";
    let clusterReport = shouldRunStage(normalizedStage, "CLUSTER_PAIN_POINTS")
      ? await clusterPainPoints({ runDir: absoluteRunDir, candidateReport, evidenceReport })
      : await loadRequiredJson(absoluteRunDir, "21_feedback_clusters.json", "feedback clusters");

    stage = "SCORE_OPPORTUNITIES";
    const selectedReport = shouldRunStage(normalizedStage, "SCORE_OPPORTUNITIES")
      ? (await scoreOpportunities({ runDir: absoluteRunDir, runContext, candidateReport, clusterReport })).selectedReport
      : await loadRequiredJson(absoluteRunDir, "31_selected_candidate.json", "selected candidate");

    stage = "BUILD_GATE";
    const gate = shouldRunStage(normalizedStage, "BUILD_GATE")
      ? await buildGate({ runDir: absoluteRunDir, runContext, selectedReport, clusterReport })
      : await loadRequiredJson(absoluteRunDir, "32_build_gate_decision.json", "build gate artifact");

    stage = "DISCOVERY_QUALITY_REVIEW";
    const discoveryReview = shouldRunStage(normalizedStage, "DISCOVERY_QUALITY_REVIEW")
      ? (await generateDiscoveryQualityReview({ runDir: absoluteRunDir })).review
      : await loadOptionalManagedJson(absoluteRunDir, "33_discovery_quality_review.json", runContext) ?? (await generateDiscoveryQualityReview({ runDir: absoluteRunDir })).review;

    let effectiveGate = gate;
    let researchResolution = null;
    const buildReadyAfterResearch = runContext.allow_build_after_research_resolution === true;
    if (discoveryReview.build_recommendation === "research_more") {
      stage = "RESEARCH_MORE_RESOLUTION";
      if (shouldRunStage(normalizedStage, "RESEARCH_MORE_RESOLUTION")) {
        researchResolution = await resolveResearchMore({ runDir: absoluteRunDir });
      } else {
        const storedResolution = await loadOptionalManagedJson(absoluteRunDir, "36_research_more_resolution.json", runContext);
        const storedGate = await loadOptionalManagedJson(absoluteRunDir, "39_research_resolution_gate.json", runContext);
        researchResolution = storedResolution && storedGate
          ? { resolution: storedResolution, gate: storedGate }
          : await resolveResearchMore({ runDir: absoluteRunDir });
      }
      if (researchResolution.gate?.final_recommendation === "build" && buildReadyAfterResearch) {
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

    if (selectedReport.status === "no_go" || effectiveGate.decision !== "go") {
      stage = "DECIDE_PUBLISH_INTENT";
      const failedQaReport = { overall_status: "failed" };
      const failedPolicyGate = { status: "fail", manual_review_items: [] };
      const publishPlan = shouldRunStage(normalizedStage, "DECIDE_PUBLISH_INTENT")
        ? await decidePublishIntentStage({
            runDir: absoluteRunDir,
            runContext,
            selectedReport,
            qaReport: failedQaReport,
            policyGate: failedPolicyGate,
            buildGateReport: effectiveGate
          })
        : await loadRequiredJson(absoluteRunDir, "80_publish_plan.json", "publish plan");

      stage = "PREPARE_LISTING_PACKAGE";
      const listingPackageReport = shouldRunStage(normalizedStage, "PREPARE_LISTING_PACKAGE")
        ? await prepareListingPackageStage({
            runDir: absoluteRunDir,
            selectedReport,
            qaReport: failedQaReport,
            policyGate: failedPolicyGate,
            publishPlan
          })
        : await loadRequiredJson(absoluteRunDir, "81_listing_package_report.json", "listing package report");
      await humanApprovalGateStage({
        runDir: absoluteRunDir,
        runContext,
        publishPlan
      });
      stage = "EXECUTE_PUBLISH_PLAN";
      const publishExecutionReport = shouldRunStage(normalizedStage, "EXECUTE_PUBLISH_PLAN")
        ? await executePublishPlanStage({
            runDir: absoluteRunDir,
            runContext,
            selectedReport,
            publishPlan,
            listingPackageReport
          })
        : await loadRequiredJson(absoluteRunDir, "90_publish_execution.json", "publish execution report");
      stage = "REVIEW_STATUS";
      const reviewStatus = shouldRunStage(normalizedStage, "REVIEW_STATUS")
        ? await reviewStatusStage({ runDir: absoluteRunDir })
        : await loadRequiredJson(absoluteRunDir, "91_review_status.json", "review status report");
      stage = "MONITOR_POST_RELEASE";
      const monitoring = shouldRunStage(normalizedStage, "MONITOR_POST_RELEASE")
        ? await monitorPostReleaseStage({
            runDir: absoluteRunDir,
            runContext,
            publishExecution: publishExecutionReport,
            reviewStatus
          })
        : {
            snapshot: await loadRequiredJson(absoluteRunDir, "95_monitoring_snapshot.json", "monitoring snapshot"),
            learning: await loadRequiredJson(absoluteRunDir, "96_learning_update.json", "learning update")
          };
      if (runContext.monitoring?.required && monitoring.snapshot.status === "failed") {
        throw new Error(`MONITOR_POST_RELEASE failed: ${monitoring.snapshot.failure_reason}`);
      }
      stage = "CLOSE_RUN";
      await (shouldRunStage(normalizedStage, "CLOSE_RUN")
        ? closeRunStage({
            runDir: absoluteRunDir,
            runContext,
            selectedReport,
            publishPlan,
            publishExecution: publishExecutionReport,
            reviewStatus,
            monitoringSnapshot: monitoring.snapshot,
            learningUpdate: monitoring.learning
          })
        : loadRequiredJson(absoluteRunDir, "99_close_run.json", "close run report"));
      repairAttempt.status = "passed";
      repairAttempt.completed_at = nowIso();
      repairAttempt.publish_intent = publishPlan.publish_intent;
      await appendRepairLog(absoluteRunDir, repairAttempt, runContext);
      return { runDir: absoluteRunDir, publishPlan, listingPackageReport, publishExecutionReport };
    }

    stage = "WRITE_BRIEF";
    const brief = shouldRunStage(normalizedStage, "WRITE_BRIEF")
      ? await writeBriefStage({ runDir: absoluteRunDir, selectedReport })
      : await loadRequiredJson(absoluteRunDir, "41_product_brief.json", "product brief");

    stage = "PLAN_IMPLEMENTATION";
    const plan = shouldRunStage(normalizedStage, "PLAN_IMPLEMENTATION")
      ? await planImplementationStage({ runDir: absoluteRunDir, brief })
      : await loadRequiredJson(absoluteRunDir, "42_implementation_plan.json", "implementation plan");

    stage = "BUILD_EXTENSION";
    const buildReport = shouldRunStage(normalizedStage, "BUILD_EXTENSION")
      ? await buildExtensionStage({ runDir: absoluteRunDir, brief, plan })
      : await loadRequiredJson(absoluteRunDir, "50_build_report.json", "build report");

    stage = "RUN_QA";
    const qaReport = shouldRunStage(normalizedStage, "RUN_QA")
      ? await runQaStage({ runDir: absoluteRunDir, brief, plan, buildReport })
      : await loadRequiredJson(absoluteRunDir, "60_qa_report.json", "qa report");

    stage = "BROWSER_SMOKE_AND_CAPTURE";
    const browserSmokeResult = shouldRunStage(normalizedStage, "BROWSER_SMOKE_AND_CAPTURE")
      ? await browserSmokeAndCaptureStage({ runDir: absoluteRunDir, runContext, brief, plan, buildReport, qaReport })
      : {
          browserSmokeReport: await loadRequiredJson(absoluteRunDir, "61_browser_smoke.json", "browser smoke report"),
          screenshotManifest: await loadRequiredJson(absoluteRunDir, "70_screenshot_manifest.json", "screenshot manifest")
        };
    const { browserSmokeReport, screenshotManifest } = browserSmokeResult;

    stage = "GENERATE_ASSETS";
    const listingCopy = shouldRunStage(normalizedStage, "GENERATE_ASSETS")
      ? await generateAssetsStage({ runDir: absoluteRunDir, runContext, brief, buildReport, qaReport, screenshotManifest })
      : await loadRequiredJson(absoluteRunDir, "71_listing_copy.json", "listing copy");

    stage = "RUN_POLICY_GATE";
    const policyGate = shouldRunStage(normalizedStage, "RUN_POLICY_GATE")
      ? await runPolicyGateStage({
          runDir: absoluteRunDir,
          runContext,
          brief,
          plan,
          buildReport,
          qaReport,
          listingCopy,
          browserSmokeReport,
          screenshotManifest
        })
      : await loadRequiredJson(absoluteRunDir, "72_policy_gate.json", "policy gate");

    stage = "DECIDE_PUBLISH_INTENT";
    const publishPlan = shouldRunStage(normalizedStage, "DECIDE_PUBLISH_INTENT")
      ? await decidePublishIntentStage({
          runDir: absoluteRunDir,
          runContext,
          selectedReport,
          qaReport,
          policyGate,
          buildGateReport: effectiveGate
        })
      : await loadRequiredJson(absoluteRunDir, "80_publish_plan.json", "publish plan");

    stage = "PREPARE_LISTING_PACKAGE";
    const listingPackageReport = shouldRunStage(normalizedStage, "PREPARE_LISTING_PACKAGE")
      ? await prepareListingPackageStage({
          runDir: absoluteRunDir,
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
        })
      : await loadRequiredJson(absoluteRunDir, "81_listing_package_report.json", "listing package report");

    await humanApprovalGateStage({
      runDir: absoluteRunDir,
      runContext,
      buildReport,
      publishPlan
    });

    stage = "EXECUTE_PUBLISH_PLAN";
    const publishExecutionReport = shouldRunStage(normalizedStage, "EXECUTE_PUBLISH_PLAN")
      ? await executePublishPlanStage({
          runDir: absoluteRunDir,
          runContext,
          selectedReport,
          buildReport,
          publishPlan,
          listingPackageReport
        })
      : await loadRequiredJson(absoluteRunDir, "90_publish_execution.json", "publish execution report");

    stage = "REVIEW_STATUS";
    const reviewStatus = shouldRunStage(normalizedStage, "REVIEW_STATUS")
      ? await reviewStatusStage({ runDir: absoluteRunDir })
      : await loadRequiredJson(absoluteRunDir, "91_review_status.json", "review status report");

    stage = "MONITOR_POST_RELEASE";
    const monitoring = shouldRunStage(normalizedStage, "MONITOR_POST_RELEASE")
      ? await monitorPostReleaseStage({
          runDir: absoluteRunDir,
          runContext,
          publishExecution: publishExecutionReport,
          reviewStatus
        })
      : {
          snapshot: await loadRequiredJson(absoluteRunDir, "95_monitoring_snapshot.json", "monitoring snapshot"),
          learning: await loadRequiredJson(absoluteRunDir, "96_learning_update.json", "learning update")
        };
    if (runContext.monitoring?.required && monitoring.snapshot.status === "failed") {
      throw new Error(`MONITOR_POST_RELEASE failed: ${monitoring.snapshot.failure_reason}`);
    }

    stage = "CLOSE_RUN";
    await (shouldRunStage(normalizedStage, "CLOSE_RUN")
      ? closeRunStage({
          runDir: absoluteRunDir,
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
        })
      : loadRequiredJson(absoluteRunDir, "99_close_run.json", "close run report"));

    repairAttempt.status = "passed";
    repairAttempt.completed_at = nowIso();
    repairAttempt.publish_intent = publishPlan.publish_intent;
    await appendRepairLog(absoluteRunDir, repairAttempt, runContext);
    return { runDir: absoluteRunDir, publishPlan, listingPackageReport, publishExecutionReport };
  } catch (error) {
    repairAttempt.status = "failed";
    repairAttempt.completed_at = nowIso();
    repairAttempt.failure_reason = error.message;
    const runContext = await loadOptionalJson(absoluteRunDir, "00_run_context.json");
    await appendRepairLog(absoluteRunDir, repairAttempt, runContext);
    if (!isSandboxValidationRun(runContext)) {
      await writeFailure(absoluteRunDir, stage, error);
    }
    throw error;
  }
}

export function listRepairableStages() {
  return [...REPAIRABLE_STAGES];
}
