import path from "node:path";
import { loadActiveReviewWatches, validateActiveReviewWatches } from "../src/publish/activeReviewWatches.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";

async function main() {
  const projectRoot = process.cwd();
  const registry = await loadActiveReviewWatches(projectRoot);
  await validateActiveReviewWatches(projectRoot, registry);
  console.log(`Active review watch registry is valid: ${path.join(projectRoot, "state", "active_review_watches.json")}`);
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
