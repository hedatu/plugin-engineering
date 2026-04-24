import path from "node:path";
import { parseArgs } from "../src/utils/io.mjs";
import { bootstrapLiveQueueFromQueriesArtifact } from "../src/discovery/liveQueue.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args["queries-from"]) {
    throw new Error("Usage: node scripts/discovery_live_queue_cli.mjs --queries-from runs/<run_id>/34_demand_discovery_improvement_plan.json --limit 10 --max-candidates 50");
  }

  const projectRoot = process.cwd();
  const result = await bootstrapLiveQueueFromQueriesArtifact({
    projectRoot,
    queriesFrom: `${args["queries-from"]}`,
    limit: Number(args.limit ?? 10),
    maxCandidates: Number(args["max-candidates"] ?? 50)
  });

  console.log(JSON.stringify({
    run_dir: result.runDir,
    run_id: path.basename(result.runDir),
    source_run_id: result.sourceRunId,
    live_unavailable: result.queryReport.live_unavailable,
    total_candidates_found: result.candidateQueue.total_candidates_found,
    deduped_candidates: result.candidateQueue.deduped_candidates,
    queue_artifact: result.queueArtifact
  }, null, 2));
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
