import path from "node:path";
import { ensureDir, nowIso, parseArgs, readJson, writeJson } from "../src/utils/io.mjs";
import { RunIdConflictError, prepareRunIdentity } from "../src/workflow/runId.mjs";
import {
  acquireWorkflowRunLock,
  ImmutableRunError,
  RunLockError
} from "../src/workflow/runLock.mjs";
import { runDailyWorkflow } from "../src/workflow/runDailyWorkflow.mjs";

async function writeLockFailure(runDir, error) {
  await ensureDir(runDir);
  await writeJson(path.join(runDir, "run_status.json"), {
    stage: "ACQUIRE_RUN_LOCK",
    status: "failed",
    generated_at: nowIso(),
    run_id: path.basename(runDir),
    run_id_strategy: "unknown",
    allow_overwrite: false,
    overwrite_blocked: false,
    created_at: nowIso(),
    failure_reason: `${error.message} Existing owner: ${error.details?.existing_owner ?? "unknown"}.`
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const projectRoot = process.cwd();
  const taskPath = args.task ? path.resolve(args.task) : path.join(projectRoot, "fixtures", "tasks", "daily_task.json");
  const runsRoot = args["runs-root"] ? path.resolve(args["runs-root"]) : path.join(projectRoot, "runs");
  const task = await readJson(taskPath);
  const runIdentity = await prepareRunIdentity({
    task,
    taskPath,
    runsRoot,
    explicitRunId: args["run-id"] ? `${args["run-id"]}` : null,
    allowOverwrite: args["allow-overwrite"] === true
  });
  let lock = null;

  try {
    lock = await acquireWorkflowRunLock({
      runDir: runIdentity.runDir,
      owner: {
        command: "daily_run",
        task_path: taskPath,
        run_id: runIdentity.runId
      },
      requireMutable: false
    });
  } catch (error) {
    if (error instanceof RunLockError) {
      await writeLockFailure(runIdentity.runDir, error);
    }
    throw error;
  }

  try {
    const result = await runDailyWorkflow({
      projectRoot,
      taskPath,
      runsRoot,
      runIdentity
    });

    console.log(`Run completed: ${result.runDir}`);
    console.log(`Run id: ${path.basename(result.runDir)}`);
    console.log(`Publish intent: ${result.publishPlan.publish_intent}`);
  } finally {
    await lock?.release?.().catch(() => {});
  }
}

main().catch((error) => {
  if (error instanceof RunIdConflictError || error instanceof ImmutableRunError) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
