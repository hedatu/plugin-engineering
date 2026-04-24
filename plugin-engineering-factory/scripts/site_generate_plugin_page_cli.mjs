import path from "node:path";
import { generatePluginPage, parseSiteArgs } from "../src/site/pluginPages.mjs";

async function main() {
  const args = parseSiteArgs(process.argv);
  if (!args.product) {
    throw new Error("Usage: npm run site:generate-plugin-page -- --product <product-key-or-slug>");
  }
  const projectRoot = process.cwd();
  const result = await generatePluginPage({
    projectRoot,
    productKey: args.product
  });
  console.log(JSON.stringify({
    product: result.product.productKey,
    output_dir: path.relative(projectRoot, result.outputDir).replaceAll("\\", "/"),
    detail_page: path.relative(projectRoot, result.detailPagePath).replaceAll("\\", "/"),
    pricing_page: path.relative(projectRoot, result.pricingPagePath).replaceAll("\\", "/")
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
