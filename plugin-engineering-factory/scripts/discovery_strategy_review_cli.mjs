import path from "node:path";
import { parseArgs } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import { generateDiscoveryStrategyReview } from "../src/discovery/strategyReview.mjs";

async function main() {
  const args = parseArgs(process.argv);
  const result = await generateDiscoveryStrategyReview({
    projectRoot: process.cwd(),
    fromRun: args["from-run"] ? `${args["from-run"]}` : null
  });

  console.log(JSON.stringify({
    run_dir: result.runDir,
    run_id: path.basename(result.runDir),
    reviewed_runs: result.review.reviewed_runs,
    recommended_primary_strategy: result.review.recommended_primary_strategy,
    next_step: result.review.next_step
  }, null, 2));
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
