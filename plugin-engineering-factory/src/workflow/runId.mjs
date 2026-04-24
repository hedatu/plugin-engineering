import crypto from "node:crypto";
import path from "node:path";
import { fileExists, slugify } from "../utils/io.mjs";

const TASK_MODES = new Set([
  "daily",
  "test_fixture",
  "sandbox_validation"
]);

export class RunIdConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "RunIdConflictError";
    this.code = "RUN_ID_CONFLICT";
    this.details = details;
  }
}

function pad(value) {
  return `${value}`.padStart(2, "0");
}

function formatLocalTimestampParts(date = new Date()) {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return {
    date: `${year}-${month}-${day}`,
    time: `${hours}${minutes}${seconds}`,
    stamp: `${year}-${month}-${day}-${hours}${minutes}${seconds}`
  };
}

function shortRandom() {
  return crypto.randomBytes(3).toString("hex");
}

function sandboxItemSlug(task) {
  const value = task?.publish?.sandbox_item_id ?? task?.publish?.existing_item_id ?? task?.run_id ?? "sandbox";
  return slugify(`${value}`.slice(0, 12)) || "sandbox";
}

export function resolveTaskMode(task = {}) {
  const explicitMode = `${task.mode ?? ""}`.trim();
  if (TASK_MODES.has(explicitMode)) {
    return explicitMode;
  }
  if (task?.publish?.execution_mode === "sandbox_validate") {
    return "sandbox_validation";
  }
  return "daily";
}

export function deriveTaskSlug(task = {}, taskPath = "") {
  const baseNameSlug = slugify(
    path.basename(taskPath, path.extname(taskPath))
      .replace(/_task$/i, "")
      .replace(/^daily[_-]?/i, "daily")
  );
  const candidates = [
    task.run_slug,
    task.task_slug,
    task.name,
    baseNameSlug,
    task.run_id
  ];

  for (const candidate of candidates) {
    const slug = slugify(`${candidate ?? ""}`);
    if (slug) {
      return slug;
    }
  }

  return "run";
}

export function buildUniqueRunId({ task, taskPath, mode, now = new Date() }) {
  const timestamp = formatLocalTimestampParts(now);
  if (mode === "sandbox_validation") {
    return `sandbox-${timestamp.stamp}-${sandboxItemSlug(task)}-${shortRandom()}`;
  }

  return `${timestamp.stamp}-${deriveTaskSlug(task, taskPath)}-${shortRandom()}`;
}

export async function prepareRunIdentity({
  task,
  taskPath,
  runsRoot,
  explicitRunId = null,
  allowOverwrite = false,
  now = new Date()
}) {
  const taskMode = resolveTaskMode(task);
  const explicitRunIdRequested = Boolean(explicitRunId);
  const stableFixtureRequested = Boolean(!explicitRunId && task.run_id);
  const requestedRunId = explicitRunId ?? task.run_id ?? null;

  if (allowOverwrite && taskMode !== "test_fixture") {
    throw new RunIdConflictError(
      "--allow-overwrite is only permitted when task.mode=test_fixture.",
      {
        task_mode: taskMode,
        allow_overwrite: true,
        overwrite_blocked: true
      }
    );
  }

  if (stableFixtureRequested && taskMode !== "test_fixture") {
    return ensureRunIdAvailable({
      runId: buildUniqueRunId({ task, taskPath, mode: taskMode, now }),
      runsRoot,
      taskMode,
      task,
      taskPath,
      allowOverwrite: false,
      runIdStrategy: taskMode === "sandbox_validation"
        ? "sandbox_validation_unique"
        : "timestamp_slug_unique"
    });
  }

  if (explicitRunIdRequested) {
    return ensureRunIdAvailable({
      runId: requestedRunId,
      runsRoot,
      taskMode,
      task,
      taskPath,
      allowOverwrite: false,
      runIdStrategy: "explicit_cli_run_id"
    });
  }

  if (stableFixtureRequested) {
    return ensureRunIdAvailable({
      runId: requestedRunId,
      runsRoot,
      taskMode,
      task,
      taskPath,
      allowOverwrite,
      runIdStrategy: "stable_fixture"
    });
  }

  return ensureRunIdAvailable({
    runId: buildUniqueRunId({ task, taskPath, mode: taskMode, now }),
    runsRoot,
    taskMode,
    task,
    taskPath,
    allowOverwrite: false,
    runIdStrategy: taskMode === "sandbox_validation"
      ? "sandbox_validation_unique"
      : "timestamp_slug_unique"
  });
}

async function ensureRunIdAvailable({
  runId,
  runsRoot,
  taskMode,
  task,
  taskPath,
  allowOverwrite,
  runIdStrategy
}) {
  const runDir = path.join(runsRoot, runId);
  const exists = await fileExists(runDir);
  const immutablePath = path.join(runDir, ".immutable");
  const immutable = exists && await fileExists(immutablePath);
  const overwriteAllowed = Boolean(allowOverwrite && taskMode === "test_fixture" && exists && !immutable);

  if (exists && !overwriteAllowed) {
    throw new RunIdConflictError(
      `Refusing to reuse existing run directory ${runDir}.`,
      {
        run_id: runId,
        run_dir: runDir,
        task_mode: taskMode,
        allow_overwrite: Boolean(allowOverwrite),
        overwrite_blocked: true,
        immutable
      }
    );
  }

  return {
    runId,
    runDir,
    taskMode,
    taskSlug: deriveTaskSlug(task, taskPath),
    runIdStrategy,
    allowOverwrite: overwriteAllowed,
    overwriteBlocked: false,
    createdAt: new Date().toISOString(),
    explicitRunIdUsed: Boolean(runId)
  };
}

export function buildImmutableRepairCopyRunId(runId, now = new Date()) {
  const timestamp = formatLocalTimestampParts(now);
  return `${slugify(runId) || "run"}-repair-${timestamp.time}-${shortRandom()}`;
}
