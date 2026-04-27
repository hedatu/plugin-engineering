import {
  hasConfiguredPublicValue,
  inferEntitlementState,
  localUsageStorageKey,
  nowIso
} from "./paySiteConfig.js";

function createUsagePayload(config, featureKey, existing = null) {
  const limit = Number(config.freeLimit?.amount ?? 10);
  const used = Number(existing?.used ?? 0);
  const remaining = Math.max(limit - used, 0);
  return {
    featureKey,
    limit,
    used,
    remaining,
    degradedMode: true,
    updatedAt: existing?.updatedAt ?? nowIso()
  };
}
export function createUsageGate({
  config,
  storage = chrome.storage.local,
  authFlow,
  callEdgeFunction,
  getInstallationId,
  registerInstallation,
  getCachedEntitlement
}) {
  async function readLocalUsage(featureKey) {
    const key = localUsageStorageKey(config.productKey, featureKey);
    const stored = await storage.get(key);
    return {
      key,
      state: createUsagePayload(config, featureKey, stored?.[key] ?? null)
    };
  }

  async function writeLocalUsage(featureKey, state) {
    const key = localUsageStorageKey(config.productKey, featureKey);
    const next = {
      ...createUsagePayload(config, featureKey, state),
      updatedAt: nowIso()
    };
    await storage.set({
      [key]: next
    });
    return next;
  }

  async function consumeLocalFallback(featureKey, amount = 1) {
    const { state } = await readLocalUsage(featureKey);
    const limit = Number(state.limit ?? config.freeLimit.amount ?? 10);
    const used = Number(state.used ?? 0);
    if (used >= limit) {
      return {
        allowed: false,
        errorCode: "QUOTA_EXCEEDED",
        used,
        limit,
        remaining: 0,
        degradedMode: true,
        source: "local_fallback"
      };
    }
    const next = await writeLocalUsage(featureKey, {
      ...state,
      used: used + amount,
      remaining: Math.max(limit - (used + amount), 0),
      degradedMode: true
    });
    return {
      allowed: true,
      used: next.used,
      limit: next.limit,
      remaining: next.remaining,
      degradedMode: true,
      source: "local_fallback"
    };
  }

  async function allowOfflineGrace(featureKey) {
    const entitlement = await getCachedEntitlement();
    const state = inferEntitlementState(entitlement, config);
    if (!state.active || state.status !== "offline_grace") {
      return null;
    }
    const { state: localState } = await readLocalUsage(featureKey);
    return {
      allowed: true,
      used: localState.used,
      limit: localState.limit,
      remaining: null,
      degradedMode: true,
      source: "offline_grace",
      planKey: entitlement.plan ?? "lifetime"
    };
  }

  async function consumeRemote(featureKey, amount = 1) {
    const installationId = await getInstallationId();
    return callEdgeFunction("consume-usage", {
      requireAuth: true,
      body: {
        productKey: config.productKey,
        featureKey,
        amount,
        installationId
      }
    });
  }

  return {
    async getUsageState(featureKey) {
      const { state } = await readLocalUsage(featureKey);
      return state;
    },

    async consumeUsage(featureKey, amount = 1) {
      const debug = await storage.get("membership.debug.consumeUsageResponse");
      if (config.checkoutMode === "test" && debug["membership.debug.consumeUsageResponse"]) {
        return debug["membership.debug.consumeUsageResponse"];
      }

      const session = await authFlow.getStoredSession();
      if (!session?.accessToken || !hasConfiguredPublicValue(config.publicSupabaseAnonKey)) {
        return consumeLocalFallback(featureKey, amount);
      }

      try {
        const response = await consumeRemote(featureKey, amount);
        return {
          allowed: response.allowed !== false,
          errorCode: response.errorCode ?? null,
          used: response.used ?? null,
          limit: response.limit ?? null,
          remaining: response.remaining ?? null,
          planKey: response.planKey ?? null,
          degradedMode: false,
          source: "remote"
        };
      } catch (error) {
        if (error.code === "INSTALLATION_NOT_REGISTERED") {
          const registration = await registerInstallation();
          if (registration?.registered === true) {
            const retry = await consumeRemote(featureKey, amount);
            return {
              allowed: retry.allowed !== false,
              errorCode: retry.errorCode ?? null,
              used: retry.used ?? null,
              limit: retry.limit ?? null,
              remaining: retry.remaining ?? null,
              planKey: retry.planKey ?? null,
              degradedMode: false,
              source: "remote_after_registration"
            };
          }
          return {
            allowed: false,
            errorCode: registration?.errorCode ?? "INSTALLATION_NOT_REGISTERED",
            used: null,
            limit: null,
            remaining: null,
            degradedMode: false,
            source: "registration_failed"
          };
        }
        if (error.code === "FEATURE_NOT_ENABLED" || error.code === "QUOTA_EXCEEDED") {
          return {
            allowed: false,
            errorCode: error.code,
            used: null,
            limit: null,
            remaining: 0,
            degradedMode: false,
            source: "remote"
          };
        }
        const offlineGrace = await allowOfflineGrace(featureKey);
        if (offlineGrace) {
          return offlineGrace;
        }
        return consumeLocalFallback(featureKey, amount);
      }
    }
  };
}
