import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import { runMonetizationSecurityScan } from "../src/monetization/integration.mjs";

async function main() {
  const args = parseArgs(process.argv);
  const scriptPath = fileURLToPath(import.meta.url);
  const projectRoot = path.resolve(path.dirname(scriptPath), "..");
  const result = await runMonetizationSecurityScan({
    projectRoot,
    runDir: args.run ? path.resolve(args.run) : null
  });

  console.log(JSON.stringify({
    run_dir: result.runDir,
    run_id: result.runContext.run_id,
    status: result.report.status,
    findings: result.report.findings.length,
    checkout_mode: result.report.checkout_mode,
    live_checkout_blocked_without_approval: result.report.live_checkout_blocked_without_approval
  }, null, 2));
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
