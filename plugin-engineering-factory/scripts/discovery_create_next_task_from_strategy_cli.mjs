import { createNextTaskFromStrategy } from "../src/discovery/strategyReview.mjs";
import { parseArgs } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args["strategy-run"] || !args["decision-file"]) {
    throw new Error("Usage: node scripts/discovery_create_next_task_from_strategy_cli.mjs --strategy-run runs/<strategy_run_id> --decision-file state/discovery_strategy_reviews/<decision_file>.json");
  }

  const result = await createNextTaskFromStrategy({
    projectRoot: process.cwd(),
    strategyRun: `${args["strategy-run"]}`,
    decisionFile: `${args["decision-file"]}`
  });

  console.log(JSON.stringify({
    task_path: result.taskPath,
    discovery_mode: result.task.discovery.mode,
    allow_auto_build: result.task.discovery.allow_auto_build
  }, null, 2));
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
