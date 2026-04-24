import path from "node:path";
import { parseArgs, readJson } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import {
  acquireWorkflowRunLock,
  ImmutableRunError,
  RunLockError
} from "../src/workflow/runLock.mjs";
import { createProductRevisionRun } from "../src/workflow/productRevision.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args["from-run"] || !args.note) {
    throw new Error("Usage: node scripts/product_create_revision_run_cli.mjs --from-run runs/<sandbox_validation_run_id> --note \"<note>\"");
  }

  const sourceRunDir = path.resolve(args["from-run"]);
  let lock = null;

  try {
    lock = await acquireWorkflowRunLock({
      runDir: sourceRunDir,
      owner: {
        command: "product_create_revision_run_cli"
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
    const runContext = await readJson(path.join(sourceRunDir, "00_run_context.json"));
    if ((runContext.run_type ?? runContext.task_mode) !== "sandbox_validation") {
      throw new Error(`Run ${runContext.run_id} is not a sandbox_validation run.`);
    }

    const result = await createProductRevisionRun({
      projectRoot: runContext.project_root,
      sourceRunDir,
      note: `${args.note}`
    });
    console.log(`Product revision run created: ${result.runId}`);
    console.log(`Manifest version: ${result.manifestVersion}`);
    console.log(`Acceptance status: ${redactSecretLikeText(result.acceptanceReview.acceptance_status)}`);
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
