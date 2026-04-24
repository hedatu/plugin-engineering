import path from "node:path";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import { selectMicroMvp } from "../src/market/marketTestMode.mjs";

async function main() {
  const result = await selectMicroMvp({ projectRoot: process.cwd() });
  console.log(JSON.stringify({
    run_dir: result.runDir,
    run_id: path.basename(result.runDir),
    selected: result.artifacts.selection.selected,
    candidate_name: result.selectedCandidate.candidate_name,
    wedge_name: result.selectedCandidate.wedge_name,
    market_test_score: result.selectedEntry.market_test_score,
    next_step: result.artifacts.selection.next_step
  }, null, 2));
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
