import { bootstrapReviewWatchEnv } from "../src/publish/reviewWatchCredentials.mjs";
import { runReviewWatchDiagnostics } from "../src/publish/reviewWatchDiagnostics.mjs";

async function main() {
  await bootstrapReviewWatchEnv({ projectRoot: process.cwd() });
  const diagnostics = await runReviewWatchDiagnostics({ projectRoot: process.cwd() });
  console.log(JSON.stringify(diagnostics, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
