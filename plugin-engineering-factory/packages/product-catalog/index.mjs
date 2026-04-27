import path from "node:path";
import { assertMatchesSchema } from "../../src/utils/schema.mjs";
import { ensureDir, fileExists, nowIso, readJson, slugify, writeJson } from "../../src/utils/io.mjs";

export const PRODUCT_CATALOG_PATH = path.join("state", "product_catalog.json");
export const PRODUCT_CATALOG_STAGE = "PRODUCT_CATALOG_V2";
export const DEFAULT_LEADFILL_RUN_ID = "commercial-2026-04-21-195643-dnnpkaefmlha-v0-2-0-7836c9";
export const DEFAULT_LEADFILL_PRODUCT_KEY = "leadfill-one-profile";
export const LEGACY_TEST_ONLY_PRODUCT_KEY = "chatgpt2obsidian";

function absoluteCatalogPath(projectRoot) {
  return path.join(projectRoot, PRODUCT_CATALOG_PATH);
}

function defaultLeadFillProduct() {
  const chromeItemId = "dnnpkaefmlhacigijccbhemgaenjbcpk";
  const slug = "leadfill-one-profile";
  return {
    productKey: DEFAULT_LEADFILL_PRODUCT_KEY,
    slug,
    name: "LeadFill One Profile",
    shortName: "LeadFill One",
    tagline: "Save once. Fill cleanly.",
    oneSentenceValue: "Save one local profile and fill visible lead form fields on the current page in one click.",
    category: "Workflow And Form Filling",
    targetUser: "Sales reps, recruiters, and operators repeatedly entering the same contact details into web forms.",
    version: "0.2.0",
    chromeExtensionId: chromeItemId,
    chromeWebStoreItemId: chromeItemId,
    chromeWebStoreUrl: `https://chromewebstore.google.com/detail/leadfill-one-profile/${chromeItemId}`,
    chromeWebStoreStatus: "published",
    status: "published",
    siteUrl: `https://pay.915500.xyz/plugins/${slug}`,
    detailPagePath: `generated/plugin-pages/${slug}/index.html`,
    pricingPagePath: `generated/plugin-pages/${slug}/pricing.html`,
    installUrl: `https://chromewebstore.google.com/detail/leadfill-one-profile/${chromeItemId}`,
    supportUrl: `generated/plugin-pages/${slug}/index.html#support`,
    privacyUrl: `generated/plugin-pages/${slug}/index.html#privacy`,
    changelogUrl: `generated/plugin-pages/${slug}/index.html#changelog`,
    docsUrl: `generated/plugin-pages/${slug}/index.html#how-it-works`,
    paymentProvider: "hwh_waffo",
    productKeyOnPaySite: "product_key_pending",
    planKeys: ["lifetime"],
    defaultPlanKey: "lifetime",
    priceLabel: "$19 lifetime",
    freeLimit: 10,
    proFeatures: [
      "Unlimited fills",
      "Save, edit, and delete one local profile",
      "Advanced field support for text, email, phone, textarea, and select",
      "Lifetime access to the current major version"
    ],
    freeFeatures: [
      "10 free fills",
      "1 local profile",
      "Local-only storage",
      "No cloud sync"
    ],
    featureKeys: [
      "leadfill_fill_action"
    ],
    checkoutMode: "disabled",
    entitlementStatus: "not_configured",
    paymentConfigStatus: "product_key_pending",
    listingAssetsPath: `state/run_events/${DEFAULT_LEADFILL_RUN_ID}/120_store_listing_release_package/assets`,
    remotionAssetsPath: `state/run_events/${DEFAULT_LEADFILL_RUN_ID}/80_remotion_assets`,
    marketTestStatus: "preview_ready",
    releaseRunId: DEFAULT_LEADFILL_RUN_ID,
    legacyTestOnlyProductKey: LEGACY_TEST_ONLY_PRODUCT_KEY,
    usingLegacyTestOnlyProductKey: false
  };
}

function normalizeProduct(product, existing = null) {
  const fallback = existing ?? (product.productKey === DEFAULT_LEADFILL_PRODUCT_KEY ? defaultLeadFillProduct() : null) ?? {};
  const slug = product.slug || existing?.slug || slugify(product.productKey || product.name || "");
  return {
    ...fallback,
    ...product,
    slug,
    planKeys: [...new Set((product.planKeys ?? fallback.planKeys ?? []).filter(Boolean))],
    proFeatures: [...new Set((product.proFeatures ?? fallback.proFeatures ?? []).filter(Boolean))],
    freeFeatures: [...new Set((product.freeFeatures ?? fallback.freeFeatures ?? []).filter(Boolean))],
    featureKeys: [...new Set((product.featureKeys ?? fallback.featureKeys ?? []).filter(Boolean))],
    usingLegacyTestOnlyProductKey: product.productKeyOnPaySite === LEGACY_TEST_ONLY_PRODUCT_KEY
  };
}

export function defaultProductCatalog() {
  const now = nowIso();
  return {
    stage: PRODUCT_CATALOG_STAGE,
    status: "passed",
    generated_at: now,
    last_updated_at: now,
    last_updated_by_command: "catalog:validate",
    products: [
      defaultLeadFillProduct()
    ]
  };
}

export async function validateProductCatalog(projectRoot, data) {
  await assertMatchesSchema({
    data,
    schemaPath: path.join(projectRoot, "schemas", "product_catalog.schema.json"),
    label: PRODUCT_CATALOG_PATH
  });
}

export async function loadProductCatalog(projectRoot) {
  const catalogPath = absoluteCatalogPath(projectRoot);
  if (!(await fileExists(catalogPath))) {
    const initialized = defaultProductCatalog();
    await ensureDir(path.dirname(catalogPath));
    await validateProductCatalog(projectRoot, initialized);
    await writeJson(catalogPath, initialized);
    return initialized;
  }

  const current = await readJson(catalogPath);
  const normalized = {
    ...defaultProductCatalog(),
    ...current,
    products: Array.isArray(current.products) ? current.products.map((product) => normalizeProduct(product)) : []
  };
  if (!normalized.products.some((product) => product.productKey === DEFAULT_LEADFILL_PRODUCT_KEY)) {
    normalized.products.push(defaultLeadFillProduct());
  }
  normalized.last_updated_at = normalized.last_updated_at ?? nowIso();
  normalized.last_updated_by_command = normalized.last_updated_by_command ?? "catalog:validate";
  await validateProductCatalog(projectRoot, normalized);
  return normalized;
}

export function summarizeProductCatalog(catalog) {
  return {
    path: PRODUCT_CATALOG_PATH,
    product_count: (catalog.products ?? []).length,
    product_keys: (catalog.products ?? []).map((product) => product.productKey),
    statuses: [...new Set((catalog.products ?? []).map((product) => product.status).filter(Boolean))],
    payment_providers: [...new Set((catalog.products ?? []).map((product) => product.paymentProvider).filter(Boolean))]
  };
}

export function getProductByKey(catalog, productKeyOrSlug) {
  return (catalog.products ?? []).find((product) =>
    product.productKey === productKeyOrSlug || product.slug === productKeyOrSlug
  ) ?? null;
}

export async function upsertProductCatalogEntry(projectRoot, inputProduct, options = {}) {
  const commandName = options.commandName ?? "catalog:update-product";
  const catalog = await loadProductCatalog(projectRoot);
  const index = (catalog.products ?? []).findIndex((product) =>
    product.productKey === inputProduct.productKey || product.slug === inputProduct.slug
  );

  if (options.mode === "add" && index >= 0) {
    throw new Error(`Product already exists in catalog: ${inputProduct.productKey ?? inputProduct.slug}`);
  }
  if (options.mode === "update" && index < 0) {
    throw new Error(`Product not found in catalog: ${inputProduct.productKey ?? inputProduct.slug}`);
  }

  const normalized = normalizeProduct(inputProduct, index >= 0 ? catalog.products[index] : null);
  const products = [...catalog.products];
  if (index >= 0) {
    products.splice(index, 1, normalized);
  } else {
    products.push(normalized);
  }

  const updated = {
    ...catalog,
    stage: PRODUCT_CATALOG_STAGE,
    status: "passed",
    last_updated_at: nowIso(),
    last_updated_by_command: commandName,
    products: products.sort((left, right) => left.slug.localeCompare(right.slug))
  };
  await validateProductCatalog(projectRoot, updated);
  await ensureDir(path.dirname(absoluteCatalogPath(projectRoot)));
  await writeJson(absoluteCatalogPath(projectRoot), updated);
  return updated;
}
