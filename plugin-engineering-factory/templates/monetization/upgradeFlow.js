import { createLicenseClient } from "./licenseClient.js";
import { createUsageMeter } from "./usageMeter.js";
import { renderMonetizationSummary, renderPaywallBlockedState } from "./paywallView.js";

async function loadConfig(configUrl) {
  const response = await fetch(configUrl);
  if (!response.ok) {
    throw new Error(`Could not load monetization config from ${configUrl}.`);
  }
  return response.json();
}

export async function createMonetizationRuntime({
  configUrl,
  licensePageUrl,
  statusNode,
  planNode,
  freeLimitNode,
  usageNode,
  messageNode,
  trustNode,
  upgradeButton,
  licenseButton,
  restoreButton
}) {
  const config = await loadConfig(configUrl);
  const licenseClient = createLicenseClient(config);
  const usageMeter = createUsageMeter(config);

  function hasPaidAccess(entitlement) {
    return entitlement?.plan === "lifetime"
      || entitlement?.plan === "pro"
      || entitlement?.local_status === "offline_grace";
  }

  async function refreshUi() {
    const entitlement = await licenseClient.getEntitlementStatus();
    const usageState = await usageMeter.getState();
    renderMonetizationSummary({
      config,
      entitlement,
      usageState,
      planNode,
      usageNode,
      freeLimitNode,
      messageNode,
      trustNode
    });
    return { entitlement, usageState };
  }

  async function openUpgradePage() {
    await chrome.tabs.create({ url: config.upgrade_url });
    return true;
  }

  async function openLicensePage() {
    await chrome.tabs.create({ url: licensePageUrl });
    return true;
  }

  async function consumeOrBlock(featureId = "core_action") {
    const { entitlement, usageState } = await refreshUi();
    if (hasPaidAccess(entitlement)) {
      return {
        allowed: true,
        reason: entitlement?.local_status === "offline_grace"
          ? "offline_grace_active"
          : "paid_unlock_active",
        entitlement,
        usageState,
        message: entitlement?.message ?? "Pro access active."
      };
    }

    if ((usageState?.remaining ?? 0) > 0) {
      const nextUsage = await usageMeter.consume(featureId);
      renderMonetizationSummary({
        config,
        entitlement,
        usageState: nextUsage,
        planNode,
        usageNode,
        messageNode
      });
      return {
        allowed: true,
        reason: "free_usage_available",
        entitlement,
        usageState: nextUsage,
        message: `Free usage consumed. ${nextUsage.remaining} remaining.`
      };
    }

      renderPaywallBlockedState({
        config,
        planNode,
        usageNode,
        freeLimitNode,
        messageNode,
        trustNode
      });
      if (statusNode) {
        statusNode.textContent = `Free limit reached. Upgrade for ${config.price_label}.`;
      }
    return {
      allowed: false,
      reason: "free_limit_reached",
      entitlement,
      usageState,
      message: `Free limit reached. Upgrade for ${config.price_label}.`
    };
  }

  upgradeButton?.addEventListener("click", () => {
    openUpgradePage().catch((error) => {
      if (statusNode) {
        statusNode.textContent = `Upgrade failed: ${error.message}`;
      }
    });
  });

  licenseButton?.addEventListener("click", () => {
    openLicensePage().catch((error) => {
      if (statusNode) {
        statusNode.textContent = `License page failed: ${error.message}`;
      }
    });
  });

  restoreButton?.addEventListener("click", () => {
    openLicensePage().catch((error) => {
      if (statusNode) {
        statusNode.textContent = `Restore page failed: ${error.message}`;
      }
    });
  });

  await refreshUi();

  return {
    config,
    refreshUi,
    consumeOrBlock,
    openUpgradePage,
    openLicensePage,
    testHooks: {
      async setMockActiveEntitlement() {
        const mockEntitlement = {
          status: "active",
          plan: "lifetime",
          product_id: config.product_id,
          license_id: "mock-license-id",
          features: config.pro_features ?? [],
          free_limit: config.free_limit,
          usage_remaining: null,
          expires_at: null,
          verified_at: new Date().toISOString(),
          message: "Mock active entitlement is enabled."
        };
        await chrome.storage.local.set({
          monetization_debug_entitlement: mockEntitlement
        });
        return refreshUi();
      },
      async clearMockActiveEntitlement() {
        await chrome.storage.local.remove("monetization_debug_entitlement");
        return refreshUi();
      },
      async getConfig() {
        return config;
      }
    }
  };
}
