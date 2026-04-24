const ENTITLEMENT_STORAGE_KEY = "monetization_entitlement";
const INSTALL_ID_STORAGE_KEY = "anonymous_install_id";
const MASKED_LICENSE_STORAGE_KEY = "masked_license_key";

function nowIso() {
  return new Date().toISOString();
}

export function defaultEntitlementState(config = {}) {
  return {
    status: "free",
    local_status: "free",
    plan: "free",
    product_id: config.product_id ?? "",
    license_id: null,
    features: [],
    free_limit: config.free_limit ?? { amount: 10, unit: "actions", scope: "lifetime" },
    usage_remaining: config.free_limit?.amount ?? 10,
    expires_at: null,
    verified_at: null,
    message: "Free plan active."
  };
}

function isPaidEntitlement(entitlement) {
  const plan = `${entitlement?.plan ?? ""}`.trim().toLowerCase();
  return plan === "lifetime" || plan === "pro";
}

function supportsOfflineGrace(entitlement, config) {
  if (!isPaidEntitlement(entitlement) || !entitlement?.verified_at || !config?.offline_grace_hours) {
    return false;
  }
  const verifiedAt = new Date(entitlement.verified_at).getTime();
  if (!Number.isFinite(verifiedAt)) {
    return false;
  }
  const graceMs = Number(config.offline_grace_hours ?? 0) * 60 * 60 * 1000;
  return Date.now() - verifiedAt <= graceMs;
}

function maskLicenseKey(licenseKey) {
  const value = `${licenseKey ?? ""}`.trim();
  if (!value) {
    return "";
  }
  if (value.length <= 8) {
    return `${value.slice(0, 2)}****${value.slice(-2)}`;
  }
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

async function sha256Hex(input) {
  const buffer = new TextEncoder().encode(`${input ?? ""}`);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function getAnonymousInstallId(storage) {
  const stored = await storage.get(INSTALL_ID_STORAGE_KEY);
  if (stored?.[INSTALL_ID_STORAGE_KEY]) {
    return stored[INSTALL_ID_STORAGE_KEY];
  }
  const value = crypto.randomUUID();
  await storage.set({ [INSTALL_ID_STORAGE_KEY]: value });
  return value;
}

async function cacheEntitlement(storage, entitlement, licenseKey = "") {
  const next = {
    status: entitlement.status ?? "free",
    local_status: entitlement.local_status ?? entitlement.status ?? "free",
    plan: entitlement.plan ?? "free",
    product_id: entitlement.product_id ?? "",
    license_id: entitlement.license_id ?? null,
    features: Array.isArray(entitlement.features) ? entitlement.features : [],
    free_limit: entitlement.free_limit ?? null,
    usage_remaining: entitlement.usage_remaining ?? null,
    expires_at: entitlement.expires_at ?? null,
    verified_at: entitlement.verified_at ?? nowIso(),
    lifetime: entitlement.plan === "lifetime" || entitlement.lifetime === true,
    message: entitlement.message ?? ""
  };
  const payload = {
    [ENTITLEMENT_STORAGE_KEY]: next
  };
  if (licenseKey) {
    payload[MASKED_LICENSE_STORAGE_KEY] = {
      masked: maskLicenseKey(licenseKey),
      hash: await sha256Hex(licenseKey)
    };
  }
  await storage.set(payload);
  return next;
}

async function readCachedEntitlement(storage, config) {
  const stored = await storage.get([ENTITLEMENT_STORAGE_KEY, MASKED_LICENSE_STORAGE_KEY]);
  const cached = {
    ...defaultEntitlementState(config),
    ...(stored?.[ENTITLEMENT_STORAGE_KEY] ?? {})
  };
  return {
    entitlement: cached,
    masked_license_key: stored?.[MASKED_LICENSE_STORAGE_KEY] ?? null
  };
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.message ?? `License request failed with HTTP ${response.status}.`);
  }
  return body;
}

function createRequestPayload(config, installId, licenseKey = "") {
  return {
    license_key: `${licenseKey ?? ""}`.trim(),
    product_id: config.product_id,
    extension_id: chrome.runtime.id,
    anonymous_install_id: installId,
    version: chrome.runtime.getManifest().version
  };
}

function buildOfflineGraceEntitlement(entitlement) {
  return {
    ...entitlement,
    local_status: "offline_grace",
    message: "Offline grace is active. Reconnect later to refresh license status."
  };
}

function buildNetworkError(error) {
  const wrapped = new Error(error?.message ?? "Network request failed.");
  wrapped.code = "network_error";
  return wrapped;
}

export function createLicenseClient(config, storage = chrome.storage.local) {
  return {
    async getAnonymousInstallId() {
      return getAnonymousInstallId(storage);
    },

    async getCachedEntitlement() {
      return readCachedEntitlement(storage, config);
    },

    async getEntitlementStatus() {
      const debug = await storage.get("monetization_debug_entitlement");
      if (config.checkout_mode === "test" && debug?.monetization_debug_entitlement) {
        return cacheEntitlement(storage, {
          ...debug.monetization_debug_entitlement,
          local_status: debug.monetization_debug_entitlement.local_status ?? debug.monetization_debug_entitlement.status ?? "active",
          verified_at: debug.monetization_debug_entitlement.verified_at ?? nowIso()
        });
      }

      const { entitlement } = await readCachedEntitlement(storage, config);
      if (!config.license_verify_url) {
        return entitlement;
      }

      const ttlHours = Number(config.entitlement_cache_ttl_hours ?? 0);
      const verifiedAt = new Date(entitlement.verified_at ?? 0).getTime();
      const cacheFresh = ttlHours > 0
        && Number.isFinite(verifiedAt)
        && Date.now() - verifiedAt < ttlHours * 60 * 60 * 1000;
      if (cacheFresh) {
        return entitlement;
      }

      if (isPaidEntitlement(entitlement) && supportsOfflineGrace(entitlement, config)) {
        return buildOfflineGraceEntitlement(entitlement);
      }

      if (isPaidEntitlement(entitlement)) {
        return cacheEntitlement(storage, {
          ...defaultEntitlementState(config),
          message: "Reconnect and verify your license to restore Pro access."
        });
      }

      return entitlement;
    },

    async verifyLicense(licenseKey) {
      const installId = await getAnonymousInstallId(storage);
      try {
        const response = await postJson(config.license_verify_url, createRequestPayload(config, installId, licenseKey));
        return cacheEntitlement(storage, {
          ...defaultEntitlementState(config),
          ...response,
          local_status: response.local_status ?? response.status ?? "active",
          verified_at: response.verified_at ?? nowIso()
        }, licenseKey);
      } catch (error) {
        const { entitlement } = await readCachedEntitlement(storage, config);
        if (supportsOfflineGrace(entitlement, config)) {
          return buildOfflineGraceEntitlement(entitlement);
        }
        throw buildNetworkError(error);
      }
    },

    async activateLicense(licenseKey) {
      const installId = await getAnonymousInstallId(storage);
      const endpoint = config.license_activate_url || config.license_verify_url;
      try {
        const response = await postJson(endpoint, createRequestPayload(config, installId, licenseKey));
        return cacheEntitlement(storage, {
          ...defaultEntitlementState(config),
          ...response,
          local_status: response.local_status ?? response.status ?? "active",
          verified_at: response.verified_at ?? nowIso()
        }, licenseKey);
      } catch (error) {
        const { entitlement } = await readCachedEntitlement(storage, config);
        if (supportsOfflineGrace(entitlement, config)) {
          return buildOfflineGraceEntitlement(entitlement);
        }
        throw buildNetworkError(error);
      }
    },

    async restorePurchase(licenseKey) {
      return this.verifyLicense(licenseKey);
    },

    async clearCachedEntitlement() {
      await storage.remove([ENTITLEMENT_STORAGE_KEY, MASKED_LICENSE_STORAGE_KEY]);
    }
  };
}
