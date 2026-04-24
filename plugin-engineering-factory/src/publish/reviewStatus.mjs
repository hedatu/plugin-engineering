import path from "node:path";
import {
  fetchChromeWebStoreStatus,
  getChromeWebStoreAccessToken,
  normalizeChromeWebStoreError
} from "./chromeWebStoreApi.mjs";
import { bootstrapReviewWatchEnv } from "./reviewWatchCredentials.mjs";
import { appendReleaseLedgerEvent, loadReleaseLedger } from "./releaseLedger.mjs";
import { assertMatchesSchema } from "../utils/schema.mjs";
import { fileExists, listFiles, nowIso, readJson, writeJson } from "../utils/io.mjs";
import {
  hasSecretLikeContent,
  inspectSecretLikeContent,
  redactSecretLikeValue
} from "../utils/redaction.mjs";
import { loadManagedRunArtifact, writeManagedRunArtifact } from "../workflow/runEventArtifacts.mjs";
import { syncActiveReviewWatchForRun } from "./activeReviewWatches.mjs";

export const REVIEW_STATUS_ARTIFACT = "91_review_status.json";

function artifactPath(runDir, fileName) {
  return path.join(runDir, fileName);
}

async function readOptionalJson(filePath) {
  if (!(await fileExists(filePath))) {
    return null;
  }
  return readJson(filePath);
}

async function loadLatestObservedReviewStatus(projectRoot, runId) {
  const historyDir = path.join(projectRoot, "state", "run_events", runId, "review_status");
  if (!(await fileExists(historyDir))) {
    return null;
  }

  const files = (await listFiles(historyDir))
    .map((entry) => entry.absolutePath)
    .filter((absolutePath) => absolutePath.endsWith(".json"))
    .sort()
    .reverse();

  for (const filePath of files) {
    const report = await readJson(filePath);
    if (
      report
      && (
        report.review_state
        || report.current_dashboard_state
        || report.is_pending_review
        || report.is_approved
        || report.is_rejected
        || report.is_cancelled
      )
    ) {
      return report;
    }
  }

  return null;
}

async function resolvePortableProjectRoot(runDir, runContext) {
  const candidate = runContext?.project_root ? path.resolve(runContext.project_root) : null;
  if (candidate && await fileExists(path.join(candidate, "schemas", "review_status.schema.json"))) {
    return candidate;
  }
  return path.resolve(runDir, "..", "..");
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

function deriveLatestUploadStatus(responseBody, priorPublishExecution, itemId) {
  const latest = findNestedFieldValue(responseBody, new Set(["uploadState", "upload_state", "latestUploadStatus", "latest_upload_status"]));
  if (latest !== null && latest !== undefined) {
    return `${latest}`;
  }
  if (priorPublishExecution?.item_id === itemId) {
    return priorPublishExecution?.upload_state ?? null;
  }
  return null;
}

function deriveCurrentDashboardState({ submittedRevisionStatus, publishedRevisionStatus }) {
  const published = `${publishedRevisionStatus ?? ""}`.trim().toUpperCase();
  const submitted = `${submittedRevisionStatus ?? ""}`.trim().toUpperCase();

  if (published) {
    return published;
  }
  if (submitted === "PENDING_REVIEW") {
    return "PENDING_REVIEW";
  }
  if (submitted === "CANCELLED") {
    return "DRAFT";
  }
  if (submitted) {
    return submitted;
  }
  return "UNKNOWN";
}

function deriveReviewFlags({ currentDashboardState, submittedRevisionStatus }) {
  const normalized = `${currentDashboardState ?? ""}`.trim().toUpperCase();
  const submitted = `${submittedRevisionStatus ?? ""}`.trim().toUpperCase();
  return {
    is_pending_review: normalized === "PENDING_REVIEW",
    is_cancelled: submitted === "CANCELLED" || normalized === "CANCELLED",
    is_draft: normalized === "DRAFT",
    is_approved: normalized.includes("APPROV")
      || normalized === "PUBLISHED"
      || normalized === "STAGED"
      || normalized.includes("ACCEPT")
      || normalized === "AVAILABLE_TO_TESTERS",
    is_rejected: normalized.includes("REJECT") || normalized.includes("DENY")
  };
}

function deriveReviewState({ currentDashboardState, submittedRevisionStatus, publishedRevisionStatus, flags }) {
  if (flags.is_cancelled) {
    return "CANCELLED";
  }
  const published = `${publishedRevisionStatus ?? ""}`.trim().toUpperCase();
  if (published) {
    return published;
  }
  const submitted = `${submittedRevisionStatus ?? ""}`.trim().toUpperCase();
  if (submitted) {
    return submitted;
  }
  return `${currentDashboardState ?? ""}`.trim().toUpperCase() || null;
}

function deriveReviewResult(flags) {
  if (flags.is_cancelled) {
    return "cancelled";
  }
  if (flags.is_pending_review) {
    return "pending_review";
  }
  if (flags.is_approved) {
    return "approved";
  }
  if (flags.is_rejected) {
    return "rejected";
  }
  if (flags.is_draft) {
    return "draft";
  }
  return "observed";
}

function deriveReviewAction({
  currentDashboardState,
  flags
}) {
  const dashboardState = `${currentDashboardState ?? ""}`.trim().toUpperCase();

  if (flags.is_cancelled) {
    return "cancelled_state_observed";
  }
  if (flags.is_pending_review) {
    return "awaiting_review";
  }
  if (flags.is_approved) {
    if (dashboardState === "STAGED") {
      return "review_approved_staged";
    }
    return "review_approved";
  }
  if (flags.is_rejected) {
    return "review_rejected";
  }
  if (dashboardState === "DRAFT") {
    return "draft_state_observed";
  }
  return "state_observed";
}

function nextStepForReview({ reviewAction, flags }) {
  if (flags.is_cancelled || reviewAction === "cancelled_state_observed") {
    return "record_manual_cancel_review_if_not_recorded";
  }
  if (flags.is_pending_review) {
    return "wait_for_review_or_manual_cancel";
  }
  if (reviewAction === "review_approved_staged") {
    return "prepare_manual_install_verification_or_final_publish_decision";
  }
  if (flags.is_approved) {
    return "prepare_manual_install_verification";
  }
  if (flags.is_rejected) {
    return "prepare_review_repair_plan";
  }
  return "inspect dashboard submission state before any further action";
}

function summarizeRawResponse(fetchStatusResponse) {
  return {
    http_status: fetchStatusResponse?.http_status ?? fetchStatusResponse?.status_code ?? null,
    body_keys: fetchStatusResponse?.body && typeof fetchStatusResponse.body === "object" && !Array.isArray(fetchStatusResponse.body)
      ? Object.keys(fetchStatusResponse.body).sort()
      : [],
    response_body_summary: fetchStatusResponse?.response_body_summary ?? null,
    response_headers_summary: fetchStatusResponse?.response_headers_summary ?? null
  };
}

function buildRedactionChecks(reportWithoutChecks) {
  return inspectSecretLikeContent(reportWithoutChecks);
}

function buildSafeReport(reportWithoutChecks) {
  const initialChecks = buildRedactionChecks(reportWithoutChecks);
  const redactionGuardTriggered = hasSecretLikeContent(initialChecks);
  const safeReport = redactSecretLikeValue(reportWithoutChecks);

  if (redactionGuardTriggered) {
    safeReport.status = "failed";
    safeReport.failure_phase = safeReport.failure_phase ?? "token_exchange";
    safeReport.failure_reason = "Review status redaction guard blocked artifact write due to secret-like content.";
    safeReport.next_step = "remove secret-like values from review status inputs and retry";
  }

  return {
    ...safeReport,
    redaction_checks: {
      ...buildRedactionChecks(safeReport),
      redaction_guard_triggered: redactionGuardTriggered
    }
  };
}

export async function validateReviewStatusArtifact(projectRoot, data) {
  await assertMatchesSchema({
    data,
    schemaPath: path.join(projectRoot, "schemas", "review_status.schema.json"),
    label: REVIEW_STATUS_ARTIFACT
  });
}

function statusSourceForSkipped(latestObservedReviewStatus) {
  return latestObservedReviewStatus
    ? "preserved_last_known_state"
    : "preserved_last_known_state";
}

function deriveUploadedCrxVersion(priorPublishExecution, itemId) {
  if (priorPublishExecution?.item_id !== itemId) {
    return null;
  }
  return priorPublishExecution?.uploaded_crx_version
    ?? priorPublishExecution?.upload_response_crx_version
    ?? priorPublishExecution?.upload_response_summary?.crxVersion
    ?? priorPublishExecution?.upload_response_summary?.crx_version
    ?? priorPublishExecution?.crx_version
    ?? null;
}

function deriveManifestVersion(priorPublishExecution, itemId) {
  if (priorPublishExecution?.item_id !== itemId) {
    return null;
  }
  return priorPublishExecution?.manifest_version ?? null;
}

function deriveReviewLedgerAction(report) {
  if (report.is_pending_review) {
    return "review_pending";
  }
  if (report.is_approved) {
    if (`${report.review_state ?? report.current_dashboard_state ?? ""}`.trim().toUpperCase() === "STAGED") {
      return "review_approved_staged";
    }
    return "review_approved";
  }
  if (report.is_rejected) {
    return "review_rejected";
  }
  return null;
}

async function appendReviewLedgerIfChanged(projectRoot, {
  runId,
  itemId,
  publisherId,
  itemName,
  packageSha256,
  manifestVersion,
  uploadedCrxVersion,
  reviewReport,
  artifactRelativePath
}) {
  const actionType = deriveReviewLedgerAction(reviewReport);
  if (!actionType) {
    return {
      appended: false,
      reason: "review_state_not_ledgered"
    };
  }

  const ledger = await loadReleaseLedger(projectRoot);
  const latestSimilarEntry = ledger.entries
    .filter((entry) => entry.run_id === runId)
    .filter((entry) => ["review_pending", "review_approved", "review_approved_staged", "review_rejected"].includes(entry.action_type))
    .at(-1) ?? null;

  const actionStatus = reviewReport.review_state ?? reviewReport.current_dashboard_state ?? "observed";
  if (
    latestSimilarEntry
    && latestSimilarEntry.action_type === actionType
    && `${latestSimilarEntry.action_status ?? ""}` === `${actionStatus}`
  ) {
    return {
      appended: false,
      reason: "same_review_state"
    };
  }

  await appendReleaseLedgerEvent(projectRoot, {
    runId,
    itemId,
    publisherId,
    itemName,
    packageSha256,
    manifestVersion,
    uploadedCrxVersion,
    actionType,
    actionSource: "api",
    actionStatus,
    evidenceArtifacts: artifactRelativePath ? [artifactRelativePath] : [],
    responseSummary: reviewReport.raw_response_summary,
    productionWrite: false,
    sandboxOnly: true
  });

  return {
    appended: true,
    reason: null
  };
}

export async function runReviewStatusStage({ runDir }) {
  const runContext = await readJson(artifactPath(runDir, "00_run_context.json"));
  const projectRoot = await resolvePortableProjectRoot(runDir, runContext);
  const portableRunContext = {
    ...runContext,
    project_root: projectRoot
  };
  const credentialBootstrap = await bootstrapReviewWatchEnv({ projectRoot });
  const latestObservedReviewStatus = await loadLatestObservedReviewStatus(projectRoot, runContext.run_id);
  const priorPublishExecution = (await loadManagedRunArtifact({
    runDir,
    artifactName: "90_publish_execution.json",
    runContext: portableRunContext
  }))?.data ?? null;
  const credential_type = credentialBootstrap.access_token_mode;
  const credential_present = credentialBootstrap.credential_present;
  const token_source = credentialBootstrap.token_source;
  const publisherId = process.env.CHROME_WEB_STORE_PUBLISHER_ID ?? priorPublishExecution?.publisher_id ?? runContext?.publish?.publisher_id ?? null;
  const itemId = process.env.CHROME_WEB_STORE_SANDBOX_ITEM_ID ?? priorPublishExecution?.item_id ?? runContext?.publish?.sandbox_item_id ?? null;
  const previousPublishExecutionState = {
    execution_mode: priorPublishExecution?.execution_mode ?? null,
    publish_validation_phase: priorPublishExecution?.publish_validation_phase ?? null,
    publish_response_state: priorPublishExecution?.publish_response?.body?.state ?? null,
    publish_response_ok: priorPublishExecution?.publish_response?.ok ?? null,
    publish_executed: priorPublishExecution?.publish_response?.executed === true
  };
  const reviewSubmissionVerified = Boolean(
    previousPublishExecutionState.publish_executed
    && previousPublishExecutionState.publish_response_ok === true
    && previousPublishExecutionState.publish_response_state
  );

  let failurePhase = null;
  let failureReason = null;
  let diagnosticHint = null;
  let fetchStatusResponse = null;
  let networkMode = "direct";
  let proxyConfigured = false;
  let proxySource = null;
  let proxyUrlRedacted = null;

  if (!priorPublishExecution || !publisherId || !itemId || !credential_present || !reviewSubmissionVerified) {
    const skippedFlags = latestObservedReviewStatus
      ? deriveReviewFlags({
          currentDashboardState: latestObservedReviewStatus.current_dashboard_state,
          submittedRevisionStatus: latestObservedReviewStatus.submitted_revision_status
        })
      : null;
    const skipped = buildSafeReport({
      stage: "REVIEW_STATUS",
      status: "skipped",
      run_id: runContext.run_id,
      run_type: runContext.run_type ?? runContext.task_mode,
      publisher_id: publisherId,
      item_id: itemId,
      checked_at: nowIso(),
      status_source: statusSourceForSkipped(latestObservedReviewStatus),
      credentials_present: credential_present,
      fetch_status_attempted: false,
      fetch_status_succeeded: false,
      previous_publish_execution_state: previousPublishExecutionState,
      current_dashboard_state: latestObservedReviewStatus?.current_dashboard_state ?? null,
      submitted_revision_status: latestObservedReviewStatus?.submitted_revision_status ?? null,
      published_revision_status: latestObservedReviewStatus?.published_revision_status ?? null,
      latest_upload_status: latestObservedReviewStatus?.latest_upload_status ?? priorPublishExecution?.upload_state ?? null,
      uploaded_crx_version: latestObservedReviewStatus?.uploaded_crx_version ?? deriveUploadedCrxVersion(priorPublishExecution, itemId),
      manifest_version: latestObservedReviewStatus?.manifest_version ?? deriveManifestVersion(priorPublishExecution, itemId),
      review_state: latestObservedReviewStatus?.review_state ?? latestObservedReviewStatus?.current_dashboard_state ?? null,
      review_result: latestObservedReviewStatus?.review_result
        && latestObservedReviewStatus.review_result !== "not_applicable"
        ? latestObservedReviewStatus.review_result
        : (skippedFlags ? deriveReviewResult(skippedFlags) : "not_applicable"),
      review_action: "not_applicable",
      review_submission_verified: reviewSubmissionVerified,
      review_cancelled_manually: latestObservedReviewStatus?.review_cancelled_manually ?? false,
      manual_action_recorded: latestObservedReviewStatus?.manual_action_recorded ?? false,
      dashboard_state_confirmed: latestObservedReviewStatus?.dashboard_state_confirmed ?? false,
      dashboard_state_unconfirmed: latestObservedReviewStatus?.dashboard_state_unconfirmed ?? false,
      is_pending_review: latestObservedReviewStatus?.is_pending_review ?? skippedFlags?.is_pending_review ?? false,
      is_draft: latestObservedReviewStatus?.is_draft ?? skippedFlags?.is_draft ?? false,
      is_approved: latestObservedReviewStatus?.is_approved ?? skippedFlags?.is_approved ?? false,
      is_rejected: latestObservedReviewStatus?.is_rejected ?? skippedFlags?.is_rejected ?? false,
      is_cancelled: latestObservedReviewStatus?.is_cancelled ?? skippedFlags?.is_cancelled ?? false,
      dashboard_action_required: latestObservedReviewStatus?.dashboard_action_required ?? false,
      next_step: latestObservedReviewStatus?.next_step ?? "review_status_not_applicable_for_this_run",
      raw_response_summary: {
        http_status: null,
        body_keys: [],
        response_body_summary: null,
        response_headers_summary: null
      },
      network_mode: networkMode,
      proxy_configured: proxyConfigured,
      proxy_source: proxySource,
      proxy_url_redacted: proxyUrlRedacted,
      failure_phase: null,
      failure_reason: null,
      diagnostic_hint: null,
      credential_type,
      token_source
    });

    await validateReviewStatusArtifact(projectRoot, skipped);
    await writeManagedRunArtifact({
      runDir,
      artifactName: REVIEW_STATUS_ARTIFACT,
      data: skipped,
      runContext: portableRunContext
    });
    await syncActiveReviewWatchForRun({
      runDir,
      runContext: portableRunContext,
      reviewStatus: skipped,
      publishExecution: priorPublishExecution
    });
    return skipped;
  }

  try {
    const tokenResult = await getChromeWebStoreAccessToken(
      credential_type === "missing" ? "service_account" : credential_type,
      { scope: "https://www.googleapis.com/auth/chromewebstore.readonly" }
    );
    networkMode = tokenResult.network_mode ?? networkMode;
    proxyConfigured = tokenResult.proxy_configured ?? proxyConfigured;
    proxySource = tokenResult.proxy_source ?? proxySource;
    proxyUrlRedacted = tokenResult.proxy_url_redacted ?? proxyUrlRedacted;

    fetchStatusResponse = await fetchChromeWebStoreStatus({
      publisherId,
      itemId,
      accessToken: tokenResult.accessToken
    });
    networkMode = fetchStatusResponse.network_mode ?? networkMode;
    proxyConfigured = fetchStatusResponse.proxy_configured ?? proxyConfigured;
    proxySource = fetchStatusResponse.proxy_source ?? proxySource;
    proxyUrlRedacted = fetchStatusResponse.proxy_url_redacted ?? proxyUrlRedacted;

    if (!fetchStatusResponse.ok) {
      failurePhase = "chrome_webstore_fetch_status";
      failureReason = `fetchStatus failed with HTTP ${fetchStatusResponse.status_code}.`;
      diagnosticHint = "Chrome Web Store fetchStatus returned a non-success response while reading review status.";
    }
  } catch (error) {
    const normalized = normalizeChromeWebStoreError(error, "token_exchange");
    failurePhase = normalized.failure_phase;
    failureReason = normalized.message;
    diagnosticHint = normalized.diagnostic_hint;
    networkMode = normalized.network_mode ?? networkMode;
    proxyConfigured = normalized.proxy_configured ?? proxyConfigured;
    proxySource = normalized.proxy_source ?? proxySource;
    proxyUrlRedacted = normalized.proxy_url_redacted ?? proxyUrlRedacted;
  }

  const submittedRevisionStatus = pickRevisionState(fetchStatusResponse?.body ?? null, [
    "submittedItemRevisionStatus",
    "submittedRevisionStatus",
    "submitted_revision_status"
  ]);
  const publishedRevisionStatus = pickRevisionState(fetchStatusResponse?.body ?? null, [
    "publishedItemRevisionStatus",
    "publishedRevisionStatus",
    "published_revision_status"
  ]);
  const currentDashboardState = deriveCurrentDashboardState({
    submittedRevisionStatus,
    publishedRevisionStatus
  });
  const flags = deriveReviewFlags({
    currentDashboardState,
    submittedRevisionStatus
  });
  const reviewState = deriveReviewState({
    currentDashboardState,
    submittedRevisionStatus,
    publishedRevisionStatus,
    flags
  });
  const reviewResult = deriveReviewResult(flags);
  const reviewAction = deriveReviewAction({
    currentDashboardState,
    flags
  });
  const reviewCancelledManually = false;
  const report = buildSafeReport({
    stage: "REVIEW_STATUS",
    status: failureReason ? "failed" : "passed",
    run_id: runContext.run_id,
    run_type: runContext.run_type ?? runContext.task_mode,
    publisher_id: publisherId,
    item_id: itemId,
    checked_at: nowIso(),
    status_source: failureReason && latestObservedReviewStatus
      ? "preserved_last_known_state"
      : "live_fetch_status",
    credentials_present: credential_present,
    fetch_status_attempted: true,
    fetch_status_succeeded: Boolean(fetchStatusResponse?.ok),
    previous_publish_execution_state: previousPublishExecutionState,
    current_dashboard_state: failureReason && latestObservedReviewStatus
      ? latestObservedReviewStatus.current_dashboard_state ?? currentDashboardState
      : currentDashboardState,
    submitted_revision_status: failureReason && latestObservedReviewStatus
      ? latestObservedReviewStatus.submitted_revision_status ?? submittedRevisionStatus
      : submittedRevisionStatus,
    published_revision_status: failureReason && latestObservedReviewStatus
      ? latestObservedReviewStatus.published_revision_status ?? publishedRevisionStatus
      : publishedRevisionStatus,
    latest_upload_status: failureReason && latestObservedReviewStatus
      ? latestObservedReviewStatus.latest_upload_status ?? deriveLatestUploadStatus(fetchStatusResponse?.body ?? null, priorPublishExecution, itemId)
      : deriveLatestUploadStatus(fetchStatusResponse?.body ?? null, priorPublishExecution, itemId),
    uploaded_crx_version: failureReason && latestObservedReviewStatus
      ? latestObservedReviewStatus.uploaded_crx_version ?? deriveUploadedCrxVersion(priorPublishExecution, itemId)
      : deriveUploadedCrxVersion(priorPublishExecution, itemId),
    manifest_version: failureReason && latestObservedReviewStatus
      ? latestObservedReviewStatus.manifest_version ?? deriveManifestVersion(priorPublishExecution, itemId)
      : deriveManifestVersion(priorPublishExecution, itemId),
    review_state: failureReason && latestObservedReviewStatus
      ? latestObservedReviewStatus.review_state ?? reviewState
      : reviewState,
    review_result: failureReason && latestObservedReviewStatus
      ? latestObservedReviewStatus.review_result ?? reviewResult
      : reviewResult,
    review_action: failureReason && latestObservedReviewStatus
      ? latestObservedReviewStatus.review_action ?? reviewAction
      : reviewAction,
    review_submission_verified: reviewSubmissionVerified,
    review_cancelled_manually: reviewCancelledManually,
    manual_action_recorded: failureReason && latestObservedReviewStatus
      ? latestObservedReviewStatus.manual_action_recorded ?? false
      : false,
    dashboard_state_confirmed: failureReason && latestObservedReviewStatus
      ? latestObservedReviewStatus.dashboard_state_confirmed ?? false
      : false,
    dashboard_state_unconfirmed: failureReason && latestObservedReviewStatus
      ? latestObservedReviewStatus.dashboard_state_unconfirmed ?? false
      : false,
    is_pending_review: failureReason && latestObservedReviewStatus
      ? latestObservedReviewStatus.is_pending_review ?? flags.is_pending_review
      : flags.is_pending_review,
    is_draft: failureReason && latestObservedReviewStatus
      ? latestObservedReviewStatus.is_draft ?? flags.is_draft
      : flags.is_draft,
    is_approved: failureReason && latestObservedReviewStatus
      ? latestObservedReviewStatus.is_approved ?? flags.is_approved
      : flags.is_approved,
    is_rejected: failureReason && latestObservedReviewStatus
      ? latestObservedReviewStatus.is_rejected ?? flags.is_rejected
      : flags.is_rejected,
    is_cancelled: failureReason && latestObservedReviewStatus
      ? latestObservedReviewStatus.is_cancelled ?? flags.is_cancelled
      : flags.is_cancelled,
    dashboard_action_required: failureReason
      ? true
      : flags.is_cancelled || flags.is_approved || flags.is_rejected,
    next_step: failureReason
      ? latestObservedReviewStatus?.next_step ?? "retry review status after fixing the fetchStatus failure"
      : nextStepForReview({ reviewAction, flags }),
    raw_response_summary: summarizeRawResponse(fetchStatusResponse),
    network_mode: networkMode,
    proxy_configured: proxyConfigured,
    proxy_source: proxySource,
    proxy_url_redacted: proxyUrlRedacted,
    failure_phase: failurePhase,
    failure_reason: failureReason,
    diagnostic_hint: diagnosticHint,
    credential_type,
    token_source
  });

  await validateReviewStatusArtifact(projectRoot, report);
  const reviewArtifactWrite = await writeManagedRunArtifact({
    runDir,
    artifactName: REVIEW_STATUS_ARTIFACT,
    data: report,
    runContext: portableRunContext
  });
  if (!failureReason && publisherId && itemId) {
    await appendReviewLedgerIfChanged(projectRoot, {
      runId: runContext.run_id,
      itemId,
      publisherId,
      itemName: runContext.item_name ?? null,
      packageSha256: priorPublishExecution?.package_sha256 ?? "",
      manifestVersion: report.manifest_version,
      uploadedCrxVersion: report.uploaded_crx_version,
      reviewReport: report,
      artifactRelativePath: reviewArtifactWrite.artifactRelativePath
    });
  }
  await syncActiveReviewWatchForRun({
    runDir,
    runContext: portableRunContext,
    reviewStatus: report,
    publishExecution: priorPublishExecution
  });
  return report;
}

export async function readReviewStatusArtifact(runDir) {
  return (await loadManagedRunArtifact({
    runDir,
    artifactName: REVIEW_STATUS_ARTIFACT
  }))?.data ?? null;
}
