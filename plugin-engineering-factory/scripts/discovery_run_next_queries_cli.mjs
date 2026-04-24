import path from "node:path";
import { parseArgs, readJson } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import {
  acquireWorkflowRunLock,
  ImmutableRunError,
  RunLockError
} from "../src/workflow/runLock.mjs";
import { runNextQueries } from "../src/discovery/researchResolution.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.run) {
    throw new Error("Usage: node scripts/discovery_run_next_queries_cli.mjs --run runs/<daily_run_id> --limit 10");
  }

  const runDir = path.resolve(args.run);
  const limit = Number.parseInt(`${args.limit ?? 10}`, 10);
  let lock = null;

  try {
    lock = await acquireWorkflowRunLock({
      runDir,
      owner: {
        command: "discovery_run_next_queries_cli"
      },
      requireMutable: false
    });
  } catch (error) {
    if (error instanceof RunLockError) {
      throw new Error(`${error.message} Existing owner: ${JSON.stringify(error.details?.existing_owner ?? "unknown")}`);
    }
    throw error;
  }

  try {
    const runContext = await readJson(path.join(runDir, "00_run_context.json"));
    if ((runContext.run_type ?? runContext.task_mode) === "sandbox_validation") {
      throw new Error(`Run ${runContext.run_id} is not a daily discovery run.`);
    }

    const result = await runNextQueries({ runDir, limit });
    console.log(`Next-query execution completed: ${runDir}`);
    console.log(`Executed: ${result.report.executed}`);
    console.log(`Live unavailable: ${result.report.live_unavailable}`);
  } finally {
    await lock?.release?.().catch(() => {});
  }
}

main().catch((error) => {
  if (error instanceof ImmutableRunError) {
    console.error(redactSecretLikeText(error.message));
    process.exitCode = 1;
    return;
  }
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
