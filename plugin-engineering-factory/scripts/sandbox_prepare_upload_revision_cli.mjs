import path from "node:path";
import { parseArgs } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import { acquireWorkflowRunLock, RunLockError } from "../src/workflow/runLock.mjs";
import { prepareSandboxUploadRevision } from "../src/workflow/prepareSandboxUploadRevision.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args["from-run"] || !args["target-version"] || !args.note) {
    throw new Error("Usage: node scripts/sandbox_prepare_upload_revision_cli.mjs --from-run runs/<sandbox_run_id> --target-version <auto|x.y.z> --note \"...\"");
  }

  const sourceRunDir = path.resolve(args["from-run"]);
  let lock = null;

  try {
    lock = await acquireWorkflowRunLock({
      runDir: sourceRunDir,
      owner: {
        command: "sandbox_prepare_upload_revision_cli",
        source_run: path.basename(sourceRunDir)
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
    const result = await prepareSandboxUploadRevision({
      projectRoot: process.cwd(),
      sourceRunDir,
      targetVersion: `${args["target-version"]}`,
      note: `${args.note}`
    });
    console.log(JSON.stringify({
      run_id: result.runId,
      run_dir: result.runDir,
      target_manifest_version: result.revisionArtifact.target_manifest_version,
      new_package_sha256: result.revisionArtifact.new_package_sha256,
      next_step: result.revisionArtifact.next_step,
      ledger_entry_id: result.ledgerEntry.ledger_entry_id
    }, null, 2));
  } finally {
    await lock?.release?.().catch(() => {});
  }
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});

