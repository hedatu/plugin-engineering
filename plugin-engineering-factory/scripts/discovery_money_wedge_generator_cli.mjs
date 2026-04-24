import path from "node:path";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import { generateMoneyFirstOpportunityEngine } from "../src/discovery/moneyFirstOpportunityEngine.mjs";

async function main() {
  const result = await generateMoneyFirstOpportunityEngine({
    projectRoot: process.cwd()
  });

  console.log(JSON.stringify({
    run_dir: result.runDir,
    run_id: path.basename(result.runDir),
    top_micro_wedges: result.wedgeCandidates.candidates.slice(0, 5).map((item) => ({
      wedge_name: item.wedge_name,
      total_money_score: item.money_scores.total_money_score,
      build_recommendation: item.build_recommendation,
      suggested_price: item.suggested_price
    })),
    recommended_first_paid_experiment: result.opsReport.recommended_first_paid_experiment
  }, null, 2));
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
