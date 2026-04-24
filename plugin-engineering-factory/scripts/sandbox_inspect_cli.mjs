import path from "node:path";
import { inspectReleaseLedger, loadReleaseLedger } from "../src/publish/releaseLedger.mjs";
import { inspectRunEventArtifacts } from "../src/workflow/runEventArtifacts.mjs";
import { inspectSandboxValidationState } from "../src/workflow/sandboxValidationReadiness.mjs";
import { parseArgs, readJson } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.run) {
    throw new Error("Usage: node scripts/sandbox_inspect_cli.mjs --run runs/<sandbox_validation_run_id>");
  }

  const runDir = path.resolve(args.run);
  const runContext = await readJson(path.join(runDir, "00_run_context.json"));
  if ((runContext.run_type ?? runContext.task_mode) !== "sandbox_validation") {
    throw new Error(`Run ${runContext.run_id} is not a sandbox_validation run.`);
  }

  const projectRoot = runContext.project_root;
  const eventArtifacts = await inspectRunEventArtifacts(projectRoot, runContext.run_id);
  const ledger = await loadReleaseLedger(projectRoot);
  const ledgerEntries = ledger.entries.filter((entry) => entry.run_id === runContext.run_id || entry.sandbox_run_id === runContext.run_id);

  const summary = await inspectSandboxValidationState({ runDir });

  console.log(JSON.stringify({
    ...summary,
    event_artifacts: eventArtifacts,
    ledger_entries_count: ledgerEntries.length,
    ledger_path: (await inspectReleaseLedger(projectRoot)).path
  }, null, 2));
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
