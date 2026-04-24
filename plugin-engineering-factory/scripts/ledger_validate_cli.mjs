import path from "node:path";
import { loadReleaseLedger, validateReleaseLedger } from "../src/publish/releaseLedger.mjs";

async function main() {
  const projectRoot = process.cwd();
  const ledger = await loadReleaseLedger(projectRoot);
  await validateReleaseLedger(projectRoot, ledger);
  console.log(`Release ledger is valid: ${path.join(projectRoot, "state", "release_ledger.json")}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
