import path from "node:path";
import { ensureDir, fileExists, listFiles, nowIso, readJson, writeJson } from "../utils/io.mjs";

export const RUN_EVENTS_ROOT = path.join("state", "run_events");
const IMMUTABLE_MARKER = ".immutable";

const ARTIFACT_DEFINITIONS = {
  "33_discovery_quality_review.json": {
    category: "discovery_review",
    prefix: "33_discovery_quality_review"
  },
  "34_demand_discovery_improvement_plan.json": {
    category: "discovery_review",
    prefix: "34_demand_discovery_improvement_plan"
  },
  "36_research_more_resolution.json": {
    category: "research_resolution",
    prefix: "36_research_more_resolution"
  },
  "37_refined_pain_clusters.json": {
    category: "research_resolution",
    prefix: "37_refined_pain_clusters"
  },
  "38_updated_opportunity_score.json": {
    category: "research_resolution",
    prefix: "38_updated_opportunity_score"
  },
  "39_research_resolution_gate.json": {
    category: "research_resolution",
    prefix: "39_research_resolution_gate"
  },
  "40_next_query_results.json": {
    category: "research_queries",
    prefix: "40_next_query_results"
  },
  "40_live_query_results.json": {
    category: "live_queue",
    prefix: "40_live_query_results"
  },
  "41_live_candidate_queue.json": {
    category: "live_queue",
    prefix: "41_live_candidate_queue"
  },
  "42_low_overlap_filter_report.json": {
    category: "live_queue",
    prefix: "42_low_overlap_filter_report"
  },
  "43_batch_opportunity_scores.json": {
    category: "live_queue",
    prefix: "43_batch_opportunity_scores"
  },
  "44_next_build_candidate.json": {
    category: "live_queue",
    prefix: "44_next_build_candidate"
  },
  "45_discovery_ops_report.json": {
    category: "discovery_ops",
    prefix: "45_discovery_ops_report"
  },
  "46_targeted_research_batch.json": {
    category: "targeted_research",
    prefix: "46_targeted_research_batch"
  },
  "47_wedge_decision_board.json": {
    category: "targeted_research",
    prefix: "47_wedge_decision_board"
  },
  "48_human_candidate_review_queue.json": {
    category: "targeted_research",
    prefix: "48_human_candidate_review_queue"
  },
  "49_targeted_research_round2.json": {
    category: "targeted_research",
    prefix: "49_targeted_research_round2"
  },
  "50_query_expansion_plan.json": {
    category: "query_expansion",
    prefix: "50_query_expansion_plan"
  },
  "51_live_queue_round2_results.json": {
    category: "live_queue_round2",
    prefix: "51_live_queue_round2_results"
  },
  "52_live_queue_round2_scores.json": {
    category: "live_queue_round2",
    prefix: "52_live_queue_round2_scores"
  },
  "53_next_candidate_round2.json": {
    category: "live_queue_round2",
    prefix: "53_next_candidate_round2"
  },
  "54_human_candidate_review_queue_v2.json": {
    category: "targeted_research",
    prefix: "54_human_candidate_review_queue_v2"
  },
  "55_discovery_strategy_v2.json": {
    category: "strategy_v2",
    prefix: "55_discovery_strategy_v2"
  },
  "56_builder_fit_map.json": {
    category: "strategy_v2",
    prefix: "56_builder_fit_map"
  },
  "57_low_overlap_search_map.json": {
    category: "strategy_v2",
    prefix: "57_low_overlap_search_map"
  },
  "58_source_priority_model.json": {
    category: "strategy_v2",
    prefix: "58_source_priority_model"
  },
  "59_strategy_v2_query_results.json": {
    category: "strategy_v2_run",
    prefix: "59_strategy_v2_query_results"
  },
  "60_strategy_v2_candidate_scores.json": {
    category: "strategy_v2_run",
    prefix: "60_strategy_v2_candidate_scores"
  },
  "61_strategy_v2_next_candidate.json": {
    category: "strategy_v2_run",
    prefix: "61_strategy_v2_next_candidate"
  },
  "62_functional_test_matrix.json": {
    category: "functional_test_matrix",
    prefix: "62_functional_test_matrix"
  },
  "62_no_build_today_report.json": {
    category: "strategy_v2_run",
    prefix: "62_no_build_today_report"
  },
  "63_discovery_strategy_review.json": {
    category: "strategy_review",
    prefix: "63_discovery_strategy_review"
  },
  "64_builder_roadmap_evaluation.json": {
    category: "strategy_review",
    prefix: "64_builder_roadmap_evaluation"
  },
  "65_manual_seed_plan.json": {
    category: "strategy_review",
    prefix: "65_manual_seed_plan"
  },
  "66_threshold_calibration_review.json": {
    category: "strategy_review",
    prefix: "66_threshold_calibration_review"
  },
  "67_next_discovery_task.json": {
    category: "strategy_review",
    prefix: "67_next_discovery_task"
  },
  "68_seed_query_plan.json": {
    category: "strategy_review",
    prefix: "68_seed_query_plan"
  },
  "69_seed_discovery_results.json": {
    category: "seed_discovery",
    prefix: "69_seed_discovery_results"
  },
  "70_seed_candidate_queue.json": {
    category: "seed_discovery",
    prefix: "70_seed_candidate_queue"
  },
  "71_seed_opportunity_scores.json": {
    category: "seed_discovery",
    prefix: "71_seed_opportunity_scores"
  },
  "72_seed_next_candidate.json": {
    category: "seed_discovery",
    prefix: "72_seed_next_candidate"
  },
  "74_seed_performance_report.json": {
    category: "seed_discovery",
    prefix: "74_seed_performance_report"
  },
  "75_seed_human_candidate_review_queue.json": {
    category: "seed_discovery",
    prefix: "75_seed_human_candidate_review_queue"
  },
  "76_support_qa_deep_dive.json": {
    category: "support_qa_deep_dive",
    prefix: "76_support_qa_deep_dive"
  },
  "77_support_qa_evidence_pack.json": {
    category: "support_qa_deep_dive",
    prefix: "77_support_qa_evidence_pack"
  },
  "78_support_qa_functional_test_plan.json": {
    category: "support_qa_deep_dive",
    prefix: "78_support_qa_functional_test_plan"
  },
  "79_support_qa_human_review_queue.json": {
    category: "support_qa_deep_dive",
    prefix: "79_support_qa_human_review_queue"
  },
  "80_support_qa_evidence_sprint.json": {
    category: "support_qa_evidence_sprint",
    prefix: "80_support_qa_evidence_sprint"
  },
  "81_support_qa_candidate_test_plan.json": {
    category: "support_qa_evidence_sprint",
    prefix: "81_support_qa_candidate_test_plan"
  },
  "82_demand_validation_plan.json": {
    category: "support_qa_validation",
    prefix: "82_demand_validation_plan"
  },
  "83_candidate_rescore_with_manual_evidence.json": {
    category: "support_qa_validation",
    prefix: "83_candidate_rescore_with_manual_evidence"
  },
  "87_money_first_opportunity_scores.json": {
    category: "money_first",
    prefix: "87_money_first_opportunity_scores"
  },
  "88_competitor_price_value_map.json": {
    category: "money_first",
    prefix: "88_competitor_price_value_map"
  },
  "89_money_micro_wedge_candidates.json": {
    category: "money_first",
    prefix: "89_money_micro_wedge_candidates"
  },
  "90_pricing_experiment_plan.json": {
    category: "money_first",
    prefix: "90_pricing_experiment_plan"
  },
  "91_payment_license_architecture_plan.json": {
    category: "money_first",
    prefix: "91_payment_license_architecture_plan"
  },
  "92_money_first_build_gate.json": {
    category: "money_first",
    prefix: "92_money_first_build_gate"
  },
  "93_fake_door_test_plan.json": {
    category: "money_first",
    prefix: "93_fake_door_test_plan"
  },
  "94_money_first_ops_report.json": {
    category: "money_first",
    prefix: "94_money_first_ops_report"
  },
  "95_monetization_strategy.json": {
    category: "monetization",
    prefix: "95_monetization_strategy"
  },
  "96_payment_link_flow_plan.json": {
    category: "market_test",
    prefix: "96_payment_link_flow_plan"
  },
  "97_license_activation_spec.json": {
    category: "market_test",
    prefix: "97_license_activation_spec"
  },
  "98_value_first_paywall_rules.json": {
    category: "market_test",
    prefix: "98_value_first_paywall_rules"
  },
  "100_paid_interest_experiment.json": {
    category: "market_test",
    prefix: "100_paid_interest_experiment"
  },
  "103_market_test_plan.json": {
    category: "market_test",
    prefix: "103_market_test_plan"
  },
  "104_market_first_build_gate.json": {
    category: "market_test",
    prefix: "104_market_first_build_gate"
  },
  "105_micro_mvp_selection.json": {
    category: "market_test",
    prefix: "105_micro_mvp_selection"
  },
  "106_market_test_metrics_spec.json": {
    category: "market_test",
    prefix: "106_market_test_metrics_spec"
  },
  "107_market_test_launch_plan.json": {
    category: "market_test",
    prefix: "107_market_test_launch_plan"
  },
  "108_page_context_market_test_plan.json": {
    category: "market_test",
    prefix: "108_page_context_market_test_plan"
  },
  "109_monetization_test_matrix.json": {
    category: "monetization",
    prefix: "109_monetization_test_matrix"
  },
  "110_monetization_security_scan.json": {
    category: "monetization",
    prefix: "110_monetization_security_scan"
  },
  "111_premium_packaging_brief.json": {
    category: "premium_packaging",
    prefix: "111_premium_packaging_brief"
  },
  "112_brand_system.json": {
    category: "premium_packaging",
    prefix: "112_brand_system"
  },
  "113_store_asset_spec.json": {
    category: "premium_packaging",
    prefix: "113_store_asset_spec"
  },
  "114_screenshot_storyboard.json": {
    category: "premium_packaging",
    prefix: "114_screenshot_storyboard"
  },
  "115_listing_quality_gate.json": {
    category: "premium_packaging",
    prefix: "115_listing_quality_gate"
  },
  "116_product_polish_checklist.json": {
    category: "premium_packaging",
    prefix: "116_product_polish_checklist"
  },
  "117_landing_page_package.json": {
    category: "premium_packaging",
    prefix: "117_landing_page_package"
  },
  "118_asset_quality_report.json": {
    category: "premium_packaging",
    prefix: "118_asset_quality_report"
  },
  "120_store_listing_release_package_report.json": {
    category: "store_release_package",
    prefix: "120_store_listing_release_package_report"
  },
  "121_human_visual_review.json": {
    category: "visual_review",
    prefix: "121_human_visual_review"
  },
  "122_market_test_asset_package.json": {
    category: "store_release_package",
    prefix: "122_market_test_asset_package"
  },
  "125_final_publish_decision_gate.json": {
    category: "publish_decision",
    prefix: "125_final_publish_decision_gate"
  },
  "126_final_publish_approval.json": {
    category: "approvals",
    prefix: "126_final_publish_approval"
  },
  "128_commercial_release_revision.json": {
    category: "commercial_release",
    prefix: "128_commercial_release_revision"
  },
  "129_commercial_release_gate.json": {
    category: "commercial_release",
    prefix: "129_commercial_release_gate"
  },
  "130_commercial_publish_strategy.json": {
    category: "commercial_release",
    prefix: "130_commercial_publish_strategy"
  },
  "134_pay_site_integration_test_matrix.json": {
    category: "pay_site_integration",
    prefix: "134_pay_site_integration_test_matrix"
  },
  "138_plugin_site_payment_gate.json": {
    category: "plugin_site",
    prefix: "138_plugin_site_payment_gate"
  },
  "140_payment_configured_commercial_candidate.json": {
    category: "commercial_release",
    prefix: "140_payment_configured_commercial_candidate"
  },
  "141_web_redesign_plan.json": {
    category: "plugin_site",
    prefix: "141_web_redesign_plan"
  },
  "142_web_design_system.json": {
    category: "plugin_site",
    prefix: "142_web_design_system"
  },
  "143_product_page_quality_review.json": {
    category: "plugin_site",
    prefix: "143_product_page_quality_review"
  },
  "144_checkout_page_quality_review.json": {
    category: "plugin_site",
    prefix: "144_checkout_page_quality_review"
  },
  "145_site_visual_consistency_report.json": {
    category: "plugin_site",
    prefix: "145_site_visual_consistency_report"
  },
  "147_production_payment_readiness.json": {
    category: "commercial_release",
    prefix: "147_production_payment_readiness"
  },
  "148_commercial_resubmission_package.json": {
    category: "commercial_release",
    prefix: "148_commercial_resubmission_package"
  },
  "149_public_launch_gate.json": {
    category: "commercial_release",
    prefix: "149_public_launch_gate"
  },
  "82_human_approval.json": {
    category: "approvals",
    prefix: "82_human_approval"
  },
  "84_sandbox_preflight.json": {
    category: "sandbox_preflight",
    prefix: "84_sandbox_preflight"
  },
  "85_publish_sandbox_ci_dry_check.json": {
    category: "ci_dry_check",
    prefix: "85_publish_sandbox_ci_dry_check"
  },
  "90_publish_execution.json": {
    category: "publish_execution",
    prefix: "90_publish_execution"
  },
  "91_review_status.json": {
    category: "review_status",
    prefix: "91_review_status"
  },
  "92_install_verification_plan.json": {
    category: "install_verification",
    prefix: "92_install_verification_plan"
  },
  "92_review_repair_plan.json": {
    category: "review_repair",
    prefix: "92_review_repair_plan"
  },
  "94_product_acceptance_review.json": {
    category: "product_review",
    prefix: "94_product_acceptance_review"
  },
  "94_human_product_review.json": {
    category: "product_review",
    prefix: "94_human_product_review"
  },
  "95_monitoring_snapshot.json": {
    category: "monitoring_snapshot",
    prefix: "95_monitoring_snapshot"
  },
  "96_learning_update.json": {
    category: "learning_update",
    prefix: "96_learning_update"
  },
  "97_product_revision_plan.json": {
    category: "product_revision",
    prefix: "97_product_revision_plan"
  }
};

function artifactDefinition(artifactName) {
  const definition = ARTIFACT_DEFINITIONS[artifactName];
  if (!definition) {
    throw new Error(`Unsupported sidecar artifact: ${artifactName}`);
  }
  return definition;
}

function normalizeRelativePath(projectRoot, absolutePath) {
  return path.relative(projectRoot, absolutePath).replaceAll("\\", "/");
}

function sidecarStamp(occurredAt = nowIso()) {
  return `${occurredAt}`.replace(/[:.]/g, "-");
}

async function readRunContext(runDir) {
  const runContextPath = path.join(runDir, "00_run_context.json");
  if (!(await fileExists(runContextPath))) {
    return null;
  }
  return readJson(runContextPath);
}

export function runEventsDirectory(projectRoot, runId) {
  return path.join(projectRoot, RUN_EVENTS_ROOT, runId);
}

export function runEventLatestArtifactPath(projectRoot, runId, artifactName) {
  return path.join(runEventsDirectory(projectRoot, runId), artifactName);
}

export function runEventVersionedArtifactPath(projectRoot, runId, artifactName, occurredAt = nowIso()) {
  const definition = artifactDefinition(artifactName);
  return path.join(
    runEventsDirectory(projectRoot, runId),
    definition.category,
    `${definition.prefix}-${sidecarStamp(occurredAt)}.json`
  );
}

export async function usesRunEventSidecars({ runDir, runContext = null }) {
  const context = runContext ?? await readRunContext(runDir);
  if (!context) {
    return false;
  }
  if (context.run_type === "sandbox_validation" || context.task_mode === "sandbox_validation") {
    return true;
  }
  return fileExists(path.join(runDir, IMMUTABLE_MARKER));
}

export async function writeManagedRunArtifact({
  runDir,
  artifactName,
  data,
  runContext = null,
  occurredAt = nowIso()
}) {
  const context = runContext ?? await readRunContext(runDir);
  if (!context) {
    throw new Error(`Cannot write ${artifactName} without 00_run_context.json.`);
  }

  if (await usesRunEventSidecars({ runDir, runContext: context })) {
    const latestPath = runEventLatestArtifactPath(context.project_root, context.run_id, artifactName);
    const eventPath = runEventVersionedArtifactPath(context.project_root, context.run_id, artifactName, occurredAt);
    await ensureDir(path.dirname(eventPath));
    await writeJson(eventPath, data);
    await writeJson(latestPath, data);
    return {
      storage: "sidecar",
      artifactPath: latestPath,
      artifactRelativePath: normalizeRelativePath(context.project_root, latestPath),
      eventPath,
      eventRelativePath: normalizeRelativePath(context.project_root, eventPath)
    };
  }

  const artifactPath = path.join(runDir, artifactName);
  await writeJson(artifactPath, data);
  return {
    storage: "run",
    artifactPath,
    artifactRelativePath: normalizeRelativePath(context.project_root, artifactPath),
    eventPath: null,
    eventRelativePath: null
  };
}

export async function loadManagedRunArtifact({
  runDir,
  artifactName,
  runContext = null
}) {
  const context = runContext ?? await readRunContext(runDir);
  if (context) {
    const latestSidecarPath = runEventLatestArtifactPath(context.project_root, context.run_id, artifactName);
    if (await fileExists(latestSidecarPath)) {
      return {
        data: await readJson(latestSidecarPath),
        storage: "sidecar",
        artifactPath: latestSidecarPath,
        artifactRelativePath: normalizeRelativePath(context.project_root, latestSidecarPath)
      };
    }
  }

  const artifactPath = path.join(runDir, artifactName);
  if (!(await fileExists(artifactPath))) {
    return null;
  }

  return {
    data: await readJson(artifactPath),
    storage: "run",
    artifactPath,
    artifactRelativePath: context
      ? normalizeRelativePath(context.project_root, artifactPath)
      : path.basename(artifactPath)
  };
}

export async function inspectRunEventArtifacts(projectRoot, runId) {
  const baseDir = runEventsDirectory(projectRoot, runId);
  if (!(await fileExists(baseDir))) {
    return {
      path: baseDir,
      exists: false,
      latest_artifacts: {},
      event_files: []
    };
  }

  const latestArtifacts = {};
  for (const artifactName of Object.keys(ARTIFACT_DEFINITIONS)) {
    const latestPath = runEventLatestArtifactPath(projectRoot, runId, artifactName);
    if (await fileExists(latestPath)) {
      latestArtifacts[artifactName] = normalizeRelativePath(projectRoot, latestPath);
    }
  }

  const eventFiles = (await listFiles(baseDir)).map((entry) => entry.relativePath);
  return {
    path: baseDir,
    exists: true,
    latest_artifacts: latestArtifacts,
    event_files: eventFiles
  };
}

export async function appendRunEventLog({
  projectRoot,
  runId,
  category,
  prefix,
  data,
  occurredAt = nowIso()
}) {
  const baseDir = path.join(runEventsDirectory(projectRoot, runId), category);
  const logPath = path.join(baseDir, `${prefix}-${sidecarStamp(occurredAt)}.json`);
  await ensureDir(baseDir);
  await writeJson(logPath, data);
  return {
    logPath,
    logRelativePath: normalizeRelativePath(projectRoot, logPath)
  };
}
