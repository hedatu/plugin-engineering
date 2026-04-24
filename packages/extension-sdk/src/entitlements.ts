import type { EntitlementResponse, UsageCounter } from './types'

export function isFeatureEnabled(entitlement: EntitlementResponse | null | undefined, featureKey: string) {
  return Boolean(entitlement?.features?.[featureKey])
}

export function getUsageCounter(entitlement: EntitlementResponse | null | undefined, featureKey: string): UsageCounter | undefined {
  return entitlement?.usage.find((item) => item.featureKey === featureKey)
}

export function getRemainingText(entitlement: EntitlementResponse | null | undefined, featureKey: string) {
  const quota = entitlement?.quotas?.[featureKey]
  if (!quota) {
    return '不限'
  }

  if (quota.limit === -1) {
    return '不限'
  }

  const usage = getUsageCounter(entitlement, featureKey)
  const remaining = usage?.remaining ?? quota.limit
  return `${remaining}/${quota.limit}`
}

export function needsUpgrade(entitlement: EntitlementResponse | null | undefined, featureKey: string) {
  return !isFeatureEnabled(entitlement, featureKey)
}

