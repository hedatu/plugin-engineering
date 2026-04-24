import path from "node:path";
import { ensureDir, nowIso, parseArgs, writeJson } from "../src/utils/io.mjs";
import {
  acquireWorkflowRunLock,
  ImmutableRunError,
  prepareRepairTargetRun,
  RunLockError
} from "../src/workflow/runLock.mjs";
import { listRepairableStages, repairDailyWorkflow } from "../src/workflow/repairRunWorkflow.mjs";

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

  if (args["list-stages"]) {
    console.log(listRepairableStages().join("\n"));
    return;
  }

  if (!args.run || !args.from) {
    throw new Error("Usage: node scripts/repair_run.mjs --run runs/<run_id> --from <STAGE>. Use --list-stages to inspect valid stages.");
  }

  const target = await prepareRepairTargetRun({
    runDir: path.resolve(args.run),
    fromStage: `${args.from}`,
    repairImmutableCopy: args["repair-immutable-copy"] === true
  });
  let lock = null;

  try {
    lock = await acquireWorkflowRunLock({
      runDir: target.runDir,
      owner: {
        command: "repair_run",
        from_stage: args.from,
        repair_copy: target.copied === true
      },
      requireMutable: target.allowImmutableSidecarRepair !== true
    });
  } catch (error) {
    if (error instanceof RunLockError) {
      if (target.allowImmutableSidecarRepair !== true) {
        await writeLockFailure(target.runDir, error);
      }
    }
    throw error;
  }

  try {
    const result = await repairDailyWorkflow({
      runDir: target.runDir,
      fromStage: args.from
    });

    console.log(`Repair completed: ${result.runDir}`);
    if (target.copied) {
      console.log(`Repair copy created from immutable run: ${target.originalRunDir}`);
    }
    console.log(`Publish intent: ${result.publishPlan.publish_intent}`);
  } finally {
    await lock?.release?.().catch(() => {});
  }
}

main().catch((error) => {
  if (error instanceof ImmutableRunError) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
