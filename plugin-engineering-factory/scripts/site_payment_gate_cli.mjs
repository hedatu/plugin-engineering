import { generatePluginSitePaymentGate, parseSiteArgs } from "../src/site/pluginPages.mjs";

async function main() {
  const args = parseSiteArgs(process.argv);
  if (!args.product) {
    throw new Error("Usage: npm run site:payment-gate -- --product <product-key-or-slug>");
  }
  const gate = await generatePluginSitePaymentGate({
    projectRoot: process.cwd(),
    productKey: args.product
  });
  console.log(JSON.stringify({
    run_id: gate.run_id,
    product_key: gate.product_key,
    release_allowed: gate.release_allowed,
    blockers: gate.blockers,
    next_step: gate.next_step
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
