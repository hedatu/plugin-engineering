import path from "node:path";
import { parseArgs } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import { acquireWorkflowRunLock, RunLockError } from "../src/workflow/runLock.mjs";
import { ensureProductRevisionLineageLedgerEntry } from "../src/workflow/productRevision.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.run) {
    throw new Error("Usage: node scripts/record_product_revision_lineage_cli.mjs --run runs/<sandbox_validation_run_id>");
  }

  const runDir = path.resolve(args.run);
  let lock = null;

  try {
    lock = await acquireWorkflowRunLock({
      runDir,
      owner: {
        command: "record_product_revision_lineage_cli",
        run: path.basename(runDir)
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
    const result = await ensureProductRevisionLineageLedgerEntry({
      projectRoot: process.cwd(),
      runDir,
      actionSource: "cli"
    });
    console.log(JSON.stringify({
      run_id: result.entry.run_id,
      created: result.created,
      action_type: result.entry.action_type,
      ledger_entry_id: result.entry.ledger_entry_id
    }, null, 2));
  } finally {
    await lock?.release?.().catch(() => {});
  }
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
