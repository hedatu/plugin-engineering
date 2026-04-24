import { importHwhHandoff, parseSiteArgs } from "../src/site/pluginPages.mjs";

async function main() {
  const args = parseSiteArgs(process.argv);
  if (!args.file) {
    throw new Error("Usage: npm run site:import-hwh-handoff -- --file <leadfill_hwh_integration_handoff.json>");
  }

  const result = await importHwhHandoff({
    projectRoot: process.cwd(),
    filePath: args.file
  });

  console.log(JSON.stringify({
    product_key: result.productKey,
    release_allowed: result.gate.release_allowed,
    blockers: result.gate.blockers,
    next_step: result.gate.next_step
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
