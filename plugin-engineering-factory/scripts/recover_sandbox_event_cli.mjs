import { appendReleaseLedgerEvent } from "../src/publish/releaseLedger.mjs";
import { nowIso, parseArgs, slugify } from "../src/utils/io.mjs";

function defaultRecoveredRunId({ event, itemId }) {
  const date = nowIso().slice(0, 10);
  return `recovered-${date}-${slugify(event) || "sandbox-event"}-${slugify(itemId).slice(0, 6) || "item"}`;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.item || !args.publisher || !args.event || !args.status || !args.note) {
    throw new Error("Usage: node scripts/recover_sandbox_event_cli.mjs --item <item_id> --publisher <publisher_id> --event <action_type> --status <status> --note \"...\"");
  }

  const projectRoot = process.cwd();
  const runId = args.run ?? defaultRecoveredRunId({
    event: `${args.event}`,
    itemId: `${args.item}`
  });

  const entry = await appendReleaseLedgerEvent(projectRoot, {
    runId,
    itemId: `${args.item}`,
    publisherId: `${args.publisher}`,
    actionType: `${args.event}`,
    actionSource: "api",
    actionStatus: `${args.status}`,
    dashboardManualNote: `${args.note}`,
    productionWrite: false,
    sandboxOnly: true,
    evidenceQuality: "manual_reconstructed",
    originalArtifactAvailable: false,
    recoveryReason: "fixed_run_id_overwrite"
  });

  console.log(JSON.stringify(entry, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
