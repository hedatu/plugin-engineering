import path from "node:path";
import { parseArgs } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import { acquireWorkflowRunLock, RunLockError } from "../src/workflow/runLock.mjs";
import { promoteToSandboxValidation } from "../src/workflow/promoteToSandboxValidation.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args["from-run"] || !args.publisher || !args.item || !args.note) {
    throw new Error("Usage: node scripts/promote_to_sandbox_validation_cli.mjs --from-run runs/<daily_run_id> --publisher <publisher_id> --item <sandbox_item_id> --note \"...\"");
  }

  const projectRoot = process.cwd();
  const sourceRunDir = path.resolve(args["from-run"]);
  let lock = null;

  try {
    lock = await acquireWorkflowRunLock({
      runDir: sourceRunDir,
      owner: {
        command: "promote_to_sandbox_validation_cli",
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
    const result = await promoteToSandboxValidation({
      projectRoot,
      sourceRunDir,
      publisherId: `${args.publisher}`,
      itemId: `${args.item}`,
      promotionNote: `${args.note}`
    });

    console.log(`Sandbox validation run created: ${result.runDir}`);
    console.log(`Run id: ${result.runId}`);
    console.log(`Ledger entry: ${result.ledgerEntry.ledger_entry_id}`);
  } finally {
    await lock?.release?.().catch(() => {});
  }
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
