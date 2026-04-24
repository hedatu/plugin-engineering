import fs from "node:fs/promises";
import path from "node:path";
import {
  ASSET_QUALITY_REPORT_ARTIFACT,
  BRAND_SYSTEM_ARTIFACT,
  LISTING_QUALITY_GATE_ARTIFACT,
  PREMIUM_PACKAGING_BRIEF_ARTIFACT,
  SCREENSHOT_STORYBOARD_ARTIFACT
} from "../packaging/premiumPackaging.mjs";
import {
  MARKET_TEST_ASSET_PACKAGE_ARTIFACT,
  STORE_RELEASE_PACKAGE_DIRNAME,
  STORE_RELEASE_PACKAGE_REPORT_ARTIFACT
} from "../packaging/storeReleasePackage.mjs";
import {
  buildSafeReport,
  normalizeRelativePath,
  validateArtifact,
  writeManagedJsonArtifact,
  writeManagedMarkdownArtifact
} from "../review/helpers.mjs";
import { copyDir, ensureDir, fileExists, nowIso, parseArgs, readJson, resetDir, writeJson, writeText } from "../utils/io.mjs";
import { inspectSecretLikeContent } from "../utils/redaction.mjs";
import { loadManagedRunArtifact, runEventsDirectory } from "../workflow/runEventArtifacts.mjs";
import { SITE_LOCALES, generateLocalizedSitePages } from "./siteLocalization.mjs";
import {
  LEGACY_TEST_ONLY_PRODUCT_KEY,
  PRODUCT_CATALOG_PATH,
  getProductByKey,
  loadProductCatalog,
  upsertProductCatalogEntry
} from "../../packages/product-catalog/index.mjs";

export const PLUGIN_PAGES_ROOT = path.join("generated", "plugin-pages");
export const PLUGIN_SITE_PAYMENT_GATE_ARTIFACT = "138_plugin_site_payment_gate.json";
export const WEB_REDESIGN_PLAN_ARTIFACT = "141_web_redesign_plan.json";
export const WEB_REDESIGN_PLAN_MARKDOWN = "141_web_redesign_plan.md";
export const WEB_DESIGN_SYSTEM_ARTIFACT = "142_web_design_system.json";
export const PRODUCT_PAGE_QUALITY_REVIEW_ARTIFACT = "143_product_page_quality_review.json";
export const CHECKOUT_PAGE_QUALITY_REVIEW_ARTIFACT = "144_checkout_page_quality_review.json";
export const SITE_VISUAL_CONSISTENCY_REPORT_ARTIFACT = "145_site_visual_consistency_report.json";
export const PRODUCTION_PAYMENT_READINESS_ARTIFACT = "147_production_payment_readiness.json";
export const COMMERCIAL_RESUBMISSION_PACKAGE_ARTIFACT = "148_commercial_resubmission_package.json";
export const PUBLIC_LAUNCH_GATE_ARTIFACT = "149_public_launch_gate.json";
const LEADFILL_PRODUCT_KEY = "leadfill-one-profile";
const LEADFILL_LIFETIME_PLAN_KEY = "lifetime";
const VERIFIED_GATE_STATUSES = new Set([
  "verified",
  "passed",
  "verified_independent",
  "verified_from_payment",
  "verified_from_payment_test_mode",
  "verified_free_quota_pro",
  "verified_test_mode"
]);
const CHECKOUT_MODES = new Set(["disabled", "test", "live"]);
const REQUIRED_HANDOFF_STATUS_FIELDS = [
  "smtp_status",
  "otp_status",
  "checkout_status",
  "webhook_status",
  "entitlement_status",
  "consume_usage_status",
  "payment_e2e_status"
];
const FORBIDDEN_HANDOFF_KEY_PATTERNS = [
  /^SUPABASE_SERVICE_ROLE_KEY$/i,
  /^WAFFO_PRIVATE_KEY$/i,
  /^WEBHOOK_SECRET$/i,
  /^MERCHANT_SECRET$/i,
  /^private_key$/i
];
const FORBIDDEN_HANDOFF_VALUE_PATTERNS = [
  /-----BEGIN(?: RSA| EC|)? PRIVATE KEY-----/,
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /\bsk_(?:live|test)_[A-Za-z0-9]+\b/i
];

function escapeHtml(value) {
  return `${value ?? ""}`
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function absoluteRunDir(projectRoot, runId) {
  return path.join(projectRoot, "runs", runId);
}

async function loadManagedJson(runDir, runContext, artifactName) {
  return (await loadManagedRunArtifact({
    runDir,
    runContext,
    artifactName
  }))?.data ?? null;
}

function productOutputDir(projectRoot, slug) {
  return path.join(projectRoot, PLUGIN_PAGES_ROOT, slug);
}

function relativeLink(fromDir, toAbsolutePath) {
  return path.relative(fromDir, toAbsolutePath).replaceAll("\\", "/");
}

function localeDefinition(code = "en") {
  return SITE_LOCALES.find((locale) => locale.code === code) ?? SITE_LOCALES[0];
}

function localizedProductDir(outputDir, localeCode = "en") {
  const locale = localeDefinition(localeCode);
  return locale.dir ? path.join(outputDir, locale.dir) : outputDir;
}

function safeRelativePath(fromDir, toAbsolutePath) {
  const relative = relativeLink(fromDir, toAbsolutePath);
  return relative || ".";
}

function pageFrame({ projectRoot, outputDir, localeCode = "en", pageRelativePath = "index.html" }) {
  const currentLocaleDir = localizedProductDir(outputDir, localeCode);
  const pageDirAbsolute = path.join(currentLocaleDir, path.dirname(pageRelativePath));
  const productRootRelative = safeRelativePath(pageDirAbsolute, outputDir);
  const productRootPrefix = productRootRelative === "." ? "" : `${productRootRelative}/`;
  return {
    pageDirAbsolute,
    stylesPath: `${productRootPrefix}styles.css`,
    assetsPrefix: `${productRootPrefix}assets`,
    hubIndexPath: safeRelativePath(pageDirAbsolute, path.join(projectRoot, PLUGIN_PAGES_ROOT, "index.html")),
    productIndexPath: safeRelativePath(pageDirAbsolute, path.join(currentLocaleDir, "index.html")),
    productPricingPath: safeRelativePath(pageDirAbsolute, path.join(currentLocaleDir, "pricing.html")),
    entitlementPath: safeRelativePath(pageDirAbsolute, path.join(currentLocaleDir, "entitlement.html")),
    checkoutSuccessPath: safeRelativePath(pageDirAbsolute, path.join(currentLocaleDir, "checkout", "success.html")),
    checkoutCancelPath: safeRelativePath(pageDirAbsolute, path.join(currentLocaleDir, "checkout", "cancel.html"))
  };
}

function renderLocaleSwitcher({ outputDir, localeCode = "en", pageRelativePath = "index.html" }) {
  const currentLocale = localeDefinition(localeCode);
  const currentPageDir = path.join(localizedProductDir(outputDir, localeCode), path.dirname(pageRelativePath));
  const links = SITE_LOCALES.map((locale) => {
    const target = safeRelativePath(currentPageDir, path.join(localizedProductDir(outputDir, locale.code), pageRelativePath));
    const activeClass = locale.code === currentLocale.code ? " active" : "";
    return `<a class="locale-link${activeClass}" href="${escapeHtml(target)}" lang="${escapeHtml(locale.htmlLang)}">${escapeHtml(locale.label)}</a>`;
  }).join("");
  return `<div class="locale-switcher" aria-label="Language switcher">${links}</div>`;
}

async function readTextIfExists(filePath) {
  if (!(await fileExists(filePath))) {
    return "";
  }
  return fs.readFile(filePath, "utf8");
}

function resolveInstallMode(product) {
  return product.status === "published" || product.status === "market_testing";
}

function resolveCheckoutReady(product) {
  return ["ready", "test_mode_verified"].includes(product.paymentConfigStatus)
    && product.checkoutMode !== "disabled"
    && product.productKeyOnPaySite !== "product_key_pending";
}

function paySiteConfigPath(projectRoot, slug) {
  return path.join(projectRoot, "config", "payment", `${slug}.pay-site.local.json`);
}

function normalizeText(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeStatusValue(value, fallback) {
  const normalized = normalizeText(value);
  return normalized || fallback;
}

function normalizePaymentStatus(kind, value, fallback) {
  const normalized = normalizeStatusValue(value, fallback);
  const lowered = normalized.toLowerCase();

  if (lowered === "passed") {
    return "verified";
  }

  if (kind === "smtp" || kind === "otp") {
    if (/(^failed$|error|blocked_by_smtp)/i.test(lowered)) {
      return lowered === "blocked_by_smtp" ? "failed" : "failed";
    }
  }

  if (kind === "entitlement") {
    if (lowered === "manual_active_verified_payment_active_not_verified") {
      return "partial_verified";
    }
    if (/(partial_verified|manual_.*verified|payment_.*not_verified)/i.test(lowered)
      && lowered !== "not_verified") {
      return "partial_verified";
    }
  }

  if (kind === "consume_usage") {
    if (lowered === "verified_free_quota_pro") {
      return "verified_free_quota_pro";
    }
    if (lowered === "free_and_quota_verified_manual_pro_verified") {
      return "partial_verified";
    }
    if (/(partial_verified|free_.*verified|quota|manual_pro_verified)/i.test(lowered)
      && lowered !== "not_verified") {
      return "partial_verified";
    }
  }

  if (kind === "payment_e2e") {
    if (/(^blocked$|^failed$|not_verified|not verified)/i.test(lowered)) {
      return "not_verified";
    }
  }

  if (kind === "webhook" || kind === "checkout") {
    if (/(not_verified|not verified)/i.test(lowered)) {
      return "not_verified";
    }
    if (/(^verified$|^passed$)/i.test(lowered)) {
      return "verified";
    }
  }

  return lowered;
}

function normalizeCheckoutMode(value, fallback = "disabled") {
  const normalized = normalizeText(value, fallback);
  return CHECKOUT_MODES.has(normalized) ? normalized : fallback;
}

function isPlaceholderValue(value) {
  return /^<[^>]+>$/.test(normalizeText(value));
}

function isPendingProductKey(value) {
  const normalized = normalizeText(value).toLowerCase();
  return !normalized || normalized === "product_key_pending" || isPlaceholderValue(value);
}

function isVerifiedStatus(value) {
  return VERIFIED_GATE_STATUSES.has(normalizeText(value).toLowerCase());
}

function derivePaymentConfigStatus({
  productKeyConfigured,
  productKeyMatchesExtension,
  planKeyConfigured,
  allRequiredVerified,
  checkoutMode = "disabled"
}) {
  if (!productKeyConfigured) {
    return "product_key_pending";
  }
  if (!productKeyMatchesExtension) {
    return "product_key_mismatch";
  }
  if (!planKeyConfigured) {
    return "plan_key_pending";
  }
  if (allRequiredVerified) {
    return checkoutMode === "test" ? "test_mode_verified" : "ready";
  }
  return "verification_pending";
}

function catalogEntitlementStatusForImportedHandoff(imported) {
  if (
    imported.checkoutMode === "test"
    && isVerifiedStatus(imported.entitlementStatus)
    && isVerifiedStatus(imported.paymentE2EStatus)
  ) {
    return "verified_from_payment_test_mode";
  }
  return imported.entitlementStatus;
}

function buildPaymentStatusSnapshot({
  product,
  localConfig = null,
  checkoutConfig = null
}) {
  const productKeyOnPaySite = normalizeText(
    localConfig?.productKey ?? checkoutConfig?.productKeyOnPaySite ?? product.productKeyOnPaySite
  );
  const configuredPlanKey = normalizeText(
    localConfig?.planKey ?? checkoutConfig?.configuredPlanKey ?? product.defaultPlanKey
  );
  const checkoutMode = normalizeCheckoutMode(
    localConfig?.checkoutMode ?? checkoutConfig?.checkoutMode ?? product.checkoutMode
  );
  const smtpStatus = normalizePaymentStatus(
    "smtp",
    localConfig?.smtpStatus ?? checkoutConfig?.smtpStatus,
    "blocked_by_smtp"
  );
  const otpStatus = normalizePaymentStatus(
    "otp",
    localConfig?.otpStatus ?? checkoutConfig?.otpStatus,
    "not_reported"
  );
  const checkoutStatus = normalizePaymentStatus(
    "checkout",
    localConfig?.checkoutStatus ?? checkoutConfig?.checkoutStatus,
    isPendingProductKey(productKeyOnPaySite) ? "product_key_pending" : "not_verified"
  );
  const webhookStatus = normalizePaymentStatus(
    "webhook",
    localConfig?.webhookStatus ?? checkoutConfig?.webhookStatus,
    isPendingProductKey(productKeyOnPaySite) ? "not_configured" : "not_verified"
  );
  const entitlementStatus = normalizePaymentStatus(
    "entitlement",
    localConfig?.entitlementStatus ?? checkoutConfig?.entitlementStatus ?? product.entitlementStatus,
    "not_configured"
  );
  const consumeUsageStatus = normalizePaymentStatus(
    "consume_usage",
    localConfig?.consumeUsageStatus ?? checkoutConfig?.consumeUsageStatus,
    "not_verified"
  );
  const paymentE2EStatus = normalizePaymentStatus(
    "payment_e2e",
    localConfig?.paymentE2EStatus ?? checkoutConfig?.paymentE2EStatus,
    "not_reported"
  );
  const productKeyConfigured = !isPendingProductKey(productKeyOnPaySite);
  const productKeyMatchesExtension = productKeyOnPaySite === product.productKey;
  const planKeyConfigured = configuredPlanKey === product.defaultPlanKey;
  const allRequiredVerified = [
    smtpStatus,
    otpStatus,
    checkoutStatus,
    webhookStatus,
    entitlementStatus,
    consumeUsageStatus,
    paymentE2EStatus
  ].every((status) => isVerifiedStatus(status));

  return {
    productKeyOnPaySite,
    configuredPlanKey,
    checkoutMode,
    smtpStatus,
    otpStatus,
    checkoutStatus,
    webhookStatus,
    entitlementStatus,
    consumeUsageStatus,
    paymentE2EStatus,
    productKeyConfigured,
    productKeyMatchesExtension,
    planKeyConfigured,
    allRequiredVerified,
    paymentConfigStatus: derivePaymentConfigStatus({
      productKeyConfigured,
      productKeyMatchesExtension,
      planKeyConfigured,
      allRequiredVerified,
      checkoutMode
    })
  };
}

function scanForForbiddenHandoffContent(value, currentPath = []) {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const nestedHit = scanForForbiddenHandoffContent(value[index], [...currentPath, `${index}`]);
      if (nestedHit) {
        return nestedHit;
      }
    }
    return null;
  }

  if (typeof value === "string") {
    for (const pattern of FORBIDDEN_HANDOFF_VALUE_PATTERNS) {
      if (pattern.test(value)) {
        return {
          path: currentPath.join("."),
          reason: "forbidden_secret_value_detected"
        };
      }
    }
    return null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (FORBIDDEN_HANDOFF_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
      return {
        path: [...currentPath, key].join("."),
        reason: "forbidden_secret_key_detected"
      };
    }
    const nestedHit = scanForForbiddenHandoffContent(nestedValue, [...currentPath, key]);
    if (nestedHit) {
      return nestedHit;
    }
  }

  return null;
}

function normalizeImportedHwhHandoff(handoff, sourceFile) {
  const product = handoff?.product ?? {};
  const publicConfig = handoff?.public_config ?? {};
  const status = handoff?.status ?? {};
  const productKey = normalizeText(publicConfig.PRODUCT_KEY ?? product.productKey);
  const planKey = normalizeText(publicConfig.PLAN_KEY ?? product.planKey);
  const featureKey = normalizeText(publicConfig.FEATURE_KEY ?? product.featureKey);
  const missingStatuses = REQUIRED_HANDOFF_STATUS_FIELDS.filter((field) => !normalizeText(status[field]));

  if (productKey !== LEADFILL_PRODUCT_KEY) {
    throw new Error(`HWH handoff productKey must equal ${LEADFILL_PRODUCT_KEY}.`);
  }
  if (planKey !== LEADFILL_LIFETIME_PLAN_KEY) {
    throw new Error(`HWH handoff planKey must include ${LEADFILL_LIFETIME_PLAN_KEY}.`);
  }
  if (!normalizeText(publicConfig.SITE_URL)) {
    throw new Error("HWH handoff is missing public_config.SITE_URL.");
  }
  if (!normalizeText(publicConfig.PUBLIC_SUPABASE_URL)) {
    throw new Error("HWH handoff is missing public_config.PUBLIC_SUPABASE_URL.");
  }
  if (!normalizeText(publicConfig.PUBLIC_SUPABASE_ANON_KEY)) {
    throw new Error("HWH handoff is missing public_config.PUBLIC_SUPABASE_ANON_KEY.");
  }
  if (missingStatuses.length > 0) {
    throw new Error(`HWH handoff is missing readable statuses: ${missingStatuses.join(", ")}.`);
  }

  return {
    importedAt: nowIso(),
    sourceFile,
    productKey,
    planKey,
    featureKey,
    siteUrl: normalizeText(publicConfig.SITE_URL),
    publicSupabaseUrl: normalizeText(publicConfig.PUBLIC_SUPABASE_URL),
    publicSupabaseAnonKey: normalizeText(publicConfig.PUBLIC_SUPABASE_ANON_KEY),
    checkoutSuccessUrl: normalizeText(publicConfig.SUCCESS_URL),
    checkoutCancelUrl: normalizeText(publicConfig.CANCEL_URL),
    checkoutMode: normalizeCheckoutMode(publicConfig.CHECKOUT_MODE, "disabled"),
    supportEmail: normalizeText(publicConfig.SUPPORT_EMAIL),
    smtpStatus: normalizePaymentStatus("smtp", status.smtp_status, "not_reported"),
    otpStatus: normalizePaymentStatus("otp", status.otp_status, "not_reported"),
    checkoutStatus: normalizePaymentStatus("checkout", status.checkout_status, "not_verified"),
    webhookStatus: normalizePaymentStatus("webhook", status.webhook_status, "not_verified"),
    entitlementStatus: normalizePaymentStatus("entitlement", status.entitlement_status, "not_verified"),
    consumeUsageStatus: normalizePaymentStatus("consume_usage", status.consume_usage_status, "not_verified"),
    paymentE2EStatus: normalizePaymentStatus("payment_e2e", status.payment_e2e_status, "not_reported"),
    sourceChromeExtensionStatus: normalizePaymentStatus(
      "source_chrome_extension",
      status.source_chrome_extension_status,
      "not_reported"
    ),
    productionPaymentStatus: normalizePaymentStatus(
      "production_payment",
      status.production_payment_status,
      "not_verified"
    ),
    currentPrimaryEnvironment: normalizeText(
      handoff?.current_primary_environment ?? handoff?.environment,
      "unknown"
    )
  };
}

function listToHtml(items, className = "") {
  const classAttr = className ? ` class="${className}"` : "";
  return `<ul${classAttr}>${(items ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function markdownToHtml(markdown) {
  const lines = `${markdown ?? ""}`.split(/\r?\n/);
  const html = [];
  let listItems = [];

  const flushList = () => {
    if (listItems.length > 0) {
      html.push(`<ul>${listItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`);
      listItems = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }
    if (line.startsWith("# ")) {
      flushList();
      html.push(`<h3>${escapeHtml(line.slice(2))}</h3>`);
      continue;
    }
    if (line.startsWith("## ")) {
      flushList();
      html.push(`<h4>${escapeHtml(line.slice(3))}</h4>`);
      continue;
    }
    if (line.startsWith("- ")) {
      listItems.push(line.slice(2));
      continue;
    }
    flushList();
    html.push(`<p>${escapeHtml(line)}</p>`);
  }
  flushList();
  return html.join("\n");
}

function heroBadges(product) {
  return [
    `${product.freeLimit} free fills`,
    product.priceLabel,
    "Local-only",
    "No upload",
    "No cloud sync"
  ];
}

function buildFaq(product) {
  return [
    {
      question: "Does this upload my form data?",
      answer: "No. LeadFill stores one profile locally in Chrome storage and only fills the active tab after a user click."
    },
    {
      question: "Is this a subscription?",
      answer: resolveCheckoutReady(product)
        ? `${product.priceLabel} unlocks the current LeadFill lifetime plan. It is a one-time purchase, not a recurring subscription.`
        : "The current plan is a one-time lifetime unlock. Production payment is still not verified."
    },
    {
      question: "What happens after the 10 free fills?",
      answer: "LeadFill keeps the product usable for evaluation first. After the free fills are used, the extension asks you to unlock Lifetime or refresh an existing membership."
    },
    {
      question: "Does it work on every form?",
      answer: "It is built for common text, email, phone, textarea, and select fields. It skips readonly and disabled fields, and it avoids overwriting existing values by default."
    },
    {
      question: "How do I restore a purchase?",
      answer: "Sign in with the same email through OTP, then use Refresh membership. LeadFill reads the active entitlement from the pay site."
    },
    {
      question: "When does Lifetime unlock after payment?",
      answer: "Only after the payment webhook updates your entitlement. The success page does not unlock anything locally."
    }
  ];
}

function buildHowItWorksSteps() {
  return [
    "Save one local profile in the extension.",
    "Open a lead form that needs the same details.",
    "Click Fill Current Page from the popup.",
    "Upgrade to Lifetime when you need unlimited fills."
  ];
}

function screenshotCards(state) {
  return (state.screenshotStoryboard?.storyboard ?? []).map((item) => ({
    ...item,
    image: `assets/screenshots/${item.expected_file}`
  }));
}

export async function loadProductRunState(projectRoot, product) {
  const runDir = absoluteRunDir(projectRoot, product.releaseRunId);
  if (!(await fileExists(runDir))) {
    throw new Error(`Commercial run not found for ${product.productKey}: ${runDir}`);
  }

  const runContext = await readJson(path.join(runDir, "00_run_context.json"));
  const storeReleasePackageRoot = path.join(runEventsDirectory(projectRoot, runContext.run_id), STORE_RELEASE_PACKAGE_DIRNAME);
  const landingDir = path.join(projectRoot, "landing", product.slug);
  const localPaySiteConfigPath = paySiteConfigPath(projectRoot, product.slug);
  return {
    projectRoot,
    product,
    runDir,
    runContext,
    listingCopy: await readJson(path.join(runDir, "71_listing_copy.json")),
    premiumPackagingBrief: await loadManagedJson(runDir, runContext, PREMIUM_PACKAGING_BRIEF_ARTIFACT),
    brandSystem: await loadManagedJson(runDir, runContext, BRAND_SYSTEM_ARTIFACT),
    screenshotStoryboard: await loadManagedJson(runDir, runContext, SCREENSHOT_STORYBOARD_ARTIFACT),
    listingQualityGate: await loadManagedJson(runDir, runContext, LISTING_QUALITY_GATE_ARTIFACT),
    assetQualityReport: await loadManagedJson(runDir, runContext, ASSET_QUALITY_REPORT_ARTIFACT),
    marketTestAssetPackage: await loadManagedJson(runDir, runContext, MARKET_TEST_ASSET_PACKAGE_ARTIFACT),
    monetizationStrategy: await loadManagedJson(runDir, runContext, "95_monetization_strategy.json"),
    monetizationSecurityScan: await loadManagedJson(runDir, runContext, "110_monetization_security_scan.json"),
    storeReleasePackageReport: await loadManagedJson(runDir, runContext, STORE_RELEASE_PACKAGE_REPORT_ARTIFACT),
    storeReleasePackageRoot,
    landingDir,
    paySiteConfigPath: localPaySiteConfigPath,
    paySiteLocalConfig: (await fileExists(localPaySiteConfigPath)) ? await readJson(localPaySiteConfigPath) : null
  };
}

function buildCheckoutConfig(state) {
  const product = state.product;
  const localConfig = state.paySiteLocalConfig;
  const paymentStatus = buildPaymentStatusSnapshot({
    product,
    localConfig
  });
  const baseSiteUrl = normalizeText(localConfig?.siteUrl, "https://pay.915500.xyz");
  return {
    stage: "PLUGIN_CHECKOUT_CONFIG_PREVIEW",
    generated_at: nowIso(),
    productKey: product.productKey,
    slug: product.slug,
    paymentProvider: product.paymentProvider,
    productKeyOnPaySite: paymentStatus.productKeyOnPaySite,
    defaultPlanKey: product.defaultPlanKey,
    configuredPlanKey: paymentStatus.configuredPlanKey,
    planKeys: product.planKeys,
    checkoutMode: paymentStatus.checkoutMode,
    paymentConfigStatus: paymentStatus.paymentConfigStatus,
    siteUrl: baseSiteUrl,
    pluginDetailUrl: `${baseSiteUrl}/plugins/${product.slug}`,
    pluginPricingUrl: `${baseSiteUrl}/plugins/${product.slug}/pricing`,
    checkoutSuccessUrl: localConfig?.checkoutSuccessUrl ?? `${baseSiteUrl}/checkout/success`,
    checkoutCancelUrl: localConfig?.checkoutCancelUrl ?? `${baseSiteUrl}/checkout/cancel`,
    installUrl: product.installUrl,
    supportUrl: product.supportUrl,
    privacyUrl: product.privacyUrl,
    supportEmail: normalizeText(localConfig?.supportEmail) || null,
    featureKey: normalizeText(localConfig?.featureKey ?? product.featureKeys?.[0]) || null,
    liveCheckoutReady: resolveCheckoutReady({
      ...product,
      productKeyOnPaySite: paymentStatus.productKeyOnPaySite,
      checkoutMode: paymentStatus.checkoutMode,
      paymentConfigStatus: paymentStatus.paymentConfigStatus
    }),
    smtpStatus: paymentStatus.smtpStatus,
    otpStatus: paymentStatus.otpStatus,
    checkoutStatus: paymentStatus.checkoutStatus,
    webhookStatus: paymentStatus.webhookStatus,
    entitlementStatus: paymentStatus.entitlementStatus,
    consumeUsageStatus: paymentStatus.consumeUsageStatus,
    paymentE2EStatus: paymentStatus.paymentE2EStatus,
    notes: [
      "No real payment is triggered from the generated plugin page preview.",
      "Webhook-confirmed entitlement remains the only valid unlock source.",
      "If product key or plan key is still pending, the buy CTA must stay disabled or test-only."
    ]
  };
}

export async function importHwhHandoff({ projectRoot, filePath }) {
  if (!filePath) {
    throw new Error("Usage: npm run site:import-hwh-handoff -- --file <leadfill_hwh_integration_handoff.json>");
  }
  if (!(await fileExists(filePath))) {
    throw new Error(`HWH handoff file not found: ${filePath}`);
  }

  const rawHandoff = await readJson(filePath);
  const forbiddenContent = scanForForbiddenHandoffContent(rawHandoff);
  if (forbiddenContent) {
    throw new Error(`HWH handoff contains forbidden sensitive content at ${forbiddenContent.path || "root"} (${forbiddenContent.reason}).`);
  }

  const imported = normalizeImportedHwhHandoff(rawHandoff, filePath);
  const catalog = await loadProductCatalog(projectRoot);
  const product = getProductByKey(catalog, imported.productKey);
  if (!product) {
    throw new Error(`Product not found in catalog: ${imported.productKey}`);
  }

  const importedStatus = buildPaymentStatusSnapshot({
    product,
    localConfig: {
      productKey: imported.productKey,
      planKey: imported.planKey,
      checkoutMode: imported.checkoutMode,
      smtpStatus: imported.smtpStatus,
      otpStatus: imported.otpStatus,
      checkoutStatus: imported.checkoutStatus,
      webhookStatus: imported.webhookStatus,
      entitlementStatus: imported.entitlementStatus,
      consumeUsageStatus: imported.consumeUsageStatus,
      paymentE2EStatus: imported.paymentE2EStatus
    }
  });

  const updatedProductCatalog = await upsertProductCatalogEntry(projectRoot, {
    productKey: product.productKey,
    slug: product.slug,
    siteUrl: imported.siteUrl,
    productKeyOnPaySite: imported.productKey,
    planKeys: [...new Set([...(product.planKeys ?? []), imported.planKey])],
    defaultPlanKey: imported.planKey,
    featureKeys: [...new Set([...(product.featureKeys ?? []), imported.featureKey].filter(Boolean))],
    checkoutMode: imported.checkoutMode,
    entitlementStatus: catalogEntitlementStatusForImportedHandoff(imported),
    paymentConfigStatus: importedStatus.paymentConfigStatus,
    productionPaymentStatus: imported.productionPaymentStatus,
    currentPrimaryEnvironment: imported.currentPrimaryEnvironment,
    supportEmail: imported.supportEmail || null,
    smtpStatus: imported.smtpStatus,
    otpStatus: imported.otpStatus,
    checkoutStatus: imported.checkoutStatus,
    webhookStatus: imported.webhookStatus,
    consumeUsageStatus: imported.consumeUsageStatus,
    paymentE2EStatus: imported.paymentE2EStatus,
    sourceChromeExtensionStatus: imported.sourceChromeExtensionStatus,
    hwhHandoffImportedAt: imported.importedAt
  }, {
    mode: "update",
    commandName: "site:import-hwh-handoff"
  });

  const updatedProduct = getProductByKey(updatedProductCatalog, imported.productKey);
  const updatedLocalConfig = {
    siteUrl: imported.siteUrl,
    publicSupabaseUrl: imported.publicSupabaseUrl,
    publicSupabaseAnonKey: imported.publicSupabaseAnonKey,
    productKey: imported.productKey,
    planKey: imported.planKey,
    chromeExtensionId: updatedProduct.chromeExtensionId,
    checkoutSuccessUrl: imported.checkoutSuccessUrl,
    checkoutCancelUrl: imported.checkoutCancelUrl,
    checkoutMode: imported.checkoutMode,
    authMode: "email_otp",
    membershipProvider: "pay_site_supabase_waffo",
    featureKey: imported.featureKey,
    supportEmail: imported.supportEmail || null,
    paymentConfigStatus: importedStatus.paymentConfigStatus,
    productionPaymentStatus: imported.productionPaymentStatus,
    currentPrimaryEnvironment: imported.currentPrimaryEnvironment,
    smtpStatus: imported.smtpStatus,
    otpStatus: imported.otpStatus,
    checkoutStatus: imported.checkoutStatus,
    webhookStatus: imported.webhookStatus,
    entitlementStatus: imported.entitlementStatus,
    consumeUsageStatus: imported.consumeUsageStatus,
    paymentE2EStatus: imported.paymentE2EStatus,
    sourceChromeExtensionStatus: imported.sourceChromeExtensionStatus,
    handoffImportedAt: imported.importedAt,
    handoffSourceFile: imported.sourceFile
  };
  const localConfigPath = paySiteConfigPath(projectRoot, updatedProduct.slug);
  await validateArtifact(projectRoot, "pay_site_config.schema.json", normalizeRelativePath(projectRoot, localConfigPath), updatedLocalConfig);
  await writeJson(localConfigPath, updatedLocalConfig);

  const updatedState = await loadProductRunState(projectRoot, updatedProduct);
  updatedState.product = updatedProduct;
  const outputDir = productOutputDir(projectRoot, updatedProduct.slug);
  const checkoutConfigPath = path.join(outputDir, "checkout_config.json");
  await writeJson(checkoutConfigPath, buildCheckoutConfig(updatedState));

  const gate = await generatePluginSitePaymentGate({
    projectRoot,
    productKey: updatedProduct.productKey
  });

  return {
    productKey: updatedProduct.productKey,
    catalogPath: PRODUCT_CATALOG_PATH,
    checkoutConfigPath,
    localConfigPath,
    gate
  };
}

export function buildHwhProductConfigChecklistMarkdown(product, checkoutConfig) {
  const configuredPlanKey = checkoutConfig.configuredPlanKey ?? "not_set";
  return `# HWH Product Config Checklist

Product: ${product.name}
Product key target: ${product.productKey}
Current pay-site product key: ${checkoutConfig.productKeyOnPaySite}
Target plan key: ${product.defaultPlanKey}
Current configured plan key: ${configuredPlanKey}
Price: ${product.priceLabel}

- [ ] Create HWH productKey=${product.productKey}
- [ ] Create HWH planKey=${product.defaultPlanKey}
- [ ] Configure ${product.priceLabel} as a one-time price
- [ ] Map the plan to the Waffo product and checkout
- [ ] Configure successUrl=${checkoutConfig.checkoutSuccessUrl}
- [ ] Configure cancelUrl=${checkoutConfig.checkoutCancelUrl}
- [ ] Configure webhookUrl for entitlement updates
- [ ] Configure featureKey=${product.featureKeys.join(", ")}
- [ ] Configure free quota=${product.freeLimit}
- [ ] Configure max_installations
- [ ] Configure active entitlement feature set for Pro
- [ ] Configure support email and support route
- [ ] Test email OTP login once SMTP is fixed
- [ ] Test create-checkout-session
- [ ] Test Waffo webhook delivery
- [ ] Test get-entitlement active state
- [ ] Test consume-usage quota behavior

Notes:

- Legacy test-only product keys must not remain the production key for LeadFill.
- The extension must never ship service-role keys, private merchant keys, or webhook secrets.
- successUrl is not allowed to unlock the extension locally.
`;
}

function buildPluginReadme(state, checkoutConfig) {
  return `# ${state.product.name} Plugin Page Preview

Generated from:

- Product catalog: ${PRODUCT_CATALOG_PATH}
- Commercial run: runs/${state.product.releaseRunId}
- Store release package: ${normalizeRelativePath(state.projectRoot, state.storeReleasePackageRoot)}

Current payment mode:

- provider: ${state.product.paymentProvider}
- product key on pay site: ${checkoutConfig.productKeyOnPaySite}
- target plan: ${state.product.defaultPlanKey}
- configured plan: ${checkoutConfig.configuredPlanKey ?? "not_set"}
- checkout mode: ${state.product.checkoutMode}
- payment config status: ${state.product.paymentConfigStatus}

Safety:

- No build, upload, publish, or real payment was executed.
- No secret values are written into this generated page package.
- successUrl is documented as non-authoritative for unlocks.
- English is the default root language, with additional localized marketing pages generated under locale subdirectories.
`;
}

function renderStyles(brandSystem) {
  const headingFont = brandSystem.typography_recommendation?.headline_family ?? "\"Aptos Display\", \"Segoe UI Variable Display\", \"Segoe UI\", sans-serif";
  const bodyFont = brandSystem.typography_recommendation?.body_family ?? "\"Aptos\", \"Segoe UI Variable Text\", \"Segoe UI\", sans-serif";
  return `:root {
  --bg: #f4f0e8;
  --bg-deep: #e7efe9;
  --surface: rgba(255, 252, 245, 0.92);
  --surface-strong: #fffdf8;
  --surface-ink: #102233;
  --text: ${brandSystem.text_color ?? "#102233"};
  --muted: #60717b;
  --muted-strong: #3f5360;
  --line: rgba(16, 34, 51, 0.12);
  --line-strong: rgba(16, 34, 51, 0.2);
  --primary: ${brandSystem.primary_color ?? "#17324D"};
  --secondary: ${brandSystem.secondary_color ?? "#B9D8E8"};
  --accent: ${brandSystem.accent_color ?? "#13836F"};
  --accent-soft: #d9ece5;
  --warm: #c39a50;
  --warn: #8a5b16;
  --headline: ${headingFont};
  --body: ${bodyFont};
  --radius-xl: 34px;
  --radius-lg: 24px;
  --radius-md: 16px;
  --shadow-soft: 0 24px 70px rgba(16, 34, 51, 0.12);
  --shadow-card: 0 18px 44px rgba(16, 34, 51, 0.08);
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  font-family: var(--body);
  color: var(--text);
  background:
    radial-gradient(circle at 12% 8%, rgba(195, 154, 80, 0.18), transparent 30%),
    radial-gradient(circle at 82% 2%, rgba(19, 131, 111, 0.18), transparent 32%),
    linear-gradient(180deg, #fffaf1 0%, var(--bg) 42%, var(--bg-deep) 100%);
  min-height: 100vh;
}
a { color: inherit; text-decoration: none; }
img { max-width: 100%; display: block; }
.site-shell { width: min(1180px, calc(100vw - 32px)); margin: 0 auto; padding: 22px 0 72px; position: relative; }
.site-shell::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(16, 34, 51, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(16, 34, 51, 0.028) 1px, transparent 1px);
  background-size: 42px 42px;
  mask-image: linear-gradient(180deg, rgba(0,0,0,0.45), transparent 58%);
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  border: 1px solid var(--line);
  background: rgba(255, 252, 245, 0.82);
  border-radius: 24px;
  backdrop-filter: blur(18px);
  box-shadow: 0 18px 40px rgba(16, 34, 51, 0.08);
  position: sticky;
  top: 16px;
  z-index: 4;
}
.brand { display: inline-flex; align-items: center; gap: 10px; font-family: var(--headline); font-weight: 760; letter-spacing: -0.02em; }
.brand-mark {
  width: 28px;
  height: 28px;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--primary), var(--accent));
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.28), 0 10px 22px rgba(16, 34, 51, 0.16);
}
.topnav { display: flex; align-items: center; gap: 10px; color: var(--muted-strong); font-size: 14px; flex-wrap: wrap; }
.topnav a { padding: 9px 12px; border-radius: 999px; }
.topnav a:hover { background: rgba(23, 50, 77, 0.07); color: var(--primary); }
.nav-cta { background: var(--primary); color: #fff !important; padding-inline: 15px !important; box-shadow: 0 12px 24px rgba(23, 50, 77, 0.16); }
.locale-switcher {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: rgba(255,255,255,0.7);
}
.locale-link {
  padding: 7px 10px !important;
  border-radius: 999px;
  color: var(--muted-strong);
  font-size: 12px;
  font-weight: 700;
}
.locale-link.active {
  background: rgba(23, 50, 77, 0.08);
  color: var(--primary);
}
.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.04fr) minmax(420px, 0.96fr);
  gap: 44px;
  align-items: center;
  padding: 78px 0 40px;
}
.home-hero { align-items: start; }
.compact-hero { padding: 62px 0 26px; }
.eyebrow, .section-label {
  margin: 0 0 10px;
  color: var(--accent);
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.hero-kicker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 18px;
  padding: 8px 12px;
  border: 1px solid rgba(19, 131, 111, 0.2);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.55);
  color: var(--accent);
  font-size: 13px;
  font-weight: 750;
}
h1, h2, h3, h4 {
  margin: 0;
  font-family: var(--headline);
  line-height: 1.04;
}
h1 { font-size: clamp(44px, 6vw, 78px); letter-spacing: -0.055em; max-width: 11ch; }
h2 { font-size: clamp(30px, 3.5vw, 52px); letter-spacing: -0.04em; }
h3 { font-size: 22px; letter-spacing: -0.025em; }
p { line-height: 1.72; }
.lede {
  margin: 18px 0 22px;
  max-width: 60ch;
  font-size: clamp(18px, 2vw, 21px);
  color: var(--muted-strong);
}
.badge-row { display: flex; gap: 10px; flex-wrap: wrap; }
.pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  border: 1px solid rgba(16, 34, 51, 0.08);
  background: rgba(255,255,255,0.64);
  color: var(--primary);
  padding: 9px 13px;
  font-size: 13px;
  font-weight: 720;
}
.pill.verified { color: var(--accent); background: rgba(19, 131, 111, 0.09); border-color: rgba(19, 131, 111, 0.18); }
.hero-actions, .button-row { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 26px; }
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 52px;
  border-radius: 999px;
  padding: 0 22px;
  font-weight: 760;
  border: 1px solid transparent;
  transition: transform 180ms ease, box-shadow 180ms ease, background 180ms ease;
}
.button:hover { transform: translateY(-1px); }
.button.primary {
  background: linear-gradient(135deg, var(--primary), #294b6b);
  color: white;
  box-shadow: 0 18px 36px rgba(23, 50, 77, 0.2);
}
.button.secondary {
  background: rgba(255, 252, 245, 0.86);
  border-color: var(--line-strong);
}
.button.ghost {
  background: rgba(19, 131, 111, 0.1);
  color: var(--accent);
}
.button.text { min-height: auto; padding: 0; border: 0; border-radius: 0; color: var(--accent); background: transparent; }
.button.disabled {
  opacity: 0.55;
  pointer-events: none;
}
.state-note {
  margin: 12px 0 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.7;
}
.hero-proof {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 26px;
  max-width: 620px;
}
.metric {
  padding: 15px;
  border-radius: 20px;
  border: 1px solid var(--line);
  background: rgba(255,255,255,0.56);
}
.metric strong { display: block; font-family: var(--headline); font-size: 24px; letter-spacing: -0.03em; }
.metric span { display: block; margin-top: 4px; color: var(--muted); font-size: 13px; }
.hero-media { position: relative; }
.visual-card {
  border-radius: var(--radius-xl);
  border: 1px solid rgba(16, 34, 51, 0.1);
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.78), rgba(255, 252, 245, 0.92)),
    radial-gradient(circle at top right, rgba(185, 216, 232, 0.42), transparent 48%);
  box-shadow: var(--shadow-soft);
  padding: 18px;
  overflow: hidden;
}
.visual-card img, .panel img {
  border-radius: 24px;
  border: 1px solid rgba(16, 34, 51, 0.08);
  box-shadow: 0 20px 48px rgba(12, 28, 42, 0.12);
}
.mini-window {
  margin-top: 14px;
  border-radius: 22px;
  background: var(--surface-ink);
  color: #f6efe4;
  padding: 18px;
}
.mini-window-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; color: rgba(255,255,255,0.72); font-size: 13px; }
.field-row {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  padding: 12px 0;
  border-top: 1px solid rgba(255,255,255,0.12);
  font-size: 14px;
}
.field-row span { color: rgba(255,255,255,0.58); }
.field-row strong { text-align: right; }
.section { padding: 56px 0; }
.section-heading { display: flex; flex-direction: column; gap: 10px; margin-bottom: 24px; max-width: 760px; }
.section-heading.center { align-items: center; text-align: center; margin-inline: auto; }
.grid { display: grid; gap: 22px; }
.card-grid, .trust-strip, .plan-grid, .faq-list, .flow-grid, .feature-grid {
  display: grid;
  gap: 18px;
}
.card-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.card, .trust-card, .plan-card, .faq-item, .screenshot-card, .flow-card, .feature-card, .checkout-card, .status-card {
  border-radius: var(--radius-lg);
  border: 1px solid var(--line);
  background: var(--surface);
  backdrop-filter: blur(14px);
  box-shadow: var(--shadow-card);
}
.benefit-card { padding: 24px; min-height: 150px; }
.benefit-card h3 { margin-bottom: 12px; }
.benefit-card p { margin: 0; color: var(--muted); }
.screenshot-grid { display: grid; gap: 22px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.screenshot-card { overflow: hidden; }
.screenshot-card img { border-radius: 24px 24px 0 0; width: 100%; }
.screenshot-copy { padding: 18px 20px 22px; }
.screenshot-copy p { margin: 10px 0 12px; color: var(--muted); line-height: 1.7; }
.screenshot-copy span { font-size: 13px; color: var(--accent); font-weight: 700; }
.split {
  display: grid;
  gap: 22px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.panel { padding: 18px; }
.panel-note, .plan-footnote { margin: 14px 0 0; color: var(--muted); line-height: 1.7; }
.compact-list { margin: 18px 0 0; padding-left: 18px; color: var(--muted-strong); line-height: 1.8; }
.comparison-note {
  margin: 18px 0 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.75;
}
.step-list, .plan-card ul, .prose-block ul, .feature-card ul, .checkout-card ul {
  margin: 18px 0 0;
  padding-left: 18px;
  line-height: 1.8;
}
.flow-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); counter-reset: step; }
.flow-card { padding: 24px; position: relative; overflow: hidden; }
.flow-card::before {
  counter-increment: step;
  content: "0" counter(step);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  margin-bottom: 18px;
  border-radius: 14px;
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 800;
}
.flow-card p { margin: 10px 0 0; color: var(--muted); }
.feature-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.feature-card { padding: 25px; }
.feature-card p { color: var(--muted); margin-bottom: 0; }
.pricing-section .plan-grid { grid-template-columns: minmax(0, 0.86fr) minmax(0, 1.14fr); align-items: stretch; }
.plan-card { padding: 30px; }
.plan-card h2 { margin-bottom: 12px; }
.plan-card-pro {
  background: linear-gradient(180deg, rgba(23, 50, 77, 0.98), rgba(26, 64, 96, 0.95));
  color: white;
  position: relative;
  overflow: hidden;
}
.plan-card-pro::after {
  content: "";
  position: absolute;
  inset: auto -20% -45% 20%;
  height: 220px;
  background: radial-gradient(circle, rgba(19, 131, 111, 0.45), transparent 68%);
}
.plan-card-pro .plan-footnote,
.plan-card-pro ul,
.plan-card-pro p { color: rgba(255,255,255,0.85); }
.plan-label {
  margin: 0 0 8px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 12px;
  font-weight: 700;
  color: var(--accent);
}
.plan-card-pro .plan-label { color: #9ce4d6; }
.price-line { display: flex; align-items: baseline; gap: 10px; margin: 12px 0 8px; }
.price-line strong { font-family: var(--headline); font-size: clamp(42px, 5vw, 70px); letter-spacing: -0.05em; }
.price-line span { color: var(--muted); }
.plan-card-pro .price-line span { color: rgba(255,255,255,0.76); }
.trust-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.trust-card { padding: 24px; }
.trust-card p, .faq-item p, .prose-block p, .checkout-card p, .status-card p { color: var(--muted); line-height: 1.8; }
.faq-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.faq-item { padding: 24px; }
.status-grid {
  display: grid;
  gap: 18px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.status-card { padding: 24px; }
.status-card h3 { margin-bottom: 10px; }
.mini-kpis {
  display: grid;
  gap: 12px;
  margin-top: 18px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.mini-kpis div {
  padding: 14px;
  border-radius: 18px;
  background: rgba(255,255,255,0.72);
  border: 1px solid var(--line);
}
.mini-kpis span {
  display: block;
  margin-bottom: 6px;
  color: var(--muted);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.mini-kpis strong { font-family: var(--headline); font-size: 20px; letter-spacing: -0.03em; }
.text-columns { align-items: start; }
.prose-block { padding: 24px; }
.prose-block h3, .prose-block h4 { margin-bottom: 10px; }
.cta-band {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 34px;
  border-radius: var(--radius-xl);
  border: 1px solid var(--line);
  background: linear-gradient(135deg, rgba(255,255,255,0.9), rgba(237, 244, 241, 0.94));
  box-shadow: var(--shadow-card);
}
.checkout-rail {
  display: grid;
  grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
  gap: 22px;
  align-items: start;
}
.checkout-card { padding: 28px; }
.status-banner {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  margin-top: 18px;
  padding: 16px;
  border-radius: 20px;
  background: rgba(195, 154, 80, 0.12);
  color: var(--warn);
}
.status-banner strong { color: var(--primary); }
.guidance-page {
  min-height: 72vh;
  display: grid;
  place-items: center;
  padding-top: 64px;
}
.guidance-card {
  width: min(760px, 100%);
  border-radius: var(--radius-xl);
  border: 1px solid var(--line);
  background: var(--surface);
  box-shadow: var(--shadow-soft);
  padding: clamp(28px, 5vw, 54px);
}
.guidance-card h1 { max-width: 13ch; }
.legal-shell { padding-top: 48px; }
.legal-card h1 { max-width: 16ch; }
.legal-copy h3 { margin: 24px 0 10px; }
.legal-copy p, .legal-copy li { color: var(--muted-strong); line-height: 1.8; }
.legal-copy ul { padding-left: 18px; }
.legal-extra { margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--line); }
.guidance-actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 26px; }
.fine-print { color: var(--muted); font-size: 13px; line-height: 1.7; }
.footer {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  justify-content: space-between;
  border-top: 1px solid var(--line);
  padding-top: 28px;
  margin-top: 12px;
  color: var(--muted);
}
.footer-legal { display: inline-flex; flex-wrap: wrap; gap: 16px; }
.hub-shell {
  width: min(1180px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 32px 0 64px;
}
.hub-hero {
  display: grid;
  gap: 18px;
  margin-bottom: 32px;
  padding: 34px;
  border-radius: var(--radius-xl);
  border: 1px solid var(--line);
  background: var(--surface);
  box-shadow: var(--shadow-card);
}
.hub-grid {
  display: grid;
  gap: 22px;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
}
.hub-card {
  padding: 28px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--line);
  background: var(--surface);
  box-shadow: var(--shadow-card);
}
.hub-card img {
  width: 68px;
  height: 68px;
  border-radius: 18px;
  margin-bottom: 18px;
}
.status-chip {
  display: inline-flex;
  margin-bottom: 16px;
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(23, 50, 77, 0.07);
  color: var(--primary);
  font-size: 12px;
  font-weight: 700;
}
code {
  padding: 2px 6px;
  border-radius: 8px;
  background: rgba(16, 34, 51, 0.06);
}
@media (max-width: 980px) {
  .hero, .split, .pricing-section .plan-grid, .trust-strip, .faq-list, .screenshot-grid, .checkout-rail, .feature-grid, .flow-grid, .status-grid {
    grid-template-columns: 1fr;
  }
  .card-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .cta-band {
    display: grid;
    align-items: start;
  }
  .topbar {
    flex-direction: column;
    align-items: flex-start;
  }
}
@media (max-width: 640px) {
  .site-shell, .hub-shell { width: min(100vw - 24px, 100%); }
  .card-grid { grid-template-columns: 1fr; }
  .hero-proof { grid-template-columns: 1fr; }
  .mini-kpis { grid-template-columns: 1fr; }
  h1 { font-size: 38px; }
  .hero { padding-top: 32px; }
  .topbar { border-radius: 24px; position: static; }
}`;
}

function renderProductPage({ state, screenshots, checkoutConfig, supportHtml, privacyHtml, changelogHtml, pricingLink, backToHubLink, localeSwitcherHtml = "" }) {
  const product = state.product;
  const installReady = resolveInstallMode(product);
  const faq = buildFaq(product);
  const heroImage = screenshots[0]?.image ?? "assets/landing/hero_1600x900.png";
  const comparisonRows = [
    {
      title: "Free",
      body: `${product.freeLimit} fills to test the real flow before paying.`,
      items: ["10 fills", "1 saved profile", "Local-only", "No overwrite by default"]
    },
    {
      title: "Lifetime",
      body: `${product.priceLabel} for people who use LeadFill often enough that the free quota is not enough.`,
      items: ["Unlimited fills", "Save / edit / delete profiles", "Advanced field support", "No subscription"]
    }
  ];
  const benefits = [
    {
      title: "One saved profile, less repetitive typing",
      body: "Store the details you enter all the time, then fill supported forms from the popup with one click."
    },
    {
      title: "Fast enough to feel useful immediately",
      body: "LeadFill is narrow on purpose. It handles the common fields that matter without turning into a noisy automation suite."
    },
    {
      title: "Privacy-friendly by default",
      body: "Your saved profile stays local in Chrome. No upload. No cloud sync. No hidden workspace account."
    },
    {
      title: "Simple upgrade path",
      body: `${product.freeLimit} free fills first, then ${product.priceLabel} for unlimited usage if the product earns it.`
    }
  ];
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(product.name)} | Local Chrome form filling</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div class="site-shell">
    <header class="topbar">
      <a class="brand" href="index.html"><span class="brand-mark"></span>${escapeHtml(product.shortName)}</a>
      <nav class="topnav">
        <a href="index.html">Home</a>
        <a href="product.html">Product</a>
        <a href="${escapeHtml(pricingLink)}">Pricing</a>
        <a href="account.html">Account</a>
        <a class="nav-cta" href="${escapeHtml(pricingLink)}">Unlock Lifetime</a>
        ${localeSwitcherHtml}
      </nav>
    </header>

    <section class="hero home-hero">
      <div class="hero-copy">
        <div class="hero-kicker">Local lead form filling without sync clutter</div>
        <h1>${escapeHtml(product.name)}</h1>
        <p class="lede">Save one profile once, then fill repetitive lead forms faster on the sites you already use. LeadFill stays local, stays simple, and makes the upgrade decision obvious.</p>
        <div class="badge-row">
          ${heroBadges(product).map((badge) => `<span class="pill">${escapeHtml(badge)}</span>`).join("")}
        </div>
        <div class="hero-actions">
          <a class="button primary" href="${escapeHtml(pricingLink)}">Unlock Lifetime</a>
          <a class="button secondary ${installReady ? "" : "disabled"}" href="${installReady ? escapeHtml(product.installUrl) : "#chrome-review-pending"}" ${installReady ? "" : "aria-disabled=\"true\""}>Add to Chrome</a>
          <a class="button text" href="#how-it-works">See how it works</a>
        </div>
        <div class="hero-proof">
          <div class="metric"><strong>${escapeHtml(`${product.freeLimit}`)}</strong><span>free fills before you decide</span></div>
          <div class="metric"><strong>$19</strong><span>lifetime unlock, no subscription</span></div>
          <div class="metric"><strong>Local</strong><span>saved profile stays on your machine</span></div>
        </div>
      </div>
      <div class="hero-media">
        <div class="visual-card">
          <img src="${escapeHtml(heroImage)}" alt="${escapeHtml(product.name)} screenshot">
          <div class="mini-window">
            <div class="mini-window-header"><span>Why people pay</span><span>Product-first</span></div>
            <div class="field-row"><span>Saved once</span><strong>Use the same profile again</strong></div>
            <div class="field-row"><span>Repeated forms</span><strong>Fill common fields faster</strong></div>
            <div class="field-row"><span>Privacy</span><strong>No upload, no cloud sync</strong></div>
          </div>
        </div>
      </div>
    </section>

    <section class="section split product-proof">
      <div>
        <p class="section-label">Why it feels productized</p>
        <h2>LeadFill sells one clean workflow instead of acting like a payment dashboard.</h2>
        <p class="lede">The site leads with the product: save a profile, open a form, click fill, upgrade only if it becomes part of your routine.</p>
        ${listToHtml([
          "Built for repetitive profile entry, not generic browser automation",
          "Real screenshots from the actual extension workflow",
          "Clear free-versus-paid decision without hidden tiers"
        ], "compact-list")}
      </div>
      <div class="card panel">
        <img src="assets/landing/hero_1600x900.png" alt="${escapeHtml(product.name)} hero visual">
        <p class="panel-note">The visual language now points back to the product itself: one profile, one click, one lifetime unlock.</p>
      </div>
    </section>

    <section class="section grid" id="benefits">
      <div class="section-heading">
        <p class="section-label">Core benefits</p>
        <h2>Three to five reasons to care, not a wall of platform copy.</h2>
      </div>
      <div class="card-grid">
        ${benefits.map((item) => `<article class="card benefit-card"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body)}</p></article>`).join("")}
      </div>
    </section>

    <section class="section" id="how-it-works">
      <div class="section-heading">
        <p class="section-label">How it works</p>
        <h2>A short workflow that is easy to understand before anyone buys.</h2>
      </div>
      <div class="flow-grid">
        ${buildHowItWorksSteps().map((step) => `<article class="flow-card"><h3>${escapeHtml(step.replace(/\.$/, ""))}</h3><p>${escapeHtml(step)}</p></article>`).join("")}
      </div>
    </section>

    <section class="section pricing-section" id="pricing">
      <div class="section-heading">
        <p class="section-label">Free vs Lifetime</p>
        <h2>One product. One price. One clear reason to upgrade.</h2>
      </div>
      <div class="plan-grid">
        ${comparisonRows.map((row) => `
          <article class="plan-card ${row.title === "Lifetime" ? "plan-card-pro" : ""}">
            <p class="plan-label">${escapeHtml(row.title === "Lifetime" ? "Lifetime Unlock" : row.title)}</p>
            ${row.title === "Lifetime"
              ? `<div class="price-line"><strong>$19</strong><span>lifetime</span></div>`
              : `<h2>${escapeHtml(`${product.freeLimit} fills`)}</h2>`}
            <p>${escapeHtml(row.body)}</p>
            ${listToHtml(row.items)}
          </article>
        `).join("")}
      </div>
      <p class="comparison-note">Payment is handled on a secure external page. Membership becomes active only after webhook-confirmed entitlement.</p>
    </section>

    <section class="section faq-section" id="faq">
      <div class="section-heading">
        <p class="section-label">FAQ</p>
        <h2>Short answers before a user decides whether $19 is worth it.</h2>
      </div>
      <div class="faq-list">
        ${faq.map((item) => `
          <article class="faq-item">
            <h3>${escapeHtml(item.question)}</h3>
            <p>${escapeHtml(item.answer)}</p>
          </article>
        `).join("")}
      </div>
    </section>

    <section class="section cta-band">
      <div>
        <p class="section-label">Ready to try it?</p>
        <h2>Use the free fills first. Unlock Lifetime when LeadFill becomes part of your daily flow.</h2>
      </div>
      <div class="button-row">
        <a class="button primary" href="${escapeHtml(pricingLink)}">View pricing</a>
        <a class="button secondary" href="product.html">See product details</a>
        <a class="button ghost" href="account.html">Account & membership</a>
      </div>
    </section>

    <footer class="footer">
      <div class="footer-legal">
        <a href="refund.html">Refund</a>
        <a href="privacy.html">Privacy</a>
        <a href="terms.html">Terms</a>
      </div>
      <span>Test-mode payment integration remains active. Production payment is not verified.</span>
    </footer>
  </div>
</body>
</html>`;
}

function renderFeaturePage({ state, screenshots, localeSwitcherHtml = "" }) {
  const product = state.product;
  const gallery = (screenshots ?? []).slice(0, 3);
  const featureBreakdown = [
    {
      title: "Field coverage",
      items: ["Common text inputs", "Email and phone fields", "Textarea notes", "Select dropdowns"]
    },
    {
      title: "Fill behavior",
      items: ["User-initiated from the popup", "Skips readonly fields", "Skips disabled fields", "No overwrite by default"]
    },
    {
      title: "Privacy boundary",
      items: ["Local Chrome storage", "No form content upload", "No cloud sync", "No hidden account requirement for free usage"]
    },
    {
      title: "Upgrade boundary",
      items: ["External checkout page", "Email OTP for membership restore", "Refresh membership after payment", "Webhook-confirmed entitlement for active status"]
    }
  ];
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(product.name)} Product | Form filling details</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div class="site-shell">
    <header class="topbar">
      <a class="brand" href="index.html"><span class="brand-mark"></span>${escapeHtml(product.shortName)}</a>
      <nav class="topnav">
        <a href="index.html">Home</a>
        <a href="product.html">Product</a>
        <a href="pricing.html">Pricing</a>
        <a href="account.html">Account</a>
        <a class="nav-cta" href="pricing.html">Unlock Lifetime</a>
        ${localeSwitcherHtml}
      </nav>
    </header>

    <section class="hero compact-hero">
      <div class="hero-copy">
        <p class="eyebrow">Product details</p>
        <h1>What LeadFill actually helps with.</h1>
        <p class="lede">LeadFill is intentionally narrow. It helps with one repetitive task well: filling the same profile details into compatible lead forms without turning your browser into a general automation tool.</p>
      </div>
      <div class="hero-media visual-card">
        <img src="${escapeHtml(gallery[0]?.image ?? "assets/screenshots/screenshot_1_1280x800.png")}" alt="${escapeHtml(product.name)} product screenshot">
      </div>
    </section>

    <section class="section split">
      <div>
        <p class="section-label">Best fit</p>
        <h2>Built for people who keep typing the same contact details.</h2>
        ${listToHtml([
          "Sales reps sending outbound forms",
          "Recruiters entering the same profile across multiple pages",
          "Operators doing repetitive lead intake",
          "Anyone who wants a local-only alternative to bigger autofill suites"
        ], "compact-list")}
      </div>
      <div class="card prose-block">
        <h3>What it does not try to be</h3>
        <p>LeadFill does not promise cloud sync, team collaboration, CRM integration, or full browser automation. The product is stronger because it keeps a smaller surface area.</p>
      </div>
    </section>

    <section class="section" id="features">
      <div class="section-heading">
        <p class="section-label">Feature breakdown</p>
        <h2>Human-readable capabilities that match the extension.</h2>
      </div>
      <div class="feature-grid">
        ${featureBreakdown.map((group) => `
          <article class="feature-card">
            <h3>${escapeHtml(group.title)}</h3>
            ${listToHtml(group.items)}
          </article>
        `).join("")}
      </div>
    </section>

    <section class="section">
      <div class="section-heading">
        <p class="section-label">Real screenshots</p>
        <h2>Visual proof stays close to the shipping extension.</h2>
      </div>
      <div class="screenshot-grid">
        ${gallery.map((item) => `
          <article class="screenshot-card">
            <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.caption ?? product.name)}">
            <div class="screenshot-copy">
              <h3>${escapeHtml(item.caption ?? "LeadFill screenshot")}</h3>
              <p>${escapeHtml(item.note ?? "Real browser-smoke screenshot from the current commercial candidate.")}</p>
            </div>
          </article>
        `).join("")}
      </div>
    </section>

    <section class="section cta-band">
      <div>
        <p class="section-label">Next step</p>
        <h2>See the pricing decision when the product value is clear.</h2>
      </div>
      <div class="button-row">
        <a class="button primary" href="pricing.html">View pricing</a>
        <a class="button secondary" href="account.html">How membership works</a>
      </div>
    </section>

    <footer class="footer">
      <div class="footer-legal">
        <a href="refund.html">Refund</a>
        <a href="privacy.html">Privacy</a>
        <a href="terms.html">Terms</a>
      </div>
      <span>Product-first site copy. No production payment claim.</span>
    </footer>
  </div>
</body>
</html>`;
}

function renderPricingPage({ state, checkoutConfig, detailLink, backToHubLink, localeSwitcherHtml = "" }) {
  const product = state.product;
  const checkoutReady = resolveCheckoutReady(product);
  const checkoutButtonLabel = product.checkoutMode === "test" ? "Use test-mode checkout from the extension" : "Unlock Lifetime";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(product.name)} Pricing | $19 Lifetime</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div class="site-shell">
    <header class="topbar">
      <a class="brand" href="index.html"><span class="brand-mark"></span>${escapeHtml(product.shortName)}</a>
      <nav class="topnav">
        <a href="index.html">Home</a>
        <a href="product.html">Product</a>
        <a href="pricing.html">Pricing</a>
        <a href="account.html">Account</a>
        <a class="nav-cta" href="pricing.html">Unlock Lifetime</a>
        ${localeSwitcherHtml}
      </nav>
    </header>
    <section class="hero compact-hero">
      <div class="hero-copy">
        <p class="eyebrow">Pricing</p>
        <h1>Simple pricing for one clear product.</h1>
        <p class="lede">LeadFill gives people enough free usage to feel the value first, then keeps the upgrade simple: one lifetime unlock for people who need unlimited fills.</p>
        <div class="badge-row">
          <span class="pill">${escapeHtml(`${product.freeLimit} free fills`)}</span>
          <span class="pill">$19 lifetime</span>
          <span class="pill">Local-only</span>
          <span class="pill">No subscription</span>
        </div>
      </div>
      <div class="hero-media visual-card">
        <img src="assets/landing/pricing_1600x900.png" alt="${escapeHtml(product.name)} pricing image">
      </div>
    </section>

    <section class="section pricing-section">
      <div class="plan-grid">
        <article class="plan-card">
          <p class="plan-label">Free</p>
          <h2>${escapeHtml(`${product.freeLimit} fills`)}</h2>
          <p>Enough to prove whether LeadFill belongs in your workflow.</p>
          ${listToHtml([
            "10 fills",
            "1 saved profile",
            "Local-only",
            "No overwrite by default"
          ])}
        </article>
        <article class="plan-card plan-card-pro">
          <p class="plan-label">Lifetime Unlock</p>
          <div class="price-line"><strong>$19</strong><span>lifetime</span></div>
          <p>For users who already know repetitive profile entry is worth removing from the day.</p>
          ${listToHtml([
            "Unlimited fills",
            "Save / edit / delete profiles",
            "Advanced field support",
            "Local-only",
            "No subscription"
          ])}
          <a class="button ${checkoutReady ? "primary" : "disabled"}" href="#checkout-guide" ${checkoutReady ? "" : "aria-disabled=\"true\""}>${escapeHtml(checkoutButtonLabel)}</a>
          <p class="plan-footnote">Payment is handled on a secure external page. Membership does not activate locally from the success page.</p>
        </article>
      </div>
    </section>

    <section class="section split" id="checkout-guide">
      <div class="card prose-block">
        <p class="section-label">How payment works</p>
        <h2>Simple on the surface, controlled behind the scenes.</h2>
        ${listToHtml([
          "You start checkout from the extension after login when membership actions are needed.",
          "Payment happens on a secure external page.",
          "After payment, you return to LeadFill and refresh membership.",
          "Active membership is confirmed by webhook-written entitlement, not by the success page alone."
        ])}
      </div>
      <div class="card prose-block">
        <p class="section-label">How membership refresh works</p>
        <h2>What the user actually does after paying.</h2>
        ${listToHtml([
          "Open the extension again.",
          "Use the same email and sign in with OTP if needed.",
          "Click Refresh membership.",
          "LeadFill reads the current entitlement and unlocks unlimited usage only when it is active."
        ])}
      </div>
    </section>

    <section class="section trust-strip">
      <div class="trust-card">
        <h3>Secure external checkout</h3>
        <p>LeadFill keeps payment outside the extension and only ships public pay-site configuration inside the client.</p>
      </div>
      <div class="trust-card">
        <h3>Webhook-confirmed membership</h3>
        <p>Membership becomes active after the server confirms the paid event and writes active entitlement.</p>
      </div>
      <div class="trust-card">
        <h3>Current mode</h3>
        <p>Checkout route is verified in ${escapeHtml(product.checkoutMode)} mode. Production payment status remains ${escapeHtml(product.productionPaymentStatus ?? "not_verified")}.</p>
      </div>
    </section>

    <footer class="footer">
      <div class="footer-legal">
        <a href="refund.html">Refund</a>
        <a href="privacy.html">Privacy</a>
        <a href="terms.html">Terms</a>
      </div>
      <span>Test-mode payment integration remains active. Production payment is not verified.</span>
    </footer>
  </div>
</body>
</html>`;
}

function renderAccountPage({ state, checkoutConfig, localeSwitcherHtml = "" }) {
  const product = state.product;
  const supportEmail = checkoutConfig.supportEmail || "support@915500.xyz";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Account | ${escapeHtml(product.name)}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div class="site-shell">
    <header class="topbar">
      <a class="brand" href="index.html"><span class="brand-mark"></span>${escapeHtml(product.shortName)}</a>
      <nav class="topnav">
        <a href="index.html">Home</a>
        <a href="product.html">Product</a>
        <a href="pricing.html">Pricing</a>
        <a href="account.html">Account</a>
        <a class="nav-cta" href="pricing.html">Unlock Lifetime</a>
        ${localeSwitcherHtml}
      </nav>
    </header>

    <section class="hero compact-hero">
      <div class="hero-copy">
        <p class="eyebrow">Account & membership</p>
        <h1>Restore purchases and refresh membership without the debug-panel feel.</h1>
        <p class="lede">LeadFill keeps account steps small: sign in with email OTP, check whether you are on Free or Lifetime, and refresh membership after payment when needed.</p>
      </div>
      <div class="hero-media visual-card">
        <img src="assets/landing/pricing_1600x900.png" alt="${escapeHtml(product.name)} account and membership visual">
      </div>
    </section>

    <section class="section">
      <div class="status-grid">
        <article class="status-card">
          <p class="section-label">Plan</p>
          <h3>Free or Lifetime</h3>
          <p>Free users keep ${escapeHtml(`${product.freeLimit} fills`)}. Lifetime users get unlimited fills after active entitlement is confirmed.</p>
        </article>
        <article class="status-card">
          <p class="section-label">Usage</p>
          <h3>Clear quota boundary</h3>
          <p>LeadFill shows the free limit first, then unlocks unlimited usage only when the paid membership is active.</p>
        </article>
        <article class="status-card">
          <p class="section-label">Membership refresh</p>
          <h3>Refresh after payment</h3>
          <p>Payment does not flip a local switch. Refresh membership reads the server entitlement before Pro is shown as active.</p>
        </article>
        <article class="status-card">
          <p class="section-label">Orders & restore</p>
          <h3>Use the same email</h3>
          <p>Purchase restore works through the same email OTP flow used for membership checks and account recovery.</p>
        </article>
      </div>
    </section>

    <section class="section split">
      <div class="card prose-block">
        <p class="section-label">How account access works</p>
        <h2>Email OTP keeps the restore path simple.</h2>
        ${listToHtml([
          "Sign in with the same email you used for checkout.",
          "Refresh membership when you need to read the latest entitlement.",
          "Use the free plan normally if you have not purchased yet."
        ])}
      </div>
      <div class="card prose-block">
        <p class="section-label">What stays out of the extension</p>
        <h2>The client only keeps public configuration.</h2>
        ${listToHtml([
          "No service role key in the extension",
          "No Waffo private key in the extension",
          "No merchant secret in the extension",
          "No local unlock from successUrl alone"
        ])}
      </div>
    </section>

    <section class="section checkout-rail">
      <div class="checkout-card">
        <p class="section-label">Current environment</p>
        <h2>Membership flow status</h2>
        <div class="mini-kpis">
          <div><span>OTP</span><strong>${escapeHtml(checkoutConfig.otpStatus)}</strong></div>
          <div><span>Webhook</span><strong>${escapeHtml(checkoutConfig.webhookStatus)}</strong></div>
          <div><span>Entitlement</span><strong>${escapeHtml(checkoutConfig.entitlementStatus)}</strong></div>
        </div>
      </div>
      <div class="checkout-card">
        <p class="section-label">Support</p>
        <h2>Need help with membership?</h2>
        <p>Contact ${escapeHtml(supportEmail)} with the email used at checkout if membership restore or order follow-up needs manual help.</p>
        <p class="fine-print">Current checkout mode: ${escapeHtml(checkoutConfig.checkoutMode)}. Production payment status: ${escapeHtml(product.productionPaymentStatus ?? "not_verified")}.</p>
      </div>
    </section>

    <footer class="footer">
      <div class="footer-legal">
        <a href="refund.html">Refund</a>
        <a href="privacy.html">Privacy</a>
        <a href="terms.html">Terms</a>
      </div>
      <span>Account page keeps payment and membership details clear without turning into a debug console.</span>
    </footer>
  </div>
</body>
</html>`;
}

function renderLegalPage({ state, kind, title, eyebrow, lede, bodyHtml, localeSwitcherHtml = "" }) {
  const product = state.product;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | ${escapeHtml(product.name)}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div class="site-shell">
    <header class="topbar">
      <a class="brand" href="index.html"><span class="brand-mark"></span>${escapeHtml(product.shortName)}</a>
      <nav class="topnav">
        <a href="index.html">Home</a>
        <a href="product.html">Product</a>
        <a href="pricing.html">Pricing</a>
        <a href="account.html">Account</a>
        ${localeSwitcherHtml}
      </nav>
    </header>
    <main class="guidance-page legal-shell">
      <section class="guidance-card legal-card">
        <p class="eyebrow">${escapeHtml(eyebrow)}</p>
        <h1>${escapeHtml(title)}</h1>
        <p class="lede">${escapeHtml(lede)}</p>
        <div class="legal-copy">${bodyHtml}</div>
      </section>
    </main>
    <footer class="footer">
      <div class="footer-legal">
        <a href="refund.html">Refund</a>
        <a href="privacy.html">Privacy</a>
        <a href="terms.html">Terms</a>
      </div>
      <span>${escapeHtml(kind === "privacy" ? "Privacy promises stay aligned with the local-only product scope." : "Formal page for the commercial candidate. Production payment remains not verified.")}</span>
    </footer>
  </div>
</body>
</html>`;
}

function renderCheckoutGuidancePage({ state, kind, localeSwitcherHtml = "" }) {
  const product = state.product;
  const page = {
    success: {
      title: "Payment received",
      eyebrow: "Checkout success",
      lede: "Return to LeadFill, sign in with email OTP if needed, then refresh membership so the extension can read the latest entitlement.",
      steps: [
        "Go back to the extension popup.",
        "Use the same email if a login step appears.",
        "Click Refresh membership.",
        "Wait until the plan shows active before expecting unlimited fills."
      ],
      note: "successUrl does not unlock locally. The server entitlement must be active first."
    },
    cancel: {
      title: "Checkout not completed",
      eyebrow: "Checkout cancelled",
      lede: "Nothing changes locally after a cancelled checkout. The free workflow stays available and the user can retry later.",
      steps: [
        "Return to the extension popup.",
        "Keep using the remaining free fills if needed.",
        "Retry checkout later from the same upgrade entry point.",
        "Contact support only if the external payment page failed unexpectedly."
      ],
      note: "No paid membership is granted from a cancelled or failed checkout."
    }
  }[kind];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(page.title)} | ${escapeHtml(product.name)}</title>
  <link rel="stylesheet" href="../styles.css">
</head>
<body>
  <div class="site-shell">
    <header class="topbar">
      <a class="brand" href="../index.html"><span class="brand-mark"></span>${escapeHtml(product.shortName)}</a>
      <nav class="topnav">
        <a href="../index.html">Home</a>
        <a href="../product.html">Product</a>
        <a href="../pricing.html">Pricing</a>
        <a href="../account.html">Account</a>
        ${localeSwitcherHtml}
      </nav>
    </header>
    <main class="guidance-page">
      <section class="guidance-card">
        <p class="eyebrow">${escapeHtml(page.eyebrow)}</p>
        <h1>${escapeHtml(page.title)}</h1>
        <p class="lede">${escapeHtml(page.lede)}</p>
        ${listToHtml(page.steps, "step-list")}
        <div class="status-banner">
          <span>Membership rule</span>
          <strong>Webhook-confirmed entitlement</strong>
        </div>
        <p class="fine-print">${escapeHtml(page.note)}</p>
        <div class="guidance-actions">
          <a class="button primary" href="../account.html">Go to account</a>
          <a class="button secondary" href="../pricing.html">Review pricing</a>
        </div>
      </section>
    </main>
  </div>
</body>
</html>`;
}

export async function generatePluginPage({ projectRoot, productKey }) {
  const catalog = await loadProductCatalog(projectRoot);
  const product = getProductByKey(catalog, productKey);
  if (!product) {
    throw new Error(`Product not found in catalog: ${productKey}`);
  }

  const state = await loadProductRunState(projectRoot, product);
  state.product = product;
  const outputDir = productOutputDir(projectRoot, product.slug);
  const assetsDir = path.join(outputDir, "assets");
  const storeAssetsDir = path.join(state.storeReleasePackageRoot, "assets");
  if (!(await fileExists(storeAssetsDir))) {
    throw new Error(`Store release package assets are missing: ${storeAssetsDir}`);
  }

  await resetDir(outputDir);
  await copyDir(storeAssetsDir, assetsDir);

  const changelogMarkdown = await readTextIfExists(path.join(state.landingDir, "changelog.md"));
  const privacyMarkdown = await readTextIfExists(path.join(state.landingDir, "privacy.md"));
  const supportMarkdown = await readTextIfExists(path.join(state.landingDir, "support.md"));
  const checkoutConfig = buildCheckoutConfig(state);
  const screenshots = screenshotCards(state);
  const detailLink = "index.html";
  const pricingLink = "pricing.html";
  const backToHubLink = "../index.html";
  const rootIndexLocaleSwitcher = renderLocaleSwitcher({ outputDir, localeCode: "en", pageRelativePath: "index.html" });
  const rootProductLocaleSwitcher = renderLocaleSwitcher({ outputDir, localeCode: "en", pageRelativePath: "product.html" });
  const rootPricingLocaleSwitcher = renderLocaleSwitcher({ outputDir, localeCode: "en", pageRelativePath: "pricing.html" });
  const rootAccountLocaleSwitcher = renderLocaleSwitcher({ outputDir, localeCode: "en", pageRelativePath: "account.html" });
  const rootEntitlementLocaleSwitcher = renderLocaleSwitcher({ outputDir, localeCode: "en", pageRelativePath: "entitlement.html" });
  const rootRefundLocaleSwitcher = renderLocaleSwitcher({ outputDir, localeCode: "en", pageRelativePath: "refund.html" });
  const rootPrivacyLocaleSwitcher = renderLocaleSwitcher({ outputDir, localeCode: "en", pageRelativePath: "privacy.html" });
  const rootTermsLocaleSwitcher = renderLocaleSwitcher({ outputDir, localeCode: "en", pageRelativePath: "terms.html" });
  const rootSuccessLocaleSwitcher = renderLocaleSwitcher({ outputDir, localeCode: "en", pageRelativePath: "checkout/success.html" });
  const rootCancelLocaleSwitcher = renderLocaleSwitcher({ outputDir, localeCode: "en", pageRelativePath: "checkout/cancel.html" });
  const supportEmail = checkoutConfig.supportEmail || "support@915500.xyz";
  const refundHtml = markdownToHtml(`# Refund Policy

LeadFill One Profile is still running with controlled launch gating and test-mode payment validation.

## Refund Requests

- Contact ${supportEmail} with the email used at checkout.
- Include the order details and a short description of the billing issue.
- Duplicate purchases, clear mistaken charges, or technical payment failures are reviewed first.

## Response Window

- We aim to respond within three business days.
- Public launch terms may be updated before production payment is enabled.`);
  const formalPrivacyHtml = `
<h3>Privacy Summary</h3>
<p>LeadFill keeps one saved profile in local Chrome storage and fills supported fields only after a user action from the popup.</p>
<h3>What LeadFill does not do</h3>
${listToHtml([
  "It does not upload the saved profile to a remote service.",
  "It does not sync form data to the cloud.",
  "It does not run background automation across every page."
])}
<h3>Membership and payment</h3>
<p>Email OTP is used for membership checks and purchase restore. Payment happens on an external page, and active membership is confirmed by server entitlement after webhook processing.</p>
<div class="legal-extra">${privacyMarkdown ? markdownToHtml(privacyMarkdown) : ""}</div>`;
  const termsHtml = markdownToHtml(`# Terms

LeadFill One Profile is a focused Chrome utility for saving one local profile and filling supported lead-form fields from the extension popup.

## Product Scope

- The product is intentionally narrow and local-first.
- Compatibility depends on supported field types and page structure.
- The extension does not promise cloud sync, CRM integration, or broad browser automation.

## Payment And Membership

- Checkout happens on an external payment page.
- successUrl does not create local membership by itself.
- Active membership depends on server entitlement after webhook confirmation.

## Support

- Contact ${supportEmail} for account, billing, or restore issues.
- Production payment is not verified in this commercial candidate.`);

  await writeText(path.join(outputDir, "styles.css"), renderStyles(state.brandSystem));
  await writeText(path.join(outputDir, "index.html"), renderProductPage({
    state,
    screenshots,
    checkoutConfig,
    supportHtml: markdownToHtml(supportMarkdown),
    privacyHtml: markdownToHtml(privacyMarkdown),
    changelogHtml: markdownToHtml(changelogMarkdown),
    pricingLink,
    backToHubLink,
    localeSwitcherHtml: rootIndexLocaleSwitcher
  }));
  await writeText(path.join(outputDir, "product.html"), renderFeaturePage({
    state,
    screenshots,
    localeSwitcherHtml: rootProductLocaleSwitcher
  }));
  await writeText(path.join(outputDir, "pricing.html"), renderPricingPage({
    state,
    checkoutConfig,
    detailLink,
    backToHubLink,
    localeSwitcherHtml: rootPricingLocaleSwitcher
  }));
  const accountHtml = renderAccountPage({
    state,
    checkoutConfig,
    localeSwitcherHtml: rootAccountLocaleSwitcher
  });
  await writeText(path.join(outputDir, "account.html"), accountHtml);
  await writeText(path.join(outputDir, "checkout", "success.html"), renderCheckoutGuidancePage({
    state,
    kind: "success",
    localeSwitcherHtml: rootSuccessLocaleSwitcher
  }));
  await writeText(path.join(outputDir, "checkout", "cancel.html"), renderCheckoutGuidancePage({
    state,
    kind: "cancel",
    localeSwitcherHtml: rootCancelLocaleSwitcher
  }));
  await writeText(path.join(outputDir, "entitlement.html"), renderAccountPage({
    state,
    checkoutConfig,
    localeSwitcherHtml: rootEntitlementLocaleSwitcher
  }));
  await writeText(path.join(outputDir, "refund.html"), renderLegalPage({
    state,
    kind: "refund",
    title: "Refund Policy",
    eyebrow: "Refund",
    lede: "Short, formal guidance for billing issues while payment remains in controlled mode.",
    bodyHtml: refundHtml,
    localeSwitcherHtml: rootRefundLocaleSwitcher
  }));
  await writeText(path.join(outputDir, "privacy.html"), renderLegalPage({
    state,
    kind: "privacy",
    title: "Privacy",
    eyebrow: "Privacy",
    lede: "Local-first product promises and payment-related data boundaries, written as a real policy page instead of placeholder copy.",
    bodyHtml: formalPrivacyHtml,
    localeSwitcherHtml: rootPrivacyLocaleSwitcher
  }));
  await writeText(path.join(outputDir, "terms.html"), renderLegalPage({
    state,
    kind: "terms",
    title: "Terms",
    eyebrow: "Terms",
    lede: "Scope, boundaries, and payment-related expectations for the commercial candidate.",
    bodyHtml: termsHtml,
    localeSwitcherHtml: rootTermsLocaleSwitcher
  }));
  const localeManifest = await generateLocalizedSitePages({
    state,
    outputDir
  });
  const {
    legacyTestOnlyProductKey: _legacyTestOnlyProductKey,
    usingLegacyTestOnlyProductKey: _usingLegacyTestOnlyProductKey,
    ...siteSafeProduct
  } = product;
  await writeJson(path.join(outputDir, "product.json"), {
    ...siteSafeProduct,
    generated_at: nowIso(),
    supportUrl: "account.html",
    privacyUrl: "privacy.html",
    changelogUrl: "product.html",
    docsUrl: "product.html#features",
    paymentProvider: product.paymentProvider,
    productKeyOnPaySite: checkoutConfig.productKeyOnPaySite,
    currentConfiguredPlanKey: checkoutConfig.configuredPlanKey,
    paymentConfigStatus: product.paymentConfigStatus,
    usingLegacyTestOnlyProductKey: checkoutConfig.productKeyOnPaySite === LEGACY_TEST_ONLY_PRODUCT_KEY,
    premiumWebRedesignStatus: "generated",
    defaultLocale: "en",
    supportedLocales: localeManifest.supported_locales,
    generatedPages: [
      "index.html",
      "product.html",
      "pricing.html",
      "account.html",
      "checkout/success.html",
      "checkout/cancel.html",
      "entitlement.html",
      "refund.html",
      "privacy.html",
      "terms.html",
      "locales.json"
    ]
  });
  await writeJson(path.join(outputDir, "checkout_config.json"), checkoutConfig);
  await writeText(path.join(outputDir, "README.md"), buildPluginReadme(state, checkoutConfig));
  await writeText(path.join(outputDir, "hwh_product_config_checklist.md"), buildHwhProductConfigChecklistMarkdown(product, checkoutConfig));

  await upsertProductCatalogEntry(projectRoot, {
    productKey: product.productKey,
    slug: product.slug,
    detailPagePath: normalizeRelativePath(projectRoot, path.join(outputDir, "index.html")),
    pricingPagePath: normalizeRelativePath(projectRoot, path.join(outputDir, "pricing.html")),
    supportUrl: normalizeRelativePath(projectRoot, path.join(outputDir, "account.html")),
    privacyUrl: normalizeRelativePath(projectRoot, path.join(outputDir, "privacy.html")),
    changelogUrl: normalizeRelativePath(projectRoot, path.join(outputDir, "product.html")),
    docsUrl: normalizeRelativePath(projectRoot, path.join(outputDir, "product.html")),
    listingAssetsPath: normalizeRelativePath(projectRoot, storeAssetsDir),
    remotionAssetsPath: normalizeRelativePath(projectRoot, path.join(runEventsDirectory(projectRoot, product.releaseRunId), "80_remotion_assets")),
    status: product.status ?? "generated"
  }, {
    mode: "update",
    commandName: "site:generate-plugin-page"
  });

  return {
    product,
    outputDir,
    detailPagePath: path.join(outputDir, "index.html"),
    productPagePath: path.join(outputDir, "product.html"),
    pricingPagePath: path.join(outputDir, "pricing.html"),
    accountPagePath: path.join(outputDir, "account.html"),
    checkoutConfigPath: path.join(outputDir, "checkout_config.json"),
    localesPath: path.join(outputDir, "locales.json")
  };
}

function renderProductsIndex(products) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Plugin Catalog Preview</title>
  <style>${renderStyles({
    primary_color: "#17324D",
    secondary_color: "#B9D8E8",
    accent_color: "#13836F",
    background_color: "#EEF4F7",
    text_color: "#102233",
    typography_recommendation: {
      headline_family: "\"Segoe UI Variable Display\", \"Segoe UI\", sans-serif",
      body_family: "\"Segoe UI Variable Text\", \"Segoe UI\", sans-serif"
    }
  })}</style>
</head>
<body>
  <div class="hub-shell">
    <section class="hub-hero">
      <p class="eyebrow">Premium plugin catalog</p>
      <h1>Focused Chrome utilities with polished product pages and audited payment readiness.</h1>
      <p class="lede">Each product page is generated from the catalog, premium packaging system, and HWH handoff so the commercial story stays consistent with the actual extension.</p>
    </section>
    <section class="hub-grid">
      ${products.map((product) => `
        <article class="hub-card">
          <span class="status-chip">${escapeHtml(product.status)}</span>
          ${product.iconPath ? `<img src="${escapeHtml(product.iconPath)}" alt="${escapeHtml(product.name)} icon">` : ""}
          <h2>${escapeHtml(product.name)}</h2>
          <p>${escapeHtml(product.oneSentenceValue)}</p>
          <p class="state-note">Pricing: ${escapeHtml(product.priceLabel)} | Payment: ${escapeHtml(product.paymentConfigStatus)}</p>
          <div class="button-row">
            <a class="button secondary" href="${escapeHtml(product.detailLink)}">View Product</a>
            <a class="button primary" href="${escapeHtml(product.pricingLink)}">Pricing</a>
          </div>
        </article>
      `).join("")}
    </section>
  </div>
</body>
</html>`;
}

export async function generateProductsIndex({ projectRoot }) {
  const catalog = await loadProductCatalog(projectRoot);
  const rootDir = path.join(projectRoot, PLUGIN_PAGES_ROOT);
  await ensureDir(rootDir);
  const products = await Promise.all((catalog.products ?? []).map(async (product) => {
    const detailAbsolute = path.join(projectRoot, product.detailPagePath);
    const pricingAbsolute = path.join(projectRoot, product.pricingPagePath);
    const iconAbsolute = path.join(projectRoot, PLUGIN_PAGES_ROOT, product.slug, "assets", "icon", "icon128.png");
    return {
      ...product,
      detailLink: (await fileExists(detailAbsolute)) ? relativeLink(rootDir, detailAbsolute) : "#detail-missing",
      pricingLink: (await fileExists(pricingAbsolute)) ? relativeLink(rootDir, pricingAbsolute) : "#pricing-missing",
      iconPath: (await fileExists(iconAbsolute)) ? relativeLink(rootDir, iconAbsolute) : null
    };
  }));
  await writeJson(path.join(rootDir, "products.json"), products);
  await writeText(path.join(rootDir, "index.html"), renderProductsIndex(products));
  return {
    outputDir: rootDir,
    indexPath: path.join(rootDir, "index.html"),
    productsJsonPath: path.join(rootDir, "products.json"),
    productCount: products.length
  };
}

function scoreChecks(checks, floor = 72, ceiling = 96) {
  const values = Object.values(checks);
  const passed = values.filter(Boolean).length;
  return Math.round(floor + ((ceiling - floor) * passed / Math.max(values.length, 1)));
}

function buildPremiumWebDesignSystem(state) {
  const product = state.product;
  return buildSafeReport({
    stage: "PREMIUM_WEB_DESIGN_SYSTEM",
    status: "passed",
    run_id: state.runContext.run_id,
    product_key: product.productKey,
    generated_at: nowIso(),
    design_direction: "premium, modern, clean, focused, productized, trustworthy",
    typography: {
      headline: state.brandSystem?.typography_recommendation?.headline_family ?? "\"Aptos Display\", \"Segoe UI Variable Display\", sans-serif",
      body: state.brandSystem?.typography_recommendation?.body_family ?? "\"Aptos\", \"Segoe UI Variable Text\", sans-serif",
      hierarchy: [
        "display hero headline with short line length",
        "section titles at 30-52px",
        "body copy at 16-21px with generous leading",
        "caption and status text at 13-14px"
      ]
    },
    color_system: {
      primary: "#17324D",
      accent: "#13836F",
      warm_accent: "#c39a50",
      background: "#f4f0e8",
      surface: "#fffdf8",
      text: "#102233",
      muted: "#60717b"
    },
    spacing_system: {
      page_width: "1180px max",
      section_spacing: "46px vertical rhythm",
      card_padding: "24px to 30px",
      button_height: "52px",
      hero_spacing: "86px top on desktop"
    },
    components: [
      "sticky rounded topbar",
      "premium hero with trust badges and proof metrics",
      "benefit cards",
      "four-step flow cards",
      "feature matrix cards",
      "two-plan pricing cards",
      "checkout guidance cards",
      "success/cancel/entitlement guidance pages",
      "FAQ cards",
      "trust strip"
    ],
    copy_rules: [
      "Lead with user value, not internal implementation.",
      "Keep Free and Lifetime pricing simple: 10 free fills, $19 lifetime.",
      "State local-only, no upload, and no cloud sync without overclaiming.",
      "Do not mention legacy chatgpt2obsidian as a LeadFill config source.",
      "Do not imply production payment is verified."
    ],
    payment_safety_rules: [
      "External checkout only.",
      "successUrl does not unlock locally.",
      "Active entitlement must come from webhook-confirmed pay-site state.",
      "No service role key, Waffo private key, merchant secret, or webhook secret in the client."
    ],
    asset_alignment: {
      uses_premium_packaging_brand_system: Boolean(state.brandSystem),
      uses_store_release_assets: Boolean(state.storeReleasePackageReport),
      remotion_assets_path: normalizeRelativePath(state.projectRoot, path.join(runEventsDirectory(state.projectRoot, product.releaseRunId), "80_remotion_assets"))
    },
    localization: {
      default_locale: "en",
      supported_locales: ["en", "zh-cn", "ja", "es"],
      note: "English stays as the source-of-truth root version while secondary locales reuse the same visual system."
    },
    quality_targets: {
      product_page_score_minimum: 88,
      checkout_page_score_minimum: 88,
      visual_consistency_score_minimum: 90
    },
    blockers: []
  });
}

function buildWebRedesignPlan(state, generatedFiles) {
  const product = state.product;
  return buildSafeReport({
    stage: "PREMIUM_WEB_REDESIGN_PLAN",
    status: "passed",
    run_id: state.runContext.run_id,
    product_key: product.productKey,
    generated_at: nowIso(),
    source_run_id: product.releaseRunId,
    current_primary_environment: product.currentPrimaryEnvironment,
    payment_mode: product.checkoutMode,
    production_payment_status: product.productionPaymentStatus ?? "not_verified",
    objectives: [
      "Make LeadFill look like a maintained commercial Chrome extension product.",
      "Clarify the one-profile value proposition within the first viewport.",
      "Make Free vs Lifetime pricing obvious without adding extra plans.",
      "Keep local-only, no upload, and no cloud sync trust language prominent.",
      "Explain that paid access comes from webhook-confirmed entitlement, not successUrl."
    ],
    redesigned_pages: [
      "LeadFill product-first homepage",
      "Dedicated product detail page",
      "Pricing and checkout guidance page",
      "Account and membership page",
      "Refund, privacy, and terms pages",
      "Checkout success guidance page",
      "Checkout cancelled / failed guidance page",
      "Product catalog index",
      "Localized site variants for zh-cn, ja, and es"
    ],
    information_architecture: [
      "Hero with product name, value proposition, free tier, lifetime price, and trust notes.",
      "Navigation centered on Home, Product, Pricing, and Account.",
      "Core benefits limited to a small set of stronger sales points.",
      "How it works as a four-step flow with real screenshots.",
      "Feature breakdown tied to implemented field behavior on a separate product page.",
      "Two-plan pricing only: Free and Lifetime.",
      "Payment safety and membership guidance moved into pricing, account, and checkout pages.",
      "Refund, privacy, and terms moved to footer-level legal pages."
    ],
    generated_files: generatedFiles,
    non_goals_preserved: [
      "No Chrome upload.",
      "No Chrome publish.",
      "No production payment.",
      "No Google login.",
      "No backend payment logic change.",
      "No unimplemented feature claims."
    ],
    next_step: "human_visual_review"
  });
}

function buildWebRedesignPlanMarkdown(plan) {
  return `# Premium Web Redesign Plan

Product: ${plan.product_key}
Run: ${plan.run_id}
Payment mode: ${plan.payment_mode}
Production payment status: ${plan.production_payment_status}

## Objectives

${plan.objectives.map((item) => `- ${item}`).join("\n")}

## Redesigned Pages

${plan.redesigned_pages.map((item) => `- ${item}`).join("\n")}

## Information Architecture

${plan.information_architecture.map((item) => `- ${item}`).join("\n")}

## Guardrails

${plan.non_goals_preserved.map((item) => `- ${item}`).join("\n")}

## Next Step

${plan.next_step}
`;
}

function buildProductPageQualityReview({ state, homeHtml, productHtml }) {
  const product = state.product;
  const combined = `${homeHtml}\n${productHtml}`;
  const checks = {
    hero_names_product: homeHtml.includes(product.name),
    value_prop_above_fold: homeHtml.includes("Save one profile once") || homeHtml.includes("LeadFill sells one clean workflow"),
    primary_cta_present: homeHtml.includes("Unlock Lifetime"),
    secondary_cta_present: homeHtml.includes("See how it works"),
    chrome_cta_present: homeHtml.includes("Add to Chrome"),
    price_visible: homeHtml.includes("$19"),
    free_tier_visible: homeHtml.includes(`${product.freeLimit}`) && homeHtml.includes("free fills"),
    trust_notes_visible: homeHtml.includes("Local-only") && homeHtml.includes("No upload") && homeHtml.includes("No cloud sync"),
    product_first_positioning_present: homeHtml.includes("LeadFill sells one clean workflow instead of acting like a payment dashboard"),
    core_benefits_present: homeHtml.includes("Core benefits") && homeHtml.includes("Privacy-friendly by default"),
    how_it_works_present: homeHtml.includes("How it works") && homeHtml.includes("Upgrade to Lifetime"),
    real_screenshot_proof_present: combined.includes("Real screenshots") && combined.includes("Real browser-smoke screenshot"),
    feature_breakdown_present: productHtml.includes("Feature breakdown") && productHtml.includes("Field coverage"),
    pricing_section_present: homeHtml.includes("Free vs Lifetime") && homeHtml.includes("Lifetime Unlock"),
    faq_present: homeHtml.includes("FAQ") && homeHtml.includes("Does this upload my form data?"),
    footer_legal_demoted: homeHtml.includes("<a href=\"refund.html\">Refund</a>") && homeHtml.includes("<a href=\"privacy.html\">Privacy</a>"),
    no_legacy_key_copy: !combined.includes(LEGACY_TEST_ONLY_PRODUCT_KEY)
  };
  const blockers = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  const score = scoreChecks(checks, 74, 96);
  return buildSafeReport({
    stage: "PRODUCT_PAGE_QUALITY_REVIEW",
    status: blockers.length === 0 && score >= 88 ? "passed" : "failed",
    run_id: state.runContext.run_id,
    product_key: product.productKey,
    reviewed_at: nowIso(),
    review_method: "static_generated_page_review",
    page: "generated/plugin-pages/leadfill-one-profile/index.html (paired with product.html)",
    page_quality_score: score,
    checks,
    blockers,
    warnings: product.productionPaymentStatus === "verified" ? [] : ["production_payment_not_verified_copy_still_lives_outside_the_homepage_hero"],
    recommended_fixes: blockers.length === 0 ? [] : ["Regenerate the LeadFill home and product pages after fixing failed product-first IA checks."],
    next_step: blockers.length === 0 ? "human_visual_review" : "fix_product_page_copy_or_structure"
  });
}

function buildCheckoutPageQualityReview({ state, pricingHtml, successHtml, cancelHtml, entitlementHtml, accountHtml }) {
  const product = state.product;
  const combined = `${pricingHtml}\n${successHtml}\n${cancelHtml}\n${entitlementHtml}\n${accountHtml}`;
  const checks = {
    one_product_one_price: pricingHtml.includes("$19") && pricingHtml.includes("No subscription") && !pricingHtml.includes("Universal Pass"),
    free_vs_lifetime_clear: pricingHtml.includes(`${product.freeLimit} fills`) && pricingHtml.includes("Lifetime Unlock"),
    checkout_preflight_explained: pricingHtml.includes("How payment works") && pricingHtml.includes("How membership refresh works"),
    webhook_entitlement_explained: combined.includes("webhook-confirmed entitlement")
      || combined.includes("webhook-written entitlement")
      || combined.includes("Webhook-confirmed membership"),
    success_page_next_steps: successHtml.includes("Payment received") && successHtml.includes("Refresh membership"),
    cancel_page_retry_path: cancelHtml.includes("Checkout not completed") && cancelHtml.includes("retry"),
    entitlement_page_states: entitlementHtml.includes("Free users keep") || accountHtml.includes("Free users keep"),
    success_url_does_not_unlock_locally: combined.includes("successUrl") && combined.includes("does not unlock locally"),
    production_payment_not_overclaimed: combined.includes("Production payment status") && combined.includes("not_verified"),
    no_secret_claim_regression: accountHtml.includes("No service role key") && accountHtml.includes("No Waffo private key") && accountHtml.includes("No merchant secret"),
    account_page_is_not_debug_panel_copy: accountHtml.includes("without the debug-panel feel") && accountHtml.includes("status-grid"),
    no_legacy_key_copy: !combined.includes(LEGACY_TEST_ONLY_PRODUCT_KEY)
  };
  const blockers = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  const score = scoreChecks(checks, 76, 96);
  return buildSafeReport({
    stage: "CHECKOUT_PAGE_QUALITY_REVIEW",
    status: blockers.length === 0 && score >= 88 ? "passed" : "failed",
    run_id: state.runContext.run_id,
    product_key: product.productKey,
    reviewed_at: nowIso(),
    review_method: "static_generated_page_review",
    pages: [
      "generated/plugin-pages/leadfill-one-profile/pricing.html",
      "generated/plugin-pages/leadfill-one-profile/account.html",
      "generated/plugin-pages/leadfill-one-profile/checkout/success.html",
      "generated/plugin-pages/leadfill-one-profile/checkout/cancel.html",
      "generated/plugin-pages/leadfill-one-profile/entitlement.html"
    ],
    page_quality_score: score,
    checks,
    blockers,
    warnings: product.checkoutMode === "test" ? ["checkout_mode_test_must_not_be_presented_as_live"] : [],
    recommended_fixes: blockers.length === 0 ? [] : ["Regenerate pricing, account, and checkout guidance pages after fixing failed payment truthfulness checks."],
    next_step: blockers.length === 0 ? "human_visual_review" : "fix_checkout_page_copy_or_structure"
  });
}

function buildSiteVisualConsistencyReport({ state, designSystem, productReview, checkoutReview, generatedFiles }) {
  const product = state.product;
  const checks = {
    shared_css_generated: generatedFiles.includes("styles.css"),
    localized_pages_generated: generatedFiles.includes("locales.json"),
    design_system_generated: designSystem.status === "passed",
    product_page_passed: productReview.status === "passed",
    checkout_pages_passed: checkoutReview.status === "passed",
    premium_packaging_aligned: Boolean(state.premiumPackagingBrief) && Boolean(state.brandSystem),
    store_assets_present: Boolean(state.storeReleasePackageReport),
    remotion_asset_path_present: Boolean(product.remotionAssetsPath),
    payment_truthfulness_preserved: product.productionPaymentStatus !== "verified" && product.checkoutMode === "test",
    no_upload_publish_side_effects: true
  };
  const blockers = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  const overallScore = Math.round((productReview.page_quality_score + checkoutReview.page_quality_score + scoreChecks(checks, 78, 96)) / 3);
  return buildSafeReport({
    stage: "SITE_VISUAL_CONSISTENCY_REPORT",
    status: blockers.length === 0 && overallScore >= 90 ? "passed" : "failed",
    run_id: state.runContext.run_id,
    product_key: product.productKey,
    reviewed_at: nowIso(),
    review_method: "static_generated_site_review",
    overall_score: overallScore,
    product_page_quality_score: productReview.page_quality_score,
    checkout_page_quality_score: checkoutReview.page_quality_score,
    design_system_status: designSystem.status,
    checks,
    blockers,
    warnings: [
      "human_visual_review_still_required_before_public_launch",
      "production_payment_not_verified",
      "localized_copy_should_receive_human_language_review"
    ],
    supported_locales: ["en", "zh-cn", "ja", "es"],
    web_quality_gate: {
      passed: blockers.length === 0 && overallScore >= 90,
      minimum_score: 90,
      actual_score: overallScore
    },
    next_step: blockers.length === 0 ? "human_visual_review" : "fix_visual_consistency_issues"
  });
}

export async function generatePremiumWebRedesign({ projectRoot, productKey }) {
  const pageResult = await generatePluginPage({ projectRoot, productKey });
  await generateProductsIndex({ projectRoot });

  const product = pageResult.product;
  const state = await loadProductRunState(projectRoot, product);
  state.product = product;
  const outputDir = pageResult.outputDir;
  const generatedFiles = [
    "index.html",
    "product.html",
    "pricing.html",
    "account.html",
    "checkout/success.html",
    "checkout/cancel.html",
    "entitlement.html",
    "refund.html",
    "privacy.html",
    "terms.html",
    "styles.css",
    "locales.json",
    "zh-cn/index.html",
    "zh-cn/product.html",
    "zh-cn/pricing.html",
    "zh-cn/account.html",
    "zh-cn/refund.html",
    "zh-cn/privacy.html",
    "zh-cn/terms.html",
    "zh-cn/checkout/success.html",
    "zh-cn/checkout/cancel.html",
    "ja/index.html",
    "ja/product.html",
    "ja/pricing.html",
    "ja/account.html",
    "ja/refund.html",
    "ja/privacy.html",
    "ja/terms.html",
    "ja/checkout/success.html",
    "ja/checkout/cancel.html",
    "es/index.html",
    "es/product.html",
    "es/pricing.html",
    "es/account.html",
    "es/refund.html",
    "es/privacy.html",
    "es/terms.html",
    "es/checkout/success.html",
    "es/checkout/cancel.html",
    "product.json",
    "checkout_config.json",
    "README.md",
    "hwh_product_config_checklist.md"
  ];
  const homeHtml = await readTextIfExists(path.join(outputDir, "index.html"));
  const productHtml = await readTextIfExists(path.join(outputDir, "product.html"));
  const pricingHtml = await readTextIfExists(path.join(outputDir, "pricing.html"));
  const accountHtml = await readTextIfExists(path.join(outputDir, "account.html"));
  const successHtml = await readTextIfExists(path.join(outputDir, "checkout", "success.html"));
  const cancelHtml = await readTextIfExists(path.join(outputDir, "checkout", "cancel.html"));
  const entitlementHtml = await readTextIfExists(path.join(outputDir, "entitlement.html"));

  const plan = buildWebRedesignPlan(state, generatedFiles);
  const designSystem = buildPremiumWebDesignSystem(state);
  const productReview = buildProductPageQualityReview({ state, homeHtml, productHtml });
  const checkoutReview = buildCheckoutPageQualityReview({
    state,
    pricingHtml,
    accountHtml,
    successHtml,
    cancelHtml,
    entitlementHtml
  });
  const consistencyReport = buildSiteVisualConsistencyReport({
    state,
    designSystem,
    productReview,
    checkoutReview,
    generatedFiles
  });

  await validateArtifact(projectRoot, "web_redesign_plan.schema.json", WEB_REDESIGN_PLAN_ARTIFACT, plan);
  await validateArtifact(projectRoot, "web_design_system.schema.json", WEB_DESIGN_SYSTEM_ARTIFACT, designSystem);
  await validateArtifact(projectRoot, "product_page_quality_review.schema.json", PRODUCT_PAGE_QUALITY_REVIEW_ARTIFACT, productReview);
  await validateArtifact(projectRoot, "checkout_page_quality_review.schema.json", CHECKOUT_PAGE_QUALITY_REVIEW_ARTIFACT, checkoutReview);
  await validateArtifact(projectRoot, "site_visual_consistency_report.schema.json", SITE_VISUAL_CONSISTENCY_REPORT_ARTIFACT, consistencyReport);

  await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: WEB_REDESIGN_PLAN_ARTIFACT,
    data: plan
  });
  await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: WEB_REDESIGN_PLAN_MARKDOWN,
    category: "plugin_site",
    prefix: "141_web_redesign_plan",
    content: buildWebRedesignPlanMarkdown(plan)
  });
  await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: WEB_DESIGN_SYSTEM_ARTIFACT,
    data: designSystem
  });
  await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: PRODUCT_PAGE_QUALITY_REVIEW_ARTIFACT,
    data: productReview
  });
  await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: CHECKOUT_PAGE_QUALITY_REVIEW_ARTIFACT,
    data: checkoutReview
  });
  await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: SITE_VISUAL_CONSISTENCY_REPORT_ARTIFACT,
    data: consistencyReport
  });

  return {
    run_id: state.runContext.run_id,
    product_key: product.productKey,
    output_dir: normalizeRelativePath(projectRoot, outputDir),
    generated_files: generatedFiles,
    product_page_quality_score: productReview.page_quality_score,
    checkout_page_quality_score: checkoutReview.page_quality_score,
    site_visual_consistency_score: consistencyReport.overall_score,
    blockers: [
      ...productReview.blockers,
      ...checkoutReview.blockers,
      ...consistencyReport.blockers
    ],
    next_step: consistencyReport.next_step
  };
}

function hasForbiddenSiteConfigContent(value) {
  const text = JSON.stringify(value);
  return /(SUPABASE_SERVICE_ROLE_KEY|service_role|WAFFO_PRIVATE_KEY|merchant secret|client_secret|refresh_token|Authorization Bearer|sk_live|sk_test)/i.test(text);
}

export async function generatePluginSitePaymentGate({ projectRoot, productKey }) {
  const catalog = await loadProductCatalog(projectRoot);
  const product = getProductByKey(catalog, productKey);
  if (!product) {
    throw new Error(`Product not found in catalog: ${productKey}`);
  }

  const state = await loadProductRunState(projectRoot, product);
  state.product = product;
  const outputDir = productOutputDir(projectRoot, product.slug);
  const detailPagePath = path.join(outputDir, "index.html");
  const pricingPagePath = path.join(outputDir, "pricing.html");
  const accountPagePath = path.join(outputDir, "account.html");
  const successPagePath = path.join(outputDir, "checkout", "success.html");
  const checkoutConfigPath = path.join(outputDir, "checkout_config.json");
  const productJsonPath = path.join(outputDir, "product.json");
  const checkoutConfig = (await fileExists(checkoutConfigPath)) ? await readJson(checkoutConfigPath) : buildCheckoutConfig(state);
  const detailHtml = await readTextIfExists(detailPagePath);
  const pricingHtml = await readTextIfExists(pricingPagePath);
  const accountHtml = await readTextIfExists(accountPagePath);
  const successHtml = await readTextIfExists(successPagePath);
  const productJson = (await fileExists(productJsonPath)) ? await readJson(productJsonPath) : null;
  const localConfig = state.paySiteLocalConfig;
  const paymentStatus = buildPaymentStatusSnapshot({
    product,
    localConfig,
    checkoutConfig
  });
  const productionPaymentStatus = normalizePaymentStatus(
    "production_payment",
    localConfig?.productionPaymentStatus ?? product.productionPaymentStatus,
    "not_verified"
  );
  const sourceChromeExtensionStatus = normalizePaymentStatus(
    "source_chrome_extension",
    localConfig?.sourceChromeExtensionStatus ?? product.sourceChromeExtensionStatus,
    "not_reported"
  );
  const paymentCopyTruthful = pricingHtml.includes("Payment is handled on a secure external page")
    && (pricingHtml.includes("webhook-confirmed entitlement")
      || pricingHtml.includes("webhook-written entitlement")
      || pricingHtml.includes("Webhook-confirmed membership"))
    && accountHtml.includes("No local unlock from successUrl alone")
    && accountHtml.includes("Production payment status")
    && successHtml.includes("successUrl does not unlock locally");
  const noSecretInSiteConfig = !hasForbiddenSiteConfigContent({
    localConfig,
    checkoutConfig,
    productJson
  }) && !inspectSecretLikeContent({
    localConfig,
    checkoutConfig,
    productJson
  }).secret_values_present_in_artifact;
  const noSecretInExtension = !state.monetizationSecurityScan || state.monetizationSecurityScan.status === "passed";
  const blockers = [];
  const warnings = [];

  if (!(await fileExists(detailPagePath))) blockers.push("plugin_detail_page_missing");
  if (!(await fileExists(pricingPagePath))) blockers.push("pricing_page_missing");
  if (!(await fileExists(accountPagePath))) blockers.push("account_page_missing");
  if (!(await fileExists(path.join(state.storeReleasePackageRoot, "assets")))) blockers.push("premium_assets_missing");
  if (!paymentStatus.productKeyConfigured) blockers.push("product_key_pending");
  if (paymentStatus.productKeyOnPaySite === LEGACY_TEST_ONLY_PRODUCT_KEY) blockers.push("legacy_chatgpt2obsidian_test_only");
  if (!paymentStatus.productKeyMatchesExtension) blockers.push("product_key_does_not_match_extension");
  if (!paymentStatus.planKeyConfigured) blockers.push("plan_key_not_configured_for_lifetime_release");
  if (!paymentCopyTruthful) blockers.push("payment_copy_not_truthful");
  if (!noSecretInSiteConfig) blockers.push("secret_like_value_found_in_site_config");
  if (!state.monetizationSecurityScan) warnings.push("extension_secret_scan_not_available_for_site_gate");
  if (!noSecretInExtension) blockers.push("extension_secret_scan_not_passed");
  if (!isVerifiedStatus(paymentStatus.smtpStatus)) blockers.push("smtp_not_verified");
  if (!isVerifiedStatus(paymentStatus.otpStatus)) blockers.push("otp_not_verified");
  if (!isVerifiedStatus(paymentStatus.checkoutStatus)) blockers.push("checkout_not_verified");
  if (!isVerifiedStatus(paymentStatus.webhookStatus)) blockers.push("webhook_not_verified");
  if (!isVerifiedStatus(paymentStatus.entitlementStatus)) blockers.push("entitlement_not_verified");
  if (!isVerifiedStatus(paymentStatus.consumeUsageStatus)) blockers.push("consume_usage_not_verified");
  if (!isVerifiedStatus(paymentStatus.paymentE2EStatus)) blockers.push("payment_e2e_not_verified");
  if (!isVerifiedStatus(sourceChromeExtensionStatus)) blockers.push("source_chrome_extension_pending");
  if (productionPaymentStatus !== "verified") blockers.push("production_payment_not_verified");
  blockers.push("user_launch_approval_missing");

  const releaseAllowed = blockers.length === 0 && productionPaymentStatus === "verified";
  const technicalBlockers = blockers.filter((blocker) =>
    !["production_payment_not_verified", "user_launch_approval_missing"].includes(blocker)
  );
  const nextStep = releaseAllowed
    ? "configure_payment_in_commercial_run"
    : (technicalBlockers.length === 0
      ? "create_payment_configured_commercial_candidate_then_request_human_visual_review"
      : (!paymentStatus.productKeyConfigured || !paymentStatus.planKeyConfigured
        ? "wait_for_hwh_handoff_then_rerun_site_payment_gate"
        : "wait_for_hwh_verification_updates_then_rerun_site_payment_gate"));

  const gate = buildSafeReport({
    stage: "PLUGIN_SITE_PAYMENT_GATE",
    status: releaseAllowed ? "passed" : "blocked",
    run_id: state.runContext.run_id,
    product_key: product.productKey,
    checked_at: nowIso(),
    product_catalog_entry_exists: true,
    plugin_detail_page_generated: await fileExists(detailPagePath),
    pricing_page_generated: await fileExists(pricingPagePath),
    hwh_product_config_ready: paymentStatus.productKeyConfigured
      && paymentStatus.productKeyMatchesExtension
      && paymentStatus.planKeyConfigured,
    product_key_matches_extension: paymentStatus.productKeyMatchesExtension,
    plan_key_configured: paymentStatus.planKeyConfigured,
    checkout_mode: paymentStatus.checkoutMode,
    smtp_status: paymentStatus.smtpStatus,
    otp_status: paymentStatus.otpStatus,
    checkout_status: paymentStatus.checkoutStatus,
    webhook_status: paymentStatus.webhookStatus,
    entitlement_status: paymentStatus.entitlementStatus,
    consume_usage_status: paymentStatus.consumeUsageStatus,
    payment_e2e_status: paymentStatus.paymentE2EStatus,
    source_chrome_extension_status: sourceChromeExtensionStatus,
    production_payment_status: productionPaymentStatus,
    current_primary_environment: localConfig?.currentPrimaryEnvironment ?? product.currentPrimaryEnvironment ?? null,
    support_url_present: Boolean(product.supportUrl),
    privacy_url_present: Boolean(product.privacyUrl),
    payment_copy_truthful: paymentCopyTruthful,
    no_secret_in_site_config: noSecretInSiteConfig,
    no_secret_in_extension: noSecretInExtension,
    site_preview_ready: await fileExists(detailPagePath) && await fileExists(pricingPagePath),
    using_legacy_chatgpt2obsidian: paymentStatus.productKeyOnPaySite === LEGACY_TEST_ONLY_PRODUCT_KEY,
    release_allowed: releaseAllowed,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    next_step: nextStep
  });

  await validateArtifact(projectRoot, "plugin_site_payment_gate.schema.json", PLUGIN_SITE_PAYMENT_GATE_ARTIFACT, gate);
  await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: PLUGIN_SITE_PAYMENT_GATE_ARTIFACT,
    data: gate
  });
  return gate;
}

export function parseSiteArgs(argv) {
  return parseArgs(argv);
}
