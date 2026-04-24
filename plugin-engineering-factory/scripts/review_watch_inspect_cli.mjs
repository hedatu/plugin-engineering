import path from "node:path";
import { inspectActiveReviewWatches, loadReviewWatchSummary } from "../src/publish/activeReviewWatches.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";

async function main() {
  const projectRoot = process.cwd();
  const inspection = await inspectActiveReviewWatches(projectRoot);
  const lastSummary = await loadReviewWatchSummary(projectRoot);
  console.log(JSON.stringify({
    ...inspection,
    last_summary_path: path.join(projectRoot, "state", "review_watch_summary.json"),
    last_summary: lastSummary
  }, null, 2));
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
