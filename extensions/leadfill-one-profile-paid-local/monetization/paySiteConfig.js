const DEFAULT_FREE_LIMIT = {
  amount: 10,
  unit: "fills",
  scope: "lifetime"
};

export const MEMBERSHIP_STORAGE_KEYS = {
  installationId: "membership.installationId",
  session: "membership.session",
  debugSession: "membership.debug.session",
  debugCheckout: "membership.debug.checkoutSessionResponse",
  debugConsumeUsage: "membership.debug.consumeUsageResponse"
};

export function entitlementStorageKey(productKey) {
  return `membership.entitlement.${productKey}`;
}

export function debugEntitlementStorageKey(productKey) {
  return `membership.debug.entitlement.${productKey}`;
}

export function localUsageStorageKey(productKey, featureKey) {
  return `membership.localUsage.${productKey}.${featureKey}`;
}

export function isPlaceholderValue(value) {
  const normalized = `${value ?? ""}`.trim();
  if (!normalized) {
    return true;
  }
  return /placeholder|product_key_pending|license_verify_endpoint_placeholder|license_activate_endpoint_placeholder/i.test(normalized);
}

export function hasConfiguredPublicValue(value) {
  return !isPlaceholderValue(value);
}

export function buildCheckoutPlaceholderUrl(config, overrides = {}) {
  const baseUrl = new URL("/checkout/test-placeholder", config.siteUrl);
  baseUrl.searchParams.set("productKey", overrides.productKey ?? config.productKey ?? "product_key_pending");
  baseUrl.searchParams.set("planKey", overrides.planKey ?? config.planKey ?? "one_time_test");
  baseUrl.searchParams.set("source", "chrome_extension_test");
  return baseUrl.toString();
}

export async function loadJsonConfig(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load config from ${url}.`);
  }
  return response.json();
}

export function normalizeRuntimeConfig({ monetization = {}, paySite = {} }) {
  const freeLimit = monetization.free_limit ?? DEFAULT_FREE_LIMIT;
  return {
    ...paySite,
    monetization,
    productKey: paySite.productKey ?? monetization.product_key ?? monetization.product_id ?? "product_key_pending",
    planKey: paySite.planKey ?? monetization.plan_key ?? "one_time_test",
    freeLimit,
    priceLabel: monetization.price_label ?? "paid plans",
    productName: monetization.product_name ?? paySite.productName ?? "LeadFill One Profile",
    upgradeUrl: paySite.upgradeUrl ?? monetization.upgrade_url ?? null,
    upgradeUrlMode: paySite.upgradeUrlMode ?? monetization.upgrade_url_mode ?? "website_product_pricing_page",
    smtpLoginBlockerExpected: monetization.smtp_login_blocker_expected === true,
    degradedFreeUsageFallback: monetization.degraded_free_usage_fallback !== false,
    webhookUnlockOnly: monetization.webhook_unlock_only !== false,
    offlineGraceHours: Number(monetization.offline_grace_hours ?? 72),
    entitlementCacheTtlHours: Number(monetization.entitlement_cache_ttl_hours ?? 24),
    featureKey: monetization.default_feature_key ?? "leadfill_fill_action",
    supportEmail: monetization.support_email ?? "<SUPPORT_EMAIL_PLACEHOLDER>"
  };
}

export async function loadPaySiteRuntimeConfig({
  monetizationConfigUrl = chrome.runtime.getURL("monetization_config.json"),
  paySiteConfigUrl = chrome.runtime.getURL("pay_site_config.json")
} = {}) {
  const [monetization, paySite] = await Promise.all([
    loadJsonConfig(monetizationConfigUrl),
    loadJsonConfig(paySiteConfigUrl)
  ]);
  return normalizeRuntimeConfig({ monetization, paySite });
}

export function createSanitizedSessionSnapshot(session) {
  return {
    loggedIn: Boolean(session?.accessToken),
    expiresAt: session?.expiresAt ?? null,
    user: session?.user
      ? {
          id: session.user.id ?? null,
          email: session.user.email ?? null
        }
      : {
          id: null,
          email: null
        },
    sessionPresent: Boolean(session?.accessToken),
    refreshTokenPresent: Boolean(session?.refreshToken)
  };
}

export function nowIso() {
  return new Date().toISOString();
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createError(message, code, status = 0) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

export function inferEntitlementState(entitlement, config) {
  const status = `${entitlement?.status ?? entitlement?.local_status ?? "free"}`.trim().toLowerCase();
  const plan = `${entitlement?.plan ?? "free"}`.trim().toLowerCase();
  const active = status === "active" || status === "offline_grace" || plan === "lifetime";
  return {
    status,
    plan,
    active,
    message: entitlement?.message
      ?? (active
        ? "Pro lifetime is active."
        : `Free plan includes ${config.freeLimit.amount} ${config.freeLimit.unit}.`)
  };
}
