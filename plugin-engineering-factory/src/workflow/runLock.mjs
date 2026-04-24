import fs from "node:fs/promises";
import path from "node:path";
import { acquireRunLock as acquireFilesystemRunLock, RunLockError } from "../utils/runLock.mjs";
import { copyDir, ensureDir, fileExists, nowIso, readJson, writeJson } from "../utils/io.mjs";
import { buildImmutableRepairCopyRunId } from "./runId.mjs";

export const IMMUTABLE_MARKER = ".immutable";

export class ImmutableRunError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ImmutableRunError";
    this.code = "IMMUTABLE_RUN";
    this.details = details;
  }
}

export function immutableMarkerPath(runDir) {
  return path.join(path.resolve(runDir), IMMUTABLE_MARKER);
}

export async function isRunImmutable(runDir) {
  return fileExists(immutableMarkerPath(runDir));
}

export async function assertRunMutable(runDir, command) {
  if (await isRunImmutable(runDir)) {
    throw new ImmutableRunError(
      `Run ${path.resolve(runDir)} is immutable and cannot be modified by ${command}.`,
      {
        run_dir: path.resolve(runDir),
        command,
        immutable: true
      }
    );
  }
}

async function writeCopiedRunContext(runDir, originalRunId) {
  const contextPath = path.join(runDir, "00_run_context.json");
  if (!(await fileExists(contextPath))) {
    return;
  }

  const runContext = await readJson(contextPath);
  const nextRunId = path.basename(runDir);
  const nextContext = {
    ...runContext,
    run_id: nextRunId,
    original_run_id: originalRunId,
    repair_copy_of_run_id: originalRunId,
    run_id_strategy: "repair_immutable_copy",
    allow_overwrite: false,
    overwrite_blocked: false,
    created_at: nowIso()
  };
  await writeJson(contextPath, nextContext);
}

async function writeCopiedRunStatus(runDir) {
  const runStatusPath = path.join(runDir, "run_status.json");
  const nextRunId = path.basename(runDir);
  await writeJson(runStatusPath, {
    stage: "REPAIR_IMMUTABLE_COPY",
    status: "passed",
    generated_at: nowIso(),
    run_id: nextRunId,
    run_id_strategy: "repair_immutable_copy",
    allow_overwrite: false,
    overwrite_blocked: false,
    created_at: nowIso(),
    failure_reason: null
  });
}

export async function cloneImmutableRunForRepair({ runDir, fromStage }) {
  const absoluteRunDir = path.resolve(runDir);
  const runsRoot = path.dirname(absoluteRunDir);
  const originalRunId = path.basename(absoluteRunDir);
  const copyRunId = buildImmutableRepairCopyRunId(originalRunId);
  const copyRunDir = path.join(runsRoot, copyRunId);

  if (await fileExists(copyRunDir)) {
    throw new ImmutableRunError(`Repair copy target already exists: ${copyRunDir}`, {
      run_dir: absoluteRunDir,
      copy_run_dir: copyRunDir,
      from_stage: fromStage
    });
  }

  await ensureDir(copyRunDir);
  await copyDir(absoluteRunDir, copyRunDir);
  await fs.rm(immutableMarkerPath(copyRunDir), { force: true });
  await writeCopiedRunContext(copyRunDir, originalRunId);
  await writeCopiedRunStatus(copyRunDir);

  return {
    originalRunDir: absoluteRunDir,
    originalRunId,
    copyRunDir,
    copyRunId
  };
}

export async function prepareRepairTargetRun({ runDir, fromStage, repairImmutableCopy = false }) {
  const absoluteRunDir = path.resolve(runDir);
  const immutable = await isRunImmutable(absoluteRunDir);
  if (!immutable) {
    return {
      runDir: absoluteRunDir,
      copied: false,
      originalRunDir: absoluteRunDir,
      originalRunId: path.basename(absoluteRunDir),
      allowImmutableSidecarRepair: false
    };
  }

  const runContextPath = path.join(absoluteRunDir, "00_run_context.json");
  const runContext = await (await fileExists(runContextPath) ? readJson(runContextPath) : null);
  const normalizedStage = `${fromStage ?? ""}`.trim().toUpperCase();
  const sandboxReadOnlyStage = ["REVIEW_STATUS", "MONITOR_POST_RELEASE", "CLOSE_RUN"].includes(normalizedStage);
  const sandboxValidationRun = runContext?.run_type === "sandbox_validation" || runContext?.task_mode === "sandbox_validation";
  if (sandboxValidationRun && sandboxReadOnlyStage) {
    return {
      runDir: absoluteRunDir,
      copied: false,
      originalRunDir: absoluteRunDir,
      originalRunId: path.basename(absoluteRunDir),
      allowImmutableSidecarRepair: true
    };
  }

  if (!repairImmutableCopy) {
    throw new ImmutableRunError(
      `Run ${absoluteRunDir} is immutable. Use --repair-immutable-copy to repair a copied run instead.`,
      {
        run_dir: absoluteRunDir,
        from_stage: fromStage,
        immutable: true
      }
    );
  }

  const copy = await cloneImmutableRunForRepair({
    runDir: absoluteRunDir,
    fromStage
  });

  return {
    runDir: copy.copyRunDir,
    copied: true,
    originalRunDir: copy.originalRunDir,
    originalRunId: copy.originalRunId,
    copyRunId: copy.copyRunId,
    allowImmutableSidecarRepair: false
  };
}

export async function acquireWorkflowRunLock({ runDir, owner, requireMutable = true }) {
  const absoluteRunDir = path.resolve(runDir);
  if (requireMutable) {
    await assertRunMutable(absoluteRunDir, owner?.command ?? "workflow");
  }
  return acquireFilesystemRunLock({
    runDir: absoluteRunDir,
    owner
  });
}

export { RunLockError };
