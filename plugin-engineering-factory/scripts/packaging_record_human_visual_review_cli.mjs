import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, readJson } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import {
  acquireWorkflowRunLock,
  ImmutableRunError,
  RunLockError
} from "../src/workflow/runLock.mjs";
import { recordHumanVisualReview } from "../src/packaging/storeReleasePackage.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.run || !args.decision || !args.note) {
    throw new Error("Usage: node scripts/packaging_record_human_visual_review_cli.mjs --run runs/<sandbox_validation_run_id> --decision passed|revise|blocked --note \"<note>\"");
  }

  const runDir = path.resolve(args.run);
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  let lock = null;

  try {
    lock = await acquireWorkflowRunLock({
      runDir,
      owner: {
        command: "packaging_record_human_visual_review_cli"
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
    if ((runContext.run_type ?? runContext.task_mode) !== "sandbox_validation") {
      throw new Error(`Run ${runContext.run_id} is not a sandbox_validation run.`);
    }

    const report = await recordHumanVisualReview({
      projectRoot,
      runDir,
      decision: args.decision,
      note: `${args.note}`,
      reviewer: `${args.reviewer ?? ""}`.trim() || undefined
    });
    console.log(`Human visual review recorded: ${runDir}`);
    console.log(`Decision: ${report.decision}`);
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
