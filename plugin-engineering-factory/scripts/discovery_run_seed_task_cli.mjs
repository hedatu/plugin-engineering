import path from "node:path";
import { parseArgs } from "../src/utils/io.mjs";
import { runSeedTask } from "../src/discovery/seedTask.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.task) {
    throw new Error("Usage: node scripts/discovery_run_seed_task_cli.mjs --task runs/<strategy_review_run>/67_next_discovery_task.json");
  }

  const result = await runSeedTask({
    projectRoot: process.cwd(),
    taskPath: `${args.task}`
  });

  console.log(JSON.stringify({
    run_dir: result.runDir,
    run_id: path.basename(result.runDir),
    live_unavailable: result.queryReport.live_unavailable === true,
    total_candidates_found: result.candidateQueue.total_candidates_found,
    build_ready_count: result.opportunityScores.build_ready_count,
    next_candidate: {
      candidate_id: result.nextCandidate.candidate_id,
      candidate_name: result.nextCandidate.candidate_name,
      seed_id: result.nextCandidate.seed_id,
      build_recommendation: result.nextCandidate.build_recommendation
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
