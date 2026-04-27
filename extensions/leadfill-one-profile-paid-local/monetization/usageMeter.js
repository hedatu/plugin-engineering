const USAGE_STORAGE_KEY = "monetization_usage";

function nowIso() {
  return new Date().toISOString();
}

function normalizeLimit(config) {
  const freeLimit = config?.free_limit ?? {};
  return {
    amount: Number(freeLimit.amount ?? 10),
    unit: freeLimit.unit ?? "actions",
    scope: freeLimit.scope ?? "lifetime"
  };
}

function createDefaultUsageState(config) {
  const limit = normalizeLimit(config);
  return {
    limit,
    used: 0,
    remaining: limit.amount,
    updated_at: nowIso()
  };
}

export function createUsageMeter(config, storage = chrome.storage.local) {
  return {
    async getState() {
      const stored = await storage.get(USAGE_STORAGE_KEY);
      const current = stored?.[USAGE_STORAGE_KEY] ?? createDefaultUsageState(config);
      const limit = normalizeLimit(config);
      return {
        limit,
        used: Number(current.used ?? 0),
        remaining: Math.max(limit.amount - Number(current.used ?? 0), 0),
        updated_at: current.updated_at ?? nowIso()
      };
    },

    async consume(featureId = "core_action") {
      const current = await this.getState();
      const used = current.used + 1;
      const next = {
        limit: current.limit,
        used,
        remaining: Math.max(current.limit.amount - used, 0),
        updated_at: nowIso(),
        last_feature_id: featureId
      };
      await storage.set({ [USAGE_STORAGE_KEY]: next });
      return next;
    },

    async setUsed(used) {
      const limit = normalizeLimit(config);
      const next = {
        limit,
        used: Math.max(Number(used ?? 0), 0),
        remaining: Math.max(limit.amount - Math.max(Number(used ?? 0), 0), 0),
        updated_at: nowIso()
      };
      await storage.set({ [USAGE_STORAGE_KEY]: next });
      return next;
    },

    async reset() {
      const next = createDefaultUsageState(config);
      await storage.set({ [USAGE_STORAGE_KEY]: next });
      return next;
    }
  };
}
