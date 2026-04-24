import { parseArgs } from "../src/utils/io.mjs";
import { selectNextBuildCandidate } from "../src/discovery/liveQueue.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.scores) {
    throw new Error("Usage: node scripts/discovery_select_next_build_candidate_cli.mjs --scores runs/<live_queue_run>/43_batch_opportunity_scores.json");
  }

  const result = await selectNextBuildCandidate({
    scoreArtifactPath: `${args.scores}`
  });

  console.log(JSON.stringify({
    artifact: result.artifact,
    ...result.selectedCandidate
  }, null, 2));
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
