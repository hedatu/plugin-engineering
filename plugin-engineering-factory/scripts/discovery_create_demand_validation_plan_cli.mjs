import path from "node:path";
import { parseArgs } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import { createDemandValidationPlan } from "../src/discovery/demandValidationLoop.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.candidate || !args.wedge) {
    throw new Error("Usage: node scripts/discovery_create_demand_validation_plan_cli.mjs --candidate <candidate_id_or_name> --wedge <wedge_name>");
  }

  const result = await createDemandValidationPlan({
    projectRoot: process.cwd(),
    run: args.run ? `${args.run}` : null,
    candidate: `${args.candidate}`,
    wedge: `${args.wedge}`
  });

  console.log(JSON.stringify({
    run_dir: result.runDir,
    run_id: path.basename(result.runDir),
    candidate_name: result.report.candidate_name,
    wedge_name: result.report.wedge_name,
    next_step: result.report.next_step
  }, null, 2));
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
