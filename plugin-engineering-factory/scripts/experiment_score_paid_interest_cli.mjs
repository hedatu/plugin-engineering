import path from "node:path";
import { parseArgs } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import { scorePaidInterestExperiment } from "../src/market/marketTestMode.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.experiment) {
    throw new Error("Usage: node scripts/experiment_score_paid_interest_cli.mjs --experiment <candidate_or_wedge>");
  }

  const result = await scorePaidInterestExperiment({
    projectRoot: process.cwd(),
    experiment: `${args.experiment}`
  });

  console.log(JSON.stringify({
    run_dir: result.runDir,
    run_id: path.basename(result.runDir),
    candidate_name: result.report.candidate_name,
    wedge_name: result.report.wedge_name,
    paid_interest_score: result.report.paid_interest_score,
    market_test_risk: result.report.market_test_risk,
    recommended_action: result.report.recommended_action
  }, null, 2));
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
