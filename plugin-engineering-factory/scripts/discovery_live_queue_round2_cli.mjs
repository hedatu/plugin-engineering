import path from "node:path";
import { parseArgs } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import { runLiveQueueRound2 } from "../src/discovery/liveQueueRound2.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.queries) {
    throw new Error("Usage: node scripts/discovery_live_queue_round2_cli.mjs --queries runs/<run_id>/50_query_expansion_plan.json --limit 20 --max-candidates 80");
  }

  const projectRoot = process.cwd();
  const result = await runLiveQueueRound2({
    projectRoot,
    queries: path.isAbsolute(args.queries) ? args.queries : `${args.queries}`,
    limit: Number(args.limit ?? 20) || 20,
    maxCandidates: Number(args["max-candidates"] ?? 80) || 80
  });

  console.log(JSON.stringify({
    run_dir: result.runDir,
    run_id: path.basename(result.runDir),
    live_unavailable: result.resultsAlias.live_unavailable,
    total_candidates_found: result.resultsAlias.total_candidates_found,
    build_ready_count: result.scoresAlias.build_ready_count,
    next_candidate: result.nextCandidateAlias.candidate_name,
    artifacts: result.artifacts
  }, null, 2));
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
