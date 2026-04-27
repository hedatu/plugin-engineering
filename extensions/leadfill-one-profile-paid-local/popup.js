import { createPaySiteRuntime } from "./monetization/paySiteRuntime.js";

const statusNode = document.getElementById("status");
let paySiteRuntimePromise = null;

function paySiteStatusNodes() {
  return {
    statusNode,
    planNode: document.getElementById("plan-badge"),
    freeLimitNode: document.getElementById("free-limit-copy"),
    usageNode: document.getElementById("usage-remaining"),
    messageNode: document.getElementById("monetization-message"),
    trustNode: document.getElementById("monetization-trust"),
    upgradeButton: document.getElementById("upgrade-button"),
    licenseButton: document.getElementById("open-license-page"),
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
  };
}

async function ensurePaySiteRuntime() {
  if (!paySiteRuntimePromise) {
    paySiteRuntimePromise = createPaySiteRuntime({
      monetizationConfigUrl: chrome.runtime.getURL("monetization_config.json"),
      paySiteConfigUrl: chrome.runtime.getURL("pay_site_config.json"),
      licensePageUrl: chrome.runtime.getURL("monetization/licensePage.html"),
      ...paySiteStatusNodes()
    });
  }
  return paySiteRuntimePromise;
}

async function guardPaidFeatureUsage(featureId = "single_profile_form_fill.fill_current_page") {
  const runtime = await ensurePaySiteRuntime();
  const gate = await runtime.consumeUsageGate(featureId);
  if (!gate.allowed) {
    statusNode.textContent = gate.message;
  }
  return gate;
}


const overwriteNode = document.getElementById("overwriteExisting");
const profileFields = ["firstName", "lastName", "email", "company", "phone", "country", "notes"];
const popupParams = new URLSearchParams(location.search);
const automationSetupOnly = popupParams.get("automation_setup") === "1";

function emptyProfile() {
  return {
    firstName: "",
    lastName: "",
    email: "",
    company: "",
    phone: "",
    country: "",
    notes: ""
  };
}

function defaultOptions() {
  return {
    overwriteExisting: false
  };
}

function hasAnyProfileValue(profile) {
  return Object.values(profile ?? {}).some((value) => `${value ?? ""}`.trim().length > 0);
}

function collectProfileFromForm() {
  const profile = emptyProfile();
  for (const field of profileFields) {
    const input = document.getElementById(field);
    profile[field] = input ? input.value.trim() : "";
  }
  return profile;
}

function collectOptionsFromForm() {
  return {
    overwriteExisting: overwriteNode?.checked === true
  };
}

async function loadProfile() {
  const stored = await chrome.storage.local.get(["profile", "profile_options"]);
  const profile = {
    ...emptyProfile(),
    ...(stored.profile ?? {})
  };
  const options = {
    ...defaultOptions(),
    ...(stored.profile_options ?? {})
  };

  for (const field of profileFields) {
    const input = document.getElementById(field);
    if (input) {
      input.value = profile[field] ?? "";
    }
  }
  if (overwriteNode) {
    overwriteNode.checked = options.overwriteExisting === true;
  }
}

async function saveProfile() {
  const profile = collectProfileFromForm();
  const options = collectOptionsFromForm();
  await chrome.storage.local.set({
    profile,
    profile_options: options
  });
  statusNode.textContent = options.overwriteExisting
    ? "Profile saved locally. Existing fields will be overwritten."
    : "Profile saved locally. Existing fields stay unchanged by default.";
  return { profile, options };
}

async function deleteProfile() {
  await chrome.storage.local.remove(["profile", "profile_options"]);
  for (const field of profileFields) {
    const input = document.getElementById(field);
    if (input) {
      input.value = "";
    }
  }
  if (overwriteNode) {
    overwriteNode.checked = false;
  }
  statusNode.textContent = "Profile deleted from local storage.";
}

async function writeAutomationResult(update) {
  const stored = await chrome.storage.local.get("automation_result");
  const next = {
    ...(stored.automation_result ?? {}),
    ...update,
    updated_at: new Date().toISOString()
  };
  await chrome.storage.local.set({ automation_result: next });
  return next;
}

function normalizeDescriptorText(value) {
  return `${value ?? ""}`.trim().toLowerCase();
}

function buildDescriptor(element) {
  return [
    element.name,
    element.id,
    element.placeholder,
    element.getAttribute("aria-label"),
    element.labels?.[0]?.textContent,
    element.closest("label")?.textContent
  ].filter(Boolean).join(" ");
}

function guessProfileMatch(profile, descriptorText) {
  if (!descriptorText) {
    return { profileField: null, value: "" };
  }
  if (descriptorText.includes("first")) return { profileField: "firstName", value: profile.firstName };
  if (descriptorText.includes("last")) return { profileField: "lastName", value: profile.lastName };
  if (descriptorText.includes("mail")) return { profileField: "email", value: profile.email };
  if (descriptorText.includes("company") || descriptorText.includes("organization")) return { profileField: "company", value: profile.company };
  if (descriptorText.includes("phone") || descriptorText.includes("mobile") || descriptorText.includes("tel")) return { profileField: "phone", value: profile.phone };
  if (descriptorText.includes("country") || descriptorText.includes("nation") || descriptorText.includes("region")) return { profileField: "country", value: profile.country };
  if (descriptorText.includes("note") || descriptorText.includes("message") || descriptorText.includes("description") || descriptorText.includes("comment")) {
    return { profileField: "notes", value: profile.notes };
  }
  return { profileField: null, value: "" };
}

function isVisibleForFill(element) {
  const style = window.getComputedStyle(element);
  return style.display !== "none"
    && style.visibility !== "hidden"
    && !element.hidden;
}

function findSelectOptionValue(select, desiredValue) {
  const normalizedDesired = normalizeDescriptorText(desiredValue);
  if (!normalizedDesired) {
    return null;
  }

  const exact = [...select.options].find((option) => {
    return normalizeDescriptorText(option.value) === normalizedDesired
      || normalizeDescriptorText(option.textContent) === normalizedDesired;
  });
  if (exact) {
    return exact.value;
  }

  const partial = [...select.options].find((option) => {
    const optionText = normalizeDescriptorText(option.textContent);
    const optionValue = normalizeDescriptorText(option.value);
    return optionText.includes(normalizedDesired)
      || normalizedDesired.includes(optionText)
      || optionValue.includes(normalizedDesired)
      || normalizedDesired.includes(optionValue);
  });
  return partial ? partial.value : null;
}

function dispatchFieldEvents(element) {
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function buildStatusMessage(result) {
  if (result.no_match_detected) {
    return "No matching fields found on this page.";
  }

  const parts = [`Filled ${result.filled_count} fields.`];
  if (result.skipped_count > 0) {
    parts.push(`Skipped ${result.skipped_count}.`);
  }
  if (result.overwrite_prevented_count > 0) {
    parts.push(`Preserved ${result.overwrite_prevented_count} existing values.`);
  }
  if (result.readonly_skipped_count > 0) {
    parts.push(`Ignored ${result.readonly_skipped_count} locked fields.`);
  }
  if (result.select_filled_count > 0) {
    parts.push(`Updated ${result.select_filled_count} select fields.`);
  }
  return parts.join(" ");
}

function fillVisibleFields(profile, options = {}) {
  function normalizeDescriptorTextForInjection(value) {
    return `${value ?? ""}`.trim().toLowerCase();
  }

  function buildDescriptorForInjection(element) {
    return [
      element.name,
      element.id,
      element.placeholder,
      element.getAttribute("aria-label"),
      element.labels?.[0]?.textContent,
      element.closest("label")?.textContent
    ].filter(Boolean).join(" ");
  }

  function guessProfileMatchForInjection(nextProfile, descriptorText) {
    if (!descriptorText) {
      return { profileField: null, value: "" };
    }
    if (descriptorText.includes("first")) return { profileField: "firstName", value: nextProfile.firstName };
    if (descriptorText.includes("last")) return { profileField: "lastName", value: nextProfile.lastName };
    if (descriptorText.includes("mail")) return { profileField: "email", value: nextProfile.email };
    if (descriptorText.includes("company") || descriptorText.includes("organization")) return { profileField: "company", value: nextProfile.company };
    if (descriptorText.includes("phone") || descriptorText.includes("mobile") || descriptorText.includes("tel")) return { profileField: "phone", value: nextProfile.phone };
    if (descriptorText.includes("country") || descriptorText.includes("nation") || descriptorText.includes("region")) return { profileField: "country", value: nextProfile.country };
    if (descriptorText.includes("note") || descriptorText.includes("message") || descriptorText.includes("description") || descriptorText.includes("comment")) {
      return { profileField: "notes", value: nextProfile.notes };
    }
    return { profileField: null, value: "" };
  }

  function isVisibleForFillForInjection(element) {
    const style = window.getComputedStyle(element);
    return style.display !== "none"
      && style.visibility !== "hidden"
      && !element.hidden;
  }

  function findSelectOptionValueForInjection(select, desiredValue) {
    const normalizedDesired = normalizeDescriptorTextForInjection(desiredValue);
    if (!normalizedDesired) {
      return null;
    }

    const exact = [...select.options].find((option) => {
      return normalizeDescriptorTextForInjection(option.value) === normalizedDesired
        || normalizeDescriptorTextForInjection(option.textContent) === normalizedDesired;
    });
    if (exact) {
      return exact.value;
    }

    const partial = [...select.options].find((option) => {
      const optionText = normalizeDescriptorTextForInjection(option.textContent);
      const optionValue = normalizeDescriptorTextForInjection(option.value);
      return optionText.includes(normalizedDesired)
        || normalizedDesired.includes(optionText)
        || optionValue.includes(normalizedDesired)
        || normalizedDesired.includes(optionValue);
    });
    return partial ? partial.value : null;
  }

  function dispatchFieldEventsForInjection(element) {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function buildStatusMessageForInjection(result) {
    if (result.no_match_detected) {
      return "No matching fields found on this page.";
    }

    const parts = [`Filled ${result.filled_count} fields.`];
    if (result.skipped_count > 0) {
      parts.push(`Skipped ${result.skipped_count}.`);
    }
    if (result.overwrite_prevented_count > 0) {
      parts.push(`Preserved ${result.overwrite_prevented_count} existing values.`);
    }
    if (result.readonly_skipped_count > 0) {
      parts.push(`Ignored ${result.readonly_skipped_count} locked fields.`);
    }
    if (result.select_filled_count > 0) {
      parts.push(`Updated ${result.select_filled_count} select fields.`);
    }
    return parts.join(" ");
  }

  const overwriteExisting = options?.overwriteExisting === true;
  const elements = Array.from(document.querySelectorAll("input, textarea, select"));
  const result = {
    filled_count: 0,
    skipped_count: 0,
    readonly_skipped_count: 0,
    select_filled_count: 0,
    matched_count: 0,
    matched_fields: [],
    skipped_fields: [],
    overwrite_prevented: false,
    overwrite_prevented_count: 0,
    no_match_detected: false,
    popup_feedback_verified: false
  };

  for (const element of elements) {
    if (!isVisibleForFillForInjection(element)) {
      continue;
    }

    const descriptor = buildDescriptorForInjection(element);
    const normalizedDescriptor = normalizeDescriptorTextForInjection(descriptor);
    const match = guessProfileMatchForInjection(profile, normalizedDescriptor);
    if (!match.profileField || !`${match.value ?? ""}`.trim()) {
      continue;
    }

    result.matched_count += 1;
    result.matched_fields.push({
      descriptor,
      profile_field: match.profileField,
      element_tag: element.tagName.toLowerCase(),
      element_id: element.id || null,
      element_name: element.name || null
    });

    if (element.disabled || element.readOnly) {
      result.skipped_count += 1;
      result.readonly_skipped_count += 1;
      result.skipped_fields.push({
        descriptor,
        profile_field: match.profileField,
        reason: "readonly_or_disabled"
      });
      continue;
    }

    const currentValue = element.tagName === "SELECT"
      ? `${element.value ?? ""}`
      : `${element.value ?? ""}`.trim();
    if (currentValue && !overwriteExisting) {
      result.skipped_count += 1;
      result.overwrite_prevented = true;
      result.overwrite_prevented_count += 1;
      result.skipped_fields.push({
        descriptor,
        profile_field: match.profileField,
        reason: "existing_value_preserved"
      });
      continue;
    }

    if (element.tagName === "SELECT") {
      const nextValue = findSelectOptionValueForInjection(element, match.value);
      if (!nextValue) {
        result.skipped_count += 1;
        result.skipped_fields.push({
          descriptor,
          profile_field: match.profileField,
          reason: "select_option_not_found"
        });
        continue;
      }
      element.focus();
      element.value = nextValue;
      dispatchFieldEventsForInjection(element);
      result.filled_count += 1;
      result.select_filled_count += 1;
      continue;
    }

    element.focus();
    element.value = match.value;
    dispatchFieldEventsForInjection(element);
    result.filled_count += 1;
  }

  result.no_match_detected = result.matched_count === 0;
  result.status_message = buildStatusMessageForInjection(result);
  return result;
}

async function fillCurrentPage(forcedTabId = null) {
  const monetizationGate = await guardPaidFeatureUsage("single_profile_form_fill.fill_current_page");
  if (!monetizationGate.allowed) {
    return null;
  }

  const stored = await chrome.storage.local.get(["profile", "profile_options"]);
  const profile = {
    ...emptyProfile(),
    ...(stored.profile ?? {})
  };
  const options = {
    ...defaultOptions(),
    ...(stored.profile_options ?? {})
  };

  if (!hasAnyProfileValue(profile)) {
    throw new Error("Save at least one profile value before filling.");
  }

  let tabId = Number.isInteger(forcedTabId) ? forcedTabId : null;
  if (!tabId) {
    const automation = await chrome.storage.local.get("automation_target_tab_id");
    tabId = Number.isInteger(automation.automation_target_tab_id) ? automation.automation_target_tab_id : null;
  }
  if (!tabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id ?? null;
  }
  if (!tabId) {
    throw new Error("No active tab available for fill.");
  }

  const executionResults = await chrome.scripting.executeScript({
    target: { tabId },
    func: fillVisibleFields,
    args: [profile, options]
  });
  const result = executionResults?.[0]?.result ?? null;
  if (!result || typeof result.filled_count !== "number") {
    throw new Error("Fill script did not return a valid result.");
  }

  statusNode.textContent = result.status_message || buildStatusMessage(result);
  return {
    ...result,
    tabId,
    overwrite_existing: options.overwriteExisting === true
  };
}

async function maybeRunAutomationMode() {
  if (automationSetupOnly) {
    return;
  }

  const stored = await chrome.storage.local.get([
    "automation_mode",
    "automation_target_tab_id",
    "automation_run_id",
    "automation_trigger_surface",
    "automation_trigger_method"
  ]);
  const runId = stored.automation_run_id ?? "";
  const targetTabId = Number.isInteger(stored.automation_target_tab_id) ? stored.automation_target_tab_id : null;
  const triggerSurface = `${stored.automation_trigger_surface ?? ""}`.trim() || "action_popup";
  const triggerMethod = `${stored.automation_trigger_method ?? ""}`.trim() || "_execute_action_shortcut";
  if (stored.automation_mode !== "form_fill_smoke") {
    return;
  }

  await writeAutomationResult({
    run_id: runId,
    status: "running",
    trigger_surface: triggerSurface,
    trigger_method: triggerMethod,
    popup_opened: true,
    fill_executed_via: "popup_domcontentloaded",
    active_tab_expected: targetTabId,
    started_at: new Date().toISOString()
  });

  try {
    const result = await fillCurrentPage(targetTabId ?? null);
    await writeAutomationResult({
      run_id: runId,
      status: "passed",
      popup_opened: true,
      fill_executed_via: "popup_domcontentloaded",
      trigger_surface: triggerSurface,
      trigger_method: triggerMethod,
      active_tab_expected: targetTabId ?? result.tabId ?? null,
      target_tab_id: result.tabId,
      filled: result.filled_count,
      filled_count: result.filled_count,
      skipped_count: result.skipped_count,
      readonly_skipped_count: result.readonly_skipped_count,
      select_filled_count: result.select_filled_count,
      matched_count: result.matched_count,
      matched_fields: result.matched_fields,
      skipped_fields: result.skipped_fields,
      no_match_detected: result.no_match_detected === true,
      overwrite_prevented: result.overwrite_prevented === true,
      overwrite_prevented_count: result.overwrite_prevented_count,
      overwrite_existing: result.overwrite_existing === true,
      status_text: result.status_message,
      completed_at: new Date().toISOString(),
      failure_reason: ""
    });
    window.setTimeout(() => window.close(), 250);
  } catch (error) {
    statusNode.textContent = "Fill failed: " + error.message;
    await writeAutomationResult({
      run_id: runId,
      status: "failed",
      popup_opened: true,
      fill_executed_via: "popup_domcontentloaded",
      trigger_surface: triggerSurface,
      trigger_method: triggerMethod,
      active_tab_expected: targetTabId,
      status_text: "Fill failed: " + error.message,
      completed_at: new Date().toISOString(),
      failure_reason: error.message
    });
  }
}

document.getElementById("save-profile").addEventListener("click", () => {
  saveProfile().catch((error) => {
    statusNode.textContent = "Save failed: " + error.message;
  });
});

document.getElementById("delete-profile").addEventListener("click", () => {
  deleteProfile().catch((error) => {
    statusNode.textContent = "Delete failed: " + error.message;
  });
});

document.getElementById("fill-page").addEventListener("click", () => {
  fillCurrentPage().catch((error) => {
    statusNode.textContent = "Fill failed: " + error.message;
  });
});

async function initializePopup() {
  await loadProfile();
  await maybeRunAutomationMode();
}

globalThis.__leadFillTestHooks = {
  loadProfile,
  saveProfile,
  deleteProfile,
  fillCurrentPage
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initializePopup().catch((error) => {
      statusNode.textContent = "Load failed: " + error.message;
    });
  }, { once: true });
} else {
  initializePopup().catch((error) => {
    statusNode.textContent = "Load failed: " + error.message;
  });
}


ensurePaySiteRuntime().catch((error) => {
  statusNode.textContent = "Membership failed: " + error.message;
});

globalThis.__monetizationTestHooks = {
  ensurePaySiteRuntime,
  guardPaidFeatureUsage
};
