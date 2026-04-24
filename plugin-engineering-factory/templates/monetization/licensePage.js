import { createLicenseClient } from "./licenseClient.js";
import { createUsageMeter } from "./usageMeter.js";
import { renderMonetizationSummary } from "./paywallView.js";

async function loadConfig() {
  const response = await fetch(chrome.runtime.getURL("monetization_config.json"));
  if (!response.ok) {
    throw new Error("Could not load monetization config.");
  }
  return response.json();
}

async function initialize() {
  const config = await loadConfig();
  const licenseClient = createLicenseClient(config);
  const usageMeter = createUsageMeter(config);

  const productNameNode = document.getElementById("product-name");
  const priceCopyNode = document.getElementById("price-copy");
  const planStatusNode = document.getElementById("plan-status");
  const usageStatusNode = document.getElementById("usage-status");
  const privacyNoteNode = document.getElementById("privacy-note");
  const licenseCacheNode = document.getElementById("license-cache");
  const statusNode = document.getElementById("status");
  const licenseInput = document.getElementById("license-key");

  if (productNameNode) {
    productNameNode.textContent = `${config.product_name} license activation`;
  }
  if (priceCopyNode) {
    priceCopyNode.textContent = `Free plan includes ${config.free_limit.amount} ${config.free_limit.unit}. Unlock ${config.price_label} on the external payment page, then activate or verify your license key here.`;
  }

  function formatStatus(entitlement, fallback) {
    const status = `${entitlement?.local_status ?? entitlement?.status ?? ""}`.trim().toLowerCase();
    if (status === "active") {
      return entitlement.message ?? "License active. Pro lifetime is available.";
    }
    if (status === "invalid") {
      return entitlement.message ?? "This license key is invalid.";
    }
    if (status === "expired") {
      return entitlement.message ?? "This license is expired.";
    }
    if (status === "revoked") {
      return entitlement.message ?? "This license has been revoked.";
    }
    if (status === "offline_grace") {
      return entitlement.message ?? "Offline grace is active. Reconnect later to verify again.";
    }
    return fallback ?? entitlement?.message ?? "Free plan active.";
  }

  async function refreshUi(message = "") {
    const entitlement = await licenseClient.getEntitlementStatus();
    const usageState = await usageMeter.getState();
    renderMonetizationSummary({
      config,
      entitlement,
      usageState,
      planNode: planStatusNode,
      usageNode: usageStatusNode,
      messageNode: privacyNoteNode,
      freeLimitNode: null,
      trustNode: licenseCacheNode
    });
    statusNode.textContent = formatStatus(entitlement, message);
  }

  document.getElementById("activate-license")?.addEventListener("click", async () => {
    try {
      const licenseKey = `${licenseInput?.value ?? ""}`.trim();
      if (!licenseKey) {
        statusNode.textContent = "Paste a license key first.";
        return;
      }
      const entitlement = await licenseClient.activateLicense(licenseKey);
      await refreshUi(entitlement.message ?? "License activated.");
    } catch (error) {
      statusNode.textContent = error.code === "network_error"
        ? "Network error. Reconnect and try license activation again."
        : `Activation failed: ${error.message}`;
    }
  });

  document.getElementById("verify-license")?.addEventListener("click", async () => {
    try {
      const licenseKey = `${licenseInput?.value ?? ""}`.trim();
      if (!licenseKey) {
        statusNode.textContent = "Paste a license key first.";
        return;
      }
      const entitlement = await licenseClient.verifyLicense(licenseKey);
      await refreshUi(entitlement.message ?? "License verified.");
    } catch (error) {
      statusNode.textContent = error.code === "network_error"
        ? "Network error. Reconnect and try license verification again."
        : `Verification failed: ${error.message}`;
    }
  });

  document.getElementById("restore-license")?.addEventListener("click", async () => {
    try {
      const licenseKey = `${licenseInput?.value ?? ""}`.trim();
      if (!licenseKey) {
        statusNode.textContent = "Paste a license key first.";
        return;
      }
      const entitlement = await licenseClient.restorePurchase(licenseKey);
      await refreshUi(entitlement.message ?? "Purchase restored.");
    } catch (error) {
      statusNode.textContent = error.code === "network_error"
        ? "Network error. Reconnect and try restore again."
        : `Restore failed: ${error.message}`;
    }
  });

  document.getElementById("open-upgrade")?.addEventListener("click", async () => {
    await chrome.tabs.create({ url: config.upgrade_url });
  });

  await refreshUi();
}

initialize().catch((error) => {
  const statusNode = document.getElementById("status");
  if (statusNode) {
    statusNode.textContent = `License page failed: ${error.message}`;
  }
});
