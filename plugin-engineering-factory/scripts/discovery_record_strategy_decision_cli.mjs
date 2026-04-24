import { parseArgs } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import { recordStrategyDecision } from "../src/discovery/strategyReview.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.run || !args.decision || !args.note) {
    throw new Error("Usage: node scripts/discovery_record_strategy_decision_cli.mjs --run runs/<strategy_run_id> --decision manual_vertical_seed|continue_strategy_v2|prioritize_builder|pause_category|adjust_thresholds --note \"note\"");
  }

  const result = await recordStrategyDecision({
    projectRoot: process.cwd(),
    run: `${args.run}`,
    decision: `${args.decision}`,
    note: `${args.note}`,
    manualSeeds: args["manual-seeds"] ? `${args["manual-seeds"]}` : null,
    builderItems: args["builder-items"] ? `${args["builder-items"]}` : null,
    pausedCategories: args["pause-categories"] ? `${args["pause-categories"]}` : null,
    thresholdChanges: args.thresholds ? `${args.thresholds}` : null
  });

  console.log(JSON.stringify({
    decision_path: result.decisionPath,
    decision: result.decisionRecord.decision,
    next_step: result.decisionRecord.next_step
  }, null, 2));
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
