import { createPaySiteRuntime } from "./paySiteRuntime.js";

async function initialize() {
  await createPaySiteRuntime({
    monetizationConfigUrl: chrome.runtime.getURL("../monetization_config.json"),
    paySiteConfigUrl: chrome.runtime.getURL("../pay_site_config.json"),
    licensePageUrl: chrome.runtime.getURL("licensePage.html"),
    statusNode: document.getElementById("status"),
    planNode: document.getElementById("plan-badge"),
    freeLimitNode: document.getElementById("free-limit-copy"),
    usageNode: document.getElementById("usage-remaining"),
    messageNode: document.getElementById("monetization-message"),
    trustNode: document.getElementById("monetization-trust"),
    upgradeButton: document.getElementById("upgrade-button"),
    licenseButton: null,
    restoreButton: document.getElementById("restore-license-button"),
    refreshMembershipButton: document.getElementById("refresh-membership-button"),
    authEmailInput: document.getElementById("auth-email"),
    sendOtpButton: document.getElementById("send-otp-button"),
    authCodeInput: document.getElementById("auth-code"),
    verifyOtpButton: document.getElementById("verify-otp-button"),
    memberEmailNode: document.getElementById("member-email"),
    authStateNode: document.getElementById("auth-state-copy"),
    signOutButton: document.getElementById("sign-out-button"),
    configStateNode: document.getElementById("config-state-copy")
  });
}

initialize().catch((error) => {
  const statusNode = document.getElementById("status");
  if (statusNode) {
    statusNode.textContent = error.message;
  }
});
