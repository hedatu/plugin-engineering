import path from "node:path";
import { loadProductCatalog, validateProductCatalog } from "../packages/product-catalog/index.mjs";

async function main() {
  const projectRoot = process.cwd();
  const catalog = await loadProductCatalog(projectRoot);
  await validateProductCatalog(projectRoot, catalog);
  console.log(`Product catalog is valid: ${path.join(projectRoot, "state", "product_catalog.json")}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
