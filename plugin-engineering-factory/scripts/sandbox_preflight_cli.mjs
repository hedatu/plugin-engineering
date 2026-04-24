import path from "node:path";
import { parseArgs } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import { runSandboxPreflight } from "../src/workflow/sandboxValidationReadiness.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.run) {
    throw new Error("Usage: node scripts/sandbox_preflight_cli.mjs --run runs/<sandbox_validation_run_id>");
  }

  const report = await runSandboxPreflight({
    runDir: path.resolve(args.run)
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "failed") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
