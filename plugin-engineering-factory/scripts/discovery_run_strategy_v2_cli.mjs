import path from "node:path";
import { parseArgs } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import { runStrategyV2Queries } from "../src/discovery/strategyV2Runner.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.strategy) {
    throw new Error("Usage: node scripts/discovery_run_strategy_v2_cli.mjs --strategy runs/<strategy_run>/57_low_overlap_search_map.json --limit 30 --max-candidates 120");
  }

  const projectRoot = process.cwd();
  const result = await runStrategyV2Queries({
    projectRoot,
    strategy: path.isAbsolute(args.strategy) ? args.strategy : `${args.strategy}`,
    limit: Number(args.limit ?? 30) || 30,
    maxCandidates: Number(args["max-candidates"] ?? 120) || 120
  });

  console.log(JSON.stringify({
    run_dir: result.runDir,
    run_id: path.basename(result.runDir),
    total_candidates_found: result.resultsAlias.total_candidates_found,
    build_ready_count: result.scoresAlias.build_ready_count,
    next_candidate: result.nextCandidateAlias.candidate_name,
    no_build_today_report: result.noBuildTodayReport ? "generated" : "not_generated"
  }, null, 2));
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
