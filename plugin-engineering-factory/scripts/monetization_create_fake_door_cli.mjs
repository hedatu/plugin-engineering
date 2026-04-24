import path from "node:path";
import { parseArgs } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import { createMonetizationFakeDoor } from "../src/market/marketTestMode.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.candidate) {
    throw new Error("Usage: node scripts/monetization_create_fake_door_cli.mjs --candidate <candidate_id_or_name>");
  }

  const result = await createMonetizationFakeDoor({
    projectRoot: process.cwd(),
    candidate: `${args.candidate}`
  });

  console.log(JSON.stringify({
    run_dir: result.runDir,
    run_id: path.basename(result.runDir),
    candidate_name: result.report.candidate_name,
    pricing_copy: result.report.pricing_copy,
    decision_after_test: result.report.decision_after_test
  }, null, 2));
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
