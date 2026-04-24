import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { evaluatePrePublishAssetGate } from "../packaging/storeReleasePackage.mjs";
import { loadActiveReviewWatches } from "../publish/activeReviewWatches.mjs";
import { loadReleaseLedger } from "../publish/releaseLedger.mjs";
import {
  APPROVAL_MODE_TEST_ARTIFACT_ONLY,
  evaluateApprovalForAction,
  writeAuthorizationForApprovalArtifact
} from "../publish/humanApproval.mjs";
import { hasSecretLikeContent, inspectSecretLikeContent, redactSecretLikeValue } from "../utils/redaction.mjs";
import { assertMatchesSchema } from "../utils/schema.mjs";
import { compareChromeExtensionVersions } from "../utils/chromeVersion.mjs";
import { fileExists, listFiles, nowIso, readJson } from "../utils/io.mjs";
import { loadManagedRunArtifact, writeManagedRunArtifact } from "./runEventArtifacts.mjs";
import { isRunImmutable } from "./runLock.mjs";

export const SANDBOX_PREFLIGHT_ARTIFACT = "84_sandbox_preflight.json";
export const PUBLISH_SANDBOX_CI_DRY_CHECK_ARTIFACT = "85_publish_sandbox_ci_dry_check.json";

function artifactPath(runDir, fileName) {
  return path.join(runDir, fileName);
}

function round(value) {
  return Math.round(value * 100) / 100;
}

async function readOptionalJson(filePath) {
  if (!(await fileExists(filePath))) {
    return null;
  }
  return readJson(filePath);
}

function normalizeSuccessfulUploadExecutionEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return entry;
  }
  const uploadResponseCrxVersion = entry.upload_response_crx_version
    ?? entry.upload_response_summary?.crxVersion
    ?? entry.upload_response_summary?.crx_version
    ?? entry.upload_response?.body?.crxVersion
    ?? entry.upload_response?.body?.crx_version
    ?? null;
  const currentSandboxItemVersion = entry.current_sandbox_item_version
    ?? entry.pre_upload_checks?.remote_crx_version
    ?? null;
  const uploadedCrxVersion = entry.upload_state === "SUCCEEDED" && uploadResponseCrxVersion
    ? uploadResponseCrxVersion
    : entry.uploaded_crx_version
      ?? entry.crx_version
      ?? uploadResponseCrxVersion;
  const versionConsistencyCheck = entry.version_consistency_check ?? {
    performed: Boolean(uploadResponseCrxVersion) || entry.upload_state === "SUCCEEDED",
    upload_state: entry.upload_state ?? null,
    manifest_version: entry.manifest_version ?? null,
    upload_response_crx_version: uploadResponseCrxVersion,
    passed: !(
      entry.upload_state === "SUCCEEDED"
      && uploadResponseCrxVersion
      && entry.manifest_version
      && uploadResponseCrxVersion !== entry.manifest_version
    ),
    failure_reason: entry.upload_state === "SUCCEEDED"
      && uploadResponseCrxVersion
      && entry.manifest_version
      && uploadResponseCrxVersion !== entry.manifest_version
      ? "upload_response_crx_version_mismatch"
      : null
  };
  return {
    ...entry,
    current_sandbox_item_version: currentSandboxItemVersion,
    upload_response_crx_version: uploadResponseCrxVersion,
    uploaded_crx_version: uploadedCrxVersion,
    crx_version: uploadedCrxVersion ?? entry.crx_version ?? null,
    version_consistency_check: versionConsistencyCheck
  };
}

async function loadPublishExecutionHistory(projectRoot, runId) {
  const historyDir = path.join(projectRoot, "state", "run_events", runId, "publish_execution");
  if (!(await fileExists(historyDir))) {
    return [];
  }

  const files = (await listFiles(historyDir))
    .map((entry) => entry.absolutePath)
    .filter((absolutePath) => absolutePath.endsWith(".json"))
    .sort();

  const history = [];
  for (const filePath of files) {
    history.push(normalizeSuccessfulUploadExecutionEntry(await readJson(filePath)));
  }
  return history;
}

async function loadManagedArtifactFromRunPath(runPath, artifactName) {
  if (!runPath) {
    return null;
  }
  const absoluteRunPath = path.resolve(runPath);
  const runContextPath = artifactPath(absoluteRunPath, "00_run_context.json");
  if (!(await fileExists(runContextPath))) {
    return null;
  }
  const runContext = await readJson(runContextPath);
  return (await loadManagedRunArtifact({
    runDir: absoluteRunPath,
    artifactName,
    runContext
  }))?.data ?? null;
}

function buildSafeReport(reportWithoutChecks) {
  const initialChecks = inspectSecretLikeContent(reportWithoutChecks);
  const redactionGuardTriggered = hasSecretLikeContent(initialChecks);
  const safeReport = redactSecretLikeValue(reportWithoutChecks);

  if (redactionGuardTriggered) {
    safeReport.status = "failed";
    safeReport.blockers = [...(safeReport.blockers ?? []), "redaction_guard_triggered"];
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

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function hashFile(filePath) {
  return sha256Buffer(await fs.readFile(filePath));
}

async function readStoredZipEntries(zipPath) {
  const archive = await fs.readFile(zipPath);
  const entries = [];
  let offset = 0;

  while (offset + 30 <= archive.length) {
    const signature = archive.readUInt32LE(offset);
    if (signature !== 0x04034b50) {
      break;
    }
    const compressionMethod = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const fileNameLength = archive.readUInt16LE(offset + 26);
    const extraFieldLength = archive.readUInt16LE(offset + 28);
    const fileNameStart = offset + 30;
    const fileNameEnd = fileNameStart + fileNameLength;
    const fileName = archive.slice(fileNameStart, fileNameEnd).toString("utf8");
    const dataStart = fileNameEnd + extraFieldLength;
    const dataEnd = dataStart + compressedSize;
    entries.push({
      name: fileName,
      compression_method: compressionMethod,
      data: archive.slice(dataStart, dataEnd)
    });
    offset = dataEnd;
  }

  return entries;
}

async function readManifestVersionFromZip(zipPath) {
  const entries = await readStoredZipEntries(zipPath);
  const manifestEntry = entries.find((entry) => entry.name === "manifest.json");
  if (!manifestEntry || manifestEntry.compression_method !== 0) {
    return null;
  }
  const manifest = JSON.parse(manifestEntry.data.toString("utf8"));
  return `${manifest.version ?? ""}` || null;
}

function findNestedFieldValue(value, candidateKeys) {
  if (!value || typeof value !== "object") {
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findNestedFieldValue(item, candidateKeys);
      if (nested !== null && nested !== undefined) {
        return nested;
      }
    }
    return null;
  }
  for (const [key, nestedValue] of Object.entries(value)) {
    if (candidateKeys.has(key) && nestedValue !== null && nestedValue !== undefined) {
      return nestedValue;
    }
  }
  for (const nestedValue of Object.values(value)) {
    const nested = findNestedFieldValue(nestedValue, candidateKeys);
    if (nested !== null && nested !== undefined) {
      return nested;
    }
  }
  return null;
}

function pickRevisionState(responseBody, keys) {
  const revision = findNestedFieldValue(responseBody, new Set(keys));
  if (revision && typeof revision === "object" && !Array.isArray(revision)) {
    const state = findNestedFieldValue(revision, new Set(["state", "status", "reviewState", "review_state"]));
    return state === null || state === undefined ? null : `${state}`;
  }
  return revision === null || revision === undefined ? null : `${revision}`;
}

function deriveCurrentDashboardState({ submittedRevisionStatus, publishedRevisionStatus }) {
  const published = `${publishedRevisionStatus ?? ""}`.trim().toUpperCase();
  const submitted = `${submittedRevisionStatus ?? ""}`.trim().toUpperCase();

  if (published) return published;
  if (submitted === "PENDING_REVIEW") return "PENDING_REVIEW";
  if (submitted === "CANCELLED") return "DRAFT";
  if (submitted) return submitted;
  return "UNKNOWN";
}

function normalizeSandboxAction(action) {
  const value = `${action ?? ""}`.trim();
  if (value === "sandbox_upload" || value === "upload_only") {
    return "sandbox_upload";
  }
  if (value === "sandbox_publish" || value === "sandbox_publish_optional" || value === "publish_optional") {
    return "sandbox_publish";
  }
  if (value === "fetch_status_only") {
    return "fetch_status_only";
  }
  throw new Error(`Unsupported sandbox action: ${action}`);
}

function nextStepForWriteAuthorization(isWriteAuthorized, action) {
  if (isWriteAuthorized) {
    return action === "sandbox_publish"
      ? "write_authorized_for_sandbox_publish"
      : "write_authorized_for_sandbox_upload";
  }
  return "write_approval_required_before_sandbox_upload";
}

function extractCurrentSandboxItemVersion({ latestPublishExecution, plan }) {
  const explicit = latestPublishExecution?.current_sandbox_item_version ?? null;
  if (explicit) {
    return `${explicit}`;
  }
  const remoteFromChecks = latestPublishExecution?.pre_upload_checks?.remote_crx_version ?? null;
  if (remoteFromChecks) {
    return `${remoteFromChecks}`;
  }
  const remoteFromFetch = findNestedFieldValue(
    latestPublishExecution?.fetch_status_response?.body ?? null,
    new Set(["crxVersion", "crx_version"])
  );
  if (remoteFromFetch !== null && remoteFromFetch !== undefined) {
    return `${remoteFromFetch}`;
  }
  return plan?.current_sandbox_item_version ?? null;
}

function computeVersionUploadable(manifestVersion, currentSandboxItemVersion) {
  if (!manifestVersion || !currentSandboxItemVersion) {
    return true;
  }
  return compareChromeExtensionVersions(manifestVersion, currentSandboxItemVersion) > 0;
}

function deriveUploadBlocker({
  versionUploadable,
  latestApproval,
  approvalMatchesCurrentPackage,
  approvalWriteAuthorized,
  prePublishAssetGate = null
}) {
  if (prePublishAssetGate?.blockers?.length) {
    return prePublishAssetGate.blockers[0];
  }
  if (!versionUploadable) {
    return "same_or_lower_manifest_version";
  }
  if (!latestApproval) {
    return "write_approval_required";
  }
  if (!approvalMatchesCurrentPackage) {
    return "approval_package_hash_mismatch";
  }
  if (!approvalWriteAuthorized) {
    return "write_approval_required";
  }
  return null;
}

function nextStepForSandboxState({
  versionUploadable,
  uploadAllowed,
  revisionKind = false,
  preflightView = false
}) {
  if (!versionUploadable) {
    return "prepare_upload_revision_required";
  }
  if (uploadAllowed) {
    return "sandbox_upload_only_allowed";
  }
  if (preflightView) {
    return "write_approval_required_before_sandbox_upload";
  }
  return revisionKind
    ? "write_approval_required_for_bumped_package"
    : "write_approval_required_before_sandbox_upload";
}

function latestRevisionRunIdForState(allLedgerEntries, runId, revisionKind) {
  if (revisionKind) {
    return runId;
  }
  const latestRevision = allLedgerEntries
    .filter((entry) =>
      ["sandbox_prepare_upload_revision", "sandbox_prepare_product_revision", "sandbox_prepare_commercial_release_revision"].includes(entry.action_type)
      && entry.source_sandbox_run_id === runId
    )
    .at(-1);
  return latestRevision?.new_sandbox_run_id ?? null;
}

function isSandboxUploadRevision(runContext, plan) {
  return runContext.revision_kind === "sandbox_upload_revision" || plan.stage === "SANDBOX_UPLOAD_REVISION";
}

function isSandboxProductRevision(runContext, plan) {
  return runContext.revision_kind === "product_revision" || plan.stage === "PRODUCT_REVISION_SANDBOX_VALIDATION";
}

function isSandboxCommercialReleaseRevision(runContext, plan) {
  return runContext.revision_kind === "commercial_release_revision" || plan.stage === "COMMERCIAL_RELEASE_SANDBOX_VALIDATION";
}

async function loadSandboxValidationState(runDir) {
  const absoluteRunDir = path.resolve(runDir);
  const runContext = await readJson(artifactPath(absoluteRunDir, "00_run_context.json"));
  if ((runContext.run_type ?? runContext.task_mode) !== "sandbox_validation") {
    throw new Error(`Run ${runContext.run_id} is not a sandbox_validation run.`);
  }

  const plan = await readJson(artifactPath(absoluteRunDir, "83_sandbox_validation_plan.json"));
  const browserSmoke = await readJson(artifactPath(absoluteRunDir, "61_browser_smoke.json"));
  const screenshotManifest = await readJson(artifactPath(absoluteRunDir, "70_screenshot_manifest.json"));
  const policyGate = await readJson(artifactPath(absoluteRunDir, "72_policy_gate.json"));
  const listingPackageReport = await readJson(artifactPath(absoluteRunDir, "81_listing_package_report.json"));
  const revisionArtifact = await readOptionalJson(artifactPath(absoluteRunDir, "86_sandbox_upload_revision.json"));
  const latestApproval = (await loadManagedRunArtifact({
    runDir: absoluteRunDir,
    artifactName: "82_human_approval.json",
    runContext
  }))?.data ?? null;
  const latestPreflight = (await loadManagedRunArtifact({
    runDir: absoluteRunDir,
    artifactName: SANDBOX_PREFLIGHT_ARTIFACT,
    runContext
  }))?.data ?? null;
  const latestPublishExecution = (await loadManagedRunArtifact({
    runDir: absoluteRunDir,
    artifactName: "90_publish_execution.json",
    runContext
  }))?.data ?? null;
  const latestReviewStatus = (await loadManagedRunArtifact({
    runDir: absoluteRunDir,
    artifactName: "91_review_status.json",
    runContext
  }))?.data ?? null;
  const latestFunctionalTestMatrix = (await loadManagedRunArtifact({
    runDir: absoluteRunDir,
    artifactName: "62_functional_test_matrix.json",
    runContext
  }))?.data ?? null;
  const latestProductAcceptanceReview = (await loadManagedRunArtifact({
    runDir: absoluteRunDir,
    artifactName: "94_product_acceptance_review.json",
    runContext
  }))?.data ?? null;
  const latestHumanProductReview = (await loadManagedRunArtifact({
    runDir: absoluteRunDir,
    artifactName: "94_human_product_review.json",
    runContext
  }))?.data ?? null;
  const latestInstallVerificationPlan = (await loadManagedRunArtifact({
    runDir: absoluteRunDir,
    artifactName: "92_install_verification_plan.json",
    runContext
  }))?.data ?? null;
  const latestReviewRepairPlan = (await loadManagedRunArtifact({
    runDir: absoluteRunDir,
    artifactName: "92_review_repair_plan.json",
    runContext
  }))?.data ?? null;
  const latestListingQualityGate = (await loadManagedRunArtifact({
    runDir: absoluteRunDir,
    artifactName: "115_listing_quality_gate.json",
    runContext
  }))?.data ?? null;
  const latestAssetQualityReport = (await loadManagedRunArtifact({
    runDir: absoluteRunDir,
    artifactName: "118_asset_quality_report.json",
    runContext
  }))?.data ?? null;
  const latestStoreReleasePackage = (await loadManagedRunArtifact({
    runDir: absoluteRunDir,
    artifactName: "120_store_listing_release_package_report.json",
    runContext
  }))?.data ?? null;
  const latestHumanVisualReview = (await loadManagedRunArtifact({
    runDir: absoluteRunDir,
    artifactName: "121_human_visual_review.json",
    runContext
  }))?.data ?? null;
  const latestFinalPublishDecisionGate = (await loadManagedRunArtifact({
    runDir: absoluteRunDir,
    artifactName: "125_final_publish_decision_gate.json",
    runContext
  }))?.data ?? null;
  const latestCiDryCheck = (await loadManagedRunArtifact({
    runDir: absoluteRunDir,
    artifactName: PUBLISH_SANDBOX_CI_DRY_CHECK_ARTIFACT,
    runContext
  }))?.data ?? null;
  const publishExecutionHistory = await loadPublishExecutionHistory(runContext.project_root, runContext.run_id);
  const latestSuccessfulUploadExecution = publishExecutionHistory
    .filter((entry) => entry.publish_validation_phase === "upload_only")
    .filter((entry) => entry.upload_request_attempted === true || entry.sandbox_upload_verified === true)
    .at(-1) ?? null;
  const ledger = await loadReleaseLedger(runContext.project_root);
  const allLedgerEntries = ledger.entries ?? [];
  const ledgerEntries = ledger.entries.filter((entry) => entry.run_id === runContext.run_id || entry.sandbox_run_id === runContext.run_id);
  const listingPackageZipPath = artifactPath(absoluteRunDir, "81_listing_package.zip");
  const extensionPackageZipPath = artifactPath(absoluteRunDir, "81_listing_package/extension_package.zip");
  const immutable = await isRunImmutable(absoluteRunDir);
  const packageSha256 = await hashFile(extensionPackageZipPath);
  const manifestVersion = await readManifestVersionFromZip(extensionPackageZipPath);
  const promoteEntry = ledgerEntries.find((entry) => entry.action_type === "promote_to_sandbox_validation") ?? null;
  const activeReviewRegistry = await loadActiveReviewWatches(runContext.project_root);
  const activeReviewWatch = (activeReviewRegistry.watches ?? []).find((watch) => watch.run_id === runContext.run_id) ?? null;
  const sourceDailyDiscoveryQualityReview = await loadManagedArtifactFromRunPath(
    runContext.source_daily_run_path ?? null,
    "33_discovery_quality_review.json"
  );

  return {
    runDir: absoluteRunDir,
    runContext,
    plan,
    revisionArtifact,
    browserSmoke,
    screenshotManifest,
    policyGate,
    listingPackageReport,
    listingPackageZipPath,
    extensionPackageZipPath,
    immutable,
    latestApproval,
    latestPreflight,
    latestPublishExecution,
    latestReviewStatus,
    latestFunctionalTestMatrix,
    latestProductAcceptanceReview,
    latestHumanProductReview,
    latestInstallVerificationPlan,
    latestReviewRepairPlan,
    latestListingQualityGate,
    latestAssetQualityReport,
    latestStoreReleasePackage,
    latestHumanVisualReview,
    latestFinalPublishDecisionGate,
    latestCiDryCheck,
    activeReviewWatch,
    publishExecutionHistory,
    latestSuccessfulUploadExecution,
    allLedgerEntries,
    ledgerEntries,
    promoteEntry,
    sourceDailyDiscoveryQualityReview,
    packageSha256,
    manifestVersion
  };
}

function summarizeFetchStatus(latestPublishExecution, latestSuccessfulUploadExecution = null) {
  if (!latestPublishExecution && !latestSuccessfulUploadExecution) {
    return {
      latest_fetch_status: "not_started",
      current_dashboard_state: null,
      submitted_revision_status: null,
      published_revision_status: null,
      latest_upload_status: null,
      http_status: null
    };
  }
  const primaryExecution = latestPublishExecution ?? latestSuccessfulUploadExecution;
  const body = primaryExecution?.fetch_status_response?.body ?? null;
  const submittedRevisionStatus = primaryExecution?.submitted_revision_status
    ?? pickRevisionState(body, ["submittedItemRevisionStatus", "submittedRevisionStatus", "submitted_revision_status"]);
  const publishedRevisionStatus = primaryExecution?.published_revision_status
    ?? pickRevisionState(body, ["publishedItemRevisionStatus", "publishedRevisionStatus", "published_revision_status"]);
  const currentDashboardState = primaryExecution?.current_dashboard_state
    ?? deriveCurrentDashboardState({ submittedRevisionStatus, publishedRevisionStatus });
  const nestedUploadStatus = findNestedFieldValue(
    body,
    new Set(["uploadState", "upload_state", "latestUploadStatus", "latest_upload_status"])
  );
  const primaryUploadStatus = primaryExecution?.latest_upload_status
    ?? primaryExecution?.upload_state
    ?? (nestedUploadStatus === null || nestedUploadStatus === undefined ? null : `${nestedUploadStatus}`);
  const fallbackUploadStatus = latestSuccessfulUploadExecution?.latest_upload_status
    ?? latestSuccessfulUploadExecution?.upload_state
    ?? null;
  const latestUploadStatus = primaryUploadStatus && primaryUploadStatus !== "not_attempted"
    ? primaryUploadStatus
    : fallbackUploadStatus;
  return {
    latest_fetch_status: primaryExecution?.sandbox_fetch_status_verified ? "passed" : primaryExecution?.status ?? "failed",
    current_dashboard_state: currentDashboardState,
    submitted_revision_status: submittedRevisionStatus,
    published_revision_status: publishedRevisionStatus,
    latest_upload_status: latestUploadStatus,
    http_status: primaryExecution?.fetch_status_response?.http_status ?? primaryExecution?.fetch_status_response?.status_code ?? null
  };
}

function summarizePublishStatus(latestPublishExecution) {
  if (!latestPublishExecution) {
    return "not_started";
  }
  if (latestPublishExecution.publish_response?.executed === true) {
    return latestPublishExecution.publish_response?.body?.state
      ?? latestPublishExecution.publish_response?.status
      ?? latestPublishExecution.status
      ?? "unknown";
  }
  if (latestPublishExecution.publish_validation_phase === "upload_only" || latestPublishExecution.publish_validation_phase === "fetch_status_only") {
    return "not_attempted";
  }
  if (latestPublishExecution.publish_response?.skipped === true) {
    return "not_attempted";
  }
  return latestPublishExecution.status ?? "not_started";
}

export async function runSandboxPreflight({ runDir }) {
  const state = await loadSandboxValidationState(runDir);
  const blockers = [];
  const uploadRevisionKind = isSandboxUploadRevision(state.runContext, state.plan);
  const productRevisionKind = isSandboxProductRevision(state.runContext, state.plan);
  const commercialRevisionKind = isSandboxCommercialReleaseRevision(state.runContext, state.plan);
  const revisionKind = uploadRevisionKind || productRevisionKind || commercialRevisionKind;
  const lineageLedgerEntry = uploadRevisionKind
    ? state.allLedgerEntries.find((entry) => entry.action_type === "sandbox_prepare_upload_revision" && entry.run_id === state.runContext.run_id)
    : productRevisionKind
      ? state.allLedgerEntries.find((entry) => entry.action_type === "sandbox_prepare_product_revision" && entry.run_id === state.runContext.run_id)
      : commercialRevisionKind
        ? state.allLedgerEntries.find((entry) => entry.action_type === "sandbox_prepare_commercial_release_revision" && entry.run_id === state.runContext.run_id)
      : state.promoteEntry;
  const promotionPlanVerified = state.plan.status === "passed" && Boolean(lineageLedgerEntry);
  const listingPackageVerified = (await fileExists(state.listingPackageZipPath)) && state.listingPackageReport.status === "passed";
  const packageHashMatchesPlan = state.packageSha256 === state.plan.package_sha256;
  const manifestVersionMatchesPlan = Boolean(state.manifestVersion) && state.manifestVersion === state.plan.manifest_version;
  const browserSmokeVerified = state.browserSmoke.status === "passed";
  const screenshotManifestVerified = state.screenshotManifest.status === "passed";
  const policyGateVerified = ["passed", "conditional_pass"].includes(`${state.policyGate.status ?? ""}`);
  const targetItemId = state.runContext.item_id ?? state.runContext.publish?.sandbox_item_id ?? null;
  const targetPublisherId = state.runContext.publisher_id ?? state.runContext.publish?.publisher_id ?? null;
  const currentSandboxItemVersion = extractCurrentSandboxItemVersion({
    latestPublishExecution: state.latestPublishExecution,
    plan: state.plan
  });
  const uploadApprovalCheck = state.latestApproval
    ? evaluateApprovalForAction({
        approvalArtifact: state.latestApproval,
        requestedAction: "sandbox_upload",
        expectedScope: "sandbox",
        itemId: targetItemId,
        publisherId: targetPublisherId,
        packageSha256: state.packageSha256,
        manifestVersion: state.manifestVersion,
        requireWriteAllowed: true
      })
    : { approved: false };
  const publishApprovalCheck = state.latestApproval
    ? evaluateApprovalForAction({
        approvalArtifact: state.latestApproval,
        requestedAction: "sandbox_publish",
        expectedScope: "sandbox",
        itemId: targetItemId,
        publisherId: targetPublisherId,
        packageSha256: state.packageSha256,
        manifestVersion: state.manifestVersion,
        requireWriteAllowed: true
      })
    : { approved: false };
  const writeApprovalPresent = state.latestApproval?.approval_mode === "write_allowed";
  const writeApprovalValid = writeApprovalPresent && writeAuthorizationForApprovalArtifact(state.latestApproval);
  const latestApprovalPackageSha256 = state.latestApproval?.package_sha256 ?? null;
  const approvalMatchesCurrentPackage = Boolean(
    latestApprovalPackageSha256
    && latestApprovalPackageSha256 === state.packageSha256
  );

  if (!promotionPlanVerified) blockers.push("promotion_plan_missing_or_not_in_ledger");
  if (!state.immutable) blockers.push("immutable_run_not_verified");
  if (!listingPackageVerified) blockers.push("listing_package_not_verified");
  if (!packageHashMatchesPlan) blockers.push("package_sha256_mismatch");
  if (!manifestVersionMatchesPlan) blockers.push("manifest_version_missing_or_mismatch");
  if (!browserSmokeVerified) blockers.push("browser_smoke_not_verified");
  if (!screenshotManifestVerified) blockers.push("screenshot_manifest_not_verified");
  if (!policyGateVerified) blockers.push("policy_gate_not_verified");
  const prePublishAssetGate = evaluatePrePublishAssetGate({
    listingQualityGate: state.latestListingQualityGate,
    assetQualityReport: state.latestAssetQualityReport,
    storeReleasePackageReport: state.latestStoreReleasePackage,
    humanVisualReview: state.latestHumanVisualReview
  });
  blockers.push(...prePublishAssetGate.blockers);
  const versionUploadable = computeVersionUploadable(state.manifestVersion, currentSandboxItemVersion);
  if (!versionUploadable) {
    blockers.push("same_or_lower_manifest_version");
  }
  const uploadAllowed = blockers.length === 0 && uploadApprovalCheck.approved;
  const publishAllowed = blockers.length === 0 && publishApprovalCheck.approved;
  const productAcceptanceStatus = state.latestProductAcceptanceReview?.acceptance_status ?? "not_started";
  const functionalTestCoverageScore = state.latestFunctionalTestMatrix?.test_coverage_score ?? null;
  const latestUploadBlocker = deriveUploadBlocker({
    versionUploadable,
    latestApproval: state.latestApproval,
    approvalMatchesCurrentPackage,
    approvalWriteAuthorized: uploadApprovalCheck.details?.approval_write_authorized === true,
    prePublishAssetGate
  });
  const status = blockers.some((blocker) => blocker !== "same_or_lower_manifest_version")
    ? "failed"
    : !versionUploadable
      ? "blocked"
      : uploadAllowed
        ? "passed"
        : "passed_read_only";

  const report = buildSafeReport({
    stage: "SANDBOX_PREFLIGHT",
    status,
    run_id: state.runContext.run_id,
    run_type: state.runContext.run_type ?? state.runContext.task_mode,
    source_run_id: state.runContext.source_run_id ?? null,
    item_id: state.runContext.item_id ?? state.runContext.publish?.sandbox_item_id ?? null,
    publisher_id: state.runContext.publisher_id ?? state.runContext.publish?.publisher_id ?? null,
    package_sha256: state.packageSha256,
    manifest_version: state.manifestVersion,
    current_sandbox_item_version: currentSandboxItemVersion,
    version_uploadable: versionUploadable,
    immutable_run_verified: state.immutable,
    promotion_plan_verified: promotionPlanVerified,
    listing_package_verified: listingPackageVerified && packageHashMatchesPlan,
    browser_smoke_verified: browserSmokeVerified,
    screenshot_manifest_verified: screenshotManifestVerified,
    policy_gate_verified: policyGateVerified,
    listing_quality_gate_passed: prePublishAssetGate.listing_quality_passed,
    asset_qa_passed: prePublishAssetGate.asset_qa_passed,
    store_release_package_passed: prePublishAssetGate.store_release_package_passed,
    premium_feel_score: prePublishAssetGate.premium_feel_score,
    human_visual_review_passed: prePublishAssetGate.human_visual_review_passed,
    paid_disclosure_passed: prePublishAssetGate.paid_disclosure_passed,
    pre_publish_asset_gate: prePublishAssetGate,
    product_acceptance_status: productAcceptanceStatus,
    functional_test_coverage_score: functionalTestCoverageScore,
    write_approval_present: writeApprovalPresent,
    write_approval_valid: writeApprovalValid,
    latest_approval_package_sha256: latestApprovalPackageSha256,
    current_package_sha256: state.packageSha256,
    approval_matches_current_package: approvalMatchesCurrentPackage,
    latest_upload_blocker: latestUploadBlocker,
    upload_allowed: uploadAllowed,
    publish_allowed: publishAllowed,
    next_step: blockers.includes("store_listing_release_package_missing")
      ? "run_packaging_store_release_package_before_any_upload_or_publish"
      : blockers.includes("human_visual_review_required_before_publish")
        || blockers.includes("human_visual_review_not_passed")
        || blockers.includes("blocked_by_human_visual_review")
        ? "complete_human_visual_review_before_any_upload_or_publish"
        : blockers.includes("premium_feel_score_below_85")
          || blockers.includes("listing_quality_gate_not_passed")
          || blockers.includes("asset_quality_report_not_passed")
          ? "resolve_premium_asset_gate_before_any_upload_or_publish"
          : nextStepForSandboxState({
              versionUploadable,
              uploadAllowed,
              revisionKind,
              preflightView: true
            }),
    blockers
  });

  await validateArtifact(state.runContext.project_root, "sandbox_preflight.schema.json", SANDBOX_PREFLIGHT_ARTIFACT, report);
  await writeManagedRunArtifact({
    runDir: state.runDir,
    artifactName: SANDBOX_PREFLIGHT_ARTIFACT,
    data: report,
    runContext: state.runContext
  });
  return report;
}

export async function runPublishSandboxCiDryCheck({ runDir, action }) {
  const normalizedAction = normalizeSandboxAction(action);
  const state = await loadSandboxValidationState(runDir);
  const preflight = await runSandboxPreflight({ runDir: state.runDir });
  const fetchSummary = summarizeFetchStatus(
    state.latestPublishExecution,
    state.latestSuccessfulUploadExecution
  );
  const packageHashMatch = state.packageSha256 === state.plan.package_sha256;
  const sandboxItemMatch = (state.runContext.item_id ?? state.runContext.publish?.sandbox_item_id ?? null) === (state.runContext.publish?.sandbox_item_id ?? null);
  const uploadVerified = state.latestSuccessfulUploadExecution?.sandbox_upload_verified === true
    && state.latestSuccessfulUploadExecution?.upload_state === "SUCCEEDED"
    && (state.latestSuccessfulUploadExecution?.uploaded_crx_version
      ?? state.latestSuccessfulUploadExecution?.crx_version
      ?? state.latestSuccessfulUploadExecution?.upload_response_crx_version
      ?? state.latestSuccessfulUploadExecution?.upload_response_summary?.crxVersion
      ?? null) === state.manifestVersion;
  const productAcceptanceStatus = state.latestProductAcceptanceReview?.acceptance_status ?? null;
  const functionalTestCoverageScore = state.latestFunctionalTestMatrix?.test_coverage_score ?? null;
  const productAcceptancePassed = productAcceptanceStatus === "passed";
  const functionalTestCoverageComplete = functionalTestCoverageScore === 100;
  const prePublishStatusObserved = normalizedAction !== "sandbox_publish"
    || state.latestPublishExecution?.sandbox_fetch_status_verified === true;
  const prePublishStateClear = normalizedAction !== "sandbox_publish"
    || (
      prePublishStatusObserved
      && `${fetchSummary.submitted_revision_status ?? fetchSummary.current_dashboard_state ?? ""}`.trim().toUpperCase() !== "PENDING_REVIEW"
    );
  const publishReadiness = preflight.promotion_plan_verified
    && preflight.immutable_run_verified === true
    && preflight.listing_package_verified === true
    && preflight.browser_smoke_verified === true
    && preflight.screenshot_manifest_verified === true
    && preflight.policy_gate_verified === true
    && preflight.listing_quality_gate_passed === true
    && preflight.asset_qa_passed === true
    && preflight.store_release_package_passed === true
    && preflight.human_visual_review_passed === true
    && preflight.paid_disclosure_passed === true
    && Number(preflight.premium_feel_score ?? 0) >= 85
    && preflight.version_uploadable === true;
  const expectedApprovalAction = normalizedAction === "sandbox_publish" ? "sandbox_publish" : "sandbox_upload";
  const approvalCheck = normalizedAction === "fetch_status_only"
    ? {
        approved: true,
        reason: null,
        details: {
          approval_found: Boolean(state.latestApproval),
          approval_mode: state.latestApproval?.approval_mode ?? APPROVAL_MODE_TEST_ARTIFACT_ONLY,
          approval_write_authorized: false,
          blocked_reason: null
        }
      }
    : evaluateApprovalForAction({
        approvalArtifact: state.latestApproval,
        requestedAction: expectedApprovalAction,
        expectedScope: "sandbox",
        itemId: state.runContext.item_id ?? state.runContext.publish?.sandbox_item_id ?? null,
        publisherId: state.runContext.publisher_id ?? state.runContext.publish?.publisher_id ?? null,
        packageSha256: state.packageSha256,
        manifestVersion: state.manifestVersion,
        requireWriteAllowed: true
      });
  const approvalFound = Boolean(state.latestApproval);
  const approvalMode = state.latestApproval?.approval_mode ?? APPROVAL_MODE_TEST_ARTIFACT_ONLY;
  const approvalWriteAuthorized = approvalCheck.details?.approval_write_authorized === true;
  const publishAllowed = normalizedAction === "sandbox_publish"
    ? publishReadiness
      && uploadVerified
      && productAcceptancePassed
      && functionalTestCoverageComplete
      && prePublishStatusObserved
      && prePublishStateClear
      && approvalCheck.approved
      && packageHashMatch
      && sandboxItemMatch
    : false;
  const wouldExecute = normalizedAction === "sandbox_publish"
    ? publishAllowed
    : preflight.status === "passed"
    && normalizedAction !== "fetch_status_only"
    && approvalCheck.approved
    && packageHashMatch
    && sandboxItemMatch;

  const blockedReason = normalizedAction === "fetch_status_only"
    ? "read_only_action"
    : normalizedAction === "sandbox_publish" && !prePublishStatusObserved
      ? "pre_publish_fetch_status_required"
    : normalizedAction === "sandbox_publish" && !prePublishStateClear
      ? "previous_submission_still_pending"
    : normalizedAction === "sandbox_publish" && !productAcceptancePassed
      ? "product_acceptance_not_passed"
    : normalizedAction === "sandbox_publish" && !functionalTestCoverageComplete
      ? "functional_test_coverage_incomplete"
    : normalizedAction === "sandbox_publish" && !uploadVerified
      ? "upload_not_verified"
    : normalizedAction === "sandbox_publish" && !publishReadiness
      ? "sandbox_preflight_failed"
    : wouldExecute
      ? null
      : approvalCheck.details?.blocked_reason
        ?? (preflight.status !== "passed" ? preflight.latest_upload_blocker ?? "sandbox_preflight_failed" : "write_approval_required");

  const report = buildSafeReport({
    stage: "PUBLISH_SANDBOX_CI_DRY_CHECK",
    status: "passed",
    run_id: state.runContext.run_id,
    action: normalizedAction,
    requested_action: normalizedAction === "fetch_status_only" ? null : expectedApprovalAction,
    run_type_verified: (state.runContext.run_type ?? state.runContext.task_mode) === "sandbox_validation",
    promotion_plan_verified: preflight.promotion_plan_verified,
    approval_found: approvalFound,
    approval_mode: approvalMode,
    approval_write_authorized: approvalWriteAuthorized,
    package_hash_match: packageHashMatch,
    sandbox_item_match: sandboxItemMatch,
    upload_verified: uploadVerified,
    manifest_version: state.manifestVersion,
    uploaded_crx_version: state.latestSuccessfulUploadExecution?.uploaded_crx_version
      ?? state.latestSuccessfulUploadExecution?.crx_version
      ?? state.latestSuccessfulUploadExecution?.upload_response_crx_version
      ?? state.latestSuccessfulUploadExecution?.upload_response_summary?.crxVersion
      ?? null,
    product_acceptance_status: productAcceptanceStatus,
    functional_test_coverage_score: functionalTestCoverageScore,
    current_dashboard_state: fetchSummary.current_dashboard_state,
    submitted_revision_status: fetchSummary.submitted_revision_status,
    pre_publish_status_observed: prePublishStatusObserved,
    pre_publish_state_clear: prePublishStateClear,
    publish_allowed: publishAllowed,
    production_write: false,
    would_execute: wouldExecute,
    blocked_reason: blockedReason,
    next_step: wouldExecute
      ? nextStepForWriteAuthorization(true, normalizedAction)
      : normalizedAction === "fetch_status_only"
        ? "use_publish_sandbox_fetch_status_for_read_only_validation"
        : preflight.next_step
  });

  await validateArtifact(state.runContext.project_root, "publish_sandbox_ci_dry_check.schema.json", PUBLISH_SANDBOX_CI_DRY_CHECK_ARTIFACT, report);
  await writeManagedRunArtifact({
    runDir: state.runDir,
    artifactName: PUBLISH_SANDBOX_CI_DRY_CHECK_ARTIFACT,
    data: report,
    runContext: state.runContext
  });
  return report;
}

export async function inspectSandboxValidationState({ runDir }) {
  const state = await loadSandboxValidationState(runDir);
  const fetchSummary = summarizeFetchStatus(
    state.latestPublishExecution,
    state.latestSuccessfulUploadExecution
  );
  const currentSandboxItemVersion = state.latestSuccessfulUploadExecution?.current_sandbox_item_version
    ?? extractCurrentSandboxItemVersion({
      latestPublishExecution: state.latestPublishExecution,
      plan: state.plan
    });
  const versionUploadable = computeVersionUploadable(state.manifestVersion, currentSandboxItemVersion);
  const latestApprovalWriteAuthorized = writeAuthorizationForApprovalArtifact(state.latestApproval);
  const latestApprovalPackageSha256 = state.latestApproval?.package_sha256 ?? null;
  const approvalMatchesCurrentPackage = Boolean(
    latestApprovalPackageSha256
    && latestApprovalPackageSha256 === state.packageSha256
  );
  const latestApprovalStatus = state.latestApproval
    ? latestApprovalWriteAuthorized
      ? state.latestApproval.approval_status
      : "not_write_authorized"
    : "not_requested";
  const revisionKind = isSandboxUploadRevision(state.runContext, state.plan)
    || isSandboxProductRevision(state.runContext, state.plan)
    || isSandboxCommercialReleaseRevision(state.runContext, state.plan);
  const prePublishAssetGate = evaluatePrePublishAssetGate({
    listingQualityGate: state.latestListingQualityGate,
    assetQualityReport: state.latestAssetQualityReport,
    storeReleasePackageReport: state.latestStoreReleasePackage,
    humanVisualReview: state.latestHumanVisualReview
  });
  const latestUploadBlocker = deriveUploadBlocker({
    versionUploadable,
    latestApproval: state.latestApproval,
    approvalMatchesCurrentPackage,
    approvalWriteAuthorized: latestApprovalWriteAuthorized,
    prePublishAssetGate
  });
  const latestRevisionRunId = latestRevisionRunIdForState(state.allLedgerEntries, state.runContext.run_id, revisionKind);
  const uploadAllowed = state.latestPreflight?.upload_allowed === true;
  const uploadResponseCrxVersion = state.latestSuccessfulUploadExecution?.upload_response_crx_version
    ?? state.latestSuccessfulUploadExecution?.upload_response_summary?.crxVersion
    ?? state.latestSuccessfulUploadExecution?.upload_response_summary?.crx_version
    ?? null;
  const uploadedCrxVersion = state.latestSuccessfulUploadExecution?.upload_state === "SUCCEEDED"
    && uploadResponseCrxVersion
    ? uploadResponseCrxVersion
    : state.latestSuccessfulUploadExecution?.uploaded_crx_version
      ?? state.latestSuccessfulUploadExecution?.crx_version
      ?? uploadResponseCrxVersion;
  const publishedCrxVersion = state.latestSuccessfulUploadExecution?.published_crx_version
    ?? null;
  const versionConsistencyCheck = state.latestSuccessfulUploadExecution?.version_consistency_check
    ?? {
      performed: Boolean(uploadResponseCrxVersion) || state.latestSuccessfulUploadExecution?.upload_state === "SUCCEEDED",
      upload_state: state.latestSuccessfulUploadExecution?.upload_state ?? null,
      manifest_version: state.manifestVersion,
      upload_response_crx_version: uploadResponseCrxVersion,
      passed: !(
        state.latestSuccessfulUploadExecution?.upload_state === "SUCCEEDED"
        && uploadResponseCrxVersion
        && state.manifestVersion
        && uploadResponseCrxVersion !== state.manifestVersion
      ),
      failure_reason: state.latestSuccessfulUploadExecution?.upload_state === "SUCCEEDED"
        && uploadResponseCrxVersion
        && state.manifestVersion
        && uploadResponseCrxVersion !== state.manifestVersion
        ? "upload_response_crx_version_mismatch"
        : null
    };
  const derivedNextStep = nextStepForSandboxState({
    versionUploadable,
    uploadAllowed,
    revisionKind,
    preflightView: false
  });
  const latestUploadExecutionNextStep = state.latestSuccessfulUploadExecution?.sandbox_upload_verified === true
    && state.latestSuccessfulUploadExecution?.publish_response?.executed !== true
    ? state.latestSuccessfulUploadExecution?.upload_state === "UPLOAD_IN_PROGRESS"
      && !uploadResponseCrxVersion
        ? "poll_fetch_status_for_upload_completion"
        : "manual_approval_required_before_sandbox_publish"
    : null;
  const latestReviewNextStep = state.latestReviewStatus?.is_pending_review === true
    || `${state.latestReviewStatus?.review_state ?? state.latestReviewStatus?.current_dashboard_state ?? ""}`.trim().toUpperCase() === "PENDING_REVIEW"
    || state.latestReviewStatus?.is_cancelled === true
    || state.latestReviewStatus?.is_approved === true
    || state.latestReviewStatus?.is_rejected === true
    ? state.latestReviewStatus?.next_step ?? "wait_for_review_or_manual_cancel"
    : null;
  const reviewState = state.latestReviewStatus?.review_state
    ?? state.latestReviewStatus?.current_dashboard_state
    ?? "not_started";
  const productAcceptanceStatus = state.latestProductAcceptanceReview?.acceptance_status ?? "not_started";
  const functionalTestCoverageScore = state.latestFunctionalTestMatrix?.test_coverage_score ?? null;
  const discoveryQualityScore = state.sourceDailyDiscoveryQualityReview
    ? round(
      ((state.sourceDailyDiscoveryQualityReview.evidence_quality_score ?? 0) * 0.45)
      + ((state.sourceDailyDiscoveryQualityReview.pain_cluster_quality_score ?? 0) * 0.3)
      + ((state.sourceDailyDiscoveryQualityReview.opportunity_score_confidence ?? 0) * 0.25)
    )
    : null;
  const humanProductReviewDecision = state.latestHumanProductReview?.decision ?? "not_requested";
  const wouldPublishToTesters = state.latestHumanProductReview
    ? state.latestHumanProductReview.decision === "passed"
    : productAcceptanceStatus === "passed";
  const knownProductRisks = [
    ...(state.latestProductAcceptanceReview?.biggest_risks ?? []),
    ...(state.latestFunctionalTestMatrix?.release_blockers ?? [])
  ].filter(Boolean);
  const nextProductStep = state.latestHumanProductReview?.next_step
    ?? state.latestProductAcceptanceReview?.next_step
    ?? state.latestFunctionalTestMatrix?.recommended_next_tests?.[0]
    ?? "product_review_not_started";
  const installVerificationStatus = state.latestInstallVerificationPlan?.status ?? "not_started";
  const finalPublishDecisionGateStatus = state.latestFinalPublishDecisionGate?.gate_status ?? "not_started";
  const recommendedNextAction = state.latestFinalPublishDecisionGate?.recommended_next_action ?? null;
  const currentReviewMayNotIncludeLatestPremiumAssets = state.latestFinalPublishDecisionGate?.current_review_may_not_include_latest_premium_assets === true;
  const reviewApprovedForMonitoring = state.latestReviewStatus?.is_approved === true
    || `${state.latestReviewStatus?.review_state ?? ""}`.trim().toUpperCase().includes("PUBLISHED");
  const monitoringEligible = Boolean(
    reviewApprovedForMonitoring
    && productAcceptanceStatus === "passed"
    && functionalTestCoverageScore === 100
  );
  return {
    run_id: state.runContext.run_id,
    run_type: state.runContext.run_type ?? state.runContext.task_mode,
    source_run_id: state.runContext.source_run_id ?? null,
    item_id: state.runContext.item_id ?? state.runContext.publish?.sandbox_item_id ?? null,
    publisher_id: state.runContext.publisher_id ?? state.runContext.publish?.publisher_id ?? null,
    package_sha256: state.packageSha256,
    manifest_version: state.manifestVersion,
    current_sandbox_item_version: currentSandboxItemVersion,
    upload_response_crx_version: uploadResponseCrxVersion,
    uploaded_crx_version: uploadedCrxVersion,
    published_crx_version: publishedCrxVersion,
    version_consistency_check: versionConsistencyCheck,
    version_uploadable: versionUploadable,
    immutable: state.immutable,
    latest_preflight_status: state.latestPreflight?.status ?? "not_started",
    latest_fetch_status: fetchSummary.latest_fetch_status,
    latest_upload_status: fetchSummary.latest_upload_status,
    latest_upload_blocker: latestUploadBlocker,
    latest_approval_status: latestApprovalStatus,
    latest_approval_mode: state.latestApproval?.approval_mode ?? APPROVAL_MODE_TEST_ARTIFACT_ONLY,
    latest_approval_write_authorized: latestApprovalWriteAuthorized,
    latest_approval_package_sha256: latestApprovalPackageSha256,
    current_package_sha256: state.packageSha256,
    approval_matches_current_package: approvalMatchesCurrentPackage,
    latest_revision_run_id: latestRevisionRunId,
    latest_publish_status: summarizePublishStatus(state.latestPublishExecution),
    latest_review_status: reviewState,
    latest_review_state: reviewState,
    review_state: reviewState,
    is_pending_review: state.latestReviewStatus?.is_pending_review === true,
    is_cancelled: state.latestReviewStatus?.is_cancelled === true,
    is_approved: state.latestReviewStatus?.is_approved === true,
    is_rejected: state.latestReviewStatus?.is_rejected === true,
    active_review_watch_terminal: state.activeReviewWatch?.terminal === true,
    active_review_watch_terminal_reason: state.activeReviewWatch?.terminal_reason ?? null,
    latest_dashboard_action_required: state.latestReviewStatus?.dashboard_action_required ?? false,
    latest_install_verification_status: state.latestInstallVerificationPlan?.status ?? "not_started",
    install_verification_status: installVerificationStatus,
    install_verification_plan_status: installVerificationStatus,
    latest_review_repair_status: state.latestReviewRepairPlan?.status ?? "not_started",
    final_publish_decision_gate_status: finalPublishDecisionGateStatus,
    recommended_next_action: recommendedNextAction,
    current_review_may_not_include_latest_premium_assets: currentReviewMayNotIncludeLatestPremiumAssets,
    product_acceptance_status: productAcceptanceStatus,
    functional_test_coverage_score: functionalTestCoverageScore,
    listing_quality_gate_status: state.latestListingQualityGate?.status ?? "not_started",
    asset_quality_status: state.latestAssetQualityReport?.status ?? "not_started",
    store_release_package_status: state.latestStoreReleasePackage?.package_status ?? "not_started",
    human_visual_review_status: state.latestHumanVisualReview?.decision ?? "not_started",
    premium_feel_score: prePublishAssetGate.premium_feel_score,
    pre_publish_asset_gate: prePublishAssetGate,
    monitoring_eligible: monitoringEligible,
    discovery_quality_score: discoveryQualityScore,
    human_product_review_decision: humanProductReviewDecision,
    would_publish_to_testers: wouldPublishToTesters,
    known_product_risks: knownProductRisks,
    next_product_step: nextProductStep,
    ledger_entries_count: state.ledgerEntries.length,
    next_step: recommendedNextAction
      ?? latestReviewNextStep
      ?? state.latestInstallVerificationPlan?.next_step
      ?? state.latestReviewRepairPlan?.next_step
      ?? latestUploadExecutionNextStep
      ?? (state.latestPreflight?.status === "failed"
        ? state.latestPreflight?.next_step ?? derivedNextStep
        : derivedNextStep),
    event_artifacts: null
  };
}
