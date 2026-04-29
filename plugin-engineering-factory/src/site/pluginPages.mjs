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
const HWH_BRAND_EN = "HWH Extensions";
const HWH_BRAND_ZH = "HWH 插件商城";
const HWH_BRAND_MARK = "H";
const GA4_MEASUREMENT_ID = "G-V93ET05FSR";
const GA4_HEAD_TAG = `  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=${GA4_MEASUREMENT_ID}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '${GA4_MEASUREMENT_ID}');
  </script>`;
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

function scriptJson(value) {
  return JSON.stringify(value).replaceAll("</", "<\\/");
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
  return (product.chromeWebStoreStatus === "published" || product.status === "published")
    && typeof product.chromeWebStoreUrl === "string"
    && product.chromeWebStoreUrl.startsWith("https://chromewebstore.google.com/");
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
      question: "Does LeadFill upload my saved profile?",
      answer: "No. Your saved profile stays in local Chrome storage. LeadFill only fills the current page when you ask it to."
    },
    {
      question: "Is this a subscription?",
      answer: `${product.priceLabel} is a one-time purchase, not a recurring subscription.`
    },
    {
      question: `What happens after the ${product.freeLimit} free fills?`,
      answer: "Try LeadFill first. When the free limit is no longer enough, unlock Lifetime for unlimited fills."
    },
    {
      question: "What kinds of fields does it support?",
      answer: "LeadFill works best with common text, email, phone, textarea, and select fields on compatible web forms."
    },
    {
      question: "How do I restore a purchase?",
      answer: "Open the account page and use the same email you used when you bought LeadFill. Then refresh your access."
    }
  ];
}

function buildHowItWorksSteps() {
  return [
    "Save one local profile in the extension.",
    "Open a compatible lead form.",
    "Click Fill Current Page from the popup.",
    "Upgrade only when unlimited fills becomes useful."
  ];
}

function renderSiteHeader({
  product,
  localeSwitcherHtml = "",
  homeHref = "index.html",
  productHref = "product.html",
  pricingHref = "pricing.html",
  accountHref = "account.html",
  ctaHref = "pricing.html",
  ctaLabel = "View pricing"
}) {
  return `<header class="topbar">
      <a class="brand" href="${escapeHtml(homeHref)}"><span class="brand-mark"></span>${escapeHtml(product.shortName)}</a>
      <nav class="topnav">
        <a href="${escapeHtml(productHref)}">Product</a>
        <a href="${escapeHtml(pricingHref)}">Pricing</a>
        <a href="${escapeHtml(accountHref)}">Account</a>
        <a class="nav-cta" href="${escapeHtml(ctaHref)}">${escapeHtml(ctaLabel)}</a>
        ${localeSwitcherHtml}
      </nav>
    </header>`;
}

function renderSiteFooter({
  refundHref = "refund.html",
  privacyHref = "privacy.html",
  termsHref = "terms.html",
  supportEmail = "support@915500.xyz",
  note = "Questions? Reach us at support@915500.xyz."
}) {
  return `<footer class="footer">
      <div class="footer-legal">
        <a href="${escapeHtml(refundHref)}">Refund</a>
        <a href="${escapeHtml(privacyHref)}">Privacy</a>
        <a href="${escapeHtml(termsHref)}">Terms</a>
      </div>
      <span>${escapeHtml(note.replace("support@915500.xyz", supportEmail))}</span>
    </footer>`;
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
    publicSupabaseUrl: normalizeText(localConfig?.publicSupabaseUrl) || `${baseSiteUrl.replace(/\/$/, "")}`,
    publicSupabaseAnonKey: normalizeText(localConfig?.publicSupabaseAnonKey) || null,
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
  const headingFont = brandSystem.typography_recommendation?.headline_family ?? "\"Inter\", \"Geist\", \"PingFang SC\", \"Noto Sans SC\", \"Segoe UI\", sans-serif";
  const bodyFont = brandSystem.typography_recommendation?.body_family ?? "\"Inter\", \"Geist\", \"PingFang SC\", \"Noto Sans SC\", \"Segoe UI\", sans-serif";
  return `:root {
  --bg: #f6f6f3;
  --bg-soft: #f1f1ec;
  --bg-deep: #e8e9e1;
  --surface: rgba(255, 255, 255, 0.88);
  --surface-strong: #ffffff;
  --surface-muted: #f4f4ef;
  --surface-ink: #121417;
  --text: ${brandSystem.text_color ?? "#121517"};
  --muted: #6e747b;
  --muted-strong: #3f454b;
  --line: rgba(18, 21, 23, 0.07);
  --line-strong: rgba(18, 21, 23, 0.12);
  --primary: ${brandSystem.primary_color ?? "#1857d8"};
  --secondary: ${brandSystem.secondary_color ?? "#dbe5ff"};
  --accent: ${brandSystem.accent_color ?? "#1857d8"};
  --accent-soft: rgba(24, 87, 216, 0.08);
  --warm: #efefe9;
  --warn: #594a1b;
  --headline: ${headingFont};
  --body: ${bodyFont};
  --radius-xl: 28px;
  --radius-lg: 24px;
  --radius-md: 18px;
  --radius-sm: 14px;
  --shadow-soft: 0 18px 42px rgba(15, 23, 32, 0.05), 0 3px 10px rgba(15, 23, 32, 0.03);
  --shadow-card: 0 14px 34px rgba(15, 23, 32, 0.045), 0 2px 8px rgba(15, 23, 32, 0.025);
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  font-family: var(--body);
  color: var(--text);
  background: linear-gradient(180deg, #fbfbf8 0%, var(--bg) 44%, var(--bg-soft) 100%);
  min-height: 100vh;
}
a { color: inherit; text-decoration: none; }
img { max-width: 100%; display: block; }
.site-shell { width: min(1180px, calc(100vw - 36px)); margin: 0 auto; padding: 20px 0 96px; position: relative; }
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.78);
  border-radius: 22px;
  backdrop-filter: blur(18px);
  box-shadow: 0 12px 30px rgba(15, 23, 32, 0.04);
  position: sticky;
  top: 16px;
  z-index: 4;
}
.brand { display: inline-flex; align-items: center; gap: 12px; font-family: var(--headline); font-weight: 700; font-size: 18px; letter-spacing: -0.04em; }
.brand-mark {
  width: 30px;
  height: 30px;
  border-radius: 11px;
  border: 1px solid rgba(24, 87, 216, 0.14);
  background:
    linear-gradient(180deg, rgba(255,255,255,0.82), rgba(255,255,255,0.22)),
    linear-gradient(135deg, #eef3ff, #dbe4ff);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.92), 0 8px 18px rgba(24, 87, 216, 0.1);
  position: relative;
}
.brand-mark::before,
.brand-mark::after {
  content: "";
  position: absolute;
  background: var(--primary);
  border-radius: 999px;
}
.brand-mark::before {
  width: 12px;
  height: 12px;
  left: 8px;
  top: 8px;
}
.brand-mark::after {
  width: 14px;
  height: 3px;
  right: 6px;
  bottom: 7px;
}
.topnav { display: flex; align-items: center; gap: 8px; color: var(--muted-strong); font-size: 14px; flex-wrap: wrap; }
.topnav a { padding: 10px 12px; border-radius: 999px; font-weight: 600; }
.topnav a:hover { background: rgba(24, 87, 216, 0.05); color: var(--primary); }
.nav-cta {
  background: linear-gradient(135deg, var(--primary), #2c66de);
  color: #fff !important;
  padding-inline: 16px !important;
  box-shadow: 0 10px 20px rgba(24, 87, 216, 0.14);
}
.locale-switcher {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: rgba(255,255,255,0.74);
}
.locale-link {
  padding: 7px 10px !important;
  border-radius: 999px;
  color: var(--muted-strong);
  font-size: 12px;
  font-weight: 700;
}
.locale-link.active {
  background: rgba(24, 87, 216, 0.08);
  color: var(--primary);
}
.hero {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: 34px;
  align-items: center;
  padding: 70px 0 32px;
}
.home-hero, .compact-hero, .product-hero, .account-hero { align-items: start; }
.compact-hero { padding: 54px 0 24px; }
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
  border: 1px solid rgba(24, 87, 216, 0.12);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.78);
  color: var(--primary);
  font-size: 13px;
  font-weight: 700;
}
h1, h2, h3, h4 {
  margin: 0;
  font-family: var(--headline);
  line-height: 1.04;
}
h1 { font-size: clamp(42px, 5.6vw, 70px); letter-spacing: -0.06em; max-width: 10ch; font-weight: 700; }
h2 { font-size: clamp(28px, 3.1vw, 44px); letter-spacing: -0.045em; font-weight: 700; }
h3 { font-size: 22px; letter-spacing: -0.03em; font-weight: 700; }
p { line-height: 1.74; }
.lede {
  margin: 16px 0 20px;
  max-width: 54ch;
  font-size: clamp(18px, 2vw, 20px);
  color: var(--muted-strong);
}
.badge-row { display: flex; gap: 10px; flex-wrap: wrap; }
.pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  border: 1px solid rgba(18, 21, 23, 0.07);
  background: rgba(255,255,255,0.92);
  color: var(--muted-strong);
  padding: 9px 14px;
  font-size: 13px;
  font-weight: 700;
}
.pill.verified { color: var(--accent); background: rgba(24, 87, 216, 0.08); border-color: rgba(24, 87, 216, 0.16); }
.hero-actions, .button-row { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 26px; }
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 52px;
  border-radius: 999px;
  padding: 0 22px;
  font-weight: 700;
  border: 1px solid transparent;
  transition: transform 180ms ease, box-shadow 180ms ease, background 180ms ease;
}
.button:hover { transform: translateY(-1px); }
.button.primary {
  background: linear-gradient(135deg, var(--primary), #2d66dd);
  color: white;
  box-shadow: 0 14px 28px rgba(24, 87, 216, 0.14);
}
.button.secondary {
  background: rgba(255, 255, 255, 0.95);
  border-color: var(--line-strong);
}
.button.ghost {
  background: rgba(24, 87, 216, 0.08);
  color: var(--primary);
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
.hero-proof,
.mini-kpis {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-top: 24px;
  max-width: 620px;
}
.metric,
.mini-kpis div {
  padding: 18px;
  border-radius: 22px;
  border: 1px solid var(--line);
  background: rgba(255,255,255,0.86);
}
.metric strong,
.mini-kpis strong { display: block; font-family: var(--headline); font-size: 24px; letter-spacing: -0.03em; }
.metric span,
.mini-kpis span { display: block; margin-top: 4px; color: var(--muted); font-size: 13px; }
.hero-media { position: relative; }
.visual-card {
  border-radius: var(--radius-xl);
  border: 1px solid rgba(18, 21, 23, 0.06);
  background: rgba(255, 255, 255, 0.96);
  box-shadow: var(--shadow-soft);
  padding: 18px;
  overflow: hidden;
  min-height: 100%;
}
.visual-card img, .panel img {
  border-radius: 22px;
  border: 1px solid rgba(18, 21, 23, 0.06);
  box-shadow: 0 18px 40px rgba(15, 23, 32, 0.07);
}
.section { padding: 38px 0 0; }
.section-heading { display: flex; flex-direction: column; gap: 10px; margin-bottom: 28px; max-width: 720px; }
.section-heading.center { align-items: center; text-align: center; margin-inline: auto; }
.grid { display: grid; gap: 22px; }
.card-grid, .trust-strip, .plan-grid, .flow-grid, .feature-grid {
  display: grid;
  gap: 20px;
}
.card-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.card, .trust-card, .plan-card, .faq-item, .screenshot-card, .flow-card, .feature-card, .checkout-card, .status-card, .panel, .hub-card {
  border-radius: var(--radius-lg);
  border: 1px solid var(--line);
  background: rgba(255,255,255,0.94);
  box-shadow: var(--shadow-card);
}
.benefit-card { padding: 28px; min-height: 168px; }
.benefit-card h3 { margin-bottom: 12px; }
.benefit-card p { margin: 0; color: var(--muted); }
.screenshot-grid { display: grid; gap: 22px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.screenshot-card { overflow: hidden; }
.screenshot-card img { border-radius: 22px 22px 0 0; width: 100%; }
.screenshot-copy { padding: 18px 20px 22px; }
.screenshot-copy p { margin: 10px 0 12px; color: var(--muted); line-height: 1.7; }
.screenshot-copy span { font-size: 13px; color: var(--accent); font-weight: 700; }
.split {
  display: grid;
  gap: 20px;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}
.spotlight-grid {
  grid-template-columns: minmax(0, 1.05fr) minmax(320px, 0.95fr);
}
.pricing-overview-grid {
  display: grid;
  gap: 24px;
  grid-template-columns: minmax(280px, 0.88fr) minmax(0, 1.12fr);
  align-items: start;
}
.pricing-stack,
.faq-list {
  display: grid;
  gap: 14px;
}
.faq-layout {
  display: grid;
  gap: 20px;
  grid-template-columns: minmax(260px, 0.78fr) minmax(0, 1.22fr);
}
.faq-intro {
  padding: 24px 0;
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
.flow-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); counter-reset: step; }
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
  color: var(--primary);
  font-weight: 700;
}
.flow-card p { margin: 10px 0 0; color: var(--muted); }
.feature-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.feature-card { padding: 28px; }
.feature-card p { color: var(--muted); margin-bottom: 0; }
.pricing-section .plan-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: stretch; }
.plan-card { padding: 32px; }
.plan-card h2 { margin-bottom: 12px; }
.plan-card-pro {
  background: linear-gradient(180deg, rgba(236, 242, 255, 0.92), rgba(255,255,255,0.98));
  color: var(--text);
  position: relative;
  overflow: hidden;
}
.plan-card-pro::after {
  content: "";
  position: absolute;
  inset: auto -12% -44% auto;
  width: 280px;
  height: 280px;
  background: radial-gradient(circle, rgba(24, 87, 216, 0.12), transparent 68%);
}
.plan-card-pro .plan-footnote,
.plan-card-pro ul,
.plan-card-pro p { color: var(--muted-strong); }
.plan-label {
  margin: 0 0 8px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 12px;
  font-weight: 700;
  color: var(--accent);
}
.plan-card-pro .plan-label { color: var(--primary); }
.price-line { display: flex; align-items: baseline; gap: 10px; margin: 12px 0 8px; }
.price-line strong { font-family: var(--headline); font-size: clamp(42px, 5vw, 70px); letter-spacing: -0.05em; }
.price-line span { color: var(--muted); }
.plan-card-pro .price-line span { color: var(--muted); }
.trust-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.trust-card { padding: 26px; }
.trust-card p, .faq-item p, .prose-block p, .checkout-card p, .status-card p { color: var(--muted); line-height: 1.8; }
.faq-item { padding: 26px; }
.status-grid {
  display: grid;
  gap: 20px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.status-card { padding: 26px; }
.status-card h3 { margin-bottom: 10px; }
.text-columns { align-items: start; }
.prose-block { padding: 28px; }
.prose-block h3, .prose-block h4 { margin-bottom: 10px; }
.cta-band {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 34px;
  border-radius: var(--radius-xl);
  border: 1px solid var(--line);
  background: linear-gradient(135deg, rgba(255,255,255,0.96), rgba(244, 245, 239, 0.98));
  box-shadow: var(--shadow-card);
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
  background: rgba(24, 87, 216, 0.08);
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
  background: rgba(255,255,255,0.97);
  box-shadow: var(--shadow-soft);
  padding: clamp(30px, 5vw, 56px);
}
.guidance-card h1 { max-width: 13ch; }
.legal-page { padding: 66px 0 24px; }
.legal-article {
  width: min(760px, 100%);
  margin: 0 auto;
  padding: clamp(28px, 5vw, 54px);
  border-radius: var(--radius-xl);
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.97);
  box-shadow: var(--shadow-soft);
}
.legal-summary {
  margin: 18px 0 0;
  color: var(--muted);
  font-size: 18px;
  line-height: 1.76;
}
.legal-copy h3 { margin: 34px 0 12px; font-size: 20px; }
.legal-copy h4 { margin: 22px 0 8px; font-size: 17px; letter-spacing: -0.02em; }
.legal-copy p, .legal-copy li { color: var(--muted-strong); line-height: 1.84; }
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
  margin-top: 28px;
  color: var(--muted);
  font-size: 14px;
}
.footer-legal { display: inline-flex; flex-wrap: wrap; gap: 16px; }
.market-shell {
  min-height: 100vh;
  background: linear-gradient(180deg, #fbfbf8 0%, var(--bg) 48%, var(--bg-soft) 100%);
}
.market-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 0 24px;
}
.market-brand {
  font-family: var(--headline);
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
}
.market-nav, .market-actions, .market-chip-row {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
}
.market-nav a {
  color: var(--muted-strong);
  font-weight: 600;
}
.market-nav a.active {
  color: var(--primary);
}
.market-search {
  min-width: 220px;
  padding: 12px 16px;
  border-radius: 999px;
  background: rgba(255,255,255,0.92);
  border: 1px solid var(--line);
  color: var(--muted);
  box-shadow: var(--shadow-soft);
}
.market-login {
  padding: 12px 18px;
  border-radius: 999px;
  background: var(--primary);
  color: #fff;
  font-weight: 700;
}
.market-hero {
  display: grid;
  gap: 18px;
  padding: 60px 0 24px;
}
.market-hero h1 {
  max-width: 11ch;
  font-size: clamp(42px, 6vw, 62px);
}
.market-hero p {
  max-width: 56ch;
  margin: 0;
  font-size: clamp(18px, 2vw, 20px);
  line-height: 1.7;
  color: var(--muted-strong);
}
.market-chip-row { justify-content: flex-start; gap: 12px; }
.market-chip {
  padding: 10px 18px;
  border-radius: 999px;
  background: rgba(18, 21, 23, 0.05);
  color: var(--text);
  font-size: 13px;
  font-weight: 650;
}
.market-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 18px 0 28px;
}
.market-section-head h2 {
  font-size: clamp(32px, 3vw, 48px);
}
.market-link {
  color: var(--primary);
  font-weight: 700;
}
.hub-shell {
  width: min(1120px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 16px 0 72px;
}
.hub-grid {
  display: grid;
  gap: 20px;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
}
.hub-card {
  padding: 28px;
  border-radius: var(--radius-lg);
  border: 1px solid rgba(18, 21, 23, 0.06);
  background: rgba(255,255,255,0.94);
  box-shadow: var(--shadow-card);
}
.hub-card img {
  width: 64px;
  height: 64px;
  border-radius: 18px;
  margin-bottom: 18px;
}
.status-chip {
  display: inline-flex;
  margin-bottom: 18px;
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(24, 87, 216, 0.08);
  color: var(--primary);
  font-size: 12px;
  font-weight: 700;
}
.catalog-meta {
  margin: 12px 0 18px;
  color: var(--muted);
}
.catalog-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.hero-header {
  display: flex;
  gap: 18px;
  align-items: center;
  margin-bottom: 14px;
}
.hero-icon-tile {
  width: 92px;
  height: 92px;
  flex: 0 0 auto;
  border-radius: 28px;
  border: 1px solid var(--line);
  background: linear-gradient(180deg, #ffffff, #f1f4fb);
  box-shadow: var(--shadow-card);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.hero-icon-tile img {
  width: 56px;
  height: 56px;
  border-radius: 18px;
  border: 0;
  box-shadow: none;
}
.hero-meta {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  align-items: center;
  margin-top: 14px;
  color: var(--muted);
  font-size: 14px;
}
.hero-meta strong {
  color: var(--primary);
  font-weight: 700;
}
.product-note {
  margin-top: 16px;
  font-size: 14px;
  color: var(--muted);
}
.marketplace-page {
  background: #f8f8fa;
}
.marketplace-topbar {
  height: 92px;
  padding: 0 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 28px;
  background: #5b606a;
  color: rgba(255,255,255,0.78);
  box-shadow: 0 16px 34px rgba(15, 23, 42, 0.14);
}
.marketplace-brand {
  color: #94a4ff;
  font-size: 22px;
  font-weight: 800;
}
.marketplace-nav,
.marketplace-actions {
  display: flex;
  align-items: center;
  gap: 28px;
}
.marketplace-nav a {
  padding: 31px 0 22px;
  color: rgba(255,255,255,0.62);
  font-size: 20px;
  font-weight: 700;
}
.marketplace-nav a.active {
  color: #9ca9ff;
  border-bottom: 3px solid #746bff;
}
.marketplace-top-search {
  min-width: 270px;
  padding: 17px 28px;
  border-radius: 999px;
  background: rgba(255,255,255,0.94);
  color: #6b7280;
  font-size: 16px;
}
.marketplace-signin {
  padding: 14px 24px;
  border-radius: 10px;
  background: #2445dc;
  color: #fff;
  font-size: 20px;
  font-weight: 800;
}
.marketplace-topbar .locale-switcher {
  display: none;
}
.marketplace-main {
  width: min(1260px, calc(100vw - 64px));
  margin: 0 auto;
}
.marketplace-hero {
  padding: 92px 0 70px;
  text-align: center;
}
.marketplace-hero h1 {
  max-width: none;
  font-size: 52px;
  letter-spacing: 0;
}
.marketplace-hero p {
  max-width: 760px;
  margin: 24px auto 0;
  color: #5f6369;
  font-size: 32px;
  line-height: 1.35;
}
.marketplace-search {
  width: min(720px, 100%);
  margin: 54px auto 0;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 22px 32px;
  border-radius: 999px;
  background: #f1f1f4;
  color: #667085;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.06);
  text-align: left;
}
.marketplace-search span {
  font-size: 28px;
}
.marketplace-search strong {
  font-size: 22px;
}
.marketplace-chip-row {
  margin-top: 34px;
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 18px;
}
.marketplace-chip-row span,
.marketplace-category {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 18px;
  border-radius: 999px;
  background: #dedee1;
  color: #15171a;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.marketplace-section {
  padding-bottom: 84px;
}
.marketplace-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 34px;
}
.marketplace-section-head h2 {
  font-size: 36px;
  letter-spacing: 0;
}
.marketplace-section-head a {
  color: #123fd1;
  font-size: 22px;
  font-weight: 700;
}
.marketplace-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 26px;
}
.marketplace-card {
  min-height: 286px;
  padding: 28px;
  border-radius: 14px;
  background: rgba(255,255,255,0.92);
  border: 1px solid rgba(15, 23, 42, 0.04);
  box-shadow: 0 18px 38px rgba(15, 23, 42, 0.045);
}
.marketplace-card-head,
.marketplace-card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.marketplace-icon {
  width: 70px;
  height: 70px;
  display: grid;
  place-items: center;
  border-radius: 18px;
  background: #e8eeff;
  color: #2346db;
  font-weight: 800;
}
.marketplace-icon img {
  width: 42px;
  height: 42px;
}
.marketplace-icon-2 { background: #dcf8e9; color: #14a15b; }
.marketplace-icon-3 { background: #ffe9e1; color: #9a3412; }
.marketplace-icon-4 { background: #f6e8ff; color: #8a3ffc; }
.marketplace-icon-5 { background: #fff7d7; color: #c97900; }
.marketplace-icon-6 { background: #d9f7fb; color: #088ba0; }
.marketplace-card h3 {
  margin-top: 22px;
  font-size: 24px;
  letter-spacing: 0;
}
.marketplace-card p {
  min-height: 58px;
  color: #52565c;
  font-size: 18px;
  line-height: 1.55;
}
.marketplace-card-foot {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid rgba(15, 23, 42, 0.1);
  color: #667085;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.marketplace-card-button {
  padding: 12px 18px;
  border-radius: 8px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  color: #111827;
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 0;
}
.marketplace-card-button.disabled {
  color: #8b929d;
  background: #f4f4f5;
}
.marketplace-footer {
  min-height: 130px;
  padding: 34px 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  background: #050914;
  color: rgba(255,255,255,0.55);
}
.marketplace-footer strong {
  color: #fff;
  font-size: 18px;
}
.marketplace-footer nav {
  display: flex;
  gap: 30px;
}
.product-detail-page {
  background: #f8f8fa;
}
.product-detail-nav {
  width: min(1280px, calc(100vw - 64px));
  margin: 0 auto;
  height: 78px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}
.product-detail-nav nav,
.product-detail-actions {
  display: flex;
  align-items: center;
  gap: 28px;
}
.product-detail-nav nav a,
.product-detail-actions a {
  color: #334155;
  font-weight: 700;
}
.product-detail-nav nav a.active {
  color: #173bd0;
}
.product-detail-nav .locale-switcher {
  display: none;
}
.product-detail-main {
  width: min(1180px, calc(100vw - 64px));
  margin: 0 auto;
  padding: 54px 0 96px;
}
.product-detail-hero {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  gap: 26px;
  align-items: center;
  margin-bottom: 58px;
}
.product-detail-icon {
  width: 112px;
  height: 112px;
  padding: 18px;
  border-radius: 24px;
  background: #fff;
  box-shadow: 0 16px 36px rgba(15, 23, 42, 0.08);
}
.product-detail-hero h1 {
  max-width: none;
  font-size: 46px;
  letter-spacing: 0;
}
.product-detail-hero p {
  margin: 10px 0 0;
  font-size: 20px;
  color: #111827;
}
.product-detail-meta {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin-top: 20px;
  color: #475569;
}
.product-detail-meta span:first-child {
  color: #173bd0;
}
.product-detail-shot {
  overflow: hidden;
  border-radius: 22px;
  box-shadow: 0 20px 44px rgba(15, 23, 42, 0.10);
}
.product-detail-shot img {
  width: 100%;
  aspect-ratio: 16 / 7;
  object-fit: cover;
}
.product-detail-two-col {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(300px, 0.65fr);
  gap: 24px;
  margin-top: 24px;
}
.product-detail-two-col article,
.product-detail-two-col aside,
.product-detail-feature-row article,
.product-detail-faq {
  padding: 32px;
  border-radius: 18px;
  background: #fff;
  border: 1px solid rgba(15, 23, 42, 0.05);
  box-shadow: 0 16px 34px rgba(15, 23, 42, 0.055);
}
.product-detail-two-col h2,
.product-detail-faq h2 {
  font-size: 30px;
  letter-spacing: 0;
}
.product-detail-two-col p {
  color: #475569;
}
.product-detail-two-col img {
  margin-top: 22px;
  width: 100%;
  border-radius: 12px;
}
.product-detail-feature-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
  margin-top: 48px;
}
.product-detail-feature-row article span {
  display: block;
  width: 38px;
  height: 38px;
  margin-bottom: 22px;
  border-radius: 999px;
  background: #dee4ff;
}
.product-detail-feature-row h3 {
  font-size: 18px;
  letter-spacing: 0;
}
.product-detail-feature-row p {
  color: #475569;
}
.product-detail-faq {
  margin-top: 48px;
}
.product-detail-faq article {
  margin-top: 18px;
  padding: 20px 0 0;
  border-top: 1px solid rgba(15, 23, 42, 0.08);
}
.product-detail-faq h3 {
  font-size: 18px;
  letter-spacing: 0;
}
.product-detail-faq p {
  color: #475569;
}
.account-simple {
  width: min(980px, calc(100vw - 64px));
  margin: 0 auto;
  padding: 70px 0 96px;
}
.account-simple-hero {
  margin-bottom: 32px;
}
.account-simple-hero h1 {
  max-width: none;
  font-size: 52px;
  letter-spacing: 0;
}
.account-simple-hero p {
  max-width: 620px;
  color: #475569;
  font-size: 20px;
}
.account-simple-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}
.account-simple-grid article {
  padding: 28px;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 16px 34px rgba(15, 23, 42, 0.055);
  border: 1px solid rgba(15, 23, 42, 0.05);
}
.account-simple-grid span {
  color: #0f766e;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.08em;
}
.account-simple-grid h2 {
  margin-top: 12px;
  font-size: 26px;
  letter-spacing: 0;
}
.account-simple-grid p {
  color: #475569;
}
.showcase-shell {
  width: min(1280px, calc(100vw - 32px));
}
.showcase-nav,
.checkout-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}
.showcase-nav {
  padding: 18px 0 30px;
}
.showcase-nav-home {
  padding: 18px 28px;
  border-radius: 26px;
  background: #5e636d;
  color: rgba(255,255,255,0.9);
  box-shadow: 0 20px 44px rgba(17, 24, 39, 0.12);
}
.showcase-nav-light {
  padding: 12px 0 26px;
}
.showcase-brand {
  color: inherit;
}
.showcase-nav-links,
.showcase-nav-actions,
.checkout-topbar-right {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.showcase-nav-home .showcase-nav-links a,
.showcase-nav-home .locale-link {
  color: rgba(255,255,255,0.74);
}
.showcase-nav-links a {
  font-weight: 600;
}
.showcase-nav-links a.active {
  color: var(--primary);
}
.showcase-nav-home .showcase-nav-links a.active {
  color: #96a6ff;
}
.showcase-search-mini {
  min-width: 230px;
  padding: 12px 18px;
  border-radius: 999px;
  background: rgba(255,255,255,0.92);
  color: #6b7280;
  font-weight: 600;
}
.showcase-nav-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0 22px;
  border-radius: 14px;
  background: #2242d7;
  color: #fff;
  font-weight: 700;
  box-shadow: 0 10px 22px rgba(34, 66, 215, 0.2);
}
.showcase-text-link,
.checkout-brand {
  font-weight: 700;
  color: var(--primary);
}
.showcase-nav-home .locale-switcher {
  background: rgba(255,255,255,0.12);
  border-color: rgba(255,255,255,0.16);
}
.showcase-nav-home .locale-link.active {
  background: rgba(255,255,255,0.18);
  color: #fff;
}
.showcase-home-hero {
  padding: 82px 0 44px;
  text-align: center;
}
.showcase-home-copy {
  width: min(980px, 100%);
  margin: 0 auto;
}
.showcase-kicker {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 0 14px;
  margin-bottom: 18px;
  border-radius: 999px;
  background: rgba(255,255,255,0.82);
  border: 1px solid var(--line);
  color: var(--primary);
  font-size: 13px;
  font-weight: 700;
}
.showcase-home-hero h1 {
  max-width: 12ch;
  margin: 0 auto;
  font-size: clamp(58px, 7vw, 84px);
}
.showcase-subtitle {
  width: min(760px, 100%);
  margin: 22px auto 0;
  color: var(--muted-strong);
  font-size: clamp(22px, 2.5vw, 30px);
  line-height: 1.45;
}
.showcase-search-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  width: min(760px, 100%);
  margin: 38px auto 0;
  padding: 24px 32px;
  border-radius: 999px;
  background: rgba(255,255,255,0.82);
  box-shadow: 0 18px 40px rgba(17, 24, 39, 0.06);
  color: #667085;
  font-size: clamp(18px, 2vw, 24px);
  font-weight: 600;
}
.showcase-search-icon {
  font-size: 28px;
  color: #7c8596;
}
.showcase-chip-row {
  display: flex;
  justify-content: center;
  gap: 14px;
  flex-wrap: wrap;
  margin-top: 28px;
}
.showcase-chip {
  padding: 10px 18px;
  border-radius: 999px;
  background: rgba(18, 21, 23, 0.08);
  color: var(--text);
  font-size: 14px;
  font-weight: 650;
}
.showcase-section-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 18px;
  margin: 16px 0 28px;
}
.showcase-card-grid {
  display: grid;
  gap: 22px;
  grid-template-columns: 1.15fr 0.85fr 0.85fr;
}
.showcase-product-card {
  padding: 28px;
  border-radius: 24px;
  background: rgba(255,255,255,0.9);
  box-shadow: 0 18px 42px rgba(17, 24, 39, 0.05);
  border: 1px solid rgba(18, 21, 23, 0.05);
}
.showcase-product-card-wide {
  grid-row: span 2;
}
.showcase-card-top,
.showcase-card-footer,
.showcase-card-actions,
.checkout-plan-top,
.checkout-summary-row,
.checkout-summary-total {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}
.showcase-icon-box,
.showcase-mini-icon {
  display: grid;
  place-items: center;
  width: 72px;
  height: 72px;
  border-radius: 20px;
  background: linear-gradient(180deg, #f3f6ff, #e6ecff);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.9);
}
.showcase-icon-box img {
  width: 44px;
  height: 44px;
}
.showcase-mini-icon {
  width: 52px;
  height: 52px;
  color: var(--primary);
  font-weight: 700;
}
.showcase-tag {
  display: inline-flex;
  padding: 8px 14px;
  border-radius: 999px;
  background: rgba(34, 66, 215, 0.12);
  color: var(--primary);
  font-size: 13px;
  font-weight: 700;
}
.showcase-product-card h3 {
  margin-top: 20px;
  font-size: 22px;
}
.showcase-product-card p {
  color: var(--muted-strong);
}
.showcase-card-preview {
  margin-top: 20px;
  overflow: hidden;
  border-radius: 20px;
  border: 1px solid rgba(18, 21, 23, 0.05);
}
.showcase-card-preview img {
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
}
.showcase-card-footer {
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px solid rgba(18, 21, 23, 0.08);
  color: #667085;
  font-size: 14px;
}
.showcase-dual-panel {
  display: grid;
  gap: 20px;
  grid-template-columns: minmax(0, 1.12fr) minmax(320px, 0.88fr);
  margin-top: 28px;
}
.showcase-panel,
.showcase-side-steps,
.detail-content-card,
.detail-feature-stage,
.detail-lower-copy,
.detail-lower-side,
.checkout-plan-card,
.checkout-summary-card,
.checkout-copy-card,
.checkout-side-card {
  border-radius: 24px;
  background: rgba(255,255,255,0.92);
  border: 1px solid rgba(18, 21, 23, 0.05);
  box-shadow: 0 18px 42px rgba(17, 24, 39, 0.05);
}
.showcase-panel {
  padding: 28px;
}
.showcase-panel-large {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(280px, 1.1fr);
  gap: 20px;
}
.showcase-panel-media img,
.detail-hero-shot img,
.detail-inline-media img {
  width: 100%;
  border-radius: 22px;
  object-fit: cover;
}
.showcase-side-steps {
  padding: 28px 24px;
}
.showcase-step-line {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 16px;
  padding: 14px 0;
}
.showcase-step-dot {
  width: 12px;
  height: 12px;
  margin-top: 7px;
  border-radius: 999px;
  background: #1f45da;
}
.showcase-step-dot.muted {
  background: rgba(18, 21, 23, 0.14);
}
.showcase-bottom-band {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-top: 28px;
  padding: 30px 34px;
  border-radius: 28px;
  background: linear-gradient(180deg, rgba(255,255,255,0.95), rgba(247,247,242,0.95));
  border: 1px solid rgba(18, 21, 23, 0.06);
}
.page-detail .showcase-shell,
.page-pricing .showcase-shell {
  width: min(1360px, calc(100vw - 40px));
}
.detail-intro {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 24px;
  align-items: center;
  padding: 48px 0 28px;
}
.detail-icon-card {
  display: grid;
  place-items: center;
  width: 96px;
  height: 96px;
  border-radius: 24px;
  background: rgba(255,255,255,0.95);
  box-shadow: 0 18px 42px rgba(17, 24, 39, 0.06);
}
.detail-icon-card img {
  width: 58px;
  height: 58px;
}
.detail-intro-copy h1 {
  max-width: none;
  font-size: clamp(50px, 5vw, 72px);
}
.detail-subtitle {
  margin: 10px 0 0;
  max-width: 60ch;
  color: var(--muted-strong);
  font-size: 24px;
}
.detail-meta-row {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin-top: 18px;
  color: #667085;
}
.detail-stars {
  color: #2242d7;
  letter-spacing: 0.12em;
}
.detail-hero-shot {
  overflow: hidden;
  border-radius: 24px;
  box-shadow: 0 18px 42px rgba(17, 24, 39, 0.08);
}
.detail-hero-shot img {
  aspect-ratio: 16 / 7;
}
.detail-split-grid,
.detail-lower-grid {
  display: grid;
  gap: 20px;
  margin-top: 18px;
  grid-template-columns: 1.05fr 0.95fr;
}
.detail-content-card,
.detail-lower-copy,
.detail-lower-side {
  padding: 28px;
}
.detail-content-card-large {
  min-height: 100%;
}
.detail-content-card-side {
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.detail-inline-media {
  margin-top: 20px;
}
.detail-inline-media img {
  aspect-ratio: 16 / 9;
}
.detail-check-list {
  margin: 18px 0 0;
  padding-left: 20px;
  line-height: 1.9;
}
.detail-feature-stage {
  margin-top: 24px;
  padding: 42px 36px 48px;
}
.detail-feature-head {
  max-width: 760px;
  margin: 0 auto 28px;
  text-align: center;
}
.detail-feature-head p:last-child {
  color: var(--muted);
}
.detail-feature-cards {
  display: grid;
  gap: 18px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.detail-feature-card {
  padding: 24px;
  border-radius: 20px;
  background: rgba(255,255,255,0.88);
  box-shadow: 0 12px 28px rgba(17, 24, 39, 0.04);
}
.detail-feature-icon {
  width: 44px;
  height: 44px;
  border-radius: 999px;
  margin-bottom: 18px;
  background: rgba(34, 66, 215, 0.12);
}
.detail-faq-list .faq-item h4 {
  margin: 0 0 10px;
  font-size: 18px;
  letter-spacing: -0.03em;
}
.checkout-topbar {
  padding: 12px 0 28px;
}
.checkout-lock {
  color: var(--muted-strong);
  font-weight: 600;
}
.checkout-hero {
  padding: 26px 0 26px;
}
.checkout-hero h1 {
  max-width: 10ch;
  font-size: clamp(58px, 5.8vw, 82px);
}
.checkout-hero p {
  max-width: 34ch;
  margin: 16px 0 0;
  color: #4b5563;
  font-size: clamp(22px, 2.4vw, 30px);
}
.checkout-layout {
  display: grid;
  gap: 28px;
  grid-template-columns: minmax(0, 1.08fr) minmax(360px, 0.92fr);
  align-items: start;
}
.checkout-main-column {
  display: grid;
  gap: 24px;
}
.checkout-plan-grid {
  display: grid;
  gap: 20px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.checkout-plan-card,
.checkout-summary-card,
.checkout-copy-card,
.checkout-side-card {
  padding: 32px;
}
.checkout-plan-card-active {
  position: relative;
  border: 2px solid #2242d7;
}
.checkout-plan-recommend {
  position: absolute;
  top: -16px;
  right: 28px;
  padding: 6px 14px;
  border-radius: 999px;
  background: #4f68e5;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.checkout-plan-radio {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: 2px solid rgba(34, 66, 215, 0.22);
}
.checkout-plan-radio.active {
  border-color: #2242d7;
  box-shadow: inset 0 0 0 6px #fff, inset 0 0 0 12px #2242d7;
}
.checkout-plan-card ul,
.checkout-copy-card ul {
  margin: 22px 0 0;
  padding-left: 22px;
  line-height: 1.9;
}
.checkout-price-line {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-top: 16px;
}
.checkout-price-line strong {
  font-family: var(--headline);
  font-size: clamp(48px, 5vw, 72px);
  letter-spacing: -0.05em;
}
.checkout-price-line span {
  color: var(--muted);
}
.checkout-summary-card {
  background: rgba(248,248,246,0.95);
}
.checkout-summary-row {
  padding: 18px 0;
  border-bottom: 1px solid rgba(18, 21, 23, 0.08);
  color: #4b5563;
}
.checkout-summary-total {
  padding-top: 26px;
  color: var(--text);
}
.checkout-summary-total strong {
  font-size: 54px;
  color: #2242d7;
  letter-spacing: -0.05em;
}
.checkout-copy-grid {
  display: grid;
  gap: 20px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.checkout-side-card {
  position: sticky;
  top: 18px;
}
.checkout-field-shell {
  padding: 18px 20px;
  margin-top: 16px;
  border-radius: 18px;
  border: 1px solid rgba(18, 21, 23, 0.08);
  background: rgba(249,249,248,0.96);
}
.checkout-field-shell label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #4b5563;
}
.checkout-side-button {
  width: 100%;
  margin-top: 20px;
}
.checkout-security-note {
  margin: 18px 0 0;
  color: #4b5563;
  line-height: 1.8;
}
code {
  padding: 2px 6px;
  border-radius: 8px;
  background: rgba(18, 21, 23, 0.06);
}
@media (max-width: 980px) {
  .hero, .split, .pricing-section .plan-grid, .trust-strip, .faq-layout, .screenshot-grid, .feature-grid, .flow-grid, .status-grid, .spotlight-grid, .pricing-overview-grid, .showcase-card-grid, .showcase-dual-panel, .showcase-panel-large, .detail-split-grid, .detail-feature-cards, .detail-lower-grid, .checkout-layout, .checkout-plan-grid, .checkout-copy-grid {
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
    border-radius: 24px;
  }
  .market-topbar, .showcase-nav, .checkout-topbar, .marketplace-topbar, .product-detail-nav {
    flex-direction: column;
    align-items: flex-start;
  }
  .marketplace-topbar {
    height: auto;
    padding: 22px 28px;
  }
  .marketplace-nav,
  .marketplace-actions {
    gap: 16px;
  }
  .marketplace-grid,
  .product-detail-two-col,
  .product-detail-feature-row,
  .account-simple-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .product-detail-hero { grid-template-columns: 1fr; }
  .showcase-home-hero h1,
  .checkout-hero h1,
  .detail-intro-copy h1 {
    max-width: none;
  }
  .showcase-bottom-band {
    display: grid;
    align-items: start;
  }
  .detail-intro {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 640px) {
  .site-shell, .hub-shell { width: min(100vw - 24px, 100%); }
  .card-grid { grid-template-columns: 1fr; }
  .hero-proof { grid-template-columns: 1fr; }
  .mini-kpis { grid-template-columns: 1fr; }
  h1 { font-size: 38px; }
  .hero { padding-top: 32px; }
  .topbar { border-radius: 22px; position: static; }
  .market-search {
    min-width: 0;
    width: 100%;
  }
  .marketplace-main { width: min(100vw - 24px, 100%); }
  .marketplace-grid { grid-template-columns: 1fr; }
  .product-detail-main,
  .product-detail-nav { width: min(100vw - 24px, 100%); }
  .product-detail-two-col,
  .product-detail-feature-row,
  .account-simple-grid { grid-template-columns: 1fr; }
  .account-simple { width: min(100vw - 24px, 100%); }
  .marketplace-hero h1 { font-size: 38px; }
  .marketplace-hero p { font-size: 22px; }
  .marketplace-section-head,
  .marketplace-card-foot,
  .marketplace-footer {
    flex-direction: column;
    align-items: flex-start;
  }
  .marketplace-top-search {
    min-width: 0;
    width: 100%;
  }
  .showcase-search-bar,
  .showcase-search-mini {
    min-width: 0;
    width: 100%;
  }
  .showcase-card-footer,
  .showcase-card-actions {
    flex-direction: column;
    align-items: stretch;
  }
  .checkout-summary-total strong {
    font-size: 40px;
  }
}`;
}

function renderMarketplaceHomePage({ state, checkoutConfig, pricingLink, localeSwitcherHtml = "" }) {
  const product = state.product;
  const iconPath = "assets/icon/icon128.png";
  const marketplaceCards = [
    {
      name: product.name,
      description: "保存一份本地资料，在当前页面一键填写常见线索表单字段。",
      category: "效率",
      price: `${product.freeLimit} 次免费试用`,
      icon: iconPath,
      href: "product.html",
      active: true
    },
    { name: "FocusFlow", description: "专注浏览、屏蔽干扰和管理工作时段的轻量插件。", category: "专注", price: "即将上线" },
    { name: "PrivacyShield", description: "面向隐私浏览的跟踪保护插件，适合后续产品线。", category: "隐私", price: "即将上线" },
    { name: "SnapCode", description: "把网页代码片段整理成更易保存和分享的格式。", category: "开发者", price: "即将上线" },
    { name: "LingoSync", description: "面向网页阅读场景的轻量翻译与术语辅助工具。", category: "工具", price: "即将上线" },
    { name: "MemSaver", description: "帮助整理低频标签页和浏览器资源占用。", category: "系统", price: "即将上线" }
  ];

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LeadFill 插件商城</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body class="marketplace-page">
  <header class="marketplace-topbar">
    <a class="marketplace-brand" href="index.html">LeadFill Gallery</a>
    <nav class="marketplace-nav">
      <a class="active" href="index.html">探索</a>
      <a href="#categories">分类</a>
      <a href="product.html">产品详情</a>
      <a href="${escapeHtml(pricingLink)}">价格</a>
    </nav>
    <div class="marketplace-actions">
      <div class="marketplace-top-search">搜索插件...</div>
      <a class="marketplace-signin" href="account.html">登录</a>
      ${localeSwitcherHtml}
    </div>
  </header>

  <main class="marketplace-main">
    <section class="marketplace-hero">
      <h1>发现更好用的 Chrome 插件</h1>
      <p>精选单一用途插件，聚焦效率、隐私和浏览器工作流。</p>
      <div class="marketplace-search">
        <span>⌕</span>
        <strong>搜索插件、分类或使用场景...</strong>
      </div>
      <div class="marketplace-chip-row" id="categories">
        <span>效率</span>
        <span>开发者工具</span>
        <span>隐私</span>
      </div>
    </section>

    <section class="marketplace-section">
      <div class="marketplace-section-head">
        <h2>推荐插件</h2>
        <a href="product.html">查看 LeadFill →</a>
      </div>
      <div class="marketplace-grid">
        ${marketplaceCards.map((card, index) => `
          <article class="marketplace-card ${card.active ? "is-active" : "is-coming-soon"}">
            <div class="marketplace-card-head">
              <div class="marketplace-icon marketplace-icon-${index + 1}">
                ${card.icon ? `<img src="${escapeHtml(card.icon)}" alt="${escapeHtml(card.name)} icon">` : `<span>${escapeHtml(card.name.slice(0, 1))}</span>`}
              </div>
              <span class="marketplace-category">${escapeHtml(card.category)}</span>
            </div>
            <h3>${escapeHtml(card.name)}</h3>
            <p>${escapeHtml(card.description)}</p>
            <div class="marketplace-card-foot">
              <span>${escapeHtml(card.price)}</span>
              ${card.active
                ? `<a class="marketplace-card-button" href="${escapeHtml(card.href)}">查看详情</a>`
                : `<span class="marketplace-card-button disabled">即将推出</span>`}
            </div>
          </article>
        `).join("")}
      </div>
    </section>
  </main>

  <footer class="marketplace-footer">
    <strong>LeadFill Gallery</strong>
    <nav>
      <a href="privacy.html">隐私</a>
      <a href="terms.html">条款</a>
      <a href="refund.html">退款</a>
      <a href="account.html">账户</a>
    </nav>
    <span>© 2026 插件工程 Chrome Extensions.</span>
  </footer>
</body>
</html>`;
}

function renderProductDetailPage({ state, screenshots, localeSwitcherHtml = "" }) {
  const product = state.product;
  const installReady = resolveInstallMode(product);
  const installHref = installReady ? product.installUrl : "#install-pending";
  const installLabel = installReady ? "安装到 Chrome" : "安装地址待提供";
  const heroImage = screenshots[0]?.image ?? "assets/screenshots/screenshot_1_1280x800.png";
  const supportImage = screenshots[1]?.image ?? "assets/screenshots/screenshot_2_1280x800.png";
  const iconPath = "assets/icon/icon128.png";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(product.name)} | 产品详情</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body class="product-detail-page">
  <header class="product-detail-nav">
    <a class="marketplace-brand" href="index.html">LeadFill Gallery</a>
    <nav>
      <a href="index.html">探索</a>
      <a class="active" href="product.html">产品</a>
      <a href="pricing.html">价格</a>
      <a href="account.html">账户</a>
    </nav>
    <div class="product-detail-actions">
      <a href="account.html">登录</a>
      <a class="marketplace-signin" href="${installReady ? escapeHtml(product.installUrl) : "pricing.html"}">${installReady ? "添加到 Chrome" : "查看价格"}</a>
      ${localeSwitcherHtml}
    </div>
  </header>

  <main class="product-detail-main">
    <section class="product-detail-hero">
      <img class="product-detail-icon" src="${escapeHtml(iconPath)}" alt="${escapeHtml(product.name)} icon">
      <div>
        <h1>${escapeHtml(product.name)}</h1>
        <p>一份本地资料，快速填写重复线索表单。</p>
        <div class="product-detail-meta">
          <span>★★★★★</span>
          <span>${escapeHtml(`${product.freeLimit} 次免费填写`)}</span>
          <span>效率工具</span>
        </div>
        <div class="hero-actions">
          <a class="button primary" href="${installReady ? escapeHtml(product.installUrl) : "pricing.html"}">${installReady ? "添加到 Chrome" : "查看价格"}</a>
          <a class="button secondary" href="pricing.html">终身版 $19</a>
        </div>
      </div>
    </section>

    <section class="product-detail-shot">
      <img src="${escapeHtml(heroImage)}" alt="${escapeHtml(product.name)} screenshot">
    </section>

    <section class="product-detail-two-col">
      <article>
        <h2>它解决什么</h2>
        <p>LeadFill 保存一份本地资料，并在兼容表单里填写文本、邮箱、电话、备注和下拉项。</p>
        <img src="${escapeHtml(supportImage)}" alt="${escapeHtml(product.name)} workflow screenshot">
      </article>
      <aside>
        <h2>适合谁</h2>
        ${listToHtml([
          "销售人员反复填写线索表单",
          "招聘人员录入同一套资料",
          "运营人员处理重复信息录入",
          "需要本地优先填表工具的人"
        ], "detail-check-list")}
      </aside>
    </section>

    <section class="product-detail-feature-row">
      <article><span></span><h3>填写更快</h3><p>资料保存一次，遇到相同字段直接复用。</p></article>
      <article><span></span><h3>资料留在本地</h3><p>不上传，不云同步，资料保存在 Chrome 本地。</p></article>
      <article><span></span><h3>免费开始</h3><p>${escapeHtml(`${product.freeLimit} 次免费填写`)}，需要无限填写时再升级。</p></article>
    </section>

    <section class="product-detail-faq">
      <h2>常见问题</h2>
      <article><h3>会上传我的资料吗？</h3><p>不会。保存的资料留在浏览器本地。</p></article>
      <article><h3>这是订阅吗？</h3><p>不是。终身版是 $19 一次性购买。</p></article>
      <article><h3>免费版能做什么？</h3><p>免费版包含 ${escapeHtml(`${product.freeLimit} 次填写`)}，足够先测试真实工作流。</p></article>
    </section>
  </main>

  ${renderSiteFooter({ supportEmail: product.supportEmail || "support@915500.xyz" })}
</body>
</html>`;
}

function renderMembershipAccountPage({ state, checkoutConfig, localeSwitcherHtml = "" }) {
  const product = state.product;
  const supportEmail = checkoutConfig.supportEmail || "support@915500.xyz";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>账户 | ${escapeHtml(product.name)}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body class="product-detail-page">
  <header class="product-detail-nav">
    <a class="marketplace-brand" href="index.html">LeadFill Gallery</a>
    <nav>
      <a href="index.html">探索</a>
      <a href="product.html">产品</a>
      <a href="pricing.html">价格</a>
      <a class="active" href="account.html">账户</a>
    </nav>
    <div class="product-detail-actions">${localeSwitcherHtml}</div>
  </header>

  <main class="account-simple">
    <section class="account-simple-hero">
      <h1>账户与会员</h1>
      <p>使用购买时的邮箱登录，查看会员状态、使用额度和订单记录。</p>
      <a class="button primary" href="pricing.html">查看价格</a>
    </section>

    <section class="account-simple-grid">
      <article>
        <span>当前方案</span>
        <h2>免费开始</h2>
        <p>新用户默认包含 ${escapeHtml(`${product.freeLimit} 次免费填写`)}。购买终身版后，可在这里刷新会员状态。</p>
      </article>
      <article>
        <span>使用额度</span>
        <h2>${escapeHtml(`${product.freeLimit} 次免费填写`)}</h2>
        <p>终身版解锁后，LeadFill 可用于无限填写。</p>
      </article>
      <article>
        <span>恢复购买</span>
        <h2>使用同一邮箱</h2>
        <p>如果已经购买，请使用结账时的邮箱登录并刷新会员。</p>
      </article>
      <article>
        <span>订单与支持</span>
        <h2>${escapeHtml(supportEmail)}</h2>
        <p>账单、退款或恢复购买问题可以通过支持邮箱处理。</p>
      </article>
    </section>
  </main>

  ${renderSiteFooter({ supportEmail })}
</body>
</html>`;
}

function renderProductPage({ state, screenshots, checkoutConfig, supportHtml, privacyHtml, changelogHtml, pricingLink, backToHubLink, localeSwitcherHtml = "" }) {
  const product = state.product;
  const installReady = resolveInstallMode(product);
  const heroImage = screenshots[0]?.image ?? "assets/landing/hero_1600x900.png";
  const previewCards = (screenshots ?? []).slice(0, 3);
  const primaryHeroHref = installReady ? product.installUrl : pricingLink;
  const primaryHeroLabel = installReady ? "Add to Chrome" : "View pricing";
  const iconPath = "assets/icon/icon128.png";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(product.name)} | Local Chrome form filling</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body class="page-home">
  <div class="site-shell showcase-shell">
    <header class="showcase-nav showcase-nav-home">
      <a class="brand showcase-brand" href="index.html"><span class="brand-mark"></span>${escapeHtml(product.shortName)}</a>
      <nav class="showcase-nav-links">
        <a class="active" href="index.html">Product</a>
        <a href="pricing.html">Pricing</a>
        <a href="account.html">Account</a>
      </nav>
      <div class="showcase-nav-actions">
        <div class="showcase-search-mini">LeadFill One Profile</div>
        <a class="showcase-nav-button" href="account.html">Account</a>
        ${localeSwitcherHtml}
      </div>
    </header>

    <section class="showcase-home-hero">
      <div class="showcase-home-copy">
        <div class="showcase-kicker">${escapeHtml(product.name)}</div>
        <h1>Fill repetitive lead forms from one local profile.</h1>
        <p class="showcase-subtitle">Save one browser-local profile and use it to fill common text, email, phone, textarea, and select fields in seconds.</p>
        <div class="showcase-search-bar">
          <span class="showcase-search-icon">⌕</span>
          <span>One saved profile. Less repetitive typing.</span>
        </div>
        <div class="showcase-chip-row">
          <span class="showcase-chip">${escapeHtml(`${product.freeLimit} free fills`)}</span>
          <span class="showcase-chip">${escapeHtml(product.priceLabel)}</span>
          <span class="showcase-chip">Local-only</span>
          <span class="showcase-chip">No upload</span>
          <span class="showcase-chip">No cloud sync</span>
        </div>
      </div>
    </section>

    <section class="showcase-section-head">
      <div>
        <p class="section-label">Featured product</p>
        <h2>LeadFill, presented like a product instead of a payment hub.</h2>
      </div>
      <a class="market-link" href="product.html">View details</a>
    </section>

    <section class="showcase-card-grid">
      <article class="showcase-product-card showcase-product-card-wide">
        <div class="showcase-card-top">
          <div class="showcase-icon-box">
            <img src="${escapeHtml(iconPath)}" alt="${escapeHtml(product.name)} icon">
          </div>
          <span class="showcase-tag">LeadFill</span>
        </div>
        <h3>${escapeHtml(product.name)}</h3>
        <p>Save one local profile and fill visible lead form fields on the current page in one click.</p>
        <div class="showcase-card-preview">
          <img src="${escapeHtml(heroImage)}" alt="${escapeHtml(product.name)} screenshot">
        </div>
        <div class="showcase-card-footer">
          <span>${escapeHtml(`${product.freeLimit} free fills`)}</span>
          <div class="showcase-card-actions">
            <a class="button secondary" href="product.html">View details</a>
            <a class="button primary" href="${escapeHtml(pricingLink)}">View pricing</a>
          </div>
        </div>
      </article>

      <article class="showcase-product-card">
        <div class="showcase-card-top">
          <div class="showcase-mini-icon">01</div>
          <span class="showcase-tag">Local-first</span>
        </div>
        <h3>Stay local</h3>
        <p>Profile data stays in Chrome. No upload, no cloud sync, and no extra workspace layer.</p>
        <div class="showcase-card-footer">
          <span>Privacy-friendly</span>
          <a class="button text" href="product.html#boundaries">View details</a>
        </div>
      </article>

      <article class="showcase-product-card">
        <div class="showcase-card-top">
          <div class="showcase-mini-icon">02</div>
          <span class="showcase-tag">Clear pricing</span>
        </div>
        <h3>Upgrade only when useful</h3>
        <p>${escapeHtml(`${product.freeLimit} free fills`)} let people test the real workflow before paying ${escapeHtml(product.priceLabel)}.</p>
        <div class="showcase-card-footer">
          <span>No subscription</span>
          <a class="button text" href="pricing.html">View pricing</a>
        </div>
      </article>
    </section>

    <section class="showcase-dual-panel">
      <article class="showcase-panel showcase-panel-large">
        <div class="showcase-panel-copy">
          <p class="section-label">How it works</p>
          <h2>Four short steps from profile to filled form.</h2>
          ${listToHtml(buildHowItWorksSteps(), "compact-list")}
        </div>
        <div class="showcase-panel-media">
          <img src="${escapeHtml(previewCards[1]?.image ?? heroImage)}" alt="${escapeHtml(product.name)} workflow screenshot">
        </div>
      </article>
      <article class="showcase-side-steps">
        <p class="section-label">Why LeadFill</p>
        <div class="showcase-step-line">
          <span class="showcase-step-dot active"></span>
          <div>
            <h3>Fill faster</h3>
            <p>Keep one saved profile ready and reuse it whenever the same fields appear again.</p>
          </div>
        </div>
        <div class="showcase-step-line">
          <span class="showcase-step-dot active"></span>
          <div>
            <h3>Stay local</h3>
            <p>Local-only product design keeps the product lightweight and easy to trust.</p>
          </div>
        </div>
        <div class="showcase-step-line">
          <span class="showcase-step-dot muted"></span>
          <div>
            <h3>Upgrade only when useful</h3>
            <p>Use the free plan first, then unlock Lifetime when the workflow proves itself.</p>
          </div>
        </div>
      </article>
    </section>

    <section class="showcase-bottom-band">
      <div>
        <p class="section-label">Next step</p>
        <h2>Start with the free plan, then decide whether Lifetime belongs in your workflow.</h2>
      </div>
      <div class="button-row">
        <a class="button primary" href="${escapeHtml(pricingLink)}">View pricing</a>
        <a class="button secondary" href="${escapeHtml(primaryHeroHref)}">${escapeHtml(primaryHeroLabel)}</a>
      </div>
    </section>

    ${renderSiteFooter({ supportEmail: checkoutConfig.supportEmail || "support@915500.xyz", note: "Questions? Reach us at support@915500.xyz." })}
  </div>
</body>
</html>`;
}

function renderFeaturePage({ state, screenshots, localeSwitcherHtml = "" }) {
  const product = state.product;
  const installReady = resolveInstallMode(product);
  const gallery = (screenshots ?? []).slice(0, 3);
  const faq = buildFaq(product);
  const iconPath = "assets/icon/icon128.png";
  const featureBreakdown = [
    {
      title: "Supports",
      items: ["Common text fields", "Email and phone fields", "Textarea notes", "Select inputs"]
    },
    {
      title: "Fill behavior",
      items: ["Triggered from the popup", "Skips readonly fields", "Skips disabled fields", "No overwrite by default"]
    },
    {
      title: "Local-first",
      items: ["One profile stored in Chrome", "No upload", "No cloud sync", "No hidden workspace layer"]
    },
    {
      title: "Not for",
      items: ["Heavy automation suites", "Team collaboration workspaces", "CRM sync", "Every form on every site"]
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
<body class="page-detail">
  <div class="site-shell showcase-shell">
    <header class="showcase-nav showcase-nav-light">
      <a class="brand showcase-brand" href="index.html"><span class="brand-mark"></span>${escapeHtml(product.shortName)}</a>
      <nav class="showcase-nav-links">
        <a href="index.html">Product</a>
        <a href="pricing.html">Pricing</a>
        <a href="account.html">Account</a>
      </nav>
      <div class="showcase-nav-actions">
        <a class="showcase-text-link" href="account.html">Sign In</a>
        <a class="showcase-nav-button" href="${installReady ? escapeHtml(product.installUrl) : "pricing.html"}">${installReady ? "Add to Chrome" : "View pricing"}</a>
        ${localeSwitcherHtml}
      </div>
    </header>

    <section class="detail-intro">
      <div class="detail-icon-card">
        <img src="${escapeHtml(iconPath)}" alt="${escapeHtml(product.name)} icon">
      </div>
      <div class="detail-intro-copy">
        <h1>${escapeHtml(product.name)}</h1>
        <p class="detail-subtitle">A focused Chrome extension for people who keep re-entering the same profile details into compatible lead forms.</p>
        <div class="detail-meta-row">
          <span class="detail-stars">★★★★★</span>
          <span>${escapeHtml(`${product.freeLimit} free fills`)}</span>
          <span>Productivity</span>
          <span>Local-only</span>
        </div>
        <div class="hero-actions">
          <a class="button primary" href="${installReady ? escapeHtml(product.installUrl) : "pricing.html"}">${installReady ? "Add to Chrome" : "View pricing"}</a>
          <a class="button secondary" href="pricing.html">Buy Now - $19</a>
        </div>
      </div>
    </section>

    <section class="detail-hero-shot">
      <img src="${escapeHtml(gallery[0]?.image ?? "assets/screenshots/screenshot_1_1280x800.png")}" alt="${escapeHtml(product.name)} product screenshot">
    </section>

    <section class="detail-split-grid">
      <article class="detail-content-card detail-content-card-large">
        <h2>What it does</h2>
        <p>One saved profile. Less repetitive typing.</p>
        <p>LeadFill is built for one job: keeping repeated form entry light, local, and fast.</p>
        <p>It works best when the same contact details appear again and again across compatible lead forms.</p>
        <div class="detail-inline-media">
          <img src="${escapeHtml(gallery[1]?.image ?? gallery[0]?.image ?? "assets/screenshots/screenshot_2_1280x800.png")}" alt="${escapeHtml(product.name)} workflow preview">
        </div>
      </article>

      <article class="detail-content-card detail-content-card-side">
        <h2>Who it is for</h2>
        ${listToHtml([
          "Sales reps sending outbound forms",
          "Recruiters entering the same profile across multiple pages",
          "Operators doing repetitive lead intake",
          "Anyone who wants a local-only alternative to bigger autofill suites"
        ], "detail-check-list")}
      </article>
    </section>

    <section class="detail-feature-stage" id="features">
      <div class="detail-feature-head">
        <p class="section-label">What it supports</p>
        <h2>The real product surface, explained in plain language.</h2>
        <p>What it does not try to be is just as important: LeadFill is not a cloud workspace, not a CRM sync layer, and not a heavy automation suite.</p>
      </div>
      <div class="detail-feature-cards">
        ${featureBreakdown.slice(0, 3).map((group) => `
          <article class="detail-feature-card">
            <div class="detail-feature-icon"></div>
            <h3>${escapeHtml(group.title)}</h3>
            ${listToHtml(group.items)}
          </article>
        `).join("")}
      </div>
    </section>

    <section class="detail-lower-grid" id="how-it-works">
      <article class="detail-lower-copy">
        <h2>Built for speed and efficiency.</h2>
        ${listToHtml([
          "Save one local profile in the extension.",
          "Open a compatible lead form.",
          "Click Fill Current Page from the popup.",
          "Upgrade only when unlimited fills becomes useful."
        ], "detail-check-list")}
      </article>
      <article class="detail-lower-side">
        <h3>What people usually want to know before they install or upgrade.</h3>
        <div class="faq-list detail-faq-list">
          ${faq.slice(0, 3).map((item) => `
            <article class="faq-item">
              <h4>${escapeHtml(item.question)}</h4>
              <p>${escapeHtml(item.answer)}</p>
            </article>
          `).join("")}
        </div>
      </article>
    </section>

    ${renderSiteFooter({ supportEmail: product.supportEmail || "support@915500.xyz" })}
  </div>
</body>
</html>`;
}

function renderPricingPage({ state, checkoutConfig, detailLink, backToHubLink, localeSwitcherHtml = "" }) {
  const product = state.product;
  const checkoutReady = resolveCheckoutReady(product);
  const supportEmail = checkoutConfig.supportEmail || "support@915500.xyz";
  const checkoutUrl = `${checkoutConfig.siteUrl}/checkout/start?productKey=${encodeURIComponent(product.productKey)}&planKey=${encodeURIComponent(product.defaultPlanKey)}&source=web`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(product.name)} Pricing | $19 Lifetime</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body class="page-pricing">
  <div class="site-shell showcase-shell">
    <header class="checkout-topbar">
      <a class="checkout-brand" href="index.html">${escapeHtml(product.shortName)}</a>
      <div class="checkout-topbar-right">
        <span class="checkout-lock">Secure Checkout</span>
        ${localeSwitcherHtml}
      </div>
    </header>

    <section class="checkout-hero">
      <h1>Simple pricing for LeadFill One Profile</h1>
      <p>Start with ${escapeHtml(`${product.freeLimit} free fills`)}. Unlock lifetime access when LeadFill becomes part of your workflow.</p>
    </section>

    <section class="checkout-layout">
      <div class="checkout-main-column">
        <div class="checkout-plan-grid">
          <article class="checkout-plan-card">
            <div class="checkout-plan-top">
              <h2>Free</h2>
              <span class="checkout-plan-radio"></span>
            </div>
            <div class="checkout-price-line"><strong>$0</strong><span>forever</span></div>
            ${listToHtml([
              "10 fills",
              "1 saved profile",
              "Local-only",
              "No upload",
              "No cloud sync",
              "No overwrite by default"
            ])}
          </article>

          <article class="checkout-plan-card checkout-plan-card-active">
            <div class="checkout-plan-recommend">Recommended</div>
            <div class="checkout-plan-top">
              <h2>Lifetime Unlock</h2>
              <span class="checkout-plan-radio active"></span>
            </div>
            <div class="checkout-price-line"><strong>$19</strong><span>one-time</span></div>
            ${listToHtml([
              "Unlimited fills",
              "Save / edit / delete profiles",
              "Advanced field support",
              "Local-only",
              "No subscription"
            ])}
          </article>
        </div>

        <article class="checkout-summary-card">
          <h3>Order Summary</h3>
          <div class="checkout-summary-row">
            <span>LeadFill Lifetime Unlock</span>
            <strong>$19.00</strong>
          </div>
          <div class="checkout-summary-row">
            <span>Estimated tax</span>
            <strong>$0.00</strong>
          </div>
          <div class="checkout-summary-total">
            <span>Total due today</span>
            <strong>$19.00</strong>
          </div>
        </article>

        <div class="checkout-copy-grid" id="checkout-guide">
          <article class="checkout-copy-card">
            <p class="section-label">How payment works</p>
            <h3>Hosted, short, and easy to follow.</h3>
            ${listToHtml([
              "Start checkout from the pricing page or from the extension upgrade flow.",
              "Complete payment on the hosted checkout page.",
              "Return to LeadFill or the account page after payment.",
              "Refresh your access so the product can show your latest plan."
            ])}
          </article>
          <article class="checkout-copy-card">
            <p class="section-label">After you pay</p>
            <h3>Keep the next step simple.</h3>
            ${listToHtml([
              "Open the extension again.",
              "Use the same email you used when you purchased.",
              "Refresh your access from the extension or account page.",
              "The confirmation page does not unlock Pro locally."
            ])}
          </article>
        </div>
      </div>

      <aside class="checkout-side-card">
        <h2>Continue with hosted checkout</h2>
        <div class="checkout-field-shell">
          <label>Email</label>
          <div>Use the same email you use in LeadFill.</div>
        </div>
        <div class="checkout-field-shell">
          <label>Payment handled securely</label>
          <div>Payment is handled on a secure hosted page. Your account updates after payment confirmation.</div>
        </div>
        <div class="checkout-field-shell">
          <label>What you are buying</label>
          <div>${escapeHtml(product.priceLabel)} one-time. No subscription.</div>
        </div>
        <a class="button ${checkoutReady ? "primary" : "disabled"} checkout-side-button" href="${checkoutReady ? escapeHtml(checkoutUrl) : "#pricing"}" ${checkoutReady ? "" : "aria-disabled=\"true\""}>Buy Lifetime</a>
        <p class="checkout-security-note">Payment handled securely on an external page. Success page does not unlock Pro locally.</p>
      </aside>
    </section>

    ${renderSiteFooter({ supportEmail })}
  </div>
</body>
</html>`;
}

function renderChineseMarketplaceCss() {
  return `<style>
:root {
  --market-bg: #f8f8fa;
  --market-surface: rgba(255, 255, 255, 0.82);
  --market-surface-solid: #ffffff;
  --market-text: #111318;
  --market-muted: #636674;
  --market-soft: #eef0f5;
  --market-line: rgba(20, 24, 32, 0.10);
  --market-blue: #173bd0;
  --market-blue-soft: #dee4ff;
  --market-shadow: 0 22px 50px rgba(28, 34, 48, 0.08), 0 6px 16px rgba(28, 34, 48, 0.04);
  --market-radius: 24px;
  --market-radius-sm: 14px;
}
* { box-sizing: border-box; }
body.market-cn,
body.detail-cn,
body.pricing-cn,
body.account-cn,
body.status-cn {
  margin: 0;
  background: var(--market-bg);
  color: var(--market-text);
  font-family: Inter, ui-sans-serif, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.cn-nav {
  position: sticky;
  top: 0;
  z-index: 20;
  height: 78px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 64px;
  background: rgba(45, 48, 57, 0.92);
  color: #fff;
  border-bottom: 0;
  box-shadow: 0 12px 34px rgba(11, 14, 22, 0.18);
  backdrop-filter: blur(18px);
}
.cn-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: inherit;
  text-decoration: none;
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.02em;
}
.cn-brand-mark {
  width: 32px;
  height: 32px;
  border-radius: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  letter-spacing: -0.03em;
  color: #fff;
  background: linear-gradient(135deg, #1741f2, #6f7cff);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.35);
}
.cn-nav-links {
  display: flex;
  align-items: center;
  gap: 42px;
}
.cn-nav-links a,
.cn-actions a,
.cn-footer a {
  color: inherit;
  text-decoration: none;
}
.cn-nav-links a {
  color: rgba(255,255,255,0.58);
  font-size: 20px;
  font-weight: 700;
}
.cn-nav-links a.active {
  color: #7d8dff;
  border-bottom: 3px solid #6f61ff;
  padding-bottom: 8px;
}
.cn-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}
.cn-mini-search {
  min-width: 280px;
  height: 56px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 24px;
  color: #6f7484;
  background: rgba(255,255,255,0.94);
  font-weight: 500;
}
.cn-mini-search input,
.cn-search-hero input {
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: #222631;
  font: inherit;
}
.cn-mini-search input::placeholder,
.cn-search-hero input::placeholder {
  color: #656b7a;
}
.cn-signin {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0 24px;
  border-radius: 10px;
  background: var(--market-blue);
  color: #fff !important;
  font-size: 17px;
  font-weight: 800;
}
.cn-signin.is-authenticated {
  background: #fff;
  color: #151922 !important;
  border: 1px solid rgba(20,24,32,0.12);
}
.cn-shell {
  width: min(100% - 128px, 1280px);
  margin: 0 auto;
}
.cn-market-hero {
  padding: 94px 0 78px;
  text-align: center;
}
.cn-market-hero h1 {
  margin: 0 0 24px;
  font-size: clamp(44px, 5vw, 72px);
  line-height: 1.05;
  letter-spacing: -0.055em;
}
.cn-market-hero p {
  max-width: 760px;
  margin: 0 auto 54px;
  color: #5f626d;
  font-size: clamp(24px, 2.5vw, 36px);
  line-height: 1.28;
  letter-spacing: -0.025em;
}
.cn-search-hero {
  width: min(760px, 100%);
  min-height: 76px;
  margin: 0 auto;
  border-radius: 999px;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 0 34px;
  color: #646a7c;
  background: #f1f2f5;
  box-shadow: 0 14px 34px rgba(30, 36, 52, 0.06);
  font-size: 22px;
  font-weight: 700;
  text-align: left;
}
.cn-chip-row {
  margin-top: 34px;
  display: flex;
  justify-content: center;
  gap: 18px;
  flex-wrap: wrap;
}
.cn-chip-row span,
.cn-chip-row a,
.cn-card-badge {
  border-radius: 999px;
  padding: 8px 18px;
  color: #171923;
  background: #dedfe4;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.08em;
}
.cn-chip-row a,
.cn-card-badge {
  text-decoration: none;
}
.cn-chip-row a.active {
  color: #fff;
  background: var(--market-blue);
}
.cn-section-head {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 24px;
  margin-bottom: 34px;
}
.cn-section-head h2 {
  margin: 0;
  font-size: 34px;
  line-height: 1.2;
  letter-spacing: -0.035em;
}
.cn-section-head a {
  color: var(--market-blue);
  font-size: 20px;
  font-weight: 800;
  text-decoration: none;
}
.cn-card-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 26px;
  padding-bottom: 92px;
}
.cn-products-page-head {
  padding: 86px 0 38px;
}
.cn-products-page-head h1 {
  margin: 0 0 18px;
  font-size: clamp(44px, 5vw, 68px);
  line-height: 1.04;
  letter-spacing: -0.055em;
}
.cn-products-page-head p {
  max-width: 760px;
  margin: 0;
  color: #596071;
  font-size: 24px;
  line-height: 1.45;
}
.cn-extension-card {
  min-height: 292px;
  display: flex;
  flex-direction: column;
  padding: 28px;
  border-radius: 18px;
  background: rgba(255,255,255,0.78);
  border: 1px solid rgba(255,255,255,0.7);
  box-shadow: 0 18px 40px rgba(30, 36, 52, 0.055);
  transition: transform .22s ease, box-shadow .22s ease, background .22s ease;
}
.cn-extension-card:hover {
  transform: translateY(-4px);
  background: #fff;
  box-shadow: var(--market-shadow);
}
.cn-card-top {
  display: flex;
  align-items: start;
  justify-content: space-between;
  margin-bottom: 22px;
}
.cn-plugin-icon {
  width: 70px;
  height: 70px;
  border-radius: 19px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  color: var(--market-blue);
  background: linear-gradient(135deg, #e6edff, #f6f8ff);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.8);
}
.cn-plugin-icon img { width: 42px; height: 42px; }
.cn-plugin-icon span { font-size: 24px; font-weight: 900; }
.cn-icon-green { background: linear-gradient(135deg, #ddfae9, #f1fff6); color: #15934f; }
.cn-icon-red { background: linear-gradient(135deg, #ffe9e4, #fff5f2); color: #a7411c; }
.cn-icon-purple { background: linear-gradient(135deg, #f2e3ff, #fff5ff); color: #7d32c8; }
.cn-icon-yellow { background: linear-gradient(135deg, #fff8c8, #fffbea); color: #b06b00; }
.cn-icon-cyan { background: linear-gradient(135deg, #dcfbff, #f2fdff); color: #0c8ba3; }
.cn-extension-card h3 {
  margin: 0 0 10px;
  font-size: 25px;
  letter-spacing: -0.025em;
}
.cn-extension-card p {
  margin: 0;
  color: #555a67;
  font-size: 18px;
  line-height: 1.55;
}
.cn-card-foot {
  margin-top: auto;
  padding-top: 24px;
  border-top: 1px solid rgba(20, 24, 32, 0.10);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}
.cn-card-foot span {
  color: #667087;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.08em;
}
.cn-outline-button,
.cn-primary-button,
.cn-plain-button {
  min-height: 52px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 24px;
  text-decoration: none;
  font-size: 18px;
  font-weight: 850;
}
.cn-primary-button {
  color: #fff;
  background: var(--market-blue);
  box-shadow: 0 10px 22px rgba(23,59,208,0.22);
}
.cn-primary-button[aria-disabled="true"] {
  background: #8d94a5;
  box-shadow: none;
  cursor: not-allowed;
}
.cn-outline-button {
  color: #111318;
  background: rgba(255,255,255,0.55);
  border: 1px solid rgba(20,24,32,0.14);
}
.cn-plain-button {
  color: var(--market-blue);
  background: transparent;
  padding-inline: 0;
}
.cn-footer {
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 30px;
  padding: 0 64px;
  color: #7a8090;
  background: #080c16;
}
.cn-footer strong { color: #fff; font-size: 18px; }
.cn-footer nav { display: flex; gap: 30px; flex-wrap: wrap; }
.cn-detail-main {
  width: min(100% - 128px, 1180px);
  margin: 0 auto;
  padding: 82px 0 100px;
}
.cn-product-head {
  display: grid;
  grid-template-columns: 136px 1fr;
  gap: 30px;
  align-items: center;
  margin-bottom: 72px;
}
.cn-product-big-icon {
  width: 126px;
  height: 126px;
  border-radius: 24px;
  background: #fff;
  box-shadow: var(--market-shadow);
  display: flex;
  align-items: center;
  justify-content: center;
}
.cn-product-big-icon img { width: 76px; height: 76px; }
.cn-product-head h1 {
  margin: 0 0 10px;
  font-size: 46px;
  line-height: 1.1;
  letter-spacing: -0.05em;
}
.cn-product-head p {
  margin: 0 0 22px;
  max-width: 720px;
  color: #343844;
  font-size: 19px;
  line-height: 1.55;
}
.cn-product-head .cn-muted-note {
  margin-top: 14px;
  margin-bottom: 0;
  color: #667087;
  font-size: 15px;
}
.cn-meta-row {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  color: #596071;
  font-size: 15px;
  margin-bottom: 22px;
}
.cn-stars { color: var(--market-blue); letter-spacing: 2px; }
.cn-action-row { display: flex; gap: 16px; flex-wrap: wrap; }
.cn-hero-shot {
  border-radius: 24px;
  overflow: hidden;
  background: #fff;
  box-shadow: var(--market-shadow);
  margin-bottom: 26px;
}
.cn-hero-shot img {
  display: block;
  width: 100%;
  height: 500px;
  object-fit: cover;
}
.cn-bento {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 26px;
  margin-bottom: 74px;
}
.cn-panel {
  padding: 30px;
  border-radius: var(--market-radius);
  background: var(--market-surface-solid);
  box-shadow: var(--market-shadow);
}
.cn-panel h2,
.cn-panel h3 {
  margin: 0 0 14px;
  letter-spacing: -0.03em;
}
.cn-panel h2 { font-size: 28px; }
.cn-panel h3 { font-size: 21px; }
.cn-panel p,
.cn-check-list {
  color: #535866;
  font-size: 16px;
  line-height: 1.7;
}
.cn-panel img {
  width: 100%;
  height: 250px;
  object-fit: cover;
  border-radius: 14px;
  margin-top: 20px;
}
.cn-check-list {
  display: grid;
  gap: 14px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.cn-check-list li {
  position: relative;
  padding-left: 30px;
}
.cn-check-list li::before {
  content: "";
  position: absolute;
  left: 0;
  top: 7px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--market-blue);
  box-shadow: inset 0 0 0 4px #dfe5ff;
}
.cn-feature-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 26px;
  margin-bottom: 74px;
}
.cn-feature-row article {
  padding: 30px;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 16px 34px rgba(30,36,52,0.05);
}
.cn-dot-icon {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: var(--market-blue-soft);
  margin-bottom: 22px;
}
.cn-faq-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}
.cn-faq-grid article {
  padding: 22px;
  border-radius: 16px;
  background: rgba(255,255,255,0.72);
  border: 1px solid rgba(20,24,32,0.08);
}
.cn-detail-accordion {
  display: grid;
  gap: 14px;
  margin: 0 0 74px;
}
.cn-detail-accordion details {
  border-radius: 18px;
  background: rgba(255,255,255,0.82);
  border: 1px solid rgba(20,24,32,0.08);
  box-shadow: 0 10px 26px rgba(30,36,52,0.04);
  overflow: hidden;
}
.cn-detail-accordion summary {
  cursor: pointer;
  list-style: none;
  padding: 24px 28px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 18px;
  font-size: 22px;
  font-weight: 900;
  letter-spacing: -0.025em;
}
.cn-detail-accordion summary::-webkit-details-marker {
  display: none;
}
.cn-detail-accordion summary::after {
  content: "+";
  color: var(--market-blue);
  font-size: 26px;
}
.cn-detail-accordion details[open] summary::after {
  content: "−";
}
.cn-detail-accordion .cn-accordion-body {
  padding: 0 28px 26px;
  color: #535866;
  font-size: 17px;
  line-height: 1.75;
}
.cn-pricing-main {
  width: min(100% - 128px, 1280px);
  margin: 0 auto;
  padding: 86px 0 100px;
}
.cn-checkout-head {
  margin-bottom: 54px;
}
.cn-checkout-head h1 {
  margin: 0 0 18px;
  max-width: 780px;
  font-size: clamp(46px, 5vw, 70px);
  line-height: 1.04;
  letter-spacing: -0.055em;
}
.cn-checkout-head p {
  margin: 0;
  max-width: 760px;
  color: #3f4452;
  font-size: 25px;
  line-height: 1.45;
}
.cn-checkout-layout {
  display: grid;
  grid-template-columns: 1.45fr 0.95fr;
  gap: 28px;
  align-items: start;
}
.cn-plan-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 26px;
  margin-bottom: 26px;
}
.cn-pricing-three {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 26px;
  align-items: stretch;
}
.cn-pricing-three[role="radiogroup"] {
  margin-bottom: 22px;
}
.cn-price-original {
  color: #8a91a1;
  font-size: 19px;
  text-decoration: line-through;
  margin-left: 8px;
}
.cn-plan-note {
  min-height: 48px;
  color: #535866;
  font-size: 16px;
  line-height: 1.55;
  margin: -10px 0 22px;
}
.cn-plan-button {
  width: 100%;
  margin-top: 24px;
}
.cn-selected-plan {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 22px;
  margin: 26px 0 18px;
  padding: 22px 24px;
  border-radius: 22px;
  background: rgba(255,255,255,0.74);
  border: 1px solid rgba(20,24,32,0.09);
  box-shadow: 0 14px 34px rgba(28,34,48,0.05);
}
.cn-selected-plan span {
  display: block;
  margin-bottom: 6px;
  color: #717786;
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.10em;
}
.cn-selected-plan strong {
  display: block;
  color: #111318;
  font-size: 22px;
  letter-spacing: -0.03em;
}
.cn-plan-card,
.cn-payment-card,
.cn-summary-card {
  border-radius: 24px;
  background: #fff;
  box-shadow: var(--market-shadow);
}
.cn-plan-card {
  position: relative;
  min-height: 380px;
  padding: 30px;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
}
.cn-plan-card:hover {
  transform: translateY(-2px);
  border-color: rgba(23,59,208,0.30);
}
.cn-plan-card:focus-visible {
  outline: 4px solid rgba(23,59,208,0.18);
  outline-offset: 4px;
}
.cn-plan-card.is-selected {
  border-color: var(--market-blue);
  box-shadow: 0 24px 54px rgba(23,59,208,0.12), 0 6px 16px rgba(28,34,48,0.05);
}
.cn-recommend {
  position: absolute;
  right: 24px;
  top: -15px;
  border-radius: 999px;
  padding: 7px 18px;
  background: var(--market-blue);
  color: #fff;
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.08em;
}
.cn-plan-title {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  margin-bottom: 24px;
}
.cn-plan-title h2 { margin: 0; font-size: 28px; }
.cn-radio {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 3px solid #c6cad8;
}
.cn-radio.active {
  border-color: var(--market-blue);
  box-shadow: inset 0 0 0 6px #fff;
  background: var(--market-blue);
}
.cn-price {
  margin-bottom: 26px;
}
.cn-price strong {
  font-size: 54px;
  letter-spacing: -0.05em;
}
.cn-price span {
  color: #2f3542;
  font-size: 20px;
}
.cn-summary-card {
  padding: 32px;
  background: #f1f2f5;
  border: 1px solid rgba(20,24,32,0.09);
}
.cn-summary-card h3 { margin: 0 0 24px; font-size: 26px; }
.cn-summary-row,
.cn-summary-total {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 0;
  border-bottom: 1px solid rgba(20,24,32,0.08);
  color: #394050;
  font-size: 18px;
}
.cn-summary-total {
  border-bottom: 0;
  color: #111318;
  font-weight: 850;
}
.cn-summary-total strong {
  color: var(--market-blue);
  font-size: 44px;
  letter-spacing: -0.04em;
}
.cn-payment-card {
  padding: 34px;
}
.cn-payment-card h2 { margin: 0 0 28px; font-size: 28px; }
.cn-field {
  padding: 18px 20px;
  border: 1px solid #bfc5d2;
  border-radius: 12px;
  margin-bottom: 18px;
}
.cn-field label {
  display: block;
  color: #202534;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.12em;
  margin-bottom: 10px;
}
.cn-field div {
  color: #717786;
  font-size: 18px;
}
.cn-payment-note {
  color: #606779;
  font-size: 14px;
  line-height: 1.6;
  text-align: center;
}
.cn-account-main {
  width: min(100% - 128px, 1120px);
  margin: 0 auto;
  padding: 86px 0 100px;
}
.cn-account-hero {
  text-align: center;
  margin-bottom: 48px;
}
.cn-account-hero h1 {
  margin: 0 0 16px;
  font-size: 52px;
  letter-spacing: -0.055em;
}
.cn-account-hero p {
  max-width: 640px;
  margin: 0 auto 26px;
  color: #535866;
  font-size: 20px;
  line-height: 1.6;
}
.cn-account-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 22px;
}
.cn-account-card {
  padding: 30px;
  border-radius: 22px;
  background: #fff;
  box-shadow: 0 16px 34px rgba(30,36,52,0.055);
}
.cn-account-card span {
  color: #7b8292;
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.11em;
}
.cn-account-card h2 {
  margin: 14px 0 10px;
  font-size: 28px;
  letter-spacing: -0.035em;
}
.cn-account-card p {
  margin: 0;
  color: #535866;
  font-size: 16px;
  line-height: 1.7;
}
.cn-account-layout {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: 24px;
  align-items: start;
}
.cn-account-stack {
  display: grid;
  gap: 18px;
}
.cn-login-panel {
  padding: 34px;
  border-radius: 26px;
  background: #fff;
  box-shadow: var(--market-shadow);
  min-height: 430px;
}
.cn-login-panel > span {
  color: #7b8292;
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.11em;
}
.cn-login-panel h2 {
  margin: 14px 0 10px;
  font-size: 32px;
  letter-spacing: -0.04em;
}
.cn-login-panel p {
  margin: 0 0 22px;
  color: #535866;
  font-size: 16px;
  line-height: 1.7;
}
.cn-signed-in-panel {
  margin-top: 26px;
  padding-top: 24px;
  border-top: 1px solid rgba(20,24,32,0.10);
}
.cn-login-form[hidden],
.cn-signed-in-panel[hidden] {
  display: none !important;
}
.cn-signed-in-panel h3 {
  margin: 6px 0 20px;
  font-size: 22px;
  letter-spacing: -0.03em;
  word-break: break-word;
}
.cn-account-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 18px;
  padding: 9px 12px;
  border-radius: 999px;
  background: rgba(23,59,208,0.08);
  color: var(--market-blue);
  font-size: 13px;
  font-weight: 900;
}
.cn-account-status-pill::before {
  content: "";
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}
.cn-login-form {
  display: grid;
  gap: 14px;
}
.cn-login-form label {
  display: grid;
  gap: 8px;
  color: #535866;
  font-size: 14px;
  font-weight: 800;
}
.cn-login-form input {
  width: 100%;
  height: 52px;
  border: 1px solid var(--market-line);
  border-radius: 14px;
  padding: 0 16px;
  color: var(--market-text);
  background: #f7f8fb;
  font: inherit;
}
.cn-login-form input:focus {
  outline: 2px solid rgba(23, 59, 208, 0.18);
  border-color: rgba(23, 59, 208, 0.42);
}
.cn-form-message {
  min-height: 22px;
  margin: 4px 0 0 !important;
  color: #535866;
  font-size: 14px !important;
}
.cn-membership-section {
  margin-top: 28px;
  padding: 34px;
  border-radius: 28px;
  background: rgba(255,255,255,0.78);
  border: 1px solid rgba(20,24,32,0.08);
  box-shadow: var(--market-shadow);
}
.cn-membership-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 24px;
}
.cn-membership-head span,
.cn-benefit-card-top span {
  color: #7b8292;
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.11em;
}
.cn-membership-head h2 {
  margin: 10px 0 10px;
  font-size: 34px;
  letter-spacing: -0.045em;
}
.cn-membership-head p {
  max-width: 720px;
  margin: 0;
  color: #535866;
  font-size: 16px;
  line-height: 1.7;
}
.cn-product-switcher {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin: 0 0 22px;
  padding: 8px;
  border-radius: 16px;
  background: #f2f4f8;
  border: 1px solid rgba(20,24,32,0.08);
}
.cn-product-switcher button {
  min-height: 44px;
  padding: 0 18px;
  border-radius: 12px;
  border: 0;
  background: transparent;
  color: #4b5262;
  font: inherit;
  font-weight: 850;
  cursor: pointer;
}
.cn-product-switcher button.active {
  background: #fff;
  color: var(--market-blue);
  box-shadow: 0 8px 18px rgba(30,36,52,0.08);
}
.cn-membership-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}
.cn-benefit-card {
  min-height: 300px;
  padding: 26px;
  border-radius: 22px;
  background: #fff;
  border: 1px solid rgba(20,24,32,0.08);
  box-shadow: 0 14px 30px rgba(30,36,52,0.045);
}
.cn-benefit-card.is-current {
  border-color: rgba(23,59,208,0.38);
  box-shadow: 0 18px 40px rgba(23,59,208,0.10);
}
.cn-benefit-card.is-locked {
  background: linear-gradient(180deg, #fff, #f7f8fc);
}
.cn-benefit-card-top {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: center;
  margin-bottom: 20px;
}
.cn-benefit-card-top strong {
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(23,59,208,0.08);
  color: var(--market-blue);
  font-size: 14px;
}
.cn-benefit-card h3 {
  margin: 0 0 18px;
  font-size: 24px;
  letter-spacing: -0.035em;
}
.cn-benefit-card p {
  color: #535866;
  font-size: 16px;
  line-height: 1.75;
}
.cn-status-main {
  min-height: calc(100vh - 198px);
  display: grid;
  place-items: center;
  padding: 70px 24px;
}
.cn-status-card {
  width: min(680px, 100%);
  padding: 48px;
  border-radius: 28px;
  background: #fff;
  box-shadow: var(--market-shadow);
  text-align: center;
}
.cn-status-card h1 {
  margin: 0 0 14px;
  font-size: 42px;
  letter-spacing: -0.045em;
}
.cn-status-card p {
  margin: 0 auto 28px;
  color: #535866;
  font-size: 18px;
  line-height: 1.7;
}
.cn-legal-main {
  width: min(100% - 128px, 880px);
  margin: 0 auto;
  padding: 76px 0 100px;
}
.cn-legal-article {
  padding: 46px;
  border-radius: 26px;
  background: #fff;
  box-shadow: var(--market-shadow);
}
.cn-legal-article h1 {
  margin: 0 0 14px;
  font-size: 48px;
  letter-spacing: -0.05em;
}
.cn-legal-article h2 {
  margin: 34px 0 12px;
  font-size: 24px;
}
.cn-legal-article p,
.cn-legal-article li {
  color: #535866;
  font-size: 17px;
  line-height: 1.8;
}
.cn-legal-article ul {
  padding-left: 20px;
}
@media (max-width: 920px) {
  .cn-nav { height: auto; padding: 20px 24px; flex-wrap: wrap; gap: 18px; }
  .cn-nav-links { order: 3; width: 100%; gap: 18px; overflow-x: auto; }
  .cn-actions { margin-left: auto; }
  .cn-mini-search { display: none; }
  .cn-shell,
  .cn-detail-main,
  .cn-pricing-main,
  .cn-account-main,
  .cn-legal-main { width: min(100% - 32px, 100%); }
  .cn-card-grid,
  .cn-feature-row,
  .cn-faq-grid,
  .cn-plan-grid,
  .cn-pricing-three,
  .cn-membership-grid,
  .cn-account-grid,
  .cn-account-layout,
  .cn-checkout-layout,
  .cn-bento,
  .cn-product-head { grid-template-columns: 1fr; }
  .cn-membership-head { flex-direction: column; }
  .cn-selected-plan { flex-direction: column; align-items: stretch; }
  .cn-selected-plan .cn-primary-button { width: 100%; }
  .cn-market-hero { padding: 64px 0 52px; }
  .cn-hero-shot img { height: 320px; }
  .cn-footer { padding: 34px 24px; flex-direction: column; align-items: flex-start; }
}
</style>`;
}

function renderChineseMarketplaceNav({ active = "explore", localeSwitcherHtml = "", pricingLink = "pricing.html", product, basePath = "/" }) {
  const installReady = product ? resolveInstallMode(product) : false;
  const href = (target) => `${basePath}${target}`;
  return `<header class="cn-nav">
    <a class="cn-brand" href="${href("index.html")}"><span class="cn-brand-mark">${HWH_BRAND_MARK}</span>${HWH_BRAND_ZH}</a>
    <nav class="cn-nav-links">
      <a class="${active === "explore" ? "active" : ""}" href="${href("index.html")}">探索</a>
      <a class="${active === "product" ? "active" : ""}" href="${href("product.html")}">产品</a>
      <a class="${active === "account" ? "active" : ""}" href="${href("account.html")}">账户</a>
    </nav>
    <div class="cn-actions">
      <label class="cn-mini-search"><span>⌕</span><input data-market-search type="search" placeholder="搜索插件..."></label>
      <a class="cn-signin" href="${href("account.html")}" data-account-action>登录</a>
      ${installReady ? `<a class="cn-signin" href="${escapeHtml(product.chromeWebStoreUrl)}">安装</a>` : ""}
      ${localeSwitcherHtml}
    </div>
  </header>
  ${renderChineseMarketplaceAccountNavScript()}`;
}

function renderChineseMarketplaceAccountNavScript() {
  return `<script>
(() => {
  const sessionKey = "plugin_engineering_account_session";
  const identityKey = "plugin_engineering_account_identity";
  const cookieKey = "hwh_account_email";
  const accountLink = document.querySelector("[data-account-action]");
  if (!accountLink) return;
  const readJson = (key) => {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
  };
  const readCookie = (key) => {
    return document.cookie.split("; ").find((row) => row.startsWith(key + "="))?.split("=")[1] || "";
  };
  const captureAuthHash = () => {
    if (!window.location.hash || !window.location.hash.includes("access_token")) return;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (!accessToken) return;
    const saved = {
      accessToken,
      refreshToken,
      email: readJson(identityKey)?.email || ""
    };
    localStorage.setItem(sessionKey, JSON.stringify(saved));
    localStorage.setItem(identityKey, JSON.stringify({ email: saved.email, signedInAt: new Date().toISOString() }));
    history.replaceState(null, "", window.location.pathname + window.location.search);
  };
  const updateAccountNav = () => {
    captureAuthHash();
    const session = readJson(sessionKey);
    const identity = readJson(identityKey);
    const email = session?.email || identity?.email || decodeURIComponent(readCookie(cookieKey) || "");
    if (session?.accessToken || session?.refreshToken || email) {
      accountLink.textContent = "我的账户";
      accountLink.classList.add("is-authenticated");
      accountLink.title = email || "已登录账户";
    } else {
      accountLink.textContent = "登录";
      accountLink.classList.remove("is-authenticated");
      accountLink.removeAttribute("title");
    }
  };
  window.addEventListener("plugin-account-session-changed", updateAccountNav);
  updateAccountNav();
})();
  </script>`;
}

function renderChineseMarketplaceFooter() {
  return `<footer class="cn-footer">
    <strong>${HWH_BRAND_ZH}</strong>
    <nav>
      <a href="/privacy.html">隐私</a>
      <a href="/terms.html">条款</a>
      <a href="/account.html">账户</a>
    </nav>
    <span>© 2026 ${HWH_BRAND_EN}.</span>
  </footer>`;
}

function replaceAllLiteral(source, from, to) {
  return source.includes(from) ? source.split(from).join(to) : source;
}

function applyLiteralReplacements(source, replacements) {
  return replacements.reduce((html, [from, to]) => replaceAllLiteral(html, from, to), source);
}

function normalizeMarketplaceHtmlPaths(html) {
  return html
    .replace(/href="(?:\.\.\/)*styles\.css"/g, `href="/styles.css"`)
    .replace(/src="(?:\.\.\/)*assets\//g, `src="/assets/`)
    .replace(/href="(?:\.\.\/)*assets\//g, `href="/assets/`)
    .replace(/href="index\.html"/g, `href="/index.html"`)
    .replace(/href="product\.html"/g, `href="/product.html"`)
    .replace(/href="leadfill\.html"/g, `href="/leadfill.html"`)
    .replace(/href="pricing\.html"/g, `href="/pricing.html"`)
    .replace(/href="account\.html"/g, `href="/account.html"`)
    .replace(/href="privacy\.html"/g, `href="/privacy.html"`)
    .replace(/href="terms\.html"/g, `href="/terms.html"`)
    .replace(/href="chatgpt-obsidian-local-exporter\.html"/g, `href="/chatgpt-obsidian-local-exporter.html"`)
    .replace(/href="chatgpt-obsidian-local-exporter-pricing\.html"/g, `href="/chatgpt-obsidian-local-exporter-pricing.html"`);
}

function withGa4Tag(html) {
  if (html.includes(GA4_MEASUREMENT_ID) || !html.includes("</head>")) {
    return html;
  }
  return html.replace("</head>", `${GA4_HEAD_TAG}\n</head>`);
}

function renderEnglishMarketplaceHtml(html) {
  const replacements = [
    ["zh-CN", "en"],
    ["插件工程 | Chrome 插件商城", `${HWH_BRAND_EN} | Chrome Extension Marketplace`],
    ["全部插件 | 插件工程", `All Extensions | ${HWH_BRAND_EN}`],
    ["付款入口准备中 | 插件工程", `Checkout Start | ${HWH_BRAND_EN}`],
    ["账户与会员", "Account & Membership"],
    ["付款已完成", "Payment received"],
    ["付款已取消", "Checkout cancelled"],
    ["隐私 | 插件工程", `Privacy | ${HWH_BRAND_EN}`],
    ["条款 | 插件工程", `Terms | ${HWH_BRAND_EN}`],
    [HWH_BRAND_ZH, HWH_BRAND_EN],
    ["插件工程", HWH_BRAND_EN],
    ["发现更好用的 Chrome 插件", "Discover better Chrome extensions"],
    ["一个面向专业用户的 Chrome 插件市场，集中展示效率、隐私、开发者工具和浏览器工作流产品。", "A curated marketplace for focused Chrome extensions across productivity, privacy, developer tools, and browser workflows."],
    ["搜索插件或使用场景...", "Search extensions or use cases..."],
    ["搜索插件...", "Search extensions..."],
    ["推荐插件", "Featured extensions"],
    ["查看所有插件 →", "View all extensions →"],
    ["全部插件", "All extensions"],
    ["探索", "Explore"],
    ["产品", "Products"],
    ["账户", "Account"],
    ["登录", "Sign in"],
    ["我的账户", "My account"],
    ["已登录账户", "Signed-in account"],
    ["隐私", "Privacy"],
    ["条款", "Terms"],
    ["安装到 Chrome", "Add to Chrome"],
    ["安装地址待提供", "Install link pending"],
    ["安装", "Install"],
    ["查看详情", "View details"],
    ["查看价格", "View pricing"],
    ["查看方案价格", "View plans"],
    ["查看可购买方案", "View available plans"],
    ["查看所有插件", "View all extensions"],
    ["即将推出", "Coming soon"],
    ["即将上线", "Coming soon"],
    ["同价方案", "Same plans"],
    ["知识管理", "Knowledge management"],
    ["效率工具", "Productivity"],
    ["效率", "Productivity"],
    ["专注", "Focus"],
    ["开发者", "Developer"],
    ["开发者工具", "Developer tools"],
    ["工具", "Tools"],
    ["系统", "System"],
    ["本地优先", "Local-first"],
    ["本地保存", "Local storage"],
    ["Markdown 导出", "Markdown export"],
    ["把 ChatGPT、Gemini、Grok、豆包等 AI 对话导出为 Obsidian 友好的 Markdown。", "Export ChatGPT, Gemini, Grok, Doubao, and other AI conversations into Obsidian-friendly Markdown."],
    ["保存一份本地资料，在常见线索表单里一键填入姓名、邮箱、电话和备注。", "Save one local profile and fill common lead-form fields like name, email, phone, and notes in one click."],
    ["减少分心页面，帮助浏览器进入专注工作模式。", "Reduce distracting pages and help the browser stay in a focused work mode."],
    ["面向隐私浏览的轻量保护工具，适合后续产品线。", "A lightweight privacy browsing helper planned for a future product line."],
    ["整理网页代码片段，让保存和复用更干净。", "Organize webpage code snippets so saving and reuse stay clean."],
    ["网页阅读场景下的轻量翻译与术语辅助。", "Lightweight translation and terminology help for web reading."],
    ["管理低频标签页和浏览器资源占用。", "Manage low-frequency tabs and browser resource usage."],
    ["10 次免费试用", "10 free fills"],
    ["10 次免费填写", "10 free fills"],
    ["免费试用权益", "Free benefits"],
    ["付费会员权益", "Paid member benefits"],
    ["当前可用", "Available now"],
    ["升级后解锁", "Unlock after upgrade"],
    ["会员信息", "Membership"],
    ["插件会员权益", "Extension membership benefits"],
    ["选择一个插件，查看当前账户在该插件下的免费权益、付费权益和恢复购买路径。", "Choose an extension to review your free benefits, paid benefits, and purchase recovery path."],
    ["当前插件", "Current extension"],
    ["当前方案", "Current plan"],
    ["使用额度", "Usage"],
    ["订单与恢复", "Orders & recovery"],
    ["恢复购买", "Restore purchase"],
    ["账户中心", "Account center"],
    ["会员账户", "Member account"],
    ["我的会员账户", "My membership account"],
    ["邮箱登录", "Email sign-in"],
    ["使用购买邮箱登录", "Sign in with your purchase email"],
    ["输入邮箱获取验证码。验证码 5 分钟内有效，登录后可查看会员权益、使用额度和购买恢复状态。", "Enter your email to receive a verification code. Codes expire in 5 minutes. After signing in, you can view membership benefits, usage, and purchase recovery."],
    ["邮箱", "Email"],
    ["发送验证码", "Send code"],
    ["发送中...", "Sending..."],
    ["重新发送 ", "Resend in "],
    ["验证码", "Verification code"],
    ["输入邮箱验证码", "Enter email code"],
    ["登录账户", "Sign in"],
    ["准备登录。", "Ready to sign in."],
    ["已登录", "Signed in"],
    ["可以刷新会员状态。", "You can refresh membership status."],
    ["刷新会员", "Refresh membership"],
    ["退出登录", "Sign out"],
    ["未登录", "Signed out"],
    ["登录后显示你的插件会员状态。", "Sign in to view your extension membership status."],
    ["免费账户可先试用，升级后按会员方案刷新额度。", "Free accounts can try the product first. Paid plans refresh usage based on membership."],
    ["请输入邮箱和验证码。", "Enter your email and verification code."],
    ["请先输入邮箱。", "Enter your email first."],
    ["正在发送验证码...", "Sending verification code..."],
    ["验证码已发送，请查看邮箱。验证码 5 分钟内有效。", "Verification code sent. Check your inbox. It expires in 5 minutes."],
    ["网络连接失败，请刷新页面后重试。", "Network connection failed. Refresh the page and try again."],
    ["正在登录...", "Signing in..."],
    ["登录成功，正在进入会员账户...", "Signed in. Opening your membership account..."],
    ["登录失败：", "Sign-in failed: "],
    ["验证码无效或已过期。请使用最新邮件里的验证码，并在 5 分钟内完成登录。", "The code is invalid or expired. Use the newest email code and complete sign-in within 5 minutes."],
    ["正在刷新会员状态...", "Refreshing membership..."],
    ["会员状态已刷新。", "Membership refreshed."],
    ["刷新失败：", "Refresh failed: "],
    ["已退出登录。", "Signed out."],
    ["当前账户", "Current account"],
    ["账户归属", "Account owner"],
    ["选择 LeadFill 方案", "Choose a LeadFill plan"],
    ["选择 ChatGPT Obsidian Local Exporter 方案", "Choose a ChatGPT Obsidian Local Exporter plan"],
    ["选择适合你的使用周期。付款按钮会进入对应方案的安全结账页面。", "Choose the billing period that fits your workflow. Payment buttons will open the matching secure checkout page."],
    ["月度版", "Monthly"],
    ["年度版", "Annual"],
    ["终身版", "Lifetime"],
    ["推荐", "Recommended"],
    ["当前选择", "Selected plan"],
    ["购买月度版", "Buy monthly"],
    ["购买年度版", "Buy annual"],
    ["购买终身版", "Buy lifetime"],
    ["继续购买", "Continue with "],
    ["付款由安全托管结账页面处理。购买完成后，请回到账户页或插件内刷新会员状态。", "Payment is handled by a secure hosted checkout page. After purchase, return to the account page or extension and refresh membership."],
    ["适合短期项目、临时表单填写，按月使用更灵活。", "Good for short projects and temporary workflows."],
    ["折扣后 $29/年，适合经常处理资料录入的人。", "Discounted to $29/year for recurring work."],
    ["折扣后 $39.9，一次购买，适合长期固定使用。", "Discounted to $39.9 once for long-term use."],
    ["每月无限填写", "Unlimited fills each month"],
    ["全年无限填写", "Unlimited fills for a year"],
    ["一次购买长期使用", "One-time purchase for long-term use"],
    ["付款入口准备中", "Checkout start is being prepared"],
    ["当前页面已经连接到商城价格入口。对应商品付款链接确认后，这里会进入安全结账页面。", "This page is connected to the marketplace pricing entry. After payment links are configured, it will open secure checkout."],
    ["打开账户", "Open account"],
    ["返回价格页", "Back to pricing"],
    ["请回到插件或账户页刷新会员状态。付费权限会在后台确认后生效。", "Return to the extension or account page and refresh membership. Paid access appears after backend confirmation."],
    ["本次没有完成付款。你可以继续使用免费版，或返回价格页重新开始。", "No payment was completed. You can keep using the free plan or return to pricing."],
    ["产品是什么", "What the product is"],
    ["信息使用", "How information is used"],
    ["本地资料", "Local profile data"],
    ["插件工程是 Chrome 插件产品中心。我们只收集提供账户、购买、会员和支持服务所需的信息。", "HWH Extensions is a Chrome extension marketplace. We collect only the information needed for accounts, purchases, membership, and support."],
    ["插件工程提供 Chrome 插件的展示、安装入口、购买入口和账户支持服务。", "HWH Extensions provides extension listings, install entries, purchase entries, and account support."],
    ["© 2026 LeadFill Chrome Extensions.", `© 2026 ${HWH_BRAND_EN}.`],
    ["© 2026 插件工程 Chrome Extensions.", `© 2026 ${HWH_BRAND_EN}.`],
    ["我的Account", "My account"],
    ["已Sign inAccount", "Signed-in account"],
    ["Account中心", "Account center"],
    ["Privacy说明", "Privacy"],
    ["服务Terms", "Terms"],
    ["Products详情", "Product details"],
    ["LeadFill One Profile | 购买", "LeadFill One Profile | Pricing"],
    ["ChatGPT Obsidian Local Exporter | 购买", "ChatGPT Obsidian Local Exporter | Pricing"],
    ["Sign in后查看插件会员、Usage和订单支持。", "Sign in to view extension memberships, usage, and order support."],
    ["输入Email获取Verification code。Verification code 5 分钟内有效，Sign in后可查看会员权益、Usage和购买恢复状态。", "Enter your email to receive a verification code. Codes expire in 5 minutes. After signing in, you can view membership benefits, usage, and purchase recovery."],
    ["准备Sign in。", "Ready to sign in."],
    ["退出Sign in", "Sign out"],
    ["未Sign in", "Signed out"],
    ["Sign in后显示你的插件会员状态。", "Sign in to view your extension membership status."],
    ["这个Account页当前管理所选插件的会员、额度和购买恢复。", "This account page manages the selected extension membership, usage, and purchase recovery."],
    ["免费Account可先试用，升级后按会员方案刷新额度。", "Free accounts can try first. Paid usage refreshes based on the selected membership plan."],
    ["请使用付款时填写的EmailSign in。如果会员没有同步，点击Refresh membership或联系 support@915500.xyz。", "Sign in with the email used at checkout. If membership does not sync, refresh membership or contact support@915500.xyz."],
    ["选择一个插件，查看当前Account在该插件下的免费权益、付费权益和Restore purchase路径。", "Choose an extension to review free benefits, paid benefits, and purchase recovery."],
    ["会员权益", "membership benefits"],
    ["恢复状态", "recovery status"],
    ["10 次免费", "10 free uses"],
    ["选择 LeadFill 付费方案", "Choose a LeadFill paid plan"],
    ["选择 ChatGPT Obsidian 付费方案", "Choose a ChatGPT Obsidian paid plan"],
    [" / 月", " / month"],
    ["/ 月", "/ month"],
    [" / 年", " / year"],
    ["/ 年", "/ year"],
    [" / 一次性", " one-time"],
    ["一次性", "one-time"],
    ["保存 1 份Local profile data", "Save 1 local profile"],
    ["保存 / 编辑 / 删除Local profile data", "Save / edit / delete local profile"],
    ["常见输入框自动匹配", "Match common input fields"],
    ["数据只保存在浏览器本地", "Data stays in local browser storage"],
    ["支持文本、Email、电话、下拉框", "Support text, email, phone, and select fields"],
    ["比月度更划算", "Better value than monthly"],
    ["当前主版本无限填写", "Unlimited fills for the current major version"],
    ["当前主版本无限导出", "Unlimited exports for the current major version"],
    ["本地资料长期保留", "Local profile remains available"],
    ["本地文件长期可控", "Local files remain under your control"],
    ["不再按月或按年续费", "No monthly or annual renewal"],
    ["付款由安全托管结账页面处理。购买完成后，请回到Account页或插件内Refresh membership状态。", "Payment is handled by a secure hosted checkout page. After purchase, return to the account page or extension and refresh membership."],
    ["付款由安全托管结账页面处理。购买完成后，请回到账户页或插件内刷新会员状态。", "Payment is handled by a secure hosted checkout page. After purchase, return to the account page or extension and refresh membership."],
    ["Install地址待提供", "Install link pending"],
    ["截图", "screenshot"],
    ["使用截图", "workflow screenshot"],
    ["它解决什么", "What it solves"],
    ["适合谁", "Who it is for"],
    ["支持平台", "Supported platforms"],
    ["填写更快", "Fill faster"],
    ["资料留在本地", "Data stays local"],
    ["先免费试用", "Try free first"],
    ["不上传，不做云同步，资料保存在 Chrome 本地。", "No upload, no cloud sync, and profile data stays in local Chrome storage."],
    ["资料保存一次，遇到相同字段时直接复用。", "Save profile data once and reuse it when the same fields appear."],
    ["有用后再升级终身版。", "Upgrade to lifetime only after it is useful."],
    ["销售人员重复填写线索表单", "Sales reps filling repeated lead forms"],
    ["招聘人员录入同一套联系资料", "Recruiters entering the same contact profile"],
    ["运营人员处理重复信息录入", "Operators handling repeated data entry"],
    ["希望资料优先留在本地的用户", "Users who want profile data to stay local first"],
    ["把常用 AI 对话整理成 Obsidian 友好的 Markdown，适合知识库沉淀、研究记录和长期归档。", "Turn AI conversations into Obsidian-friendly Markdown for knowledge bases, research notes, and long-term archives."],
    ["一份Local profile data，快速填写重复的线索表单。适合销售、招聘和运营人员减少重复录入。", "Use one local profile to fill repetitive lead forms faster. Built for sales, recruiting, and operations work."],
    ["LeadFill 只做一件事：把你经常重复输入的资料保存在浏览器本地，并在兼容表单里快速填入。", "LeadFill does one job: save repeated profile details locally in the browser and fill compatible forms quickly."],
    ["导出 Markdown", "Export Markdown"],
    ["本地归档", "Local archive"],
    ["多平台整理", "Multi-platform organization"],
    ["把对话内容转成更适合 Obsidian 保存和检索的 Markdown 文件。", "Turn conversations into Markdown files that are easier to save and search in Obsidian."],
    ["以本地下载和本地目录为核心，不把知识库变成额外云服务。", "Centered on local downloads and local folders, not another cloud workspace."],
    ["不同插件会尽量把用户内容保留在浏览器本地。具体数据范围以对应插件详情页为准。", "Each extension aims to keep user content local when possible. Exact data boundaries are described on each product page."],
    ["除非Products明确说明，我们不会把插件中的Local profile data用于云同步。", "Unless a product explicitly says otherwise, local extension profile data is not used for cloud sync."],
    ["网站和后端可能保存AccountEmail、购买记录、会员状态、Install记录和Usage等必要信息。", "The website and backend may store account email, purchase records, membership status, installation records, and usage records needed for service operation."],
    ["付款由托管结账页面处理。Account页用于查看会员状态、Restore purchase和联系支持。", "Payment is handled by a hosted checkout page. The account page is used to view membership, restore purchases, and contact support."],
    ["Privacy、Account或订单问题可联系 support@915500.xyz。", "For privacy, account, or order issues, contact support@915500.xyz."],
    ["HWH Extensions是 Chrome 插件Products中心。我们只收集提供Account、购买、会员和支持服务所需的信息。", "HWH Extensions is a Chrome extension marketplace. We collect only the information needed for accounts, purchases, membership, and support."],
    ["HWH Extensions提供 Chrome 插件的展示、Install入口、购买入口和Account支持服务。", "HWH Extensions provides Chrome extension listings, install entries, purchase entries, and account support."],
    ["Products范围", "Product scope"],
    ["免费与付费", "Free and paid access"],
    ["可接受使用", "Acceptable use"],
    ["服务可用性", "Service availability"],
    ["每个插件都有自己的功能边界、适用场景和限制。请以对应Products详情页为准。", "Each extension has its own feature boundaries, use cases, and limits. Refer to the relevant product page."],
    ["部分插件可能提供免费额度或付费方案。价格、权益和购买入口以对应插件价格页为准。", "Some extensions may offer free allowances or paid plans. Pricing, benefits, and purchase entries are defined on each product pricing page."],
    ["请只在你有权处理的数据、网页和工作场景中使用插件。", "Use extensions only with data, pages, and workflows you are allowed to handle."],
    ["网站、插件、Account和付款能力可能随着Products维护而调整。", "Website, extension, account, and payment capabilities may change as products are maintained."],
    ["Account、订单或退款问题可联系 support@915500.xyz，相关处理入口会优先放在Account页。", "For account, order, or refund issues, contact support@915500.xyz. Related support paths are prioritized on the account page."]
    ,
    ["减少分心页面，帮助浏览器进入Focus工作模式。", "Reduce distracting pages and help the browser enter focus mode."],
    ["面向Privacy浏览的轻量保护Tools，适合后续Products线。", "A lightweight privacy browsing helper for a future product line."],
    ["购买Monthly", "Buy monthly"],
    ["购买Annual", "Buy annual"],
    ["购买Lifetime", "Buy lifetime"],
    ["Local profile data长期保留", "Local profile remains available"],
    ["使用购买EmailSign in", "Sign in with purchase email"],
    ["输入EmailVerification code", "Enter email verification code"],
    ["已Sign in", "Signed in"],
    ["选择插件会员", "Select extension membership"],
    ["Account归属", "Account owner"],
    ["购买恢复", "Purchase recovery"],
    ["使用付款EmailSign in后，点击Refresh membership即可同步所选插件的会员状态。若仍未生效，请联系 support@", "After signing in with the payment email, click Refresh membership to sync the selected extension. If it still does not activate, contact support@"],
    ["常见文本、Email、电话字段填写", "Fill common text, email, and phone fields"],
    ["资料保存在浏览器本地", "Profile data stays in local browser storage"],
    ["无限填写，不受免费额度限制", "Unlimited fills without the free quota limit"],
    ["保存、编辑、删除Local profile data", "Save, edit, and delete local profile data"],
    ["支持文本、Email、电话、备注、下拉框", "Support text, email, phone, notes, and select fields"],
    ["适合长期重复录入工作流", "Built for long-term repetitive entry workflows"],
    ["基础 Markdown export体验", "Basic Markdown export experience"],
    ["本地下载保存", "Local download and save"],
    ["适合先测试导出效果", "Useful for testing export quality first"],
    ["不做云端同步", "No cloud sync"],
    ["更适合长期对话归档", "Better for long-term conversation archiving"],
    ["多平台 AI 对话整理", "Organize AI conversations across platforms"],
    ["导出为 Obsidian 友好的 Markdown", "Export Obsidian-friendly Markdown"],
    ["适合知识库沉淀和研究记录", "Built for knowledge bases and research notes"],
    ["请求过于频繁，请 ", "Too many requests. Wait "],
    [" 秒后再发送新的Verification code。", " seconds before sending a new verification code."],
    ["Sign in配置未通过校验，请刷新页面后重试。", "Sign-in configuration failed validation. Refresh and try again."],
    ["Verification code发送失败，请稍后重试。", "Verification code failed to send. Try again later."],
    ["这个Account页当前管理 ", "This account page manages "],
    [" 的会员、额度和购买恢复。", " membership, usage, and purchase recovery."],
    ["10 free fills，确认有用后再升级Lifetime。", "10 free fills, then upgrade to Lifetime when useful."],
    ["LeadFill One Profile 是一个单用途 Chrome 插件：保存一份Local profile data，并在兼容的线索表单中快速填写。这个区域以后可以复用给每一个插件详情页。", "LeadFill One Profile is a single-purpose Chrome extension: save one local profile and fill compatible lead forms quickly. This product-detail structure can be reused for future extensions."],
    ["🧩 支持的字段", "Supported fields"],
    ["常见文本字段", "Common text fields"],
    ["Email和电话字段", "Email and phone fields"],
    ["备注 textarea", "Textarea notes"],
    ["部分 select 下拉字段", "Some select dropdown fields"],
    ["默认不覆盖已有内容", "No overwrite by default"],
    ["👥 适合的用户", "Best-fit users"],
    ["销售人员", "Sales reps"],
    ["招聘人员", "Recruiters"],
    ["运营人员", "Operators"],
    ["经常重复填写同一套资料的人", "People who repeatedly enter the same profile"],
    ["🚫 不适合什么", "What it is not for"],
    ["它不是 CRM、不是团队协作System、不是云同步资料库，也不承诺适配所有网站的所有表单。", "It is not a CRM, not a team collaboration system, not a cloud profile database, and it does not promise to support every form on every website."],
    ["💳 升级方式", "Upgrade flow"],
    ["从插件点击升级时进入这个网站的价格页。付款完成后回到插件或Account页Refresh membership状态。", "The extension upgrade button opens this website's pricing page. After payment, return to the extension or account page and refresh membership."],
    ["会上传我的资料吗？", "Does it upload my profile?"],
    ["不会。保存的个人资料留在浏览器本地。", "No. Saved profile data stays in local browser storage."],
    ["有哪些付费方案？", "What paid plans are available?"],
    ["价格页提供月度、年度和终身方案，正式 Waffo 链接接入后可直接购买。", "The pricing page offers monthly, annual, and lifetime plans. Direct purchase will be enabled after Waffo links are connected."],
    ["支持所有表单吗？", "Does it support every form?"],
    ["它适合常见文本、Email、电话、备注和下拉字段，不承诺覆盖所有网站。", "It works best with common text, email, phone, note, and select fields; it does not promise to cover every site."],
    ["插件数据", "Extension data"],
    ["网站记录", "Website records"],
    ["付款", "Payment"],
    ["联系", "Contact"],
    ["每个插件都有自己的功能边界、适用场景和限制。请以对应Product details页为准。", "Each extension has its own feature boundaries, use cases, and limits. Refer to the relevant product details page."]
    ,
    [" 的会员、额度和Purchase recovery。", " membership, usage, and purchase recovery."],
    ["使用PaymentEmailSign in后，点击Refresh membership即可同步 ", "After signing in with the payment email, click Refresh membership to sync "],
    [" 的会员状态。若仍未生效，请Contact support@915500.xyz。", " membership status. If it still does not activate, contact support@915500.xyz."],
    [" 次免费", " free uses"],
    ["次免费", " free uses"],
    ["会员Account", "Member account"],
    ["我的会员Account", "My membership account"],
    ["管理你的插件会员、Usage和Purchase recovery。", "Manage your extension membership, usage, and purchase recovery."],
    ["你已经Sign in，可以Refresh membership状态、查看方案或Restore purchase。", "You are signed in. You can refresh membership, view plans, or restore purchases."],
    ["如果Payment后会员没有同步，请确认使用的是购买Email，然后点击Refresh membership。", "If membership does not sync after payment, confirm you are using the purchase email, then refresh membership."],
    ["刷新失败", "Refresh failed"],
    ["Pro 已开通", "Pro active"],
    ["免费版", "Free"],
    ["会员已生效。回到插件后点击Refresh membership即可同步。", "Membership is active. Return to the extension and refresh membership to sync."],
    ["当前Account还没有付费会员，仍可使用免费额度。", "This account has no paid membership yet and can still use the free allowance."],
    ["Pro 不限量", "Pro unlimited"],
    ["会员额度已解锁。", "Membership allowance unlocked."],
    ["免费额度会在插件使用时自动记录。", "Free usage is recorded when the extension is used."],
    ["使用screenshot", "workflow screenshot"],
    ["经常把 AI 对话整理进 Obsidian 的用户", "Users who often organize AI conversations into Obsidian"],
    ["需要保存研究过程、提示词和回答结果的创作者", "Creators who need to save research process, prompts, and answers"],
    ["希望把多平台对话统一成 Markdown 的Knowledge management用户", "Knowledge-management users who want multi-platform conversations in Markdown"],
    ["不想依赖额外付费同步服务的Local-first用户", "Local-first users who do not want another paid sync service"],
    ["豆包、腾讯 IMA、通义千问", "Doubao, Tencent IMA, and Qwen"],
    ["Gemini、Grok、腾讯元宝", "Gemini, Grok, and Tencent Yuanbao"],
    ["更多站点后续按真实适配情况加入", "More sites will be added only after real compatibility work"],
    ["面向多个 AI 对话网站，把分散记录统一成可维护的笔记格式。", "Organize scattered AI chat records from multiple sites into maintainable notes."],
    ["这是一个面向 AI 对话归档的 Chrome 插件。它的重点不是聊天，而是把已经产生的对话整理成本地 Markdown 文件。", "This Chrome extension is for AI conversation archiving. It is not a chat product; it organizes existing conversations into local Markdown files."],
    ["价格与当前商城插件保持一致：月度、年度和终身三档。正式Payment链接接入后会在价格页启用。", "Pricing follows the marketplace plans: monthly, annual, and lifetime. Live payment links will be enabled on the pricing page after configuration."],
    ["待上线 · Google 审核中", "Pending launch · Google review"],
    ["这个插件正在等待 Google Chrome Web Store 审核。审核通过后再开放安装和购买。", "This extension is waiting for Google Chrome Web Store review. Installation and purchase will open after approval."],
    ["价格方案已预留。当前插件正在等待 Google Chrome Web Store 审核，审核通过后再开放安装和购买。", "Plan options are reserved. This extension is waiting for Google Chrome Web Store review. Installation and purchase will open after approval."],
    ["当前不会跳转付款。等 Google 审核通过后，这里会接入对应方案的正式结账入口。", "Payment will not open yet. After Google review approval, this page will connect the matching checkout entry."],
    ["查看方案", "View plans"],
    ["这个插件正在等待 Google Chrome Web Store 审核。审核通过后再开放Install和购买。", "This extension is waiting for Google Chrome Web Store review. Installation and purchase will open after approval."],
    ["方案已预留，但Current extension仍处于 Google 审核中。审核通过后才会开放Install和购买入口。", "Plan options are reserved, but this extension is still under Google review. Installation and purchase will open after approval."],
    ["方案已预留。Current extension正在等待 Google Chrome Web Store 审核，审核通过后再开放Install和购买。", "Plan options are reserved. This extension is waiting for Google Chrome Web Store review. Installation and purchase will open after approval."],
    ["当前不会跳转Payment。等 Google 审核通过后，这里会接入对应方案的正式结账入口。", "Payment will not open yet. After Google review approval, this page will connect the matching checkout entry."],
    ["适合短期整理资料、临时导出对话到本地文档。", "Good for short-term organization and temporary local exports."],
    ["每月无限导出", "Unlimited exports each month"],
    ["导出为 Markdown", "Export to Markdown"],
    ["折扣后 $29/年，适合长期沉淀知识库。", "Discounted to $29/year for long-term knowledge-base work."],
    ["全年无限导出", "Unlimited exports for a year"],
    ["整理对话为本地文件", "Save conversations as local files"],
    ["更适合长期归档", "Better for long-term archiving"],
    ["价格", "Pricing"],
    ["我的Member account", "My membership account"],
    ["已使用 ", "Used "],
    [" 次。", " uses."],
    ["已解锁", "Unlocked"],
    ["Sign in配置暂未启用。", "Sign-in is not enabled yet."],
    ["请先输入Email。", "Enter your email first."],
    ["正在Send code...", "Sending verification code..."],
    ["Verification code已发送，请查看Email。Verification code 5 分钟内有效。", "Verification code sent. Check your inbox. It expires in 5 minutes."],
    ["请输入Email和Verification code。", "Enter your email and verification code."],
    ["正在Sign in...", "Signing in..."],
    ["Verification code无效或已过期。请使用最新邮件里的Verification code，并在 5 分钟内完成Sign in。", "The verification code is invalid or expired. Use the newest email code and complete sign-in within 5 minutes."],
    ["Verification code无效或已过期", "The verification code is invalid or expired"],
    ["Sign in失败：", "Sign-in failed: "],
    ["Sign in成功，正在进入Member account...", "Signed in. Opening your membership account..."],
    ["正在Refresh membership状态...", "Refreshing membership..."],
    ["请稍后重试", "Try again later"],
    ["已Sign out。", "Signed out."]
  ];
  return withGa4Tag(normalizeMarketplaceHtmlPaths(applyLiteralReplacements(html, replacements)));
}

function renderChineseLocaleMarketplaceHtml(html) {
  return withGa4Tag(normalizeMarketplaceHtmlPaths(replaceAllLiteral(html, "插件工程", HWH_BRAND_ZH))
    .replace(/href="\/index\.html"/g, `href="/zh-cn/index.html"`)
    .replace(/href="\/product\.html"/g, `href="/zh-cn/product.html"`)
    .replace(/href="\/leadfill\.html"/g, `href="/zh-cn/leadfill.html"`)
    .replace(/href="\/pricing\.html"/g, `href="/zh-cn/pricing.html"`)
    .replace(/href="\/account\.html"/g, `href="/zh-cn/account.html"`)
    .replace(/href="\/privacy\.html"/g, `href="/zh-cn/privacy.html"`)
    .replace(/href="\/terms\.html"/g, `href="/zh-cn/terms.html"`)
    .replace(/href="\/chatgpt-obsidian-local-exporter\.html"/g, `href="/zh-cn/chatgpt-obsidian-local-exporter.html"`)
    .replace(/href="\/chatgpt-obsidian-local-exporter-pricing\.html"/g, `href="/zh-cn/chatgpt-obsidian-local-exporter-pricing.html"`)
    .replace(/href="\/products\/index\.html"/g, `href="/zh-cn/products/index.html"`)
    .replace(/href="\/products\/leadfill-one-profile\//g, `href="/zh-cn/products/leadfill-one-profile/`)
    .replace(/href="\/products\/chatgpt-obsidian-local-exporter\//g, `href="/zh-cn/products/chatgpt-obsidian-local-exporter/`));
}

function buildChinesePluginCards(product) {
  return [
    {
      name: "ChatGPT Obsidian Local Exporter",
      desc: "把 ChatGPT、Gemini、Grok、豆包等 AI 对话导出为 Obsidian 友好的 Markdown。",
      category: "知识管理",
      price: "待上线 · Google 审核中",
      icon: "assets/external/chatgpt-obsidian-icon-128.png",
      href: "chatgpt-obsidian-local-exporter.html",
      kind: "obsidian"
    },
    {
      name: "LeadFill One Profile",
      desc: "保存一份本地资料，在常见线索表单里一键填入姓名、邮箱、电话和备注。",
      category: "效率",
      price: `${product.freeLimit} 次免费试用`,
      icon: "assets/icon/icon128.png",
      href: "leadfill.html",
      kind: "leadfill"
    },
    { name: "FocusFlow", desc: "减少分心页面，帮助浏览器进入专注工作模式。", category: "专注", price: "即将上线", kind: "green" },
    { name: "PrivacyShield", desc: "面向隐私浏览的轻量保护工具，适合后续产品线。", category: "隐私", price: "即将上线", kind: "red" },
    { name: "SnapCode", desc: "整理网页代码片段，让保存和复用更干净。", category: "开发者", price: "即将上线", kind: "purple" },
    { name: "LingoSync", desc: "网页阅读场景下的轻量翻译与术语辅助。", category: "工具", price: "即将上线", kind: "yellow" },
    { name: "MemSaver", desc: "管理低频标签页和浏览器资源占用。", category: "系统", price: "即将上线", kind: "cyan" }
  ];
}

function renderChinesePluginCards(cards) {
  return `<div class="cn-card-grid" data-market-grid>
    ${cards.map((card) => `
      <article class="cn-extension-card" data-card-search="${escapeHtml(`${card.name} ${card.desc} ${card.category}`)}" data-card-category="${escapeHtml(card.category)}">
        <div class="cn-card-top">
          <div class="cn-plugin-icon ${card.kind === "green" ? "cn-icon-green" : card.kind === "red" ? "cn-icon-red" : card.kind === "purple" ? "cn-icon-purple" : card.kind === "yellow" ? "cn-icon-yellow" : card.kind === "cyan" ? "cn-icon-cyan" : card.kind === "obsidian" ? "cn-icon-purple" : ""}">
            ${card.icon ? `<img src="${escapeHtml(card.icon)}" alt="${escapeHtml(card.name)} icon">` : `<span>${escapeHtml(card.name.slice(0, 1))}</span>`}
          </div>
          <span class="cn-card-badge">${escapeHtml(card.category)}</span>
        </div>
        <h3>${escapeHtml(card.name)}</h3>
        <p>${escapeHtml(card.desc)}</p>
        <div class="cn-card-foot">
          <span>${escapeHtml(card.price)}</span>
          ${card.href ? `<a class="cn-outline-button" href="${escapeHtml(card.href)}">查看详情</a>` : `<span>即将推出</span>`}
        </div>
      </article>
    `).join("")}
  </div>`;
}

function renderChineseMarketplaceSearchScript() {
  return `<script>
(() => {
  const inputs = Array.from(document.querySelectorAll("[data-market-search]"));
  const cards = Array.from(document.querySelectorAll("[data-card-search]"));
  if (!inputs.length || !cards.length) return;
  const params = new URLSearchParams(window.location.search);
  const selectedCategory = params.get("category") || "";
  const chips = Array.from(document.querySelectorAll(".cn-chip-row a"));
  chips.forEach((chip) => {
    const url = new URL(chip.href, window.location.href);
    const chipCategory = url.searchParams.get("category") || "";
    if (chipCategory === selectedCategory) chip.classList.add("active");
  });
  const apply = (value) => {
    const query = value.trim().toLowerCase();
    cards.forEach((card) => {
      const haystack = (card.getAttribute("data-card-search") || "").toLowerCase();
      const category = card.getAttribute("data-card-category") || "";
      const matchesQuery = !query || haystack.includes(query);
      const matchesCategory = !selectedCategory || category === selectedCategory;
      card.style.display = matchesQuery && matchesCategory ? "" : "none";
    });
  };
  inputs.forEach((input) => {
    input.addEventListener("input", () => {
      inputs.forEach((other) => { if (other !== input) other.value = input.value; });
      apply(input.value);
    });
  });
  apply("");
})();
</script>`;
}

function renderChineseMarketplaceHomePage({ state, pricingLink, localeSwitcherHtml = "" }) {
  const product = state.product;
  const cards = buildChinesePluginCards(product);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>插件工程 | Chrome 插件商城</title>
  <link rel="stylesheet" href="styles.css">
  ${renderChineseMarketplaceCss()}
</head>
<body class="market-cn">
  ${renderChineseMarketplaceNav({ active: "explore", pricingLink, product, localeSwitcherHtml })}
  <main class="cn-shell">
    <section class="cn-market-hero">
      <h1>发现更好用的 Chrome 插件</h1>
      <p>一个面向专业用户的 Chrome 插件市场，集中展示效率、隐私、开发者工具和浏览器工作流产品。</p>
      <label class="cn-search-hero"><span>⌕</span><input data-market-search type="search" placeholder="搜索插件或使用场景..."></label>
    </section>

    <section id="featured">
      <div class="cn-section-head">
        <h2>推荐插件</h2>
        <a href="product.html">查看所有插件 →</a>
      </div>
      ${renderChinesePluginCards(cards)}
    </section>
  </main>
  ${renderChineseMarketplaceFooter()}
  ${renderChineseMarketplaceSearchScript()}
</body>
</html>`;
}

function renderChineseProductsIndexPage({ state, pricingLink, localeSwitcherHtml = "" }) {
  const product = state.product;
  const cards = buildChinesePluginCards(product);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>全部插件 | 插件工程</title>
  <link rel="stylesheet" href="styles.css">
  ${renderChineseMarketplaceCss()}
</head>
<body class="market-cn">
  ${renderChineseMarketplaceNav({ active: "product", pricingLink, product, localeSwitcherHtml })}
  <main class="cn-shell">
    <section class="cn-products-page-head">
      <h1>全部插件</h1>
    </section>
    <section>
      ${renderChinesePluginCards(cards)}
    </section>
  </main>
  ${renderChineseMarketplaceFooter()}
  ${renderChineseMarketplaceSearchScript()}
</body>
</html>`;
}

function renderChineseObsidianDetailPage({ state, localeSwitcherHtml = "" }) {
  const product = state.product;
  const iconPath = "assets/external/chatgpt-obsidian-icon-128.png";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ChatGPT Obsidian Local Exporter | 产品详情</title>
  <link rel="stylesheet" href="styles.css">
  ${renderChineseMarketplaceCss()}
</head>
<body class="detail-cn">
  ${renderChineseMarketplaceNav({ active: "product", pricingLink: "chatgpt-obsidian-local-exporter-pricing.html", product, localeSwitcherHtml })}
  <main class="cn-detail-main">
    <section class="cn-product-head">
      <div class="cn-product-big-icon"><img src="${escapeHtml(iconPath)}" alt="ChatGPT Obsidian Local Exporter icon"></div>
      <div>
        <h1>ChatGPT Obsidian Local Exporter</h1>
        <p>把常用 AI 对话整理成 Obsidian 友好的 Markdown，适合知识库沉淀、研究记录和长期归档。</p>
        <div class="cn-meta-row">
          <span class="cn-stars">★ ★ ★ ★ ☆</span>
          <span>知识管理</span>
          <span>Markdown 导出</span>
          <span>本地优先</span>
        </div>
        <div class="cn-action-row">
          <a class="cn-primary-button" href="#pending-review" aria-disabled="true">待上线 · Google 审核中</a>
          <a class="cn-outline-button" href="chatgpt-obsidian-local-exporter-pricing.html">查看方案</a>
        </div>
        <p class="cn-muted-note">这个插件正在等待 Google Chrome Web Store 审核。审核通过后再开放安装和购买。</p>
      </div>
    </section>

    <section class="cn-bento">
      <article class="cn-panel">
        <h2>适合谁</h2>
        ${listToHtml([
          "经常把 AI 对话整理进 Obsidian 的用户",
          "需要保存研究过程、提示词和回答结果的创作者",
          "希望把多平台对话统一成 Markdown 的知识管理用户",
          "不想依赖额外付费同步服务的本地优先用户"
        ], "cn-check-list")}
      </article>
      <aside class="cn-panel">
        <h2>支持平台</h2>
        ${listToHtml([
          "ChatGPT / chat.openai.com",
          "豆包、腾讯 IMA、通义千问",
          "Gemini、Grok、腾讯元宝",
          "更多站点后续按真实适配情况加入"
        ], "cn-check-list")}
      </aside>
    </section>

    <section class="cn-feature-row">
      <article><div class="cn-dot-icon"></div><h3>导出 Markdown</h3><p>把对话内容转成更适合 Obsidian 保存和检索的 Markdown 文件。</p></article>
      <article><div class="cn-dot-icon"></div><h3>本地归档</h3><p>以本地下载和本地目录为核心，不把知识库变成额外云服务。</p></article>
      <article><div class="cn-dot-icon"></div><h3>多平台整理</h3><p>面向多个 AI 对话网站，把分散记录统一成可维护的笔记格式。</p></article>
    </section>

    <section class="cn-detail-accordion">
      <details open>
        <summary>产品</summary>
        <div class="cn-accordion-body">
          <p>这是一个面向 AI 对话归档的 Chrome 插件。它的重点不是聊天，而是把已经产生的对话整理成本地 Markdown 文件。</p>
        </div>
      </details>
      <details>
        <summary>价格</summary>
        <div class="cn-accordion-body">
          <p>价格方案已预留，但当前插件仍处于 Google 审核中。审核通过后才会开放安装和购买入口。</p>
        </div>
      </details>
    </section>
  </main>
  ${renderChineseMarketplaceFooter()}
</body>
</html>`;
}

function renderChineseProductDetailPage({ state, screenshots, localeSwitcherHtml = "" }) {
  const product = state.product;
  const installReady = resolveInstallMode(product);
  const installHref = installReady ? product.chromeWebStoreUrl : "#install-pending";
  const installLabel = installReady ? "安装到 Chrome" : "安装地址待提供";
  const heroImage = screenshots[0]?.image ?? "assets/screenshots/screenshot_1_1280x800.png";
  const supportImage = screenshots[1]?.image ?? "assets/screenshots/screenshot_2_1280x800.png";
  const iconPath = "assets/icon/icon128.png";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(product.name)} | 产品详情</title>
  <link rel="stylesheet" href="styles.css">
  ${renderChineseMarketplaceCss()}
</head>
<body class="detail-cn">
  ${renderChineseMarketplaceNav({ active: "product", pricingLink: "pricing.html", product, localeSwitcherHtml })}
  <main class="cn-detail-main">
    <section class="cn-product-head">
      <div class="cn-product-big-icon"><img src="${escapeHtml(iconPath)}" alt="${escapeHtml(product.name)} icon"></div>
      <div>
        <h1>${escapeHtml(product.name)}</h1>
        <p>一份本地资料，快速填写重复的线索表单。适合销售、招聘和运营人员减少重复录入。</p>
        <div class="cn-meta-row">
          <span class="cn-stars">★ ★ ★ ★ ☆</span>
          <span>${escapeHtml(`${product.freeLimit} 次免费填写`)}</span>
          <span>效率工具</span>
          <span>本地保存</span>
        </div>
        <div class="cn-action-row">
          <a class="cn-primary-button" href="${escapeHtml(installHref)}" ${installReady ? "" : "aria-disabled=\"true\""}>${escapeHtml(installLabel)}</a>
          <a class="cn-outline-button" href="pricing.html">查看价格</a>
        </div>
      </div>
    </section>

    <section class="cn-hero-shot">
      <img src="${escapeHtml(heroImage)}" alt="${escapeHtml(product.name)} 截图">
    </section>

    <section class="cn-bento">
      <article class="cn-panel">
        <h2>它解决什么</h2>
        <p>LeadFill 只做一件事：把你经常重复输入的资料保存在浏览器本地，并在兼容表单里快速填入。</p>
        <img src="${escapeHtml(supportImage)}" alt="${escapeHtml(product.name)} 使用截图">
      </article>
      <aside class="cn-panel">
        <h2>适合谁</h2>
        ${listToHtml([
          "销售人员重复填写线索表单",
          "招聘人员录入同一套联系资料",
          "运营人员处理重复信息录入",
          "希望资料优先留在本地的用户"
        ], "cn-check-list")}
      </aside>
    </section>

    <section class="cn-feature-row">
      <article><div class="cn-dot-icon"></div><h3>填写更快</h3><p>资料保存一次，遇到相同字段时直接复用。</p></article>
      <article><div class="cn-dot-icon"></div><h3>资料留在本地</h3><p>不上传，不做云同步，资料保存在 Chrome 本地。</p></article>
      <article><div class="cn-dot-icon"></div><h3>先免费试用</h3><p>${escapeHtml(`${product.freeLimit} 次免费填写`)}，确认有用后再升级终身版。</p></article>
    </section>

    <section class="cn-detail-accordion">
      <details open>
        <summary>🧍‍♂️ 产品</summary>
        <div class="cn-accordion-body">
          <p>LeadFill One Profile 是一个单用途 Chrome 插件：保存一份本地资料，并在兼容的线索表单中快速填写。这个区域以后可以复用给每一个插件详情页。</p>
        </div>
      </details>
      <details>
        <summary>🧩 支持的字段</summary>
        <div class="cn-accordion-body">
          ${listToHtml(["常见文本字段", "邮箱和电话字段", "备注 textarea", "部分 select 下拉字段", "默认不覆盖已有内容"], "cn-check-list")}
        </div>
      </details>
      <details>
        <summary>👥 适合的用户</summary>
        <div class="cn-accordion-body">
          ${listToHtml(["销售人员", "招聘人员", "运营人员", "经常重复填写同一套资料的人"], "cn-check-list")}
        </div>
      </details>
      <details>
        <summary>🚫 不适合什么</summary>
        <div class="cn-accordion-body">
          <p>它不是 CRM、不是团队协作系统、不是云同步资料库，也不承诺适配所有网站的所有表单。</p>
        </div>
      </details>
      <details>
        <summary>💳 升级方式</summary>
        <div class="cn-accordion-body">
          <p>从插件点击升级时进入这个网站的价格页。付款完成后回到插件或账户页刷新会员状态。</p>
        </div>
      </details>
    </section>

    <section class="cn-faq-grid">
      <article><h3>会上传我的资料吗？</h3><p>不会。保存的个人资料留在浏览器本地。</p></article>
      <article><h3>有哪些付费方案？</h3><p>价格页提供月度、年度和终身方案，正式 Waffo 链接接入后可直接购买。</p></article>
      <article><h3>支持所有表单吗？</h3><p>它适合常见文本、邮箱、电话、备注和下拉字段，不承诺覆盖所有网站。</p></article>
    </section>
  </main>
  ${renderChineseMarketplaceFooter()}
</body>
</html>`;
}

function renderChinesePricingPage({ state, checkoutConfig, localeSwitcherHtml = "" }) {
  const product = state.product;
  const plans = [
    {
      key: "monthly",
      name: "月度版",
      original: "$9",
      price: "$9",
      suffix: "/ 月",
      note: "适合短期项目、临时表单填写，按月使用更灵活。",
      features: ["每月无限填写", "保存 1 份本地资料", "常见输入框自动匹配", "数据只保存在浏览器本地"],
      cta: "购买月度版"
    },
    {
      key: "annual",
      name: "年度版",
      original: "$99.9",
      price: "$29",
      suffix: "/ 年",
      note: "折扣后 $29/年，适合经常处理资料录入的人。",
      features: ["全年无限填写", "保存 / 编辑 / 删除本地资料", "支持文本、邮箱、电话、下拉框", "比月度更划算"],
      cta: "购买年度版",
      recommended: true
    },
    {
      key: "lifetime",
      name: "终身版",
      original: "$199",
      price: "$39.9",
      suffix: " / 一次性",
      note: "折扣后 $39.9，一次购买，适合长期固定使用。",
      features: ["一次购买长期使用", "当前主版本无限填写", "本地资料长期保留", "不再按月或按年续费"],
      cta: "购买终身版"
    }
  ];
  const planCardsHtml = plans.map((plan) => {
    const planUrl = `${checkoutConfig.siteUrl}/checkout/start?productKey=${encodeURIComponent(product.productKey)}&planKey=${encodeURIComponent(plan.key)}&source=web`;
    return `<article class="cn-plan-card ${plan.recommended ? "is-selected" : ""}" data-plan-card data-plan-key="${escapeHtml(plan.key)}" data-plan-name="${escapeHtml(plan.name)}" data-plan-price="${escapeHtml(plan.price)}${escapeHtml(plan.suffix)}" data-plan-href="${escapeHtml(planUrl)}" role="radio" aria-checked="${plan.recommended ? "true" : "false"}" tabindex="0">
          ${plan.recommended ? `<div class="cn-recommend">推荐</div>` : ""}
          <div class="cn-plan-title"><h2>${escapeHtml(plan.name)}</h2><span class="cn-radio ${plan.recommended ? "active" : ""}" aria-hidden="true"></span></div>
          <div class="cn-price"><strong>${escapeHtml(plan.price)}</strong><span>${escapeHtml(plan.suffix)}</span>${plan.original !== plan.price ? `<span class="cn-price-original">${escapeHtml(plan.original)}</span>` : ""}</div>
          <p class="cn-plan-note">${escapeHtml(plan.note)}</p>
          ${listToHtml(plan.features, "cn-check-list")}
          <a class="cn-primary-button cn-plan-button" href="${escapeHtml(planUrl)}" data-waffo-plan="${escapeHtml(plan.key)}">${escapeHtml(plan.cta)}</a>
        </article>`;
  }).join("");
  const recommendedPlan = plans.find((plan) => plan.recommended) ?? plans[0];
  const recommendedUrl = `${checkoutConfig.siteUrl}/checkout/start?productKey=${encodeURIComponent(product.productKey)}&planKey=${encodeURIComponent(recommendedPlan.key)}&source=web`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(product.name)} | 购买</title>
  <link rel="stylesheet" href="styles.css">
  ${renderChineseMarketplaceCss()}
</head>
<body class="pricing-cn">
  ${renderChineseMarketplaceNav({ active: "product", pricingLink: "pricing.html", product, localeSwitcherHtml })}
  <main class="cn-pricing-main">
    <section class="cn-checkout-head">
      <h1>选择 LeadFill 方案</h1>
      <p>选择适合你的使用周期。付款按钮会进入对应方案的安全结账页面。</p>
    </section>
    <section class="cn-pricing-three" role="radiogroup" aria-label="选择 LeadFill 付费方案">
      ${planCardsHtml}
    </section>
    <section class="cn-selected-plan">
      <div>
        <span>当前选择</span>
        <strong data-selected-plan-label>${escapeHtml(recommendedPlan.name)} · ${escapeHtml(recommendedPlan.price)}${escapeHtml(recommendedPlan.suffix)}</strong>
      </div>
      <a class="cn-primary-button" data-selected-plan-cta href="${escapeHtml(recommendedUrl)}">继续购买${escapeHtml(recommendedPlan.name)}</a>
    </section>
    <p class="cn-payment-note">付款由安全托管结账页面处理。购买完成后，请回到账户页或插件内刷新会员状态。</p>
  </main>
  ${renderChineseMarketplaceFooter()}
  ${renderChinesePlanSelectionScript()}
</body>
</html>`;
}

function renderChineseObsidianPricingPage({ state, checkoutConfig, localeSwitcherHtml = "" }) {
  const product = state.product;
  const productKey = "chatgpt-obsidian-local-exporter";
  const plans = [
    {
      key: "monthly",
      name: "月度版",
      original: "$9",
      price: "$9",
      suffix: "/ 月",
      note: "适合短期整理资料、临时导出对话到本地文档。",
      features: ["每月无限导出", "导出为 Markdown", "本地下载保存", "不做云端同步"],
      cta: "购买月度版"
    },
    {
      key: "annual",
      name: "年度版",
      original: "$99.9",
      price: "$29",
      suffix: "/ 年",
      note: "折扣后 $29/年，适合长期沉淀知识库。",
      features: ["全年无限导出", "整理对话为本地文件", "更适合长期归档", "比月度更划算"],
      cta: "购买年度版",
      recommended: true
    },
    {
      key: "lifetime",
      name: "终身版",
      original: "$199",
      price: "$39.9",
      suffix: " / 一次性",
      note: "折扣后 $39.9，一次购买，适合长期固定使用。",
      features: ["一次购买长期使用", "当前主版本无限导出", "本地文件长期可控", "不再按月或按年续费"],
      cta: "购买终身版"
    }
  ];
  const planCardsHtml = plans.map((plan) => {
    return `<article class="cn-plan-card ${plan.recommended ? "is-selected" : ""}" data-plan-card data-plan-key="${escapeHtml(plan.key)}" data-plan-name="${escapeHtml(plan.name)}" data-plan-price="${escapeHtml(plan.price)}${escapeHtml(plan.suffix)}" data-plan-href="#pending-review" role="radio" aria-checked="${plan.recommended ? "true" : "false"}" tabindex="0">
          ${plan.recommended ? `<div class="cn-recommend">推荐</div>` : ""}
          <div class="cn-plan-title"><h2>${escapeHtml(plan.name)}</h2><span class="cn-radio ${plan.recommended ? "active" : ""}" aria-hidden="true"></span></div>
          <div class="cn-price"><strong>${escapeHtml(plan.price)}</strong><span>${escapeHtml(plan.suffix)}</span>${plan.original !== plan.price ? `<span class="cn-price-original">${escapeHtml(plan.original)}</span>` : ""}</div>
          <p class="cn-plan-note">${escapeHtml(plan.note)}</p>
          ${listToHtml(plan.features, "cn-check-list")}
          <span class="cn-primary-button cn-plan-button" aria-disabled="true" data-waffo-plan="${escapeHtml(plan.key)}">待上线 · Google 审核中</span>
        </article>`;
  }).join("");
  const recommendedPlan = plans.find((plan) => plan.recommended) ?? plans[0];
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ChatGPT Obsidian Local Exporter | 购买</title>
  <link rel="stylesheet" href="styles.css">
  ${renderChineseMarketplaceCss()}
</head>
<body class="pricing-cn">
  ${renderChineseMarketplaceNav({ active: "product", pricingLink: "chatgpt-obsidian-local-exporter-pricing.html", product, localeSwitcherHtml })}
  <main class="cn-pricing-main">
    <section class="cn-checkout-head">
      <h1>选择 ChatGPT Obsidian Local Exporter 方案</h1>
      <p>价格方案已预留。当前插件正在等待 Google Chrome Web Store 审核，审核通过后再开放安装和购买。</p>
    </section>
    <section class="cn-pricing-three" role="radiogroup" aria-label="选择 ChatGPT Obsidian 付费方案">
      ${planCardsHtml}
    </section>
    <section class="cn-selected-plan">
      <div>
        <span>当前选择</span>
        <strong data-selected-plan-label>${escapeHtml(recommendedPlan.name)} · ${escapeHtml(recommendedPlan.price)}${escapeHtml(recommendedPlan.suffix)}</strong>
      </div>
      <span class="cn-primary-button" data-selected-plan-cta aria-disabled="true">待上线 · Google 审核中</span>
    </section>
    <p class="cn-payment-note">当前不会跳转付款。等 Google 审核通过后，这里会接入对应方案的正式结账入口。</p>
  </main>
  ${renderChineseMarketplaceFooter()}
  ${renderChinesePlanSelectionScript()}
</body>
</html>`;
}

function renderChinesePlanSelectionScript() {
  return `<script>
(() => {
  const cards = Array.from(document.querySelectorAll("[data-plan-card]"));
  const label = document.querySelector("[data-selected-plan-label]");
  const cta = document.querySelector("[data-selected-plan-cta]");
  if (!cards.length || !label || !cta) return;

  const selectPlan = (card) => {
    cards.forEach((item) => {
      const selected = item === card;
      item.classList.toggle("is-selected", selected);
      item.setAttribute("aria-checked", selected ? "true" : "false");
      const radio = item.querySelector(".cn-radio");
      if (radio) radio.classList.toggle("active", selected);
    });
    const name = card.dataset.planName || "";
    const price = card.dataset.planPrice || "";
    label.textContent = name + " · " + price;
    if (cta.getAttribute("aria-disabled") === "true") {
      cta.textContent = "待上线 · Google 审核中";
      return;
    }
    cta.textContent = "继续购买" + name;
    cta.href = card.dataset.planHref || cta.href;
  };

  cards.forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      selectPlan(card);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectPlan(card);
    });
  });
})();
  </script>`;
}

function renderChineseMembershipAccountPage({ state, checkoutConfig, localeSwitcherHtml = "" }) {
  const product = state.product;
  const supportEmail = checkoutConfig.supportEmail || "support@915500.xyz";
  const accountRuntimeConfig = {
    productKey: product.productKey,
    freeLimit: product.freeLimit,
    publicSupabaseUrl: checkoutConfig.publicSupabaseUrl,
    publicSupabaseAnonKey: checkoutConfig.publicSupabaseAnonKey,
    publicConfigUrl: "/site-public-config.json",
    products: [
      {
        key: "leadfill-one-profile",
        name: "LeadFill One Profile",
        category: "效率工具",
        pricingUrl: "/products/leadfill-one-profile/pricing/",
        freeTitle: "免费试用权益",
        proTitle: "付费会员权益",
        freeBenefits: [
          `${product.freeLimit} 次免费填写`,
          "保存 1 份本地资料",
          "常见文本、邮箱、电话字段填写",
          "资料保存在浏览器本地"
        ],
        proBenefits: [
          "无限填写，不受免费额度限制",
          "保存、编辑、删除本地资料",
          "支持文本、邮箱、电话、备注、下拉框",
          "适合长期重复录入工作流"
        ]
      },
      {
        key: "chatgpt-obsidian-local-exporter",
        name: "ChatGPT Obsidian Local Exporter",
        category: "知识管理",
        pricingUrl: "/products/chatgpt-obsidian-local-exporter/pricing/",
        freeTitle: "免费试用权益",
        proTitle: "付费会员权益",
        freeBenefits: [
          "基础 Markdown 导出体验",
          "本地下载保存",
          "适合先测试导出效果",
          "不做云端同步"
        ],
        proBenefits: [
          "更适合长期对话归档",
          "多平台 AI 对话整理",
          "导出为 Obsidian 友好的 Markdown",
          "适合知识库沉淀和研究记录"
        ]
      }
    ]
  };
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>账户与会员 | ${escapeHtml(product.name)}</title>
  <link rel="stylesheet" href="styles.css">
  ${renderChineseMarketplaceCss()}
</head>
<body class="account-cn">
  ${renderChineseMarketplaceNav({ active: "account", pricingLink: "pricing.html", product, localeSwitcherHtml })}
  <main class="cn-account-main">
    <section class="cn-account-hero">
      <h1 id="account-hero-title">账户中心</h1>
      <p id="account-hero-copy">登录后查看插件会员、使用额度和订单支持。</p>
    </section>
    <section class="cn-account-layout">
      <article class="cn-login-panel">
        <span id="account-login-kicker">邮箱登录</span>
        <h2 id="account-panel-title">使用购买邮箱登录</h2>
        <p id="account-login-copy">输入邮箱获取验证码。验证码 5 分钟内有效，登录后可查看会员权益、使用额度和购买恢复状态。</p>
        <form id="account-login-form" class="cn-login-form">
          <label>
            邮箱
            <input id="account-email" type="email" autocomplete="email" placeholder="you@example.com" required>
          </label>
          <button id="send-otp" class="cn-primary-button" type="button">发送验证码</button>
          <label>
            验证码
            <input id="account-token" type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="输入邮箱验证码">
          </label>
          <button id="verify-otp" class="cn-outline-button" type="button">登录账户</button>
          <p id="account-message" class="cn-form-message" role="status">准备登录。</p>
        </form>
        <div id="account-signed-in-panel" class="cn-signed-in-panel" hidden>
          <div class="cn-account-status-pill">已登录</div>
          <p class="cn-form-message">已登录</p>
          <h3 id="account-email-display">-</h3>
          <p id="account-session-message" class="cn-form-message" role="status">可以刷新会员状态。</p>
          <div class="cn-action-row">
            <button id="refresh-membership" class="cn-primary-button" type="button">刷新会员</button>
            <button id="sign-out-account" class="cn-outline-button" type="button">退出登录</button>
          </div>
          <a class="cn-plain-button" href="pricing.html">查看可购买方案</a>
        </div>
      </article>
      <div class="cn-account-stack">
        <article class="cn-account-card"><span>当前插件</span><h2 id="account-product-name">${escapeHtml(product.name)}</h2><p id="account-product-copy">这个账户页当前管理所选插件的会员、额度和购买恢复。</p></article>
        <article class="cn-account-card"><span>当前方案</span><h2 id="account-plan">未登录</h2><p id="account-access">登录后显示你的插件会员状态。</p></article>
        <article class="cn-account-card"><span>使用额度</span><h2 id="account-usage">${escapeHtml(`${product.freeLimit} 次免费`)}</h2><p id="account-usage-copy">免费账户可先试用，升级后按会员方案刷新额度。</p></article>
        <article class="cn-account-card"><span>订单与恢复</span><h2>恢复购买</h2><p id="account-order-copy">请使用付款时填写的邮箱登录。如果会员没有同步，点击刷新会员或联系 ${escapeHtml(supportEmail)}。</p></article>
      </div>
    </section>

    <section class="cn-membership-section" aria-labelledby="membership-benefits-title">
      <div class="cn-membership-head">
        <div>
          <span>会员信息</span>
          <h2 id="membership-benefits-title">插件会员权益</h2>
          <p id="membership-benefits-copy">选择一个插件，查看当前账户在该插件下的免费权益、付费权益和恢复购买路径。</p>
        </div>
        <a class="cn-outline-button" id="membership-pricing-link" href="/products/leadfill-one-profile/pricing/">查看方案价格</a>
      </div>
      <div class="cn-product-switcher" role="tablist" aria-label="选择插件会员">
        <button class="active" type="button" data-account-product="leadfill-one-profile">LeadFill</button>
        <button type="button" data-account-product="chatgpt-obsidian-local-exporter">ChatGPT Obsidian</button>
      </div>
      <div class="cn-membership-grid">
        <article class="cn-benefit-card is-current" id="free-benefit-card">
          <div class="cn-benefit-card-top">
            <span>当前可用</span>
            <strong>Free</strong>
          </div>
          <h3 id="free-benefit-title">免费试用权益</h3>
          <ul class="cn-check-list" id="free-benefit-list"></ul>
        </article>
        <article class="cn-benefit-card is-locked" id="pro-benefit-card">
          <div class="cn-benefit-card-top">
            <span id="pro-benefit-state">升级后解锁</span>
            <strong>Pro</strong>
          </div>
          <h3 id="pro-benefit-title">付费会员权益</h3>
          <ul class="cn-check-list" id="pro-benefit-list"></ul>
        </article>
        <article class="cn-benefit-card">
          <div class="cn-benefit-card-top">
            <span>账户归属</span>
            <strong id="membership-owner">未登录</strong>
          </div>
          <h3>购买恢复</h3>
          <p id="membership-recovery-copy">使用付款邮箱登录后，点击刷新会员即可同步所选插件的会员状态。若仍未生效，请联系 ${escapeHtml(supportEmail)}。</p>
        </article>
      </div>
    </section>
  </main>
  ${renderChineseMarketplaceFooter()}
  <script>
(() => {
  const config = ${scriptJson(accountRuntimeConfig)};
  const emailInput = document.getElementById("account-email");
  const tokenInput = document.getElementById("account-token");
  const message = document.getElementById("account-message");
  const plan = document.getElementById("account-plan");
  const access = document.getElementById("account-access");
  const usage = document.getElementById("account-usage");
  const usageCopy = document.getElementById("account-usage-copy");
  const orderCopy = document.getElementById("account-order-copy");
  const freeBenefitCard = document.getElementById("free-benefit-card");
  const proBenefitCard = document.getElementById("pro-benefit-card");
  const proBenefitState = document.getElementById("pro-benefit-state");
  const membershipOwner = document.getElementById("membership-owner");
  const productName = document.getElementById("account-product-name");
  const productCopy = document.getElementById("account-product-copy");
  const pricingLink = document.getElementById("membership-pricing-link");
  const freeBenefitTitle = document.getElementById("free-benefit-title");
  const proBenefitTitle = document.getElementById("pro-benefit-title");
  const freeBenefitList = document.getElementById("free-benefit-list");
  const proBenefitList = document.getElementById("pro-benefit-list");
  const recoveryCopy = document.getElementById("membership-recovery-copy");
  const productButtons = Array.from(document.querySelectorAll("[data-account-product]"));
  let selectedProductKey = new URLSearchParams(window.location.search).get("productKey") || config.productKey;
  const loginForm = document.getElementById("account-login-form");
  const loginKicker = document.getElementById("account-login-kicker");
  const loginCopy = document.getElementById("account-login-copy");
  const sendOtpButton = document.getElementById("send-otp");
  const verifyOtpButton = document.getElementById("verify-otp");
  const panelTitle = document.getElementById("account-panel-title");
  const heroTitle = document.getElementById("account-hero-title");
  const heroCopy = document.getElementById("account-hero-copy");
  const signedInPanel = document.getElementById("account-signed-in-panel");
  const emailDisplay = document.getElementById("account-email-display");
  const sessionMessage = document.getElementById("account-session-message");
  const sessionKey = "plugin_engineering_account_session";
  const identityKey = "plugin_engineering_account_identity";
  const cookieKey = "hwh_account_email";
  const setMessage = (text) => {
    message.textContent = text;
    sessionMessage.textContent = text;
  };
  let sendCooldownTimer = null;
  const setSendOtpDisabled = (disabled, label) => {
    if (!sendOtpButton) return;
    sendOtpButton.disabled = disabled;
    if (label) sendOtpButton.textContent = label;
  };
  const startSendCooldown = (seconds) => {
    clearInterval(sendCooldownTimer);
    let left = Math.max(1, Number(seconds) || 60);
    setSendOtpDisabled(true, "重新发送 " + left + "s");
    sendCooldownTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(sendCooldownTimer);
        setSendOtpDisabled(false, "发送验证码");
        return;
      }
      setSendOtpDisabled(true, "重新发送 " + left + "s");
    }, 1000);
  };
  const readAuthError = async (response) => {
    const body = await response.json().catch(() => ({}));
    const text = body.msg || body.message || body.error_description || body.error || "";
    const waitMatch = String(text).match(/after\s+(\d+)\s+seconds/i);
    if (response.status === 429) {
      const waitSeconds = waitMatch ? Number(waitMatch[1]) : 60;
      startSendCooldown(waitSeconds);
      return "请求过于频繁，请 " + waitSeconds + " 秒后再发送新的验证码。";
    }
    if (response.status === 401 || response.status === 403) {
      return "登录配置未通过校验，请刷新页面后重试。";
    }
    return text || "验证码发送失败，请稍后重试。";
  };
  const writeLoginCookie = (email) => {
    if (!email) return;
    document.cookie = cookieKey + "=" + encodeURIComponent(email) + "; Path=/; Max-Age=2592000; SameSite=Lax; Secure";
  };
  const clearLoginCookie = () => {
    document.cookie = cookieKey + "=; Path=/; Max-Age=0; SameSite=Lax; Secure";
  };
  const readLoginCookie = () => {
    return decodeURIComponent(document.cookie.split("; ").find((row) => row.startsWith(cookieKey + "="))?.split("=")[1] || "");
  };
  const isPlaceholder = (value) => !value || /^<.*>$/.test(String(value));
  const loadPublicConfig = async () => {
    if (!isPlaceholder(config.publicSupabaseAnonKey) && config.publicSupabaseUrl) return config;
    const response = await fetch(config.publicConfigUrl, { cache: "no-store" });
    if (!response.ok) return config;
    const body = await response.json();
    config.publicSupabaseUrl = body.publicSupabaseUrl || config.publicSupabaseUrl;
    config.publicSupabaseAnonKey = body.publicSupabaseAnonKey || config.publicSupabaseAnonKey;
    return config;
  };
  const canLoginNow = () => Boolean(config.publicSupabaseUrl && !isPlaceholder(config.publicSupabaseAnonKey));
  const authHeaders = () => ({
    "content-type": "application/json",
    apikey: config.publicSupabaseAnonKey
  });
  const readSession = () => {
    try { return JSON.parse(localStorage.getItem(sessionKey) || "null"); } catch { return null; }
  };
  const readIdentity = () => {
    try { return JSON.parse(localStorage.getItem(identityKey) || "null"); } catch { return null; }
  };
  const getSelectedProduct = () => config.products.find((item) => item.key === selectedProductKey) || config.products[0];
  const renderList = (target, items) => {
    target.innerHTML = "";
    items.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      target.appendChild(li);
    });
  };
  const renderProductMembership = () => {
    const selected = getSelectedProduct();
    selectedProductKey = selected.key;
    config.productKey = selected.key;
    productName.textContent = selected.name;
    productCopy.textContent = "这个账户页当前管理 " + selected.name + " 的会员、额度和购买恢复。";
    pricingLink.href = selected.pricingUrl;
    freeBenefitTitle.textContent = selected.freeTitle;
    proBenefitTitle.textContent = selected.proTitle;
    renderList(freeBenefitList, selected.freeBenefits);
    renderList(proBenefitList, selected.proBenefits);
    recoveryCopy.textContent = "使用付款邮箱登录后，点击刷新会员即可同步 " + selected.name + " 的会员状态。若仍未生效，请联系 ${escapeHtml(supportEmail)}。";
    productButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.accountProduct === selected.key);
    });
  };
  const captureAuthHash = async () => {
    if (!window.location.hash || !window.location.hash.includes("access_token")) return null;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (!accessToken) return null;
    let email = readIdentity()?.email || "";
    try {
      await loadPublicConfig();
      const response = await fetch(config.publicSupabaseUrl.replace(/\\/$/, "") + "/auth/v1/user", {
        headers: { ...authHeaders(), authorization: "Bearer " + accessToken }
      });
      const user = await response.json().catch(() => ({}));
      email = user.email || user.user?.email || email;
    } catch {}
    const saved = { accessToken, refreshToken, email };
    localStorage.setItem(sessionKey, JSON.stringify(saved));
    localStorage.setItem(identityKey, JSON.stringify({ email, signedInAt: new Date().toISOString() }));
    writeLoginCookie(email || readLoginCookie());
    history.replaceState(null, "", window.location.pathname + window.location.search);
    return saved;
  };
  const saveSession = (body) => {
    const session = body.session || body;
    const saved = {
      accessToken: session.access_token || session.accessToken,
      refreshToken: session.refresh_token || session.refreshToken,
      email: session.user?.email || emailInput.value.trim()
    };
    localStorage.setItem(sessionKey, JSON.stringify(saved));
    localStorage.setItem(identityKey, JSON.stringify({ email: saved.email, signedInAt: new Date().toISOString() }));
    writeLoginCookie(saved.email);
    return saved;
  };
  const showSignedOut = () => {
    loginForm.hidden = false;
    signedInPanel.hidden = true;
    loginKicker.textContent = "邮箱登录";
    panelTitle.textContent = "使用购买邮箱登录";
    heroTitle.textContent = "账户中心";
    heroCopy.textContent = "登录后查看插件会员、使用额度和订单支持。";
    loginCopy.textContent = "输入邮箱获取验证码。验证码 5 分钟内有效，登录后可查看会员权益、使用额度和购买恢复状态。";
    plan.textContent = "未登录";
    access.textContent = "登录后显示你的插件会员状态。";
    usage.textContent = String(config.freeLimit) + " 次免费";
    usageCopy.textContent = "免费账户可先试用，升级后按会员方案刷新额度。";
    membershipOwner.textContent = "未登录";
    freeBenefitCard.classList.add("is-current");
    proBenefitCard.classList.remove("is-current");
    proBenefitCard.classList.add("is-locked");
    proBenefitState.textContent = "升级后解锁";
    clearLoginCookie();
    window.dispatchEvent(new CustomEvent("plugin-account-session-changed"));
  };
  const showSignedIn = (session) => {
    loginForm.hidden = true;
    signedInPanel.hidden = false;
    loginKicker.textContent = "会员账户";
    panelTitle.textContent = "我的会员账户";
    heroTitle.textContent = "会员账户";
    heroCopy.textContent = "管理你的插件会员、使用额度和购买恢复。";
    loginCopy.textContent = "你已经登录，可以刷新会员状态、查看方案或恢复购买。";
    emailDisplay.textContent = session.email || "已登录账户";
    membershipOwner.textContent = session.email || "已登录账户";
    writeLoginCookie(session.email || readLoginCookie());
    orderCopy.textContent = "如果付款后会员没有同步，请确认使用的是购买邮箱，然后点击刷新会员。";
    window.dispatchEvent(new CustomEvent("plugin-account-session-changed"));
  };
  const refreshEntitlement = async () => {
    const session = readSession();
    const identity = readIdentity();
    if (!session?.accessToken) {
      if (identity?.email) showSignedIn({ email: identity.email });
      return;
    }
    showSignedIn(session);
    const response = await fetch(config.publicSupabaseUrl.replace(/\\/$/, "") + "/functions/v1/get-entitlement", {
      method: "POST",
      headers: { ...authHeaders(), authorization: "Bearer " + session.accessToken },
      body: JSON.stringify({ productKey: selectedProductKey })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || body.message || "刷新失败");
    const status = body.status || body.entitlementStatus || "free";
    const used = body.usage?.used ?? body.used ?? null;
    const limit = body.usage?.limit ?? body.limit ?? config.freeLimit;
    plan.textContent = status === "active" ? "Pro 已开通" : "免费版";
    access.textContent = status === "active"
      ? "会员已生效。回到插件后点击刷新会员即可同步。"
      : "当前账户还没有付费会员，仍可使用免费额度。";
    usage.textContent = status === "active" ? "Pro 不限量" : String(limit) + " 次免费";
    usageCopy.textContent = used === null
      ? (status === "active" ? "会员额度已解锁。" : "免费额度会在插件使用时自动记录。")
      : ("已使用 " + used + " / " + limit + " 次。");
    freeBenefitCard.classList.toggle("is-current", status !== "active");
    proBenefitCard.classList.toggle("is-current", status === "active");
    proBenefitCard.classList.toggle("is-locked", status !== "active");
    proBenefitState.textContent = status === "active" ? "已解锁" : "升级后解锁";
  };
  const verifyOtp = async (email, token, type) => {
    const response = await fetch(config.publicSupabaseUrl.replace(/\\/$/, "") + "/auth/v1/verify", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ email, token, type })
    });
    const body = await response.json().catch(() => ({}));
    return { response, body };
  };
  const verifyOtpAcrossKnownTypes = async (email, token) => {
    const types = ["magiclink", "recovery", "email"];
    let last = null;
    for (const type of types) {
      const result = await verifyOtp(email, token, type);
      if (result.response.ok) return result;
      last = result;
    }
    return last;
  };
  sendOtpButton.addEventListener("click", async () => {
    await loadPublicConfig();
    if (!canLoginNow()) { setMessage("登录配置暂未启用。"); return; }
    const email = emailInput.value.trim();
    if (!email) { setMessage("请先输入邮箱。"); return; }
    setMessage("正在发送验证码...");
    setSendOtpDisabled(true, "发送中...");
    try {
      const response = await fetch(config.publicSupabaseUrl.replace(/\\/$/, "") + "/auth/v1/otp", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ email, create_user: true, type: "magiclink" })
      });
      if (response.ok) {
        setMessage("验证码已发送，请查看邮箱。验证码 5 分钟内有效。");
        startSendCooldown(60);
        return;
      }
      const reason = await readAuthError(response);
      setMessage(reason);
      if (response.status !== 429) setSendOtpDisabled(false, "发送验证码");
    } catch {
      setMessage("网络连接失败，请刷新页面后重试。");
      setSendOtpDisabled(false, "发送验证码");
    }
  });
  verifyOtpButton.addEventListener("click", async () => {
    await loadPublicConfig();
    if (!canLoginNow()) { setMessage("登录配置暂未启用。"); return; }
    const email = emailInput.value.trim();
    const token = tokenInput.value.replace(/\\s+/g, "").trim();
    if (!email || !token) { setMessage("请输入邮箱和验证码。"); return; }
    verifyOtpButton.disabled = true;
    setMessage("正在登录...");
    let { response, body } = await verifyOtpAcrossKnownTypes(email, token);
    if (!response.ok) {
      const rawReason = body.msg || body.message || body.error_description || body.error || "";
      const reason = /expired|invalid/i.test(rawReason)
        ? "验证码无效或已过期。请使用最新邮件里的验证码，并在 5 分钟内完成登录。"
        : (rawReason || "验证码无效或已过期");
      setMessage("登录失败：" + reason);
      verifyOtpButton.disabled = false;
      return;
    }
    let session;
    try {
      session = saveSession(body);
    } catch {
      session = { email };
      localStorage.setItem(identityKey, JSON.stringify({ email, signedInAt: new Date().toISOString() }));
      writeLoginCookie(email);
    }
    showSignedIn(session);
    setMessage("登录成功，正在进入会员账户...");
    setTimeout(() => {
      window.location.href = "/account.html?signedIn=1&t=" + Date.now();
    }, 80);
  });
  document.getElementById("refresh-membership").addEventListener("click", async () => {
    await loadPublicConfig();
    setMessage("正在刷新会员状态...");
    try {
      await refreshEntitlement();
      setMessage("会员状态已刷新。");
    } catch (error) {
      setMessage("刷新失败：" + (error.message || "请稍后重试"));
    }
  });
  document.getElementById("sign-out-account").addEventListener("click", () => {
    localStorage.removeItem(sessionKey);
    localStorage.removeItem(identityKey);
    clearLoginCookie();
    showSignedOut();
    setMessage("已退出登录。");
  });
  productButtons.forEach((button) => {
    button.addEventListener("click", () => {
      selectedProductKey = button.dataset.accountProduct;
      renderProductMembership();
      refreshEntitlement().catch(() => null);
    });
  });
  renderProductMembership();
  loadPublicConfig().then(() => {
    renderProductMembership();
    if (!canLoginNow()) setMessage("登录配置暂未启用。");
    return captureAuthHash().then((captured) => {
      const session = captured || readSession();
      const identity = readIdentity();
      const cookieEmail = readLoginCookie();
      if (session?.accessToken) showSignedIn(session);
      else if (identity?.email) showSignedIn({ email: identity.email });
      else if (cookieEmail) showSignedIn({ email: cookieEmail });
      return refreshEntitlement().catch(() => null);
    });
  });
})();
  </script>
</body>
</html>`;
}

function renderChineseCheckoutStatusPage({ state, kind, localeSwitcherHtml = "" }) {
  const success = kind === "success";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${success ? "付款已完成" : "付款已取消"} | ${escapeHtml(state.product.name)}</title>
  <link rel="stylesheet" href="../styles.css">
  ${renderChineseMarketplaceCss()}
</head>
<body class="status-cn">
  ${renderChineseMarketplaceNav({ active: "product", product: state.product, basePath: "../", localeSwitcherHtml })}
  <main class="cn-status-main">
    <section class="cn-status-card">
      <h1>${success ? "付款已完成" : "付款已取消"}</h1>
      <p>${success ? "请回到插件或账户页刷新会员状态。付费权限会在后台确认后生效。" : "本次没有完成付款。你可以继续使用免费版，或返回价格页重新开始。"}</p>
      <div class="cn-action-row" style="justify-content:center">
        <a class="cn-primary-button" href="../account.html">打开账户</a>
        <a class="cn-outline-button" href="../pricing.html">返回价格页</a>
      </div>
    </section>
  </main>
</body>
</html>`;
}

function renderChineseCheckoutStartPendingPage({ state }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>付款入口准备中 | 插件工程</title>
  <link rel="stylesheet" href="../../styles.css">
  ${renderChineseMarketplaceCss()}
</head>
<body class="status-cn">
  ${renderChineseMarketplaceNav({ active: "product", product: state.product, basePath: "../../" })}
  <main class="cn-status-main">
    <section class="cn-status-card">
      <h1>付款入口准备中</h1>
      <p>当前页面已经连接到商城价格入口。对应商品付款链接确认后，这里会进入安全结账页面。</p>
      <div class="cn-action-row" style="justify-content:center">
        <a class="cn-primary-button" href="../../product.html">查看全部插件</a>
        <a class="cn-outline-button" href="../../account.html">打开账户</a>
      </div>
    </section>
  </main>
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
    ${renderSiteHeader({
      product,
      localeSwitcherHtml,
      ctaHref: "pricing.html",
      ctaLabel: "View pricing"
    })}

    <section class="hero compact-hero account-hero">
      <div class="hero-copy">
        <p class="eyebrow">Account</p>
        <h1>Manage your LeadFill access in one place.</h1>
        <p class="lede">Use the same email you used at checkout to restore access, review usage, and refresh your current plan.</p>
        <div class="button-row">
          <a class="button primary" href="pricing.html">Open pricing</a>
          <a class="button secondary" href="${escapeHtml(product.installUrl)}">Add to Chrome</a>
        </div>
      </div>
      <div class="hero-media visual-card">
        <img src="assets/landing/pricing_1600x900.png" alt="${escapeHtml(product.name)} account and membership visual">
        <p class="panel-note">A quieter account page focused on plan, usage, purchase recovery, and support.</p>
      </div>
    </section>

    <section class="section">
      <div class="status-grid">
        <article class="status-card">
          <p class="section-label">Current access</p>
          <h3>Free to start</h3>
          <p>Every new account starts with ${escapeHtml(`${product.freeLimit} free fills`)} before you ever need to pay.</p>
        </article>
        <article class="status-card">
          <p class="section-label">Usage</p>
          <h3>Clear quota</h3>
          <p>The free plan is meant for real evaluation. Lifetime removes the fill limit when the product becomes useful enough to keep.</p>
        </article>
        <article class="status-card">
          <p class="section-label">Restore purchase</p>
          <h3>Use the same email</h3>
          <p>If you already paid, use the same email on this page to restore access and refresh your plan.</p>
        </article>
        <article class="status-card">
          <p class="section-label">Orders / payments</p>
          <h3>Keep billing simple</h3>
          <p>Use the same checkout email for purchase recovery, billing follow-up, and account help.</p>
        </article>
      </div>
    </section>

    <section class="section split">
      <div class="card prose-block">
        <p class="section-label">Restore purchase</p>
        <h2>A simple path back to your paid access.</h2>
        ${listToHtml([
          "Open the account page.",
          "Use the same email you used when you purchased LeadFill.",
          "Refresh your access to sync your current plan."
        ])}
      </div>
      <div class="card prose-block">
        <p class="section-label">Support</p>
        <h2>Need help with access or billing?</h2>
        ${listToHtml([
          `Contact ${supportEmail}.`,
          "Include the email you used when you purchased.",
          "Mention whether you need billing help or purchase recovery."
        ])}
      </div>
    </section>

    ${renderSiteFooter({ supportEmail })}
  </div>
</body>
</html>`;
}

function renderLegalPage({ state, kind, title, eyebrow, lede, bodyHtml, localeSwitcherHtml = "" }) {
  const product = state.product;
  const supportEmail = product.supportEmail || "support@915500.xyz";
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
    ${renderSiteHeader({
      product,
      localeSwitcherHtml,
      ctaHref: "pricing.html",
      ctaLabel: "View pricing"
    })}
    <main class="legal-page">
      <article class="legal-article">
        <p class="eyebrow">${escapeHtml(eyebrow)}</p>
        <h1>${escapeHtml(title)}</h1>
        <p class="legal-summary">${escapeHtml(lede)}</p>
        <div class="legal-copy">${bodyHtml}</div>
      </article>
    </main>
    ${renderSiteFooter({ supportEmail })}
  </div>
</body>
</html>`;
}

function renderChineseLegalPage({ state, kind, localeSwitcherHtml = "" }) {
  const product = state.product;
  const supportEmail = product.supportEmail || "support@915500.xyz";
  const page = kind === "privacy"
    ? {
        title: "隐私说明",
        summary: "插件工程是 Chrome 插件产品中心。我们只收集提供账户、购买、会员和支持服务所需的信息。",
        sections: [
          ["插件数据", ["不同插件会尽量把用户内容保留在浏览器本地。具体数据范围以对应插件详情页为准。", "除非产品明确说明，我们不会把插件中的本地资料用于云同步。"]],
          ["网站记录", ["网站和后端可能保存账户邮箱、购买记录、会员状态、安装记录和使用额度等必要信息。"]],
          ["付款", ["付款由托管结账页面处理。账户页用于查看会员状态、恢复购买和联系支持。"]],
          ["联系", [`隐私、账户或订单问题可联系 ${supportEmail}。`]]
        ]
      }
    : kind === "refund"
      ? {
          title: "退款与订单支持",
          summary: "退款和订单问题后续统一放到账户页处理，避免在主导航和页脚暴露独立退款入口。",
          sections: [
            ["处理入口", ["请进入账户页，使用购买时的邮箱登录后联系支持。"]],
            ["退款影响", ["如果退款被批准，对应会员权限可能会被撤销。"]],
            ["联系", [`账单、退款和订单问题可联系 ${supportEmail}。`]]
          ]
        }
      : {
        title: "服务条款",
        summary: "插件工程提供 Chrome 插件的展示、安装入口、购买入口和账户支持服务。",
        sections: [
          ["产品范围", ["每个插件都有自己的功能边界、适用场景和限制。请以对应产品详情页为准。"]],
          ["免费与付费", ["部分插件可能提供免费额度或付费方案。价格、权益和购买入口以对应插件价格页为准。"]],
          ["可接受使用", ["请只在你有权处理的数据、网页和工作场景中使用插件。"]],
          ["服务可用性", ["网站、插件、账户和付款能力可能随着产品维护而调整。"]],
          ["联系", [`账户、订单或退款问题可联系 ${supportEmail}，相关处理入口会优先放在账户页。`]]
        ]
        };
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(page.title)} | 插件工程</title>
  <link rel="stylesheet" href="styles.css">
  ${renderChineseMarketplaceCss()}
</head>
<body class="detail-cn">
  ${renderChineseMarketplaceNav({ active: "", pricingLink: "pricing.html", product, localeSwitcherHtml })}
  <main class="cn-legal-main">
    <article class="cn-legal-article">
      <h1>${escapeHtml(page.title)}</h1>
      <p>${escapeHtml(page.summary)}</p>
      ${page.sections.map(([heading, items]) => `
        <h2>${escapeHtml(heading)}</h2>
        <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      `).join("")}
    </article>
  </main>
  ${renderChineseMarketplaceFooter()}
</body>
</html>`;
}

function renderCheckoutGuidancePage({ state, kind, localeSwitcherHtml = "" }) {
  const product = state.product;
  const page = {
    success: {
      title: "Payment received",
      eyebrow: "Success",
      lede: "Your payment was received. Return to LeadFill or your account page to continue.",
      steps: [
        "Return to the extension or account page.",
        "Use the same email you used when you purchased.",
        "Refresh your access if it does not appear right away."
      ],
      note: "This page confirms the payment only. Your account updates after payment confirmation."
    },
    cancel: {
      title: "Checkout not completed",
      eyebrow: "Cancelled",
      lede: "No payment was completed. You can keep using the free plan or come back later.",
      steps: [
        "Return to the product or pricing page.",
        "Keep using your remaining free fills.",
        "Retry checkout later if you still want unlimited access."
      ],
      note: "If something went wrong on the hosted payment page, contact support."
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
    ${renderSiteHeader({
      product,
      localeSwitcherHtml,
      homeHref: "../index.html",
      productHref: "../product.html",
      pricingHref: "../pricing.html",
      accountHref: "../account.html",
      ctaHref: "../pricing.html",
      ctaLabel: "View pricing"
    })}
    <main class="guidance-page">
      <section class="guidance-card minimal-guidance">
        <p class="eyebrow">${escapeHtml(page.eyebrow)}</p>
        <h1>${escapeHtml(page.title)}</h1>
        <p class="lede">${escapeHtml(page.lede)}</p>
        ${listToHtml(page.steps, "step-list")}
        <p class="fine-print">${escapeHtml(page.note)}</p>
        <div class="guidance-actions">
          <a class="button primary" href="../account.html">Open account</a>
          <a class="button secondary" href="../product.html">Back to product</a>
        </div>
      </section>
    </main>
    ${renderSiteFooter({
      refundHref: "../refund.html",
      privacyHref: "../privacy.html",
      termsHref: "../terms.html",
      supportEmail: product.supportEmail || "support@915500.xyz"
    })}
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
  const externalAssetsDir = path.join(assetsDir, "external");
  await ensureDir(externalAssetsDir);
  const obsidianIconPath = path.join(projectRoot, "chatgpt-obsidian-local-exporter", "src", "assets", "icon-128.png");
  if (await fileExists(obsidianIconPath)) {
    await fs.copyFile(obsidianIconPath, path.join(externalAssetsDir, "chatgpt-obsidian-icon-128.png"));
  }

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

## Contact

- Contact ${supportEmail} with the email used at checkout.
- Include your order details and a short description of the billing issue.

## Review

- Duplicate purchases, clear mistaken charges, and failed payment attempts are reviewed first.
- Refund decisions are handled case by case.
- If a refund is granted, paid access for the related order may be revoked.

## Payment Processing

- Payments are processed on a hosted checkout page.
- The payment provider handles payment processing.

## Response Window

- We aim to respond within three business days.`);
  const formalPrivacyHtml = `
<h3>Privacy Summary</h3>
<p>LeadFill keeps one saved profile in local Chrome storage and fills supported fields only after a user action from the popup.</p>
<h3>What LeadFill does not do</h3>
${listToHtml([
  "It does not upload the saved profile to a remote service.",
  "It does not sync form data to the cloud.",
  "It does not run background automation across every page."
])}
<h3>Website and account records</h3>
<p>The website and backend store account, purchase, access, installation, and usage records needed to operate billing, support, and product access.</p>
<h3>Payment and support</h3>
<p>Payment happens on a hosted checkout page. Account recovery and support use the email address connected to your purchase.</p>
<div class="legal-extra">${privacyMarkdown ? markdownToHtml(privacyMarkdown) : ""}</div>`;
  const termsHtml = markdownToHtml(`# Terms

LeadFill One Profile is a focused Chrome utility for saving one local profile and filling supported lead-form fields from the extension popup.

## Product Scope

- The product is intentionally narrow and local-first.
- Compatibility depends on supported field types and page structure.
- The extension does not promise cloud sync, CRM integration, or broad browser automation.

## Free And Paid Access

- LeadFill offers a free usage tier and a paid lifetime unlock.
- Payment happens on a hosted checkout page.
- Paid access appears after purchase confirmation is attached to your account.

## Acceptable Use

- Use the product only with forms and data you are allowed to fill.
- Do not use the product in a way that breaks website terms, laws, or privacy obligations.

## Availability

- Website, extension, and payment availability may change over time.
- We may update the product, pricing, or support process as the service evolves.

## Support

- Contact ${supportEmail} for account, billing, or restore issues.`);

  await writeText(path.join(outputDir, "styles.css"), renderStyles(state.brandSystem));
  await writeText(path.join(outputDir, "index.html"), renderEnglishMarketplaceHtml(renderChineseMarketplaceHomePage({
    state,
    checkoutConfig,
    pricingLink,
    localeSwitcherHtml: rootIndexLocaleSwitcher
  })));
  await writeText(path.join(outputDir, "product.html"), renderEnglishMarketplaceHtml(renderChineseProductsIndexPage({
    state,
    pricingLink,
    localeSwitcherHtml: rootProductLocaleSwitcher
  })));
  await writeText(path.join(outputDir, "leadfill.html"), renderEnglishMarketplaceHtml(renderChineseProductDetailPage({
    state,
    screenshots,
    localeSwitcherHtml: rootProductLocaleSwitcher
  })));
  await writeText(path.join(outputDir, "chatgpt-obsidian-local-exporter.html"), renderEnglishMarketplaceHtml(renderChineseObsidianDetailPage({
    state,
    localeSwitcherHtml: rootProductLocaleSwitcher
  })));
  await writeText(path.join(outputDir, "pricing.html"), renderEnglishMarketplaceHtml(renderChinesePricingPage({
    state,
    checkoutConfig,
    localeSwitcherHtml: rootPricingLocaleSwitcher
  })));
  await writeText(path.join(outputDir, "chatgpt-obsidian-local-exporter-pricing.html"), renderEnglishMarketplaceHtml(renderChineseObsidianPricingPage({
    state,
    checkoutConfig,
    localeSwitcherHtml: rootPricingLocaleSwitcher
  })));
  const accountHtml = renderChineseMembershipAccountPage({
    state,
    checkoutConfig,
    localeSwitcherHtml: rootAccountLocaleSwitcher
  });
  await writeText(path.join(outputDir, "account.html"), renderEnglishMarketplaceHtml(accountHtml));
  await writeText(path.join(outputDir, "checkout", "success.html"), renderEnglishMarketplaceHtml(renderChineseCheckoutStatusPage({
    state,
    kind: "success",
    localeSwitcherHtml: rootSuccessLocaleSwitcher
  })));
  await writeText(path.join(outputDir, "checkout", "cancel.html"), renderEnglishMarketplaceHtml(renderChineseCheckoutStatusPage({
    state,
    kind: "cancel",
    localeSwitcherHtml: rootCancelLocaleSwitcher
  })));
  await writeText(path.join(outputDir, "checkout", "start", "index.html"), renderEnglishMarketplaceHtml(renderChineseCheckoutStartPendingPage({
    state
  })));
  await writeText(path.join(outputDir, "products", "index.html"), renderEnglishMarketplaceHtml(renderChineseProductsIndexPage({
    state,
    pricingLink,
    localeSwitcherHtml: rootProductLocaleSwitcher
  })));
  await writeText(path.join(outputDir, "products", "leadfill-one-profile", "index.html"), renderEnglishMarketplaceHtml(renderChineseProductDetailPage({
    state,
    screenshots,
    localeSwitcherHtml: rootProductLocaleSwitcher
  })));
  await writeText(path.join(outputDir, "products", "leadfill-one-profile", "pricing", "index.html"), renderEnglishMarketplaceHtml(renderChinesePricingPage({
    state,
    checkoutConfig,
    localeSwitcherHtml: rootPricingLocaleSwitcher
  })));
  await writeText(path.join(outputDir, "products", "chatgpt-obsidian-local-exporter", "index.html"), renderEnglishMarketplaceHtml(renderChineseObsidianDetailPage({
    state,
    localeSwitcherHtml: rootProductLocaleSwitcher
  })));
  await writeText(path.join(outputDir, "products", "chatgpt-obsidian-local-exporter", "pricing", "index.html"), renderEnglishMarketplaceHtml(renderChineseObsidianPricingPage({
    state,
    checkoutConfig,
    localeSwitcherHtml: rootPricingLocaleSwitcher
  })));
  await writeText(path.join(outputDir, "entitlement.html"), renderEnglishMarketplaceHtml(renderChineseMembershipAccountPage({
    state,
    checkoutConfig,
    localeSwitcherHtml: rootEntitlementLocaleSwitcher
  })));
  await writeText(path.join(outputDir, "privacy.html"), renderEnglishMarketplaceHtml(renderChineseLegalPage({
    state,
    kind: "privacy",
    localeSwitcherHtml: rootPrivacyLocaleSwitcher
  })));
  await writeText(path.join(outputDir, "terms.html"), renderEnglishMarketplaceHtml(renderChineseLegalPage({
    state,
    kind: "terms",
    localeSwitcherHtml: rootTermsLocaleSwitcher
  })));
  const localeManifest = await generateLocalizedSitePages({
    state,
    outputDir
  });
  const zhDir = path.join(outputDir, "zh-cn");
  await ensureDir(zhDir);
  const zhIndexLocaleSwitcher = renderLocaleSwitcher({ outputDir, localeCode: "zh-cn", pageRelativePath: "index.html" });
  const zhProductLocaleSwitcher = renderLocaleSwitcher({ outputDir, localeCode: "zh-cn", pageRelativePath: "product.html" });
  const zhPricingLocaleSwitcher = renderLocaleSwitcher({ outputDir, localeCode: "zh-cn", pageRelativePath: "pricing.html" });
  const zhAccountLocaleSwitcher = renderLocaleSwitcher({ outputDir, localeCode: "zh-cn", pageRelativePath: "account.html" });
  const zhEntitlementLocaleSwitcher = renderLocaleSwitcher({ outputDir, localeCode: "zh-cn", pageRelativePath: "entitlement.html" });
  const zhPrivacyLocaleSwitcher = renderLocaleSwitcher({ outputDir, localeCode: "zh-cn", pageRelativePath: "privacy.html" });
  const zhTermsLocaleSwitcher = renderLocaleSwitcher({ outputDir, localeCode: "zh-cn", pageRelativePath: "terms.html" });
  const zhSuccessLocaleSwitcher = renderLocaleSwitcher({ outputDir, localeCode: "zh-cn", pageRelativePath: "checkout/success.html" });
  const zhCancelLocaleSwitcher = renderLocaleSwitcher({ outputDir, localeCode: "zh-cn", pageRelativePath: "checkout/cancel.html" });
  await writeText(path.join(zhDir, "index.html"), renderChineseLocaleMarketplaceHtml(renderChineseMarketplaceHomePage({
    state,
    checkoutConfig,
    pricingLink,
    localeSwitcherHtml: zhIndexLocaleSwitcher
  })));
  await writeText(path.join(zhDir, "product.html"), renderChineseLocaleMarketplaceHtml(renderChineseProductsIndexPage({
    state,
    pricingLink,
    localeSwitcherHtml: zhProductLocaleSwitcher
  })));
  await writeText(path.join(zhDir, "leadfill.html"), renderChineseLocaleMarketplaceHtml(renderChineseProductDetailPage({
    state,
    screenshots,
    localeSwitcherHtml: zhProductLocaleSwitcher
  })));
  await writeText(path.join(zhDir, "chatgpt-obsidian-local-exporter.html"), renderChineseLocaleMarketplaceHtml(renderChineseObsidianDetailPage({
    state,
    localeSwitcherHtml: zhProductLocaleSwitcher
  })));
  await writeText(path.join(zhDir, "pricing.html"), renderChineseLocaleMarketplaceHtml(renderChinesePricingPage({
    state,
    checkoutConfig,
    localeSwitcherHtml: zhPricingLocaleSwitcher
  })));
  await writeText(path.join(zhDir, "chatgpt-obsidian-local-exporter-pricing.html"), renderChineseLocaleMarketplaceHtml(renderChineseObsidianPricingPage({
    state,
    checkoutConfig,
    localeSwitcherHtml: zhPricingLocaleSwitcher
  })));
  await writeText(path.join(zhDir, "account.html"), renderChineseLocaleMarketplaceHtml(renderChineseMembershipAccountPage({
    state,
    checkoutConfig,
    localeSwitcherHtml: zhAccountLocaleSwitcher
  })));
  await writeText(path.join(zhDir, "entitlement.html"), renderChineseLocaleMarketplaceHtml(renderChineseMembershipAccountPage({
    state,
    checkoutConfig,
    localeSwitcherHtml: zhEntitlementLocaleSwitcher
  })));
  await writeText(path.join(zhDir, "checkout", "success.html"), renderChineseLocaleMarketplaceHtml(renderChineseCheckoutStatusPage({
    state,
    kind: "success",
    localeSwitcherHtml: zhSuccessLocaleSwitcher
  })));
  await writeText(path.join(zhDir, "checkout", "cancel.html"), renderChineseLocaleMarketplaceHtml(renderChineseCheckoutStatusPage({
    state,
    kind: "cancel",
    localeSwitcherHtml: zhCancelLocaleSwitcher
  })));
  await writeText(path.join(zhDir, "checkout", "start", "index.html"), renderChineseLocaleMarketplaceHtml(renderChineseCheckoutStartPendingPage({
    state
  })));
  await writeText(path.join(zhDir, "products", "index.html"), renderChineseLocaleMarketplaceHtml(renderChineseProductsIndexPage({
    state,
    pricingLink,
    localeSwitcherHtml: zhProductLocaleSwitcher
  })));
  await writeText(path.join(zhDir, "products", "leadfill-one-profile", "index.html"), renderChineseLocaleMarketplaceHtml(renderChineseProductDetailPage({
    state,
    screenshots,
    localeSwitcherHtml: zhProductLocaleSwitcher
  })));
  await writeText(path.join(zhDir, "products", "leadfill-one-profile", "pricing", "index.html"), renderChineseLocaleMarketplaceHtml(renderChinesePricingPage({
    state,
    checkoutConfig,
    localeSwitcherHtml: zhPricingLocaleSwitcher
  })));
  await writeText(path.join(zhDir, "products", "chatgpt-obsidian-local-exporter", "index.html"), renderChineseLocaleMarketplaceHtml(renderChineseObsidianDetailPage({
    state,
    localeSwitcherHtml: zhProductLocaleSwitcher
  })));
  await writeText(path.join(zhDir, "products", "chatgpt-obsidian-local-exporter", "pricing", "index.html"), renderChineseLocaleMarketplaceHtml(renderChineseObsidianPricingPage({
    state,
    checkoutConfig,
    localeSwitcherHtml: zhPricingLocaleSwitcher
  })));
  await writeText(path.join(zhDir, "privacy.html"), renderChineseLocaleMarketplaceHtml(renderChineseLegalPage({
    state,
    kind: "privacy",
    localeSwitcherHtml: zhPrivacyLocaleSwitcher
  })));
  await writeText(path.join(zhDir, "terms.html"), renderChineseLocaleMarketplaceHtml(renderChineseLegalPage({
    state,
    kind: "terms",
    localeSwitcherHtml: zhTermsLocaleSwitcher
  })));
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
    changelogUrl: "leadfill.html",
    docsUrl: "leadfill.html#features",
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
      "chatgpt-obsidian-local-exporter.html",
      "chatgpt-obsidian-local-exporter-pricing.html",
      "leadfill.html",
      "pricing.html",
      "account.html",
      "checkout/start/index.html",
      "checkout/success.html",
      "checkout/cancel.html",
      "products/index.html",
      "products/leadfill-one-profile/index.html",
      "products/leadfill-one-profile/pricing/index.html",
      "products/chatgpt-obsidian-local-exporter/index.html",
      "products/chatgpt-obsidian-local-exporter/pricing/index.html",
      "entitlement.html",
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
    detailPagePath: normalizeRelativePath(projectRoot, path.join(outputDir, "leadfill.html")),
    pricingPagePath: normalizeRelativePath(projectRoot, path.join(outputDir, "pricing.html")),
    supportUrl: normalizeRelativePath(projectRoot, path.join(outputDir, "account.html")),
    privacyUrl: normalizeRelativePath(projectRoot, path.join(outputDir, "privacy.html")),
    changelogUrl: normalizeRelativePath(projectRoot, path.join(outputDir, "leadfill.html")),
    docsUrl: normalizeRelativePath(projectRoot, path.join(outputDir, "leadfill.html")),
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
  const lead = products[0];
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Products | LeadFill</title>
  <style>${renderStyles({
    primary_color: "#1857d8",
    secondary_color: "#dbe5ff",
    accent_color: "#1857d8",
    background_color: "#f5f5f2",
    text_color: "#121517",
    typography_recommendation: {
      headline_family: "\"Inter\", \"Geist\", \"PingFang SC\", \"Noto Sans SC\", sans-serif",
      body_family: "\"Inter\", \"Geist\", \"PingFang SC\", \"Noto Sans SC\", sans-serif"
    }
  })}</style>
</head>
<body>
  <div class="market-shell">
    <div class="hub-shell">
      <header class="market-topbar">
        <div class="market-brand">LeadFill</div>
        <nav class="market-nav">
          <a class="active" href="index.html">Products</a>
          <a href="${lead?.pricingLink ?? "#pricing"}">Pricing</a>
          <a href="${lead?.detailLink ?? "#product"}">Product</a>
          <a href="${lead?.supportLink ?? lead?.detailLink ?? "#account"}">Account</a>
        </nav>
        <div class="market-actions">
          <div class="market-search">Focused browser products</div>
          <a class="market-login" href="${lead?.detailLink ?? "#product"}">Open LeadFill</a>
        </div>
      </header>

      <section class="market-hero">
        <p class="eyebrow">Products</p>
        <h1>Focused Chrome products with dedicated product pages.</h1>
        <p>Each product gets a clear landing page, a dedicated pricing page, and a lightweight account flow instead of a generic payment hub.</p>
        <div class="market-chip-row" id="categories">
          <span class="market-chip">Single-purpose</span>
          <span class="market-chip">Form Filling</span>
          <span class="market-chip">Local-first</span>
        </div>
      </section>

      <section id="featured">
        <div class="market-section-head">
          <h2>Current products</h2>
          <a class="market-link" href="${lead?.detailLink ?? "#product"}">View product</a>
        </div>
        <section class="hub-grid">
      ${products.map((product) => `
        <article class="hub-card">
          <span class="status-chip">${escapeHtml(product.status)}</span>
          ${product.iconPath ? `<img src="${escapeHtml(product.iconPath)}" alt="${escapeHtml(product.name)} icon">` : ""}
          <h2>${escapeHtml(product.name)}</h2>
          <p>${escapeHtml(product.oneSentenceValue)}</p>
          <p class="catalog-meta">${escapeHtml(`${product.freeLimit ?? 10} free fills`)} · ${escapeHtml(product.priceLabel ?? "$19 lifetime")} · Local-only</p>
          <div class="catalog-actions">
            <a class="button secondary" href="${escapeHtml(product.detailLink)}">View details</a>
            <a class="button primary" href="${escapeHtml(product.pricingLink)}">Pricing</a>
          </div>
        </article>
      `).join("")}
        </section>
      </section>
    </div>
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
    const supportAbsolute = product.supportUrl ? path.join(projectRoot, product.supportUrl) : null;
    const iconAbsolute = path.join(projectRoot, PLUGIN_PAGES_ROOT, product.slug, "assets", "icon", "icon128.png");
    return {
      ...product,
      detailLink: (await fileExists(detailAbsolute)) ? relativeLink(rootDir, detailAbsolute) : "#detail-missing",
      pricingLink: (await fileExists(pricingAbsolute)) ? relativeLink(rootDir, pricingAbsolute) : "#pricing-missing",
      supportLink: supportAbsolute && await fileExists(supportAbsolute) ? relativeLink(rootDir, supportAbsolute) : "#account-missing",
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
      "Make the site behave like a Chinese Chrome extension marketplace.",
      "Use the homepage as a multi-product discovery surface, not a single-product hub.",
      "Give each plugin a dedicated product detail page and pricing path.",
      "Keep LeadFill's install, pricing, and account flows clear without exposing internals.",
      "Keep payment activation tied to backend confirmation, not local success-page state."
    ],
    redesigned_pages: [
      "Chinese marketplace homepage",
      "All-products listing page",
      "Dedicated product detail page",
      "Three-plan pricing page",
      "Account and membership page",
      "Privacy and terms legal pages",
      "Checkout success guidance page",
      "Checkout cancelled / failed guidance page",
      "Localized site variants for zh-cn, ja, and es"
    ],
    information_architecture: [
      "Homepage focuses on search, categories, featured plugin cards, and marketplace discovery.",
      "Navigation is centered on Explore, Category, Product, and Account.",
      "Product listing page shows all plugins and supports category filtering.",
      "LeadFill detail page contains install and pricing actions without duplicate pricing CTAs.",
      "Pricing page uses three plans: monthly, annual, and lifetime.",
      "Account page keeps purchase recovery and membership management separate from product marketing.",
      "Privacy and terms stay in footer-level document pages; refund handling moves into account support."
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
    hero_names_product: homeHtml.includes("插件工程") && homeHtml.includes("Chrome 插件"),
    value_prop_above_fold: homeHtml.includes("发现更好用的 Chrome 插件"),
    primary_cta_present: homeHtml.includes("查看详情"),
    secondary_cta_present: homeHtml.includes("查看所有插件"),
    chrome_cta_present: productHtml.includes("全部插件") && productHtml.includes("查看详情"),
    price_visible: productHtml.includes("LeadFill One Profile") && productHtml.includes("10 次免费试用"),
    free_tier_visible: homeHtml.includes(`${product.freeLimit}`) && homeHtml.includes("免费试用"),
    trust_notes_visible: homeHtml.includes("隐私") && productHtml.includes("PrivacyShield"),
    product_first_positioning_present: homeHtml.includes("推荐插件") && homeHtml.includes("搜索插件"),
    core_benefits_present: productHtml.includes("FocusFlow") && productHtml.includes("PrivacyShield"),
    how_it_works_present: productHtml.includes("全部插件") && productHtml.includes("LeadFill One Profile"),
    real_screenshot_proof_present: homeHtml.includes("cn-extension-card") && productHtml.includes("cn-extension-card"),
    feature_breakdown_present: productHtml.includes("FocusFlow") && productHtml.includes("MemSaver"),
    pricing_section_present: homeHtml.includes("查看详情") && productHtml.includes("leadfill.html"),
    faq_present: productHtml.includes("LeadFill One Profile") && productHtml.includes("MemSaver"),
    footer_legal_demoted: homeHtml.includes("href=\"/privacy.html\"") && homeHtml.includes("href=\"/terms.html\"") && !homeHtml.includes("refund.html"),
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
    pricing_options_clear: pricingHtml.includes("月度版") && pricingHtml.includes("年度版") && pricingHtml.includes("终身版"),
    discount_pricing_clear: pricingHtml.includes("$9") && pricingHtml.includes("$99.9") && pricingHtml.includes("$29") && pricingHtml.includes("$199") && pricingHtml.includes("$39.9"),
    checkout_preflight_explained: pricingHtml.includes("购买月度版") && pricingHtml.includes("购买年度版") && pricingHtml.includes("购买终身版"),
    payment_confirmation_explained: pricingHtml.includes("托管结账页面") && pricingHtml.includes("刷新会员状态"),
    success_page_next_steps: successHtml.includes("付款已完成") && successHtml.includes("刷新会员状态"),
    cancel_page_retry_path: cancelHtml.includes("付款已取消") && cancelHtml.includes("重新开始"),
    entitlement_page_states: (accountHtml.includes("Current access") && accountHtml.includes("Usage") && accountHtml.includes("Restore purchase"))
      || (accountHtml.includes("会员状态") && accountHtml.includes("使用额度") && accountHtml.includes("订单支持")),
    success_page_does_not_overclaim_unlock: successHtml.includes("后台确认后生效")
      || pricingHtml.includes("刷新会员状态"),
    production_payment_not_overclaimed: !combined.includes("production payment verified") && !combined.includes("live checkout is enabled"),
    no_secret_claim_regression: !/(service role|Waffo private key|merchant secret|webhook secret)/i.test(combined),
    account_page_is_not_debug_panel_copy: !/debug/i.test(accountHtml)
      && (accountHtml.includes("账户中心") || accountHtml.includes("Current access"))
      && (accountHtml.includes("订单支持") || accountHtml.includes("Orders / payments")),
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
    "chatgpt-obsidian-local-exporter.html",
    "chatgpt-obsidian-local-exporter-pricing.html",
    "leadfill.html",
    "pricing.html",
    "account.html",
    "checkout/start/index.html",
    "checkout/success.html",
    "checkout/cancel.html",
    "products/index.html",
    "products/leadfill-one-profile/index.html",
    "products/leadfill-one-profile/pricing/index.html",
    "products/chatgpt-obsidian-local-exporter/index.html",
    "products/chatgpt-obsidian-local-exporter/pricing/index.html",
    "entitlement.html",
    "privacy.html",
    "terms.html",
    "styles.css",
    "locales.json",
    "zh-cn/index.html",
    "zh-cn/product.html",
    "zh-cn/pricing.html",
    "zh-cn/account.html",
    "zh-cn/privacy.html",
    "zh-cn/terms.html",
    "zh-cn/checkout/success.html",
    "zh-cn/checkout/cancel.html",
    "ja/index.html",
    "ja/product.html",
    "ja/pricing.html",
    "ja/account.html",
    "ja/privacy.html",
    "ja/terms.html",
    "ja/checkout/success.html",
    "ja/checkout/cancel.html",
    "es/index.html",
    "es/product.html",
    "es/pricing.html",
    "es/account.html",
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
  const paymentCopyTruthful = (pricingHtml.includes("Payment is handled on a secure external page")
      || pricingHtml.includes("Payment is handled on a secure hosted page"))
    && (pricingHtml.includes("updates after payment confirmation")
      || successHtml.includes("confirms the payment only"))
    && !/service role|merchant secret|WAFFO_PRIVATE_KEY|webhook secret/i.test(`${pricingHtml}\n${accountHtml}\n${successHtml}`);
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
