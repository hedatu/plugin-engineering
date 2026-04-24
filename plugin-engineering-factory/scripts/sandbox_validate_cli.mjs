import path from "node:path";
import { parseArgs, readJson } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import { validateSandboxValidationRun } from "../src/workflow/promoteToSandboxValidation.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.run) {
    throw new Error("Usage: node scripts/sandbox_validate_cli.mjs --run runs/<sandbox_validation_run_id>");
  }

  const runDir = path.resolve(args.run);
  const runContext = await readJson(path.join(runDir, "00_run_context.json"));
  const plan = await readJson(path.join(runDir, "83_sandbox_validation_plan.json"));
  const validation = await validateSandboxValidationRun({
    projectRoot: runContext.project_root,
    runDir,
    runContext,
    plan
  });

  console.log(JSON.stringify(validation, null, 2));
  if (validation.status !== "passed") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
