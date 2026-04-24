import path from "node:path";
import { parseArgs } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import {
  acquireWorkflowRunLock,
  ImmutableRunError,
  RunLockError
} from "../src/workflow/runLock.mjs";
import { runTargetedResearchBatch } from "../src/discovery/targetedResearchBatch.mjs";

async function main() {
  const args = parseArgs(process.argv);
  const projectRoot = process.cwd();
  const runDir = args.run ? path.resolve(projectRoot, args.run) : null;
  let lock = null;

  try {
    if (runDir) {
      lock = await acquireWorkflowRunLock({
        runDir,
        owner: {
          command: "discovery_targeted_research_batch_cli"
        },
        requireMutable: false
      });
    }
  } catch (error) {
    if (error instanceof RunLockError) {
      throw new Error(`${error.message} Existing owner: ${JSON.stringify(error.details?.existing_owner ?? "unknown")}`);
    }
    throw error;
  }

  try {
    const result = await runTargetedResearchBatch({
      runDir,
      top: Number(args.top ?? 10) || 10,
      projectRoot
    });
    console.log(`Targeted research batch completed: ${redactSecretLikeText(result.batchReport.run_id)}`);
    console.log(`Build ready: ${result.batchReport.build_ready_count}`);
    console.log(`Research more: ${result.batchReport.research_more_count}`);
    console.log(`Skip: ${result.batchReport.skip_count}`);
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
