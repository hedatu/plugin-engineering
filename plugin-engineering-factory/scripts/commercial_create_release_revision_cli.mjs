import path from "node:path";
import { parseArgs, readJson } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import {
  acquireWorkflowRunLock,
  ImmutableRunError,
  RunLockError
} from "../src/workflow/runLock.mjs";
import { createCommercialReleaseRevision } from "../src/workflow/commercialReleaseRevision.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args["from-run"] || !args["target-version"] || !args.note) {
    throw new Error("Usage: node scripts/commercial_create_release_revision_cli.mjs --from-run runs/<sandbox_validation_run_id> --target-version 0.2.0 --note \"<note>\"");
  }

  const sourceRunDir = path.resolve(args["from-run"]);
  let lock = null;

  try {
    lock = await acquireWorkflowRunLock({
      runDir: sourceRunDir,
      owner: {
        command: "commercial_create_release_revision_cli"
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

    const result = await createCommercialReleaseRevision({
      projectRoot: runContext.project_root,
      sourceRunDir,
      targetVersion: `${args["target-version"]}`,
      note: `${args.note}`
    });
    console.log(JSON.stringify({
      commercial_run_id: result.runId,
      manifest_version: result.manifestVersion,
      product_acceptance_status: result.acceptanceReview.acceptance_status,
      functional_test_coverage_score: result.functionalMatrix.test_coverage_score,
      upload_allowed: false,
      publish_allowed: false
    }, null, 2));
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
