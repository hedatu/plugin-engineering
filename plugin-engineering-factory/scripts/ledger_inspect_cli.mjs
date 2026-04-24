import { inspectReleaseLedger, loadReleaseLedger } from "../src/publish/releaseLedger.mjs";

async function main() {
  const projectRoot = process.cwd();
  const summary = await inspectReleaseLedger(projectRoot);
  const ledger = await loadReleaseLedger(projectRoot);
  console.log(JSON.stringify({
    ...summary,
    recent_entries: ledger.entries.slice(-5)
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
