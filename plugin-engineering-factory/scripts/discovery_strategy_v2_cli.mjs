import path from "node:path";
import { parseArgs } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import { generateDiscoveryStrategyV2 } from "../src/discovery/strategyV2.mjs";

async function main() {
  const args = parseArgs(process.argv);
  const projectRoot = process.cwd();
  const result = await generateDiscoveryStrategyV2({
    projectRoot,
    fromRun: args["from-run"] ? path.resolve(projectRoot, args["from-run"]) : null
  });

  console.log(JSON.stringify({
    run_dir: result.runDir,
    run_id: path.basename(result.runDir),
    strategy_artifact: result.artifacts.strategy,
    builder_fit_map: result.artifacts.builder_fit,
    low_overlap_search_map: result.artifacts.low_overlap_search_map,
    source_priority_model: result.artifacts.source_priority_model
  }, null, 2));
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
