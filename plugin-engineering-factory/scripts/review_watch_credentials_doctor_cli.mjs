import { runReviewWatchCredentialsDoctor } from "../src/publish/reviewWatchCredentialsDoctor.mjs";

async function main() {
  const report = await runReviewWatchCredentialsDoctor({ projectRoot: process.cwd() });
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
