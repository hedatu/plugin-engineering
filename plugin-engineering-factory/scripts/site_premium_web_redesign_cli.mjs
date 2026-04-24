import { generatePremiumWebRedesign, parseSiteArgs } from "../src/site/pluginPages.mjs";

async function main() {
  const args = parseSiteArgs(process.argv);
  if (!args.product) {
    throw new Error("Usage: npm run site:premium-web-redesign -- --product <product-key-or-slug>");
  }

  const result = await generatePremiumWebRedesign({
    projectRoot: process.cwd(),
    productKey: args.product
  });

  console.log(JSON.stringify({
    run_id: result.run_id,
    product_key: result.product_key,
    output_dir: result.output_dir,
    product_page_quality_score: result.product_page_quality_score,
    checkout_page_quality_score: result.checkout_page_quality_score,
    site_visual_consistency_score: result.site_visual_consistency_score,
    blockers: result.blockers,
    next_step: result.next_step
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
