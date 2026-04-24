import path from "node:path";
import { parseArgs, readJson } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import {
  acquireWorkflowRunLock,
  ImmutableRunError,
  RunLockError
} from "../src/workflow/runLock.mjs";
import { bootstrapReviewWatchEnv } from "../src/publish/reviewWatchCredentials.mjs";
import { isRunImmutable } from "../src/workflow/runLock.mjs";
import { runReviewStatusStage } from "../src/publish/reviewStatus.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.run) {
    throw new Error("Usage: node scripts/publish_review_status_cli.mjs --run runs/<run_id>");
  }

  const runDir = path.resolve(args.run);
  await bootstrapReviewWatchEnv({ projectRoot: process.cwd() });
  let lock = null;

  try {
    lock = await acquireWorkflowRunLock({
      runDir,
      owner: {
        command: "publish_review_status_cli"
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
    if (await isRunImmutable(runDir)) {
      const runType = runContext.run_type ?? runContext.task_mode;
      if (runType !== "sandbox_validation") {
        throw new ImmutableRunError(`Run ${runDir} is immutable. Use --repair-immutable-copy for non-sandbox review refreshes.`);
      }
    }
    const report = await runReviewStatusStage({ runDir });
    console.log(`Review status completed: ${runDir}`);
    console.log(`Status: ${report.status}`);
    console.log(`Review state: ${report.review_state ?? report.current_dashboard_state ?? "unknown"}`);
    console.log(`Next step: ${redactSecretLikeText(report.next_step)}`);
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
