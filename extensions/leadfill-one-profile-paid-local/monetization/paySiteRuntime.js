import {
  createError,
  inferEntitlementState,
  loadPaySiteRuntimeConfig,
  sleep
} from "./paySiteConfig.js";

function setText(node, value) {
  if (node) {
    node.textContent = value;
  }
}

async function callMessage(payload) {
  return chrome.runtime.sendMessage(payload);
}

function usageLine(config, usageState) {
  if (usageState?.remaining === null || usageState?.remaining === undefined) {
    return "Unlimited fills available.";
  }
  return `${usageState.remaining} free actions left`;
}

function planLine(entitlementState) {
  return entitlementState.active ? "Pro Lifetime Active" : "Free";
}

function membershipCopy(config, entitlementState, usageState, authState) {
  if (entitlementState.active) {
    return "Pro is unlocked. Membership is active after webhook-confirmed entitlement.";
  }
  if (!authState.loggedIn) {
    return `Free plan includes ${config.freeLimit.amount} ${config.freeLimit.unit}. Upgrade opens the LeadFill pricing page.`;
  }
  return `Free plan includes ${config.freeLimit.amount} ${config.freeLimit.unit}. Upgrade on the external secure payment page, then refresh membership here.`;
}

export async function createPaySiteRuntime({
  monetizationConfigUrl = chrome.runtime.getURL("monetization_config.json"),
  paySiteConfigUrl = chrome.runtime.getURL("pay_site_config.json"),
  licensePageUrl = chrome.runtime.getURL("monetization/licensePage.html"),
  statusNode,
  planNode,
  freeLimitNode,
  usageNode,
  messageNode,
  trustNode,
  upgradeButton,
  licenseButton,
  restoreButton,
  refreshMembershipButton,
  authEmailInput,
  sendOtpButton,
  authCodeInput,
  verifyOtpButton,
  memberEmailNode,
  authStateNode,
  signOutButton,
  configStateNode
} = {}) {
  const config = await loadPaySiteRuntimeConfig({
    monetizationConfigUrl,
    paySiteConfigUrl
  });

  function render(authState) {
    const entitlementState = inferEntitlementState(authState.entitlement, config);
    setText(planNode, `Plan: ${planLine(entitlementState)}`);
    setText(freeLimitNode, `${config.freeLimit.amount} free fills`);
    setText(usageNode, usageLine(config, authState.usageState));
    setText(messageNode, membershipCopy(config, entitlementState, authState.usageState, authState));
    setText(
      trustNode,
      "Local-only form data. No upload of form content. Payment handled on external secure page. Membership unlocks after webhook-confirmed entitlement."
    );
    setText(memberEmailNode, authState.email ? `Signed in as ${authState.email}` : "Not signed in");
    setText(authStateNode, authState.loggedIn ? "Email login active." : "Login with email");
    setText(
      configStateNode,
      authState.configSummary.smtpLoginBlockerExpected
        ? "Real OTP delivery is still blocked by SMTP validation."
        : "OTP flow is configured."
    );
    return entitlementState;
  }

  async function refreshUi(statusMessage = "") {
    const response = await callMessage({ type: "GET_AUTH_STATE" });
    if (!response?.ok) {
      throw createError(response?.error ?? "GET_AUTH_STATE_FAILED", response?.error ?? "GET_AUTH_STATE_FAILED");
    }
    const authState = response.data;
    render(authState);
    if (statusMessage) {
      setText(statusNode, statusMessage);
    }
    return authState;
  }

  async function sendOtp() {
    const email = `${authEmailInput?.value ?? ""}`.trim();
    if (!email) {
      setText(statusNode, "Enter an email first.");
      return { ok: false };
    }
    const response = await callMessage({ type: "SEND_OTP", email });
    if (!response?.ok) {
      setText(statusNode, "Email login is not available yet. Please try again later.");
      return { ok: false, error: response?.error ?? "EMAIL_LOGIN_NOT_AVAILABLE" };
    }
    setText(statusNode, "Code sent. Check your email and paste the code below.");
    return { ok: true };
  }

  async function verifyOtp() {
    const email = `${authEmailInput?.value ?? ""}`.trim();
    const token = `${authCodeInput?.value ?? ""}`.trim();
    if (!email || !token) {
      setText(statusNode, "Enter both email and code.");
      return { ok: false };
    }
    const response = await callMessage({ type: "VERIFY_OTP", email, token });
    if (!response?.ok) {
      setText(statusNode, "Email login is not available yet. Please try again later.");
      return { ok: false, error: response?.error ?? "VERIFY_OTP_FAILED" };
    }
    await refreshUi("Email login complete.");
    return { ok: true };
  }

  async function signOut() {
    await callMessage({ type: "SIGN_OUT" });
    await refreshUi("Signed out.");
  }

  async function refreshMembership({ attempts = 1 } = {}) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const response = await callMessage({
        type: "REFRESH_ENTITLEMENT",
        productKey: config.productKey
      });
      if (response?.ok) {
        const authState = await refreshUi("Membership refreshed.");
        const entitlementState = inferEntitlementState(authState.entitlement, config);
        if (entitlementState.active) {
          setText(statusNode, "Pro unlocked.");
          return {
            ok: true,
            active: true
          };
        }
      } else if (response?.error === "LOGIN_REQUIRED") {
        setText(statusNode, "Log in with email to refresh membership.");
        return {
          ok: false,
          active: false,
          error: response.error
        };
      } else if (response?.error === "PRODUCT_NOT_FOUND") {
        setText(statusNode, "Payment product is not configured yet.");
        return {
          ok: false,
          active: false,
          error: response.error
        };
      }
      if (attempt < attempts) {
        await sleep(2000);
      }
    }
    setText(statusNode, "Payment may still be processing. Try again in a moment.");
    return {
      ok: true,
      active: false
    };
  }

  function buildUpgradePricingUrl(authState = {}) {
    const productKey = config.productKey ?? "leadfill-one-profile";
    const planKey = config.planKey ?? "lifetime";
    const baseUrl = config.upgradeUrl
      ?? `${config.siteUrl.replace(/\/$/, "")}/products/${encodeURIComponent(productKey)}/pricing`;
    const url = new URL(baseUrl, config.siteUrl);
    if (url.pathname === "/" || !url.pathname) {
      url.pathname = `/products/${encodeURIComponent(productKey)}/pricing`;
    }
    url.searchParams.set("source", "chrome_extension");
    url.searchParams.set("productKey", productKey);
    url.searchParams.set("planKey", planKey);
    if (authState.installationId) {
      url.searchParams.set("installationId", authState.installationId);
    }
    const extensionId = chrome.runtime.id
      || config.chromeExtensionId
      || config.extensionId
      || config.monetization?.extension_id;
    if (extensionId) {
      url.searchParams.set("extensionId", extensionId);
    }
    return url.toString();
  }

  async function requestUpgrade() {
    const authState = await refreshUi().catch(() => ({}));
    const pricingUrl = buildUpgradePricingUrl(authState);
    await chrome.tabs.create({ url: pricingUrl });
    setText(statusNode, "LeadFill pricing opened. Complete checkout on the website, then refresh membership here.");
    return {
      ok: true,
      opened: true,
      checkoutUrl: pricingUrl,
      upgradeUrl: pricingUrl
    };
  }

  async function consumeUsageGate(featureKey = config.featureKey) {
    const response = await callMessage({
      type: "CONSUME_USAGE",
      productKey: config.productKey,
      featureKey,
      amount: 1
    });
    if (!response?.ok) {
      const fallbackMessage = response?.error === "LOGIN_REQUIRED"
        ? "Log in with email to continue."
        : `Usage check failed: ${response?.error ?? "CONSUME_USAGE_FAILED"}`;
      setText(statusNode, fallbackMessage);
      return {
        allowed: false,
        message: fallbackMessage
      };
    }
    const result = response.data ?? {};
    await refreshUi();
    if (result.allowed === false) {
      const message = result.errorCode === "QUOTA_EXCEEDED"
        ? "Free limit reached. Open upgrade plans to continue."
        : result.errorCode === "FEATURE_NOT_ENABLED"
          ? "This plan does not include that feature."
          : "Usage blocked.";
      setText(statusNode, message);
      return {
        allowed: false,
        message,
        errorCode: result.errorCode ?? null
      };
    }
    return {
      allowed: true,
      message: result.degradedMode
        ? "Free usage recorded locally while membership sync is unavailable."
        : "Usage allowed.",
      degradedMode: result.degradedMode === true
    };
  }

  async function openMembershipPage() {
    await chrome.tabs.create({ url: licensePageUrl });
  }

  sendOtpButton?.addEventListener("click", () => {
    sendOtp().catch(() => {
      setText(statusNode, "Email login is not available yet. Please try again later.");
    });
  });
  verifyOtpButton?.addEventListener("click", () => {
    verifyOtp().catch(() => {
      setText(statusNode, "Email login is not available yet. Please try again later.");
    });
  });
  signOutButton?.addEventListener("click", () => {
    signOut().catch((error) => {
      setText(statusNode, error.message);
    });
  });
  refreshMembershipButton?.addEventListener("click", () => {
    refreshMembership({ attempts: 3 }).catch((error) => {
      setText(statusNode, error.message);
    });
  });
  upgradeButton?.addEventListener("click", () => {
    requestUpgrade().catch((error) => {
      setText(statusNode, error.message);
    });
  });
  licenseButton?.addEventListener("click", () => {
    openMembershipPage().catch((error) => {
      setText(statusNode, error.message);
    });
  });
  restoreButton?.addEventListener("click", () => {
    openMembershipPage().catch((error) => {
      setText(statusNode, error.message);
    });
  });

  await refreshUi();

  return {
    config,
    refreshUi,
    sendOtp,
    verifyOtp,
    signOut,
    refreshMembership,
    requestUpgrade,
    consumeUsageGate,
    openMembershipPage,
    testHooks: {
      async getAuthState() {
        return refreshUi();
      },
      async requestUpgradeWithoutOpeningUi() {
        return requestUpgrade();
      }
    }
  };
}
