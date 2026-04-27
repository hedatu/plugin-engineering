function formatLimit(limit) {
  if (!limit) {
    return "Free plan available.";
  }
  return `${limit.amount} free ${limit.unit}`;
}

function isPaidEntitlement(entitlement) {
  return entitlement?.plan === "lifetime" || entitlement?.plan === "pro";
}

export function renderMonetizationSummary({
  config,
  entitlement,
  usageState,
  planNode,
  freeLimitNode,
  usageNode,
  messageNode,
  trustNode
}) {
  if (planNode) {
    const planLabel = isPaidEntitlement(entitlement)
      ? "Pro Lifetime Active"
      : "Free";
    planNode.textContent = `Plan: ${planLabel}`;
  }

  if (freeLimitNode) {
    freeLimitNode.textContent = `${config?.free_limit?.amount ?? 10} free ${config?.free_limit?.unit ?? "fills"}`;
  }

  if (usageNode) {
    if (isPaidEntitlement(entitlement)) {
      usageNode.textContent = "Unlimited fills unlocked.";
    } else {
      const remaining = usageState?.remaining ?? config?.free_limit?.amount ?? 0;
      const unit = config?.free_limit?.unit ?? "fills";
      usageNode.textContent = `${remaining} free ${unit} left`;
    }
  }

  if (messageNode) {
    messageNode.textContent = entitlement?.message
      ?? `Free plan includes ${formatLimit(config?.free_limit)}. Upgrade uses an external payment page and license activation.`;
  }

  if (trustNode) {
    trustNode.textContent = "Local-only. No upload. No cloud sync. Lifetime access to the current major version.";
  }
}

export function renderPaywallBlockedState({
  config,
  planNode,
  freeLimitNode,
  usageNode,
  messageNode,
  trustNode
}) {
  renderMonetizationSummary({
    config,
    entitlement: {
      plan: "free",
      message: "Free limit reached. Open the LeadFill pricing page to choose an upgrade plan."
    },
    usageState: { remaining: 0 },
    planNode,
    freeLimitNode,
    usageNode,
    messageNode,
    trustNode
  });
}
