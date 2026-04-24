import path from "node:path";
import { parseArgs, readJson } from "../src/utils/io.mjs";
import { buildExtensionStage } from "../src/workflow/stages.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.run) {
    throw new Error("Usage: node scripts/build_cli.mjs --run runs/<run_id>");
  }

  const runDir = path.resolve(args.run);
  const brief = await readJson(path.join(runDir, "41_product_brief.json"));
  const plan = await readJson(path.join(runDir, "42_implementation_plan.json"));
  const buildReport = await buildExtensionStage({ runDir, brief, plan });
  console.log(`Build status: ${buildReport.status}`);
  console.log(`Workspace: ${buildReport.workspace_dist ?? "n/a"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

