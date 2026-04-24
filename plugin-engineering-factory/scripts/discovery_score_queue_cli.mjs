import { parseArgs } from "../src/utils/io.mjs";
import { scoreDiscoveryQueue } from "../src/discovery/liveQueue.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.queue) {
    throw new Error("Usage: node scripts/discovery_score_queue_cli.mjs --queue runs/<live_queue_run>/41_live_candidate_queue.json");
  }

  const result = await scoreDiscoveryQueue({
    queueArtifactPath: `${args.queue}`
  });

  console.log(JSON.stringify({
    score_artifact: result.scoreArtifact,
    build_ready_count: result.scoredReport.build_ready_count,
    top_ranked_candidates: (result.scoredReport.top_ranked_opportunities ?? []).slice(0, 10).map((item) => ({
      candidate_id: item.candidate_id,
      candidate_name: item.name,
      build_recommendation: item.build_recommendation,
      total_score: item.total_score
    }))
  }, null, 2));
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
