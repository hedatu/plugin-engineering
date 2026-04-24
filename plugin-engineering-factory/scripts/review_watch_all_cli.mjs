import path from "node:path";
import {
  discoverPendingReviewRunDirs,
  loadActiveReviewWatches,
  syncActiveReviewWatchForRun,
  writeReviewWatchSummary
} from "../src/publish/activeReviewWatches.mjs";
import { bootstrapReviewWatchEnv } from "../src/publish/reviewWatchCredentials.mjs";
import { runReviewStatusStage } from "../src/publish/reviewStatus.mjs";
import { prepareInstallVerificationPlan } from "../src/workflow/sandboxPostReview.mjs";
import {
  acquireWorkflowRunLock,
  RunLockError
} from "../src/workflow/runLock.mjs";
import { fileExists, nowIso, parseArgs, readJson } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";

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

function unique(values) {
  return [...new Set(values)];
}

async function resolveRunDir(projectRoot, value) {
  const candidate = path.isAbsolute(value)
    ? value
    : value.startsWith("runs/")
      ? path.resolve(value)
      : path.join(projectRoot, "runs", value);
  if (!(await fileExists(candidate))) {
    throw new Error(`Run directory not found: ${candidate}`);
  }
  return candidate;
}

async function discoverTargetRunDirs(projectRoot, runArg = null) {
  if (runArg) {
    return [await resolveRunDir(projectRoot, runArg)];
  }

  const registry = await loadActiveReviewWatches(projectRoot);
  const activeRunDirs = await Promise.all(
    registry.watches
      .filter((watch) => watch.enabled === true && watch.terminal !== true)
      .map(async (watch) => {
        const candidate = path.join(projectRoot, "runs", watch.run_id);
        return (await fileExists(candidate)) ? candidate : null;
      })
  );
  const discoveredRunDirs = await discoverPendingReviewRunDirs(projectRoot, registry);
  return unique([
    ...activeRunDirs.filter(Boolean),
    ...discoveredRunDirs
  ]).sort();
}

async function processRun({ projectRoot, runDir }) {
  const runContext = await readJson(path.join(runDir, "00_run_context.json"));
  if ((runContext.run_type ?? runContext.task_mode) !== "sandbox_validation") {
    throw new Error(`Run ${runContext.run_id} is not a sandbox_validation run.`);
  }

  const registryBefore = await loadActiveReviewWatches(projectRoot);
  const previousWatch = registryBefore.watches.find((watch) => watch.run_id === runContext.run_id) ?? null;

  let lock = null;
  try {
    lock = await acquireWorkflowRunLock({
      runDir,
      owner: {
        command: "review_watch_all_cli"
      },
      requireMutable: false
    });
  } catch (error) {
    if (error instanceof RunLockError) {
      throw new Error(`${error.message} Existing owner: ${JSON.stringify(error.details?.existing_owner ?? "unknown")}`);
    }
    throw error;
  }

  let report;
  let installPlan = null;
  try {
    report = await runReviewStatusStage({ runDir });
    if (report.is_approved === true || isApprovedState(report.review_state)) {
      installPlan = await prepareInstallVerificationPlan({ runDir });
    }
  } finally {
    await lock?.release?.().catch(() => {});
  }

  const syncResult = await syncActiveReviewWatchForRun({
    runDir,
    runContext,
    reviewStatus: report
  });
  const nextWatch = syncResult.watch
    ?? (await loadActiveReviewWatches(projectRoot)).watches.find((watch) => watch.run_id === runContext.run_id)
    ?? null;

  return {
    run_id: runContext.run_id,
    report,
    install_plan: installPlan,
    previous_watch: previousWatch,
    watch: nextWatch,
    state_changed: normalizeState(previousWatch?.latest_review_state) !== normalizeState(nextWatch?.latest_review_state)
      || Boolean(previousWatch?.terminal) !== Boolean(nextWatch?.terminal)
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const projectRoot = process.cwd();
  await bootstrapReviewWatchEnv({ projectRoot });
  const targetRunDirs = await discoverTargetRunDirs(projectRoot, args.run ? `${args.run}` : null);
  const failures = [];
  const processed = [];

  for (const runDir of targetRunDirs) {
    try {
      processed.push(await processRun({ projectRoot, runDir }));
    } catch (error) {
      const runId = path.basename(runDir);
      failures.push({
        run_id: runId,
        failure_phase: "review_watch_all",
        failure_reason: redactSecretLikeText(error.message)
      });
    }
  }

  const registry = await loadActiveReviewWatches(projectRoot);
  for (const entry of processed) {
    if (entry.report?.status === "failed") {
      failures.push({
        run_id: entry.run_id,
        failure_phase: entry.report.failure_phase ?? "review_status",
        failure_reason: entry.report.failure_reason ?? "review status failed"
      });
    }
  }

  const summary = await writeReviewWatchSummary(projectRoot, {
    checked_at: nowIso(),
    total_watches: registry.watches.length,
    checked_count: processed.length,
    skipped_count: processed.filter((entry) => entry.report.status === "skipped").length,
    live_checked_count: processed.filter((entry) =>
      entry.report.status_source === "live_fetch_status" && entry.report.fetch_status_succeeded === true
    ).length,
    preserved_state_count: processed.filter((entry) =>
      entry.report.status_source === "preserved_last_known_state"
    ).length,
    changed_count: processed.filter((entry) => entry.state_changed).length,
    pending_count: registry.watches.filter((watch) => isPendingState(watch.latest_review_state)).length,
    approved_count: registry.watches.filter((watch) => isApprovedState(watch.latest_review_state)).length,
    rejected_count: registry.watches.filter((watch) => isRejectedState(watch.latest_review_state)).length,
    cancelled_count: registry.watches.filter((watch) => isCancelledState(watch.latest_review_state)).length,
    failures,
    next_actions: processed.map((entry) => ({
      run_id: entry.run_id,
      review_state: entry.watch?.latest_review_state ?? entry.report.review_state ?? null,
      status_source: entry.report.status_source ?? null,
      next_step: entry.install_plan?.next_step ?? entry.watch?.next_step ?? entry.report.next_step,
      terminal: entry.watch?.terminal === true
    }))
  });

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
