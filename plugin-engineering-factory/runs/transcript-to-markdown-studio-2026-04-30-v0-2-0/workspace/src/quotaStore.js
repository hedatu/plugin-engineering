import { storageGet, storageSet } from "./storage.js";

export const FREE_LIMIT = 10;
export const USAGE_KEY = "transcript_md_usage_count";
export const ENTITLEMENT_KEY = "transcript_md_entitlement";

export async function getUsageCount() {
  const stored = await storageGet([USAGE_KEY]);
  return Number(stored[USAGE_KEY] ?? 0) || 0;
}

export async function getEntitlement() {
  const stored = await storageGet([ENTITLEMENT_KEY]);
  const entitlement = stored[ENTITLEMENT_KEY];
  if (entitlement?.status === "active") {
    return entitlement;
  }
  return { status: "free" };
}

export async function getAccessStatus() {
  const entitlement = await getEntitlement();
  const used = await getUsageCount();
  const pro = entitlement.status === "active";
  return {
    pro,
    entitlement,
    used,
    limit: FREE_LIMIT,
    remaining: pro ? Infinity : Math.max(0, FREE_LIMIT - used),
    canConvert: pro || used < FREE_LIMIT
  };
}

export async function recordConversion() {
  const access = await getAccessStatus();
  if (access.pro) {
    return access;
  }
  const nextUsed = access.used + 1;
  await storageSet({ [USAGE_KEY]: nextUsed });
  return getAccessStatus();
}

export async function setMockEntitlement(status) {
  await storageSet({
    [ENTITLEMENT_KEY]: {
      status,
      updatedAt: new Date().toISOString()
    }
  });
}
