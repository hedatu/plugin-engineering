import {
  MEMBERSHIP_STORAGE_KEYS,
  createError,
  createSanitizedSessionSnapshot,
  debugEntitlementStorageKey,
  entitlementStorageKey,
  hasConfiguredPublicValue,
  inferEntitlementState,
  isPlaceholderValue,
  loadPaySiteRuntimeConfig,
  nowIso
} from "./paySiteConfig.js";
import { createAuthFlow } from "./authFlow.js";
import { createCheckoutFlow } from "./checkoutFlow.js";
import { createUsageGate } from "./usageGate.js";

async function fetchJsonWithTimeout(fetchImpl, url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...options,
      signal: controller.signal
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = body?.errorCode ?? body?.code ?? body?.error ?? body?.message ?? "EDGE_FUNCTION_FAILED";
      throw createError(`${code}`, `${code}`, response.status);
    }
    return body;
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeEntitlement(response, config) {
  const status = response?.status ?? response?.entitlementStatus ?? response?.local_status ?? "free";
  return {
    status,
    local_status: status,
    plan: response?.plan ?? (status === "active" ? "lifetime" : "free"),
    features: Array.isArray(response?.features) ? response.features : [],
    verified_at: response?.verified_at ?? nowIso(),
    usage_remaining: response?.usage_remaining ?? null,
    message: response?.message ?? (
      status === "active"
        ? "Pro lifetime is active."
        : `Free plan includes ${config.freeLimit.amount} ${config.freeLimit.unit}.`
    )
  };
}

export async function createMembershipBackgroundService({
  config = null,
  storage = chrome.storage.local,
  fetchImpl = fetch
} = {}) {
  const runtimeConfig = config ?? await loadPaySiteRuntimeConfig();
  const authFlow = createAuthFlow({
    config: runtimeConfig,
    storage,
    fetchImpl
  });

  async function getInstallationId() {
    const stored = await storage.get(MEMBERSHIP_STORAGE_KEYS.installationId);
    const existing = stored?.[MEMBERSHIP_STORAGE_KEYS.installationId];
    if (existing) {
      return existing;
    }
    const nextId = crypto.randomUUID();
    await storage.set({
      [MEMBERSHIP_STORAGE_KEYS.installationId]: nextId
    });
    return nextId;
  }

  async function readCachedEntitlement(productKey = runtimeConfig.productKey) {
    const key = entitlementStorageKey(productKey);
    const stored = await storage.get(key);
    return stored?.[key] ?? {
      status: "free",
      local_status: "free",
      plan: "free",
      features: [],
      verified_at: null,
      message: `Free plan includes ${runtimeConfig.freeLimit.amount} ${runtimeConfig.freeLimit.unit}.`
    };
  }

  async function cacheEntitlement(entitlement, productKey = runtimeConfig.productKey) {
    const key = entitlementStorageKey(productKey);
    const normalized = normalizeEntitlement(entitlement, runtimeConfig);
    await storage.set({
      [key]: normalized
    });
    return normalized;
  }

  async function callEdgeFunction(name, { body, requireAuth = true } = {}) {
    const headers = {
      "content-type": "application/json"
    };
    if (hasConfiguredPublicValue(runtimeConfig.publicSupabaseAnonKey)) {
      headers.apikey = runtimeConfig.publicSupabaseAnonKey;
    }
    if (requireAuth) {
      const session = await authFlow.refreshSessionIfNeeded().catch(() => authFlow.getStoredSession());
      if (!session?.accessToken) {
        throw createError("Login is required.", "LOGIN_REQUIRED", 401);
      }
      headers.authorization = `Bearer ${session.accessToken}`;
    }
    const url = `${runtimeConfig.publicSupabaseUrl.replace(/\/$/, "")}/functions/v1/${name}`;
    return fetchJsonWithTimeout(fetchImpl, url, {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? {})
    });
  }

  async function refreshEntitlement(productKey = runtimeConfig.productKey) {
    const debugKey = debugEntitlementStorageKey(productKey);
    const debug = await storage.get(debugKey);
    if (runtimeConfig.checkoutMode === "test" && debug?.[debugKey]) {
      return cacheEntitlement(debug[debugKey], productKey);
    }
    if (isPlaceholderValue(productKey)) {
      throw createError("Product is not configured.", "PRODUCT_NOT_FOUND", 404);
    }
    const response = await callEdgeFunction("get-entitlement", {
      requireAuth: true,
      body: {
        productKey
      }
    });
    return cacheEntitlement(response, productKey);
  }

  async function registerInstallation({
    productKey = runtimeConfig.productKey,
    installationId = null,
    extensionId = chrome.runtime.id,
    browser = "chrome",
    version = chrome.runtime.getManifest().version
  } = {}) {
    if (isPlaceholderValue(productKey)) {
      return {
        registered: false,
        errorCode: "PRODUCT_KEY_PENDING"
      };
    }
    try {
      const response = await callEdgeFunction("register-installation", {
        requireAuth: true,
        body: {
          productKey,
          installationId: installationId ?? await getInstallationId(),
          extensionId,
          browser,
          version
        }
      });
      return {
        registered: response?.registered !== false,
        errorCode: response?.errorCode ?? null,
        currentInstallations: response?.currentInstallations ?? null,
        maxInstallations: response?.maxInstallations ?? null
      };
    } catch (error) {
      return {
        registered: false,
        errorCode: error.code ?? "REGISTER_INSTALLATION_FAILED"
      };
    }
  }

  const checkoutFlow = createCheckoutFlow({
    config: runtimeConfig,
    authFlow,
    callEdgeFunction,
    getInstallationId
  });

  const usageGate = createUsageGate({
    config: runtimeConfig,
    storage,
    authFlow,
    callEdgeFunction,
    getInstallationId,
    registerInstallation,
    getCachedEntitlement: () => readCachedEntitlement(runtimeConfig.productKey)
  });

  async function getAuthState() {
    const session = await authFlow.getStoredSession();
    const entitlement = await readCachedEntitlement(runtimeConfig.productKey);
    const usageState = await usageGate.getUsageState(runtimeConfig.featureKey);
    return {
      session: createSanitizedSessionSnapshot(session),
      loggedIn: Boolean(session?.accessToken),
      email: session?.user?.email ?? null,
      entitlement,
      entitlementState: inferEntitlementState(entitlement, runtimeConfig),
      installationId: await getInstallationId(),
      usageState,
      configSummary: {
        productKey: runtimeConfig.productKey,
        planKey: runtimeConfig.planKey,
        checkoutMode: runtimeConfig.checkoutMode,
        smtpLoginBlockerExpected: runtimeConfig.smtpLoginBlockerExpected,
        publicSupabaseConfigured: hasConfiguredPublicValue(runtimeConfig.publicSupabaseAnonKey)
      }
    };
  }

  async function handleMessage(message) {
    const type = `${message?.type ?? ""}`.trim();
    switch (type) {
      case "GET_AUTH_STATE":
        return {
          ok: true,
          data: await getAuthState()
        };
      case "SEND_OTP":
        return {
          ok: true,
          data: await authFlow.sendOtp(`${message.email ?? ""}`.trim())
        };
      case "VERIFY_OTP":
        return {
          ok: true,
          data: await authFlow.verifyOtp(`${message.email ?? ""}`.trim(), `${message.token ?? ""}`.trim())
        };
      case "SIGN_OUT":
        return {
          ok: true,
          data: await authFlow.signOut()
        };
      case "REFRESH_ENTITLEMENT":
        return {
          ok: true,
          data: await refreshEntitlement(message.productKey ?? runtimeConfig.productKey)
        };
      case "REGISTER_INSTALLATION":
        return {
          ok: true,
          data: await registerInstallation(message)
        };
      case "CREATE_CHECKOUT":
        return {
          ok: true,
          data: await checkoutFlow.createCheckout(message)
        };
      case "CONSUME_USAGE":
        return {
          ok: true,
          data: await usageGate.consumeUsage(
            message.featureKey ?? runtimeConfig.featureKey,
            Number(message.amount ?? 1)
          )
        };
      default:
        return {
          ok: false,
          error: "UNSUPPORTED_MESSAGE"
        };
    }
  }

  return {
    config: runtimeConfig,
    getAuthState,
    refreshEntitlement,
    registerInstallation,
    handleMessage
  };
}

export async function installMembershipBackgroundHandlers() {
  const service = await createMembershipBackgroundService();
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    service.handleMessage(message)
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error.code ?? error.message ?? "UNKNOWN_ERROR"
        });
      });
    return true;
  });
  return service;
}
