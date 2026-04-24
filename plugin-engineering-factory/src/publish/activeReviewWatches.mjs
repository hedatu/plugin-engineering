import fs from "node:fs/promises";
import path from "node:path";
import { assertMatchesSchema } from "../utils/schema.mjs";
import { ensureDir, fileExists, nowIso, readJson, writeJson } from "../utils/io.mjs";
import { loadManagedRunArtifact } from "../workflow/runEventArtifacts.mjs";
import { loadReleaseLedger } from "./releaseLedger.mjs";

export const ACTIVE_REVIEW_WATCHES_PATH = path.join("state", "active_review_watches.json");
export const REVIEW_WATCH_SUMMARY_PATH = path.join("state", "review_watch_summary.json");

function absoluteRegistryPath(projectRoot) {
  return path.join(projectRoot, ACTIVE_REVIEW_WATCHES_PATH);
}

function reviewWatchSummaryPath(projectRoot) {
  return path.join(projectRoot, REVIEW_WATCH_SUMMARY_PATH);
}

function registryLockPath(projectRoot) {
  return path.join(projectRoot, "state", ".locks", "active_review_watches.lock.json");
}

function shortRandom() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildWatchId(runId) {
  return `watch-${runId ?? shortRandom()}`;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function normalizeState(value) {
  return `${value ?? ""}`.trim().toUpperCase();
}

function isPendingState(value) {
  return normalizeState(value) === "PENDING_REVIEW";
}

function isApprovedState(value) {
  const normalized = normalizeState(value);
  return normalized.includes("APPROV")
    || normalized.includes("ACCEPT")
    || normalized === "STAGED"
    || normalized === "PUBLISHED"
    || normalized === "AVAILABLE_TO_TESTERS";
}

function isRejectedState(value) {
  const normalized = normalizeState(value);
  return normalized.includes("REJECT") || normalized.includes("DENY");
}

function isCancelledState(value) {
  const normalized = normalizeState(value);
  return normalized === "CANCELLED" || normalized === "DRAFT";
}

function terminalReasonForState(value) {
  const normalized = normalizeState(value);
  if (normalized === "STAGED") {
    return "approved_staged";
  }
  if (isApprovedState(value)) {
    return "review_approved";
  }
  if (isRejectedState(value)) {
    return "review_rejected";
  }
  if (isCancelledState(value)) {
    return "review_cancelled_or_draft";
  }
  return null;
}

function nextStepForState(value, fallback = null) {
  const normalized = normalizeState(value);
  if (isPendingState(value)) {
    return "wait_for_review_or_manual_cancel";
  }
  if (normalized === "STAGED") {
    return "prepare_manual_install_verification_or_final_publish_decision";
  }
  if (isApprovedState(value)) {
    return "prepare_manual_install_verification";
  }
  if (isRejectedState(value)) {
    return "prepare_review_repair_plan";
  }
  if (isCancelledState(value)) {
    return "record_manual_cancel_review_if_not_recorded";
  }
  return fallback ?? "inspect_dashboard_submission_state";
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

function buildPendingAgeMetadata(submittedAt, referenceTime = nowIso()) {
  if (!submittedAt) {
    return {
      pending_duration_hours: null,
      pending_duration_days: null,
      review_age_bucket: null,
      escalation_recommended: false
    };
  }

  const submittedTimestamp = Date.parse(submittedAt);
  const referenceTimestamp = Date.parse(referenceTime);
  if (Number.isNaN(submittedTimestamp) || Number.isNaN(referenceTimestamp)) {
    return {
      pending_duration_hours: null,
      pending_duration_days: null,
      review_age_bucket: null,
      escalation_recommended: false
    };
  }

  const durationHours = Math.max(0, (referenceTimestamp - submittedTimestamp) / (1000 * 60 * 60));
  const durationDays = durationHours / 24;
  let reviewAgeBucket = "lt_24h";
  if (durationHours < 24) {
    reviewAgeBucket = "lt_24h";
  } else if (durationDays < 4) {
    reviewAgeBucket = "day_1_to_3";
  } else if (durationDays < 15) {
    reviewAgeBucket = "day_4_to_14";
  } else if (durationDays <= 21) {
    reviewAgeBucket = "day_15_to_21";
  } else {
    reviewAgeBucket = "over_21_days";
  }

  return {
    pending_duration_hours: round(durationHours),
    pending_duration_days: round(durationDays),
    review_age_bucket: reviewAgeBucket,
    escalation_recommended: reviewAgeBucket === "day_15_to_21" || reviewAgeBucket === "over_21_days"
  };
}

function hasFetchFailure(reviewStatus) {
  if (!reviewStatus) {
    return false;
  }
  if (reviewStatus.status === "failed") {
    return true;
  }
  if (reviewStatus.fetch_status_attempted === true && reviewStatus.fetch_status_succeeded !== true) {
    return true;
  }
  return false;
}

function deriveReviewState({ reviewStatus, publishExecution, existingWatch }) {
  if (
    reviewStatus?.review_cancelled_manually === true
    && reviewStatus?.manual_action_recorded === true
    && reviewStatus?.dashboard_state_confirmed !== true
  ) {
    return "MANUAL_CANCEL_RECORDED_UNCONFIRMED";
  }
  return reviewStatus?.review_state
    ?? reviewStatus?.current_dashboard_state
    ?? publishExecution?.review_state
    ?? publishExecution?.publish_response?.body?.state
    ?? existingWatch?.latest_review_state
    ?? null;
}

function deriveManifestVersion({ reviewStatus, publishExecution, existingWatch }) {
  return reviewStatus?.manifest_version
    ?? publishExecution?.manifest_version
    ?? existingWatch?.manifest_version
    ?? null;
}

function deriveUploadedCrxVersion({ reviewStatus, publishExecution, existingWatch }) {
  return reviewStatus?.uploaded_crx_version
    ?? publishExecution?.uploaded_crx_version
    ?? publishExecution?.upload_response_crx_version
    ?? publishExecution?.upload_response_summary?.crxVersion
    ?? publishExecution?.crx_version
    ?? existingWatch?.uploaded_crx_version
    ?? null;
}

function pickLatestOccurredAt(entries) {
  const occurredAt = entries
    .map((entry) => entry?.occurred_at ?? null)
    .filter(Boolean)
    .sort()
    .at(-1);
  return occurredAt ?? null;
}

function normalizeRelativePath(projectRoot, absolutePath) {
  return path.relative(projectRoot, absolutePath).replaceAll("\\", "/");
}

async function resolvePortableProjectRoot(runDir, runContext) {
  const candidate = runContext?.project_root ? path.resolve(runContext.project_root) : null;
  if (candidate && await fileExists(path.join(candidate, "schemas", "active_review_watches.schema.json"))) {
    return candidate;
  }
  return path.resolve(runDir, "..", "..");
}

async function readOptionalJson(filePath) {
  if (!(await fileExists(filePath))) {
    return null;
  }
  return readJson(filePath);
}

export function defaultActiveReviewWatches() {
  return {
    stage: "ACTIVE_REVIEW_WATCH_REGISTRY",
    status: "passed",
    generated_at: nowIso(),
    watches: []
  };
}

export async function validateActiveReviewWatches(projectRoot, data) {
  await assertMatchesSchema({
    data,
    schemaPath: path.join(projectRoot, "schemas", "active_review_watches.schema.json"),
    label: ACTIVE_REVIEW_WATCHES_PATH
  });
}

export async function validateReviewWatchSummary(projectRoot, data) {
  await assertMatchesSchema({
    data,
    schemaPath: path.join(projectRoot, "schemas", "review_watch_summary.schema.json"),
    label: REVIEW_WATCH_SUMMARY_PATH
  });
}

export async function loadActiveReviewWatches(projectRoot) {
  const registryPath = absoluteRegistryPath(projectRoot);
  if (!(await fileExists(registryPath))) {
    const initialized = defaultActiveReviewWatches();
    await ensureDir(path.dirname(registryPath));
    await validateActiveReviewWatches(projectRoot, initialized);
    await writeJson(registryPath, initialized);
    return initialized;
  }

  const current = await readJson(registryPath);
  const normalized = {
    ...defaultActiveReviewWatches(),
    ...current,
    watches: current.watches ?? []
  };
  await validateActiveReviewWatches(projectRoot, normalized);
  return normalized;
}

async function writeActiveReviewWatches(projectRoot, data) {
  const next = {
    ...defaultActiveReviewWatches(),
    ...data,
    generated_at: nowIso(),
    watches: data.watches ?? []
  };
  await validateActiveReviewWatches(projectRoot, next);
  await writeJson(absoluteRegistryPath(projectRoot), next);
  return next;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRegistryLock(projectRoot, action) {
  const lockPath = registryLockPath(projectRoot);
  await ensureDir(path.dirname(lockPath));
  let handle = null;
  let lastError = null;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      handle = await fs.open(lockPath, "wx");
      await handle.writeFile(`${JSON.stringify({
        pid: process.pid,
        acquired_at: nowIso()
      }, null, 2)}\n`, "utf8");
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      lastError = error;
      await sleep(50);
    }
  }

  if (!handle) {
    throw lastError ?? new Error("Could not acquire active review watch registry lock.");
  }

  try {
    return await action();
  } finally {
    await handle.close().catch(() => {});
    await fs.rm(lockPath, { force: true }).catch(() => {});
  }
}

async function loadRunContext(runDir) {
  return readJson(path.join(runDir, "00_run_context.json"));
}

async function deriveSubmittedAt({
  projectRoot,
  runId,
  publishExecution,
  existingWatch,
  ledger
}) {
  if (existingWatch?.submitted_at) {
    return existingWatch.submitted_at;
  }

  if (publishExecution?.publish_response?.executed === true && publishExecution?.publish_response?.ok === true) {
    return publishExecution.generated_at ?? null;
  }

  const entries = (ledger?.entries ?? [])
    .filter((entry) => entry.run_id === runId)
    .filter((entry) => entry.action_type === "sandbox_publish_optional" || entry.action_type === "review_pending");
  return pickLatestOccurredAt(entries);
}

async function loadLatestPublishExecution(runDir, runContext) {
  return (await loadManagedRunArtifact({
    runDir,
    artifactName: "90_publish_execution.json",
    runContext
  }))?.data ?? null;
}

async function loadLatestReviewStatus(runDir, runContext) {
  return (await loadManagedRunArtifact({
    runDir,
    artifactName: "91_review_status.json",
    runContext
  }))?.data ?? null;
}

function buildWatchRecord({
  existingWatch,
  runContext,
  reviewStatus,
  publishExecution,
  submittedAt,
  checkedAt,
  reviewState
}) {
  const nextState = reviewState ?? existingWatch?.latest_review_state ?? null;
  const terminalReason = terminalReasonForState(nextState);
  const terminal = Boolean(terminalReason);
  const ageMetadata = buildPendingAgeMetadata(submittedAt, checkedAt ?? nowIso());

  return {
    watch_id: existingWatch?.watch_id ?? buildWatchId(runContext.run_id),
    run_id: runContext.run_id,
    item_id: runContext.item_id ?? runContext.publish?.sandbox_item_id ?? existingWatch?.item_id ?? null,
    publisher_id: runContext.publisher_id ?? runContext.publish?.publisher_id ?? existingWatch?.publisher_id ?? null,
    manifest_version: deriveManifestVersion({ reviewStatus, publishExecution, existingWatch }),
    uploaded_crx_version: deriveUploadedCrxVersion({ reviewStatus, publishExecution, existingWatch }),
    submitted_at: submittedAt,
    latest_review_state: nextState,
    latest_checked_at: checkedAt ?? existingWatch?.latest_checked_at ?? nowIso(),
    check_count: existingWatch?.check_count ?? 0,
    consecutive_failures: existingWatch?.consecutive_failures ?? 0,
    status_source: reviewStatus?.status_source
      ?? existingWatch?.status_source
      ?? "publish_response_pending_review",
    next_check_after: terminal
      ? null
      : addHours(checkedAt ?? existingWatch?.latest_checked_at ?? nowIso(), 6),
    enabled: existingWatch?.enabled !== false,
    terminal,
    terminal_reason: terminalReason,
    next_step: nextStepForState(nextState, reviewStatus?.next_step ?? existingWatch?.next_step ?? null),
    ...ageMetadata
  };
}

async function resolveWatchInputs({
  runDir,
  runContext,
  reviewStatus,
  publishExecution
}) {
  const effectiveRunContext = runContext ?? await loadRunContext(runDir);
  const effectivePublishExecution = publishExecution ?? await loadLatestPublishExecution(runDir, effectiveRunContext);
  const effectiveReviewStatus = reviewStatus ?? await loadLatestReviewStatus(runDir, effectiveRunContext);
  return {
    runContext: effectiveRunContext,
    reviewStatus: effectiveReviewStatus,
    publishExecution: effectivePublishExecution
  };
}

export async function syncActiveReviewWatchForRun({
  runDir,
  runContext = null,
  reviewStatus = null,
  publishExecution = null
}) {
  const resolvedRunDir = path.resolve(runDir);
  const {
    runContext: effectiveRunContext,
    reviewStatus: effectiveReviewStatus,
    publishExecution: effectivePublishExecution
  } = await resolveWatchInputs({
    runDir: resolvedRunDir,
    runContext,
    reviewStatus,
    publishExecution
  });

  if ((effectiveRunContext.run_type ?? effectiveRunContext.task_mode) !== "sandbox_validation") {
    return {
      skipped: true,
      reason: "not_sandbox_validation"
    };
  }

  const projectRoot = await resolvePortableProjectRoot(resolvedRunDir, effectiveRunContext);
  const portableRunContext = {
    ...effectiveRunContext,
    project_root: projectRoot
  };

  return withRegistryLock(projectRoot, async () => {
    const registry = await loadActiveReviewWatches(projectRoot);
    const ledger = await loadReleaseLedger(projectRoot);
    const existingWatch = registry.watches.find((watch) => watch.run_id === effectiveRunContext.run_id) ?? null;

    const publishAttempted = existingWatch
      || effectivePublishExecution?.publish_response?.executed === true
      || ledger.entries.some((entry) =>
        entry.run_id === effectiveRunContext.run_id
        && (entry.action_type === "sandbox_publish_optional" || entry.action_type === "review_pending")
      );
    if (!publishAttempted) {
      return {
        skipped: true,
        reason: "publish_not_attempted"
      };
    }

    const submittedAt = await deriveSubmittedAt({
      projectRoot,
      runId: effectiveRunContext.run_id,
      publishExecution: effectivePublishExecution,
      existingWatch,
      ledger
    });
    const checkedAt = effectiveReviewStatus?.checked_at
      ?? effectivePublishExecution?.generated_at
      ?? existingWatch?.latest_checked_at
      ?? nowIso();
    const reviewState = deriveReviewState({
      reviewStatus: effectiveReviewStatus,
      publishExecution: effectivePublishExecution,
      existingWatch
    });
    if (!reviewState && !existingWatch) {
      return {
        skipped: true,
        reason: "review_state_unavailable"
      };
    }

    const nextWatch = buildWatchRecord({
      existingWatch,
      runContext: portableRunContext,
      reviewStatus: effectiveReviewStatus,
      publishExecution: effectivePublishExecution,
      submittedAt,
      checkedAt,
      reviewState
    });

    const previousState = normalizeState(existingWatch?.latest_review_state);
    const nextState = normalizeState(nextWatch.latest_review_state);
    const checkCountChanged = effectiveReviewStatus?.checked_at && effectiveReviewStatus.checked_at !== existingWatch?.latest_checked_at;
    if (effectiveReviewStatus) {
      nextWatch.check_count = (existingWatch?.check_count ?? 0) + (checkCountChanged || !existingWatch ? 1 : 0);
      nextWatch.consecutive_failures = hasFetchFailure(effectiveReviewStatus)
        ? (existingWatch?.consecutive_failures ?? 0) + (checkCountChanged || !existingWatch ? 1 : 0)
        : 0;
    }

    const nextRegistry = {
      ...registry,
      watches: [
        ...registry.watches.filter((watch) => watch.run_id !== effectiveRunContext.run_id),
        nextWatch
      ].sort((left, right) => `${left.run_id}`.localeCompare(`${right.run_id}`))
    };
    await writeActiveReviewWatches(projectRoot, nextRegistry);

    return {
      skipped: false,
      created: !existingWatch,
      updated: Boolean(existingWatch),
      state_changed: previousState !== nextState,
      watch: nextWatch
    };
  });
}

export async function inspectActiveReviewWatches(projectRoot) {
  const registry = await loadActiveReviewWatches(projectRoot);
  const watches = registry.watches ?? [];
  return {
    path: absoluteRegistryPath(projectRoot),
    total_watches: watches.length,
    active_count: watches.filter((watch) => watch.enabled === true && watch.terminal !== true).length,
    terminal_count: watches.filter((watch) => watch.terminal === true).length,
    pending_count: watches.filter((watch) => isPendingState(watch.latest_review_state)).length,
    approved_count: watches.filter((watch) => isApprovedState(watch.latest_review_state)).length,
    rejected_count: watches.filter((watch) => isRejectedState(watch.latest_review_state)).length,
    cancelled_count: watches.filter((watch) => isCancelledState(watch.latest_review_state)).length,
    recent_watch_ids: watches.slice(-5).map((watch) => watch.watch_id),
    watches
  };
}

export async function discoverPendingReviewRunDirs(projectRoot, registry = null) {
  const effectiveRegistry = registry ?? await loadActiveReviewWatches(projectRoot);
  const knownRunIds = new Set((effectiveRegistry.watches ?? []).map((watch) => watch.run_id));
  const runsRoot = path.join(projectRoot, "runs");
  if (!(await fileExists(runsRoot))) {
    return [];
  }

  const discovered = [];
  const entries = await fs.readdir(runsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const runDir = path.join(runsRoot, entry.name);
    const runContext = await readOptionalJson(path.join(runDir, "00_run_context.json"));
    if (!runContext) {
      continue;
    }
    if ((runContext.run_type ?? runContext.task_mode) !== "sandbox_validation") {
      continue;
    }
    if (knownRunIds.has(runContext.run_id)) {
      continue;
    }

    const reviewStatus = await readOptionalJson(
      path.join(projectRoot, "state", "run_events", runContext.run_id, "91_review_status.json")
    );
    if (reviewStatus?.review_cancelled_manually === true && reviewStatus?.manual_action_recorded === true) {
      continue;
    }
    if (isPendingState(reviewStatus?.review_state ?? reviewStatus?.current_dashboard_state ?? null)) {
      discovered.push(runDir);
      continue;
    }

    const publishExecution = await readOptionalJson(
      path.join(projectRoot, "state", "run_events", runContext.run_id, "90_publish_execution.json")
    );
    if (isPendingState(
      publishExecution?.review_state
      ?? publishExecution?.publish_response?.body?.state
      ?? null
    )) {
      discovered.push(runDir);
    }
  }

  return discovered.sort();
}

export async function writeReviewWatchSummary(projectRoot, summary) {
  const safeSummary = {
    stage: "REVIEW_WATCH_SUMMARY",
    status: summary.failures?.length ? "passed_with_failures" : "passed",
    checked_at: summary.checked_at ?? nowIso(),
    total_watches: summary.total_watches ?? 0,
    checked_count: summary.checked_count ?? 0,
    skipped_count: summary.skipped_count ?? 0,
    live_checked_count: summary.live_checked_count ?? 0,
    preserved_state_count: summary.preserved_state_count ?? 0,
    changed_count: summary.changed_count ?? 0,
    pending_count: summary.pending_count ?? 0,
    approved_count: summary.approved_count ?? 0,
    rejected_count: summary.rejected_count ?? 0,
    cancelled_count: summary.cancelled_count ?? 0,
    failures: summary.failures ?? [],
    next_actions: summary.next_actions ?? []
  };
  await validateReviewWatchSummary(projectRoot, safeSummary);
  await writeJson(reviewWatchSummaryPath(projectRoot), safeSummary);
  return safeSummary;
}

export async function loadReviewWatchSummary(projectRoot) {
  const summaryPath = reviewWatchSummaryPath(projectRoot);
  if (!(await fileExists(summaryPath))) {
    return null;
  }
  return readJson(summaryPath);
}

export async function buildSingleRunReviewWatchSummary({
  projectRoot,
  watch,
  report,
  stateChanged
}) {
  return writeReviewWatchSummary(projectRoot, {
    checked_at: report?.checked_at ?? nowIso(),
    total_watches: watch ? 1 : 0,
    checked_count: 1,
    skipped_count: report?.status === "skipped" ? 1 : 0,
    live_checked_count: report?.status_source === "live_fetch_status" && report?.fetch_status_succeeded === true ? 1 : 0,
    preserved_state_count: report?.status_source === "preserved_last_known_state" ? 1 : 0,
    changed_count: stateChanged ? 1 : 0,
    pending_count: watch && isPendingState(watch.latest_review_state) ? 1 : 0,
    approved_count: watch && isApprovedState(watch.latest_review_state) ? 1 : 0,
    rejected_count: watch && isRejectedState(watch.latest_review_state) ? 1 : 0,
    cancelled_count: watch && isCancelledState(watch.latest_review_state) ? 1 : 0,
    failures: report?.status === "failed"
      ? [{
          run_id: report.run_id,
          failure_phase: report.failure_phase ?? null,
          failure_reason: report.failure_reason ?? null
        }]
      : [],
    next_actions: watch
      ? [{
          run_id: watch.run_id,
          review_state: watch.latest_review_state,
          next_step: watch.next_step,
          terminal: watch.terminal === true
        }]
      : []
  });
}

export async function absoluteActiveReviewWatchesPath(projectRoot) {
  const registry = await loadActiveReviewWatches(projectRoot);
  return normalizeRelativePath(projectRoot, absoluteRegistryPath(projectRoot)) || ACTIVE_REVIEW_WATCHES_PATH;
}
