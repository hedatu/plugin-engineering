import path from "node:path";
import { parseArgs, readJson } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import {
  acquireWorkflowRunLock,
  ImmutableRunError,
  RunLockError
} from "../src/workflow/runLock.mjs";
import { generateDiscoveryQualityReview } from "../src/review/discoveryQuality.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.run) {
    throw new Error("Usage: node scripts/discovery_quality_review_cli.mjs --run runs/<source_daily_run_id>");
  }

  const runDir = path.resolve(args.run);
  let lock = null;

  try {
    lock = await acquireWorkflowRunLock({
      runDir,
      owner: {
        command: "discovery_quality_review_cli"
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

    const result = await generateDiscoveryQualityReview({ runDir });
    console.log(`Discovery quality review completed: ${runDir}`);
    console.log(`Evidence quality score: ${result.review.evidence_quality_score}`);
    console.log(`Build recommendation: ${redactSecretLikeText(result.review.build_recommendation)}`);
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
