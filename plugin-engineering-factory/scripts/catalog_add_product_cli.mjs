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
  if (!args["product-key"] || !args.name) {
    throw new Error("Usage: npm run catalog:add-product -- --json <product.json> OR --product-key <key> --name <name>");
  }
  const slug = args.slug || slugify(args["product-key"]);
  return {
    productKey: args["product-key"],
    slug,
    name: args.name,
    shortName: args["short-name"] || args.name,
    tagline: args.tagline || args.name,
    oneSentenceValue: args.value || args.name,
    category: args.category || "Uncategorized",
    targetUser: args["target-user"] || "TBD",
    version: args.version || "0.1.0",
    chromeExtensionId: args["chrome-extension-id"] || "pending",
    chromeWebStoreItemId: args["chrome-web-store-item-id"] || "pending",
    chromeWebStoreUrl: args["chrome-web-store-url"] || "pending",
    status: args.status || "draft",
    siteUrl: args["site-url"] || `https://pay.915500.xyz/plugins/${slug}`,
    detailPagePath: args["detail-page-path"] || `generated/plugin-pages/${slug}/index.html`,
    pricingPagePath: args["pricing-page-path"] || `generated/plugin-pages/${slug}/pricing.html`,
    installUrl: args["install-url"] || "pending",
    supportUrl: args["support-url"] || `generated/plugin-pages/${slug}/index.html#support`,
    privacyUrl: args["privacy-url"] || `generated/plugin-pages/${slug}/index.html#privacy`,
    changelogUrl: args["changelog-url"] || `generated/plugin-pages/${slug}/index.html#changelog`,
    docsUrl: args["docs-url"] || `generated/plugin-pages/${slug}/index.html#how-it-works`,
    paymentProvider: args["payment-provider"] || "hwh_waffo",
    productKeyOnPaySite: args["product-key-on-pay-site"] || "product_key_pending",
    planKeys: parseList(args["plan-keys"] || "lifetime"),
    defaultPlanKey: args["default-plan-key"] || "lifetime",
    priceLabel: args["price-label"] || "$0",
    freeLimit: Number.parseInt(args["free-limit"] || "0", 10),
    proFeatures: parseList(args["pro-features"]),
    freeFeatures: parseList(args["free-features"]),
    featureKeys: parseList(args["feature-keys"]),
    checkoutMode: args["checkout-mode"] || "disabled",
    entitlementStatus: args["entitlement-status"] || "not_configured",
    paymentConfigStatus: args["payment-config-status"] || "not_configured",
    listingAssetsPath: args["listing-assets-path"] || "pending",
    remotionAssetsPath: args["remotion-assets-path"] || "pending",
    marketTestStatus: args["market-test-status"] || "not_started",
    releaseRunId: args["release-run-id"] || "pending"
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const projectRoot = process.cwd();
  const product = await readInputProduct(args);
  const updated = await upsertProductCatalogEntry(projectRoot, product, {
    mode: "add",
    commandName: "catalog:add-product"
  });
  console.log(JSON.stringify({
    path: "state/product_catalog.json",
    product_count: updated.products.length,
    added: product.productKey
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
