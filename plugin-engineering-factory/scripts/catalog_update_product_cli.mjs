import { parseArgs, readJson, slugify } from "../src/utils/io.mjs";
import { upsertProductCatalogEntry } from "../packages/product-catalog/index.mjs";

function parseList(value) {
  if (!value) {
    return [];
  }
  return `${value}`.split(",").map((item) => item.trim()).filter(Boolean);
}

async function readInputProduct(args) {
  if (args.json) {
    return readJson(args.json);
  }
  if (!args["product-key"] && !args.slug) {
    throw new Error("Usage: npm run catalog:update-product -- --json <product.json> OR --product-key <key>");
  }
  const slug = args.slug || slugify(args["product-key"] || "");
  const product = {};
  if (args["product-key"]) product.productKey = args["product-key"];
  if (slug) product.slug = slug;
  if (args.name) product.name = args.name;
  if (args["short-name"]) product.shortName = args["short-name"];
  if (args.tagline) product.tagline = args.tagline;
  if (args.value) product.oneSentenceValue = args.value;
  if (args.category) product.category = args.category;
  if (args["target-user"]) product.targetUser = args["target-user"];
  if (args.version) product.version = args.version;
  if (args["chrome-extension-id"]) product.chromeExtensionId = args["chrome-extension-id"];
  if (args["chrome-web-store-item-id"]) product.chromeWebStoreItemId = args["chrome-web-store-item-id"];
  if (args["chrome-web-store-url"]) product.chromeWebStoreUrl = args["chrome-web-store-url"];
  if (args.status) product.status = args.status;
  if (args["site-url"]) product.siteUrl = args["site-url"];
  if (args["detail-page-path"]) product.detailPagePath = args["detail-page-path"];
  if (args["pricing-page-path"]) product.pricingPagePath = args["pricing-page-path"];
  if (args["install-url"]) product.installUrl = args["install-url"];
  if (args["support-url"]) product.supportUrl = args["support-url"];
  if (args["privacy-url"]) product.privacyUrl = args["privacy-url"];
  if (args["changelog-url"]) product.changelogUrl = args["changelog-url"];
  if (args["docs-url"]) product.docsUrl = args["docs-url"];
  if (args["payment-provider"]) product.paymentProvider = args["payment-provider"];
  if (args["product-key-on-pay-site"]) product.productKeyOnPaySite = args["product-key-on-pay-site"];
  if (args["plan-keys"]) product.planKeys = parseList(args["plan-keys"]);
  if (args["default-plan-key"]) product.defaultPlanKey = args["default-plan-key"];
  if (args["price-label"]) product.priceLabel = args["price-label"];
  if (args["free-limit"]) product.freeLimit = Number.parseInt(args["free-limit"], 10);
  if (args["pro-features"]) product.proFeatures = parseList(args["pro-features"]);
  if (args["free-features"]) product.freeFeatures = parseList(args["free-features"]);
  if (args["feature-keys"]) product.featureKeys = parseList(args["feature-keys"]);
  if (args["checkout-mode"]) product.checkoutMode = args["checkout-mode"];
  if (args["entitlement-status"]) product.entitlementStatus = args["entitlement-status"];
  if (args["payment-config-status"]) product.paymentConfigStatus = args["payment-config-status"];
  if (args["listing-assets-path"]) product.listingAssetsPath = args["listing-assets-path"];
  if (args["remotion-assets-path"]) product.remotionAssetsPath = args["remotion-assets-path"];
  if (args["market-test-status"]) product.marketTestStatus = args["market-test-status"];
  if (args["release-run-id"]) product.releaseRunId = args["release-run-id"];
  return product;
}

async function main() {
  const args = parseArgs(process.argv);
  const projectRoot = process.cwd();
  const product = await readInputProduct(args);
  const updated = await upsertProductCatalogEntry(projectRoot, product, {
    mode: "update",
    commandName: "catalog:update-product"
  });
  console.log(JSON.stringify({
    path: "state/product_catalog.json",
    product_count: updated.products.length,
    updated: product.productKey ?? product.slug
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
