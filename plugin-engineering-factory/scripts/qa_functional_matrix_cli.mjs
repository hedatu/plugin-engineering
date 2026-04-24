import path from "node:path";
import { parseArgs, readJson } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import {
  acquireWorkflowRunLock,
  ImmutableRunError,
  RunLockError
} from "../src/workflow/runLock.mjs";
import { generateFunctionalTestMatrix } from "../src/review/productQuality.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.run) {
    throw new Error("Usage: node scripts/qa_functional_matrix_cli.mjs --run runs/<sandbox_validation_run_id>");
  }

  const runDir = path.resolve(args.run);
  let lock = null;

  try {
    lock = await acquireWorkflowRunLock({
      runDir,
      owner: {
        command: "qa_functional_matrix_cli"
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

    const result = await generateFunctionalTestMatrix({ runDir });
    console.log(`Functional test matrix completed: ${runDir}`);
    console.log(`Coverage score: ${result.report.test_coverage_score}`);
    console.log(`Release blockers: ${result.report.release_blockers.length}`);
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
