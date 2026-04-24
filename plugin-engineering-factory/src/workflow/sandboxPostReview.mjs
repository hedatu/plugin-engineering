import os from "node:os";
import path from "node:path";
import { evaluatePrePublishAssetGate } from "../packaging/storeReleasePackage.mjs";
import { appendReleaseLedgerEvent } from "../publish/releaseLedger.mjs";
import { loadManagedRunArtifact, writeManagedRunArtifact } from "./runEventArtifacts.mjs";
import { assertMatchesSchema } from "../utils/schema.mjs";
import { fileExists, nowIso, readJson } from "../utils/io.mjs";
import {
  hasSecretLikeContent,
  inspectSecretLikeContent,
  redactSecretLikeValue
} from "../utils/redaction.mjs";

export const INSTALL_VERIFICATION_PLAN_ARTIFACT = "92_install_verification_plan.json";
export const REVIEW_REPAIR_PLAN_ARTIFACT = "92_review_repair_plan.json";
export const FINAL_PUBLISH_DECISION_GATE_ARTIFACT = "125_final_publish_decision_gate.json";
export const FINAL_PUBLISH_APPROVAL_ARTIFACT = "126_final_publish_approval.json";

function artifactPath(runDir, fileName) {
  return path.join(runDir, fileName);
}

function buildSafeReport(reportWithoutChecks) {
  const initialChecks = inspectSecretLikeContent(reportWithoutChecks);
  const redactionGuardTriggered = hasSecretLikeContent(initialChecks);
  const safeReport = redactSecretLikeValue(reportWithoutChecks);

  if (redactionGuardTriggered) {
    safeReport.status = "failed";
    safeReport.next_step = "remove secret-like content from post-review planning inputs and retry";
  }

  return {
    ...safeReport,
    redaction_checks: {
      ...inspectSecretLikeContent(safeReport),
      redaction_guard_triggered: redactionGuardTriggered
    }
  };
}

async function validateArtifact(projectRoot, schemaName, label, data) {
  await assertMatchesSchema({
    data,
    schemaPath: path.join(projectRoot, "schemas", schemaName),
    label
  });
}

function addHours(isoString, hours) {
  if (!isoString) {
    return null;
  }
  const timestamp = Date.parse(isoString);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return new Date(timestamp + (hours * 60 * 60 * 1000)).toISOString();
}

function normalizeState(value) {
  return `${value ?? ""}`.trim().toUpperCase();
}

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

async function loadOptionalManagedArtifact({ runDir, runContext, artifactName }) {
  return (await loadManagedRunArtifact({
    runDir,
    artifactName,
    runContext
  }))?.data ?? null;
}

async function loadSandboxPostReviewState(runDir) {
  const absoluteRunDir = path.resolve(runDir);
  const runContext = await readJson(artifactPath(absoluteRunDir, "00_run_context.json"));
  if ((runContext.run_type ?? runContext.task_mode) !== "sandbox_validation") {
    throw new Error(`Run ${runContext.run_id} is not a sandbox_validation run.`);
  }

  const sandboxPlan = await readJson(artifactPath(absoluteRunDir, "83_sandbox_validation_plan.json"));
  const buildReport = await readJson(artifactPath(absoluteRunDir, "50_build_report.json"));
  const implementationPlan = await readJson(artifactPath(absoluteRunDir, "42_implementation_plan.json"));
  const brief = await readJson(artifactPath(absoluteRunDir, "41_product_brief.json"));
  const latestReviewStatus = (await loadManagedRunArtifact({
    runDir: absoluteRunDir,
    artifactName: "91_review_status.json",
    runContext
  }))?.data ?? null;
  const latestPublishExecution = (await loadManagedRunArtifact({
    runDir: absoluteRunDir,
    artifactName: "90_publish_execution.json",
    runContext
  }))?.data ?? null;
  const latestFunctionalTestMatrix = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    runContext,
    artifactName: "62_functional_test_matrix.json"
  });
  const latestProductAcceptanceReview = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    runContext,
    artifactName: "94_product_acceptance_review.json"
  });
  const latestInstallVerificationPlan = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    runContext,
    artifactName: INSTALL_VERIFICATION_PLAN_ARTIFACT
  });
  const latestListingQualityGate = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    runContext,
    artifactName: "115_listing_quality_gate.json"
  });
  const latestAssetQualityReport = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    runContext,
    artifactName: "118_asset_quality_report.json"
  });
  const latestStoreReleasePackage = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    runContext,
    artifactName: "120_store_listing_release_package_report.json"
  });
  const latestHumanVisualReview = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    runContext,
    artifactName: "121_human_visual_review.json"
  });
  const latestMarketTestAssetPackage = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    runContext,
    artifactName: "122_market_test_asset_package.json"
  });
  const latestMonetizationStrategy = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    runContext,
    artifactName: "95_monetization_strategy.json"
  });
  const latestPaymentLinkFlowPlan = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    runContext,
    artifactName: "96_payment_link_flow_plan.json"
  });
  const latestLicenseActivationSpec = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    runContext,
    artifactName: "97_license_activation_spec.json"
  });
  const latestFinalPublishDecisionGate = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    runContext,
    artifactName: FINAL_PUBLISH_DECISION_GATE_ARTIFACT
  });

  return {
    runDir: absoluteRunDir,
    runContext,
    sandboxPlan,
    buildReport,
    implementationPlan,
    brief,
    latestReviewStatus,
    latestPublishExecution,
    latestFunctionalTestMatrix,
    latestProductAcceptanceReview,
    latestInstallVerificationPlan,
    latestListingQualityGate,
    latestAssetQualityReport,
    latestStoreReleasePackage,
    latestHumanVisualReview,
    latestMarketTestAssetPackage,
    latestMonetizationStrategy,
    latestPaymentLinkFlowPlan,
    latestLicenseActivationSpec,
    latestFinalPublishDecisionGate
  };
}

function installUrlForItem(itemId) {
  return itemId
    ? `https://chromewebstore.google.com/detail/${itemId}`
    : null;
}

function installVerificationSteps({ archetype, expectedVersion }) {
  if (archetype === "single_profile_form_fill") {
    return [
      "Attempt install from the staged, private, or trusted-tester Chrome Web Store path. If the STAGED revision is not installable yet, record blocker staged_not_installable_until_final_publish and set next_step=final_publish_decision_required_before_install_verification.",
      `Confirm the installed version is ${expectedVersion}.`,
      "Open the popup and confirm the extension action loads without UI errors.",
      "Save a local profile, edit it, then delete or reset it once to confirm profile lifecycle management works.",
      "Open the controlled form fixture used for the sandbox validation scenario.",
      "Click the extension action to trigger the saved profile fill flow.",
      "Verify that text, email, phone, textarea, and select fields are populated with the stored profile values.",
      "Verify that readonly and disabled fields are skipped and not overwritten.",
      "Verify that already-filled fields are not overwritten by default.",
      "Verify that a no matching fields case shows clear popup feedback instead of a silent success.",
      "Verify that the popup or listing copy clearly states the local-only and no-upload behavior.",
      "Capture a screenshot showing the populated fields and extension state.",
      "Write state/run_events/<run_id>/93_manual_install_verification.json with the tester result."
    ];
  }

  return [
    "Use a trusted tester account to install the sandbox extension.",
    `Confirm the installed version is ${expectedVersion}.`,
    "Execute the primary happy-path interaction for the extension.",
    "Capture evidence screenshots for the exercised flow.",
    "Write state/run_events/<run_id>/93_manual_install_verification.json with the tester result."
  ];
}

function expectedHappyPath({ archetype, extensionName }) {
  if (archetype === "single_profile_form_fill") {
    return [
      `${extensionName ?? "The extension"} installs for the trusted tester without warnings.`,
      "The popup opens, supports save, edit, and delete for the local profile, and keeps the current profile available for the fill action.",
      "The controlled form fixture fills supported text-like and select fields correctly, skips readonly or disabled fields safely, preserves pre-filled values by default, shows explicit no-match feedback, and keeps the local-only / no-upload promise clear."
    ];
  }

  return [
    `${extensionName ?? "The extension"} installs successfully for the trusted tester.`,
    "The primary user journey completes without console or UI errors."
  ];
}

function isApprovedReviewState(reviewStatus) {
  const reviewState = normalizeState(reviewStatus?.review_state ?? reviewStatus?.current_dashboard_state);
  return reviewStatus?.is_approved === true
    || reviewState === "STAGED"
    || reviewState === "PUBLISHED"
    || reviewState === "AVAILABLE_TO_TESTERS";
}

function buildFinalPublishDecisionGateReport(state) {
  const reviewState = normalizeState(state.latestReviewStatus?.review_state ?? state.latestReviewStatus?.current_dashboard_state);
  const isApproved = isApprovedReviewState(state.latestReviewStatus);
  const isStaged = reviewState === "STAGED";
  const installVerificationStatus = state.latestInstallVerificationPlan?.status ?? "not_started";
  const productAcceptanceStatus = state.latestProductAcceptanceReview?.acceptance_status ?? "not_started";
  const functionalTestCoverageScore = state.latestFunctionalTestMatrix?.test_coverage_score ?? null;
  const premiumPackageStatus = state.latestStoreReleasePackage?.package_status ?? "not_started";
  const assetQaStatus = state.latestAssetQualityReport?.status ?? "not_started";
  const listingQualityGateStatus = state.latestListingQualityGate?.status ?? "not_started";
  const humanVisualReviewStatus = state.latestHumanVisualReview?.decision ?? "not_started";
  const monetizationStrategyStatus = state.latestMonetizationStrategy
    ? state.latestMonetizationStrategy.status ?? "present"
    : "not_present";
  const paymentReadyStatus = state.latestPaymentLinkFlowPlan
    ? "planned_external_payment"
    : state.latestMonetizationStrategy || state.latestLicenseActivationSpec
      ? "pending_external_payment_contract"
      : "not_required";
  const marketTestReadinessStatus = state.latestMarketTestAssetPackage?.status === "passed"
    ? "passed"
    : "not_assessed";
  const prePublishAssetGate = evaluatePrePublishAssetGate({
    listingQualityGate: state.latestListingQualityGate,
    assetQualityReport: state.latestAssetQualityReport,
    storeReleasePackageReport: state.latestStoreReleasePackage,
    humanVisualReview: state.latestHumanVisualReview
  });
  const currentReviewMayNotIncludeLatestPremiumAssets = Boolean(isStaged && state.latestStoreReleasePackage);
  const requiresDashboardListingSync = currentReviewMayNotIncludeLatestPremiumAssets;
  const dashboardListingSyncStatus = requiresDashboardListingSync ? "required_not_started" : "not_required";
  const installVerificationBlocked = state.latestInstallVerificationPlan?.blockers?.includes("staged_not_installable_until_final_publish")
    || state.latestInstallVerificationPlan?.next_step === "final_publish_decision_required_before_install_verification";
  const blockers = unique([
    isApproved ? null : "review_not_approved",
    installVerificationStatus === "passed" ? null : installVerificationBlocked
      ? "staged_not_installable_until_final_publish"
      : installVerificationStatus === "active"
        ? "install_verification_pending"
        : installVerificationStatus === "not_started"
          ? "install_verification_not_started"
          : installVerificationStatus === "skipped"
            ? "install_verification_skipped"
            : installVerificationStatus === "failed"
              ? "install_verification_failed"
              : null,
    productAcceptanceStatus === "passed" ? null : "product_acceptance_not_passed",
    functionalTestCoverageScore !== null && functionalTestCoverageScore >= 100 ? null : "functional_test_coverage_incomplete",
    premiumPackageStatus === "passed" ? null : "premium_package_not_passed",
    assetQaStatus === "passed" ? null : "asset_qa_not_passed",
    listingQualityGateStatus === "passed" ? null : "listing_quality_gate_not_passed",
    humanVisualReviewStatus === "passed" ? null : "human_visual_review_not_passed",
    prePublishAssetGate.paid_disclosure_passed ? null : "paid_disclosure_not_passed",
    requiresDashboardListingSync ? "dashboard_listing_sync_required" : null,
    currentReviewMayNotIncludeLatestPremiumAssets ? "current_review_may_not_include_latest_premium_assets" : null
  ]);

  let recommendedNextAction = "hold_staged";
  if (!isApproved) {
    recommendedNextAction = "hold_staged";
  } else if (humanVisualReviewStatus !== "passed") {
    recommendedNextAction = "record_human_visual_review";
  } else if (dashboardListingSyncStatus !== "not_required" && dashboardListingSyncStatus !== "completed") {
    recommendedNextAction = "sync_dashboard_listing_assets";
  } else if (installVerificationBlocked) {
    recommendedNextAction = "final_publish_or_private_test_decision";
  } else if (installVerificationStatus === "active" || installVerificationStatus === "not_started") {
    recommendedNextAction = "record_install_verification";
  } else if (blockers.length === 0) {
    recommendedNextAction = "request_human_final_publish_approval";
  }

  const allowedActions = {
    record_install_verification: isApproved,
    record_dashboard_listing_sync: requiresDashboardListingSync,
    final_publish: blockers.length === 0,
    hold_staged: isStaged || isApproved
  };
  const gateStatus = allowedActions.final_publish
    ? "ready_for_human_final_publish_approval"
    : blockers.length > 0
      ? "action_required"
      : "hold";

  return buildSafeReport({
    stage: "FINAL_PUBLISH_DECISION_GATE",
    status: "passed",
    gate_status: gateStatus,
    run_id: state.runContext.run_id,
    review_state: reviewState || null,
    is_approved: isApproved,
    is_staged: isStaged,
    install_verification_status: installVerificationStatus,
    product_acceptance_status: productAcceptanceStatus,
    functional_test_coverage_score: functionalTestCoverageScore,
    premium_package_status: premiumPackageStatus,
    asset_qa_status: assetQaStatus,
    listing_quality_gate_status: listingQualityGateStatus,
    human_visual_review_status: humanVisualReviewStatus,
    dashboard_listing_sync_status: dashboardListingSyncStatus,
    monetization_strategy_status: monetizationStrategyStatus,
    payment_ready_status: paymentReadyStatus,
    market_test_readiness_status: marketTestReadinessStatus,
    current_review_may_not_include_latest_premium_assets: currentReviewMayNotIncludeLatestPremiumAssets,
    requires_dashboard_listing_sync: requiresDashboardListingSync,
    blockers,
    allowed_actions: allowedActions,
    recommended_next_action: recommendedNextAction
  });
}

async function writeFinalPublishDecisionGate({ state }) {
  const report = buildFinalPublishDecisionGateReport(state);
  await validateArtifact(
    state.runContext.project_root,
    "final_publish_decision_gate.schema.json",
    FINAL_PUBLISH_DECISION_GATE_ARTIFACT,
    report
  );
  await writeManagedRunArtifact({
    runDir: state.runDir,
    artifactName: FINAL_PUBLISH_DECISION_GATE_ARTIFACT,
    data: report,
    runContext: state.runContext
  });
  return report;
}

function inferPolicyArea(rejectionReason) {
  const normalized = `${rejectionReason ?? ""}`.trim().toLowerCase();
  if (!normalized) {
    return "unknown_review_rejection";
  }
  if (normalized.includes("privacy")) {
    return "privacy_disclosure";
  }
  if (normalized.includes("permission")) {
    return "permissions_scope";
  }
  if (normalized.includes("deceptive") || normalized.includes("misleading")) {
    return "store_listing_claims";
  }
  if (normalized.includes("metadata") || normalized.includes("listing")) {
    return "listing_metadata";
  }
  if (normalized.includes("policy")) {
    return "chrome_web_store_policy";
  }
  return "unknown_review_rejection";
}

function repairStartStageForPolicyArea(policyArea) {
  if (policyArea === "privacy_disclosure" || policyArea === "permissions_scope") {
    return "PLAN_IMPLEMENTATION";
  }
  if (policyArea === "listing_metadata" || policyArea === "store_listing_claims") {
    return "PREPARE_LISTING_PACKAGE";
  }
  return "RUN_POLICY_GATE";
}

function affectedArtifactsForPolicyArea(policyArea) {
  if (policyArea === "privacy_disclosure") {
    return [
      "41_product_brief.json",
      "42_implementation_plan.json",
      "72_policy_gate.json",
      "81_listing_package/review/policy_gate.json"
    ];
  }
  if (policyArea === "permissions_scope") {
    return [
      "42_implementation_plan.json",
      "50_build_report.json",
      "72_policy_gate.json",
      "81_listing_package/extension_package.zip"
    ];
  }
  if (policyArea === "listing_metadata" || policyArea === "store_listing_claims") {
    return [
      "71_listing_copy.json",
      "72_policy_gate.json",
      "80_publish_plan.json",
      "81_listing_package/listing_copy.json"
    ];
  }
  return [
    "72_policy_gate.json",
    "80_publish_plan.json",
    "81_listing_package.zip"
  ];
}

function requiredChangesForPolicyArea(policyArea, rejectionReason) {
  if (policyArea === "privacy_disclosure") {
    return [
      "Update the privacy disclosure so the stored profile behavior is explicit and reviewable.",
      "Re-run policy gate and listing package generation after the disclosure change.",
      "Capture fresh evidence that no hidden sync or server-side processing is performed."
    ];
  }
  if (policyArea === "permissions_scope") {
    return [
      "Reduce or justify every requested permission against the implementation plan.",
      "Regenerate the extension package and re-run QA plus policy gate.",
      "Prepare a new sandbox upload revision after the permission change."
    ];
  }
  if (policyArea === "listing_metadata" || policyArea === "store_listing_claims") {
    return [
      "Revise listing copy so claims exactly match implemented behavior.",
      "Regenerate listing assets and package metadata for review.",
      `Preserve the dashboard rejection text in the next repair note: ${rejectionReason}`
    ];
  }
  return [
    `Translate the dashboard rejection into concrete artifact changes: ${rejectionReason}`,
    "Re-run policy gate and prepare a fresh sandbox revision after the repair.",
    "Collect new human approvals after the repaired package hash changes."
  ];
}

export async function prepareInstallVerificationPlan({ runDir }) {
  const state = await loadSandboxPostReviewState(runDir);
  const itemId = state.runContext.item_id ?? state.runContext.publish?.sandbox_item_id ?? null;
  const publisherId = state.runContext.publisher_id ?? state.runContext.publish?.publisher_id ?? null;
  const manifestVersion = state.latestPublishExecution?.manifest_version
    ?? state.sandboxPlan.manifest_version
    ?? state.buildReport.manifest_version
    ?? null;
  const expectedCrxVersion = state.latestPublishExecution?.uploaded_crx_version
    ?? state.latestPublishExecution?.upload_response_crx_version
    ?? state.latestPublishExecution?.crx_version
    ?? manifestVersion;
  const effectiveReviewApproved = isApprovedReviewState(state.latestReviewStatus);
  const report = buildSafeReport({
    stage: "PREPARE_INSTALL_VERIFICATION",
    status: effectiveReviewApproved ? "active" : "skipped",
    reason: effectiveReviewApproved ? null : "review_not_approved_yet",
    run_id: state.runContext.run_id,
    item_id: itemId,
    publisher_id: publisherId,
    expected_version: manifestVersion,
    expected_crx_version: expectedCrxVersion,
    trusted_tester_required: true,
    install_url: installUrlForItem(itemId),
    verification_steps: installVerificationSteps({
      archetype: state.buildReport.archetype,
      expectedVersion: manifestVersion
    }),
    expected_happy_path: expectedHappyPath({
      archetype: state.buildReport.archetype,
      extensionName: state.brief.product_name_working ?? null
    }),
    screenshots_required: true,
    result_artifact_path: `state/run_events/${state.runContext.run_id}/93_manual_install_verification.json`,
    blockers: effectiveReviewApproved ? [] : ["review_not_approved_yet"],
    next_step: effectiveReviewApproved
      ? "trusted_tester_manual_install_verification_required"
      : state.latestReviewStatus?.next_step ?? "wait_for_review_or_manual_cancel"
  });

  await validateArtifact(
    state.runContext.project_root,
    "install_verification_plan.schema.json",
    INSTALL_VERIFICATION_PLAN_ARTIFACT,
    report
  );
  await writeManagedRunArtifact({
    runDir: state.runDir,
    artifactName: INSTALL_VERIFICATION_PLAN_ARTIFACT,
    data: report,
    runContext: state.runContext
  });
  await writeFinalPublishDecisionGate({
    state: {
      ...state,
      latestInstallVerificationPlan: report
    }
  });
  return report;
}

export async function prepareFinalPublishDecisionGate({ runDir }) {
  const state = await loadSandboxPostReviewState(runDir);
  return writeFinalPublishDecisionGate({ state });
}

export async function approveFinalPublish({
  runDir,
  note = "",
  approvedBy = os.userInfo().username
}) {
  const state = await loadSandboxPostReviewState(runDir);
  const gate = state.latestFinalPublishDecisionGate ?? await writeFinalPublishDecisionGate({ state });
  if (gate.is_staged !== true || gate.is_approved !== true) {
    throw new Error(`Run ${state.runContext.run_id} is not in an approved STAGED state for final publish approval.`);
  }
  if (gate.allowed_actions?.final_publish !== true) {
    throw new Error(`Final publish approval is blocked until these issues are resolved: ${(gate.blockers ?? []).join(", ") || "unknown_blocker"}`);
  }

  const approvedAt = nowIso();
  const packageSha256 = state.sandboxPlan.package_sha256
    ?? state.latestPublishExecution?.package_sha256
    ?? "";
  const manifestVersion = state.latestPublishExecution?.manifest_version
    ?? state.sandboxPlan.manifest_version
    ?? state.buildReport.manifest_version
    ?? null;
  const report = buildSafeReport({
    stage: "FINAL_PUBLISH_APPROVAL",
    status: "passed",
    run_id: state.runContext.run_id,
    approval_status: "approved",
    approved_by: approvedBy,
    approved_at: approvedAt,
    note: `${note ?? ""}`.trim(),
    approved_action: "final_publish",
    review_state: gate.review_state,
    package_sha256: packageSha256,
    manifest_version: manifestVersion,
    asset_package_status: gate.premium_package_status,
    human_visual_review_status: gate.human_visual_review_status,
    dashboard_listing_sync_status: gate.dashboard_listing_sync_status,
    risks_acknowledged: gate.blockers ?? [],
    expires_at: addHours(approvedAt, 24),
    next_step: "final_publish_approval_recorded_only_manual_publish_command_still_required"
  });

  await validateArtifact(
    state.runContext.project_root,
    "final_publish_approval.schema.json",
    FINAL_PUBLISH_APPROVAL_ARTIFACT,
    report
  );
  await writeManagedRunArtifact({
    runDir: state.runDir,
    artifactName: FINAL_PUBLISH_APPROVAL_ARTIFACT,
    data: report,
    runContext: state.runContext
  });
  return report;
}

export async function prepareReviewRepairPlan({ runDir, rejectionReason }) {
  const state = await loadSandboxPostReviewState(runDir);
  const reviewRejected = state.latestReviewStatus?.is_rejected === true;
  if (!reviewRejected) {
    throw new Error(`Run ${state.runContext.run_id} is not in a rejected review state.`);
  }

  const itemId = state.runContext.item_id ?? state.runContext.publish?.sandbox_item_id ?? null;
  const publisherId = state.runContext.publisher_id ?? state.runContext.publish?.publisher_id ?? null;
  const policyArea = inferPolicyArea(rejectionReason);
  const report = buildSafeReport({
    stage: "PREPARE_REVIEW_REPAIR",
    status: "active",
    run_id: state.runContext.run_id,
    item_id: itemId,
    publisher_id: publisherId,
    rejection_reason: `${rejectionReason ?? ""}`.trim(),
    suspected_policy_area: policyArea,
    affected_artifacts: affectedArtifactsForPolicyArea(policyArea),
    required_changes: requiredChangesForPolicyArea(policyArea, rejectionReason),
    repair_start_stage: repairStartStageForPolicyArea(policyArea),
    requires_new_version_bump: true,
    requires_new_upload_approval: true,
    requires_new_publish_approval: true,
    next_step: "repair_from_review_feedback_then_prepare_new_sandbox_revision"
  });

  await validateArtifact(
    state.runContext.project_root,
    "review_repair_plan.schema.json",
    REVIEW_REPAIR_PLAN_ARTIFACT,
    report
  );
  const artifactWrite = await writeManagedRunArtifact({
    runDir: state.runDir,
    artifactName: REVIEW_REPAIR_PLAN_ARTIFACT,
    data: report,
    runContext: state.runContext
  });

  await appendReleaseLedgerEvent(state.runContext.project_root, {
    runId: state.runContext.run_id,
    itemId,
    publisherId,
    packageSha256: state.sandboxPlan.package_sha256,
    manifestVersion: state.sandboxPlan.manifest_version,
    actionType: "review_repair_plan_created",
    actionSource: "cli",
    actionStatus: "passed",
    evidenceArtifacts: [artifactWrite.artifactRelativePath],
    responseSummary: {
      rejection_reason: report.rejection_reason,
      suspected_policy_area: report.suspected_policy_area,
      repair_start_stage: report.repair_start_stage
    },
    productionWrite: false,
    sandboxOnly: true
  });

  return report;
}
