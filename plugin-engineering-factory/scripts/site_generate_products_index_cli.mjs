import path from "node:path";
import { generateProductsIndex } from "../src/site/pluginPages.mjs";

async function main() {
  const projectRoot = process.cwd();
  const result = await generateProductsIndex({ projectRoot });
  console.log(JSON.stringify({
    output_dir: path.relative(projectRoot, result.outputDir).replaceAll("\\", "/"),
    index_path: path.relative(projectRoot, result.indexPath).replaceAll("\\", "/"),
    products_json_path: path.relative(projectRoot, result.productsJsonPath).replaceAll("\\", "/"),
    product_count: result.productCount
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
