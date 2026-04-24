import path from "node:path";
import { parseArgs } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import { recordHumanStrategyReview } from "../src/discovery/strategyV2.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.run || !args.decision) {
    throw new Error("Usage: node scripts/discovery_record_human_strategy_review_cli.mjs --run runs/<strategy_run> --decision continue_strategy|adjust_queries|approve_future_builder|manual_seed --note \"note\"");
  }

  const projectRoot = process.cwd();
  const result = await recordHumanStrategyReview({
    projectRoot,
    run: path.resolve(projectRoot, args.run),
    decision: args.decision,
    note: args.note ?? "",
    reviewer: "human"
  });

  console.log(JSON.stringify({
    review_path: result.reviewPath,
    decision: result.review.decision,
    next_step: result.review.next_step
  }, null, 2));
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
