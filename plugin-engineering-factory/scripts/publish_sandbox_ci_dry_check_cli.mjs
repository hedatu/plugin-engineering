import path from "node:path";
import { parseArgs } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import { runPublishSandboxCiDryCheck } from "../src/workflow/sandboxValidationReadiness.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.run || !args.action) {
    throw new Error("Usage: node scripts/publish_sandbox_ci_dry_check_cli.mjs --run runs/<sandbox_validation_run_id> --action <sandbox_upload|sandbox_publish|upload_only|publish_optional>");
  }

  const report = await runPublishSandboxCiDryCheck({
    runDir: path.resolve(args.run),
    action: `${args.action}`
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.would_execute) {
    process.exitCode = 0;
  }
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
