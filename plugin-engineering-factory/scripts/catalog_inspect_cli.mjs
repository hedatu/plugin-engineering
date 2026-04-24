import path from "node:path";
import { loadProductCatalog, summarizeProductCatalog } from "../packages/product-catalog/index.mjs";

async function main() {
  const projectRoot = process.cwd();
  const catalog = await loadProductCatalog(projectRoot);
  console.log(JSON.stringify({
    path: path.join(projectRoot, "state", "product_catalog.json"),
    ...summarizeProductCatalog(catalog),
    products: catalog.products.map((product) => ({
      productKey: product.productKey,
      slug: product.slug,
      status: product.status,
      paymentConfigStatus: product.paymentConfigStatus,
      checkoutMode: product.checkoutMode,
      releaseRunId: product.releaseRunId
    }))
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
