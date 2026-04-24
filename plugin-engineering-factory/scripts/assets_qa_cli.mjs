import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import {
  acquireWorkflowRunLock,
  ImmutableRunError,
  RunLockError
} from "../src/workflow/runLock.mjs";
import { runAssetQa } from "../src/packaging/premiumPackaging.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.run) {
    throw new Error("Usage: node scripts/assets_qa_cli.mjs --run runs/<run_id>");
  }

  const runDir = path.resolve(args.run);
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  let lock = null;
  try {
    lock = await acquireWorkflowRunLock({
      runDir,
      owner: {
        command: "assets_qa_cli"
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
    const result = await runAssetQa({
      projectRoot,
      runDir
    });
    console.log(JSON.stringify({
      run_dir: result.runDir,
      run_id: result.runContext.run_id,
      status: result.report.status,
      blockers: result.report.blockers.length,
      render_status: result.report.render_status
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
