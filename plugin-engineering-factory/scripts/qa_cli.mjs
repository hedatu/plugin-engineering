import path from "node:path";
import { parseArgs, readJson } from "../src/utils/io.mjs";
import { runQaStage } from "../src/workflow/stages.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.run) {
    throw new Error("Usage: node scripts/qa_cli.mjs --run runs/<run_id>");
  }

  const runDir = path.resolve(args.run);
  const brief = await readJson(path.join(runDir, "41_product_brief.json"));
  const plan = await readJson(path.join(runDir, "42_implementation_plan.json"));
  const buildReport = await readJson(path.join(runDir, "50_build_report.json"));
  const qaReport = await runQaStage({ runDir, brief, plan, buildReport });
  console.log(`QA status: ${qaReport.overall_status}`);
  console.log(`Checks passed: ${qaReport.checks_passed.length}`);
  console.log(`Checks failed: ${qaReport.checks_failed.length}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

