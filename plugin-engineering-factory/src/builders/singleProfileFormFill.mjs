import path from "node:path";
import { copyDir, ensureDir, writeJson, writeText } from "../utils/io.mjs";
import { applyMonetizationToBuilder } from "../monetization/integration.mjs";
import { createDraftIcon } from "../utils/png.mjs";
import { createZipFromDirectory } from "../utils/zip.mjs";

function popupScript() {
  return `const statusNode = document.getElementById("status");
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
  return Object.values(profile ?? {}).some((value) => \`\${value ?? ""}\`.trim().length > 0);
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
  return \`\${value ?? ""}\`.trim().toLowerCase();
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

  const parts = [\`Filled \${result.filled_count} fields.\`];
  if (result.skipped_count > 0) {
    parts.push(\`Skipped \${result.skipped_count}.\`);
  }
  if (result.overwrite_prevented_count > 0) {
    parts.push(\`Preserved \${result.overwrite_prevented_count} existing values.\`);
  }
  if (result.readonly_skipped_count > 0) {
    parts.push(\`Ignored \${result.readonly_skipped_count} locked fields.\`);
  }
  if (result.select_filled_count > 0) {
    parts.push(\`Updated \${result.select_filled_count} select fields.\`);
  }
  return parts.join(" ");
}

function fillVisibleFields(profile, options = {}) {
  function normalizeDescriptorTextForInjection(value) {
    return \`\${value ?? ""}\`.trim().toLowerCase();
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

    const parts = [\`Filled \${result.filled_count} fields.\`];
    if (result.skipped_count > 0) {
      parts.push(\`Skipped \${result.skipped_count}.\`);
    }
    if (result.overwrite_prevented_count > 0) {
      parts.push(\`Preserved \${result.overwrite_prevented_count} existing values.\`);
    }
    if (result.readonly_skipped_count > 0) {
      parts.push(\`Ignored \${result.readonly_skipped_count} locked fields.\`);
    }
    if (result.select_filled_count > 0) {
      parts.push(\`Updated \${result.select_filled_count} select fields.\`);
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
    if (!match.profileField || !\`\${match.value ?? ""}\`.trim()) {
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
      ? \`\${element.value ?? ""}\`
      : \`\${element.value ?? ""}\`.trim();
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
  const triggerSurface = \`\${stored.automation_trigger_surface ?? ""}\`.trim() || "action_popup";
  const triggerMethod = \`\${stored.automation_trigger_method ?? ""}\`.trim() || "_execute_action_shortcut";
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
`;
}

export async function buildSingleProfileFormFill({ runDir, brief, plan }) {
  const workspaceDir = path.join(runDir, "workspace");
  const repoDir = path.join(workspaceDir, "repo");
  const distDir = path.join(workspaceDir, "dist");
  const iconsDir = path.join(repoDir, "icons");
  await ensureDir(iconsDir);

  const extensionVersion = `${plan.build_version ?? "0.1.0"}`;
  let manifest = {
    manifest_version: 3,
    name: brief.product_name_working,
    version: extensionVersion,
    description: brief.listing_summary_seed,
    permissions: plan.permissions,
    action: {
      default_title: brief.product_name_working,
      default_popup: "popup.html"
    },
    commands: {
      _execute_action: {
        suggested_key: {
          default: "Ctrl+Shift+Y"
        }
      }
    },
    icons: {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  };

  let popupHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${brief.product_name_working}</title>
    <link rel="stylesheet" href="popup.css" />
  </head>
  <body>
    <main class="app">
      <h1>${brief.product_name_working}</h1>
      <p class="subhead">${brief.single_purpose_statement}</p>
      <p class="local-note">Local-only profile storage. No sync, no account, no hidden data transfer.</p>
      <label>First name <input id="firstName" type="text" autocomplete="given-name" /></label>
      <label>Last name <input id="lastName" type="text" autocomplete="family-name" /></label>
      <label class="full">Email <input id="email" type="email" autocomplete="email" /></label>
      <label>Company <input id="company" type="text" autocomplete="organization" /></label>
      <label>Phone <input id="phone" type="tel" autocomplete="tel" /></label>
      <label>Country <input id="country" type="text" autocomplete="country-name" /></label>
      <label class="full">Notes <textarea id="notes" rows="3" placeholder="Optional notes for textarea matching"></textarea></label>
      <label class="toggle">
        <input id="overwriteExisting" type="checkbox" />
        <span>Overwrite fields that already have values</span>
      </label>
      <div class="actions">
        <button id="save-profile" type="button">Save Profile</button>
        <button id="delete-profile" type="button" class="secondary">Delete Profile</button>
        <button id="fill-page" type="button" class="primary full-width">Fill Current Page</button>
      </div>
      <p id="status" aria-live="polite">Ready. Existing page values stay unchanged by default.</p>
    </main>
    <script type="module" src="popup.js"></script>
  </body>
</html>
`;

  let popupCss = `:root {
  color-scheme: light;
  font-family: "Segoe UI", sans-serif;
}

body {
  margin: 0;
  background: #f8f4ed;
  color: #3b2616;
}

.app {
  width: 360px;
  padding: 16px;
}

h1 {
  margin: 0 0 8px;
  font-size: 20px;
}

.subhead,
.local-note {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.45;
}

.local-note {
  color: #6f4f34;
}

label {
  display: block;
  margin-bottom: 10px;
  font-size: 12px;
}

.full {
  grid-column: 1 / -1;
}

input,
textarea {
  width: 100%;
  box-sizing: border-box;
  margin-top: 4px;
  border: 1px solid #d5c2ae;
  border-radius: 8px;
  padding: 9px 10px;
  font-size: 13px;
  resize: vertical;
}

.toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 14px 0;
}

.toggle input {
  width: auto;
  margin: 0;
}

.toggle span {
  font-size: 12px;
}

.actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 10px;
}

.full-width {
  grid-column: 1 / -1;
}

button {
  border: 0;
  border-radius: 10px;
  background: #9d5f2b;
  color: #fff;
  padding: 10px 8px;
  font-size: 13px;
  cursor: pointer;
}

button.secondary {
  background: #caa27a;
  color: #3b2616;
}

#status {
  min-height: 32px;
  margin: 12px 0 0;
  font-size: 12px;
  color: #6f4f34;
  line-height: 1.4;
}
`;

  let privacyHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${brief.product_name_working} Privacy</title>
  </head>
  <body>
    <main>
      <h1>${brief.product_name_working} Privacy</h1>
      <p>The extension stores one local profile in Chrome storage so the user can fill matching visible fields on the current page.</p>
      <p>No remote sync, analytics, or third-party requests are used.</p>
      <p>By default the extension does not overwrite fields that already contain values unless the user explicitly enables overwrite in the popup.</p>
      <p>The extension only injects a fill script into the active tab when the user clicks Fill Current Page.</p>
    </main>
  </body>
</html>
`;

  let readme = `# ${brief.product_name_working}

## Purpose
${brief.single_purpose_statement}

## Load Unpacked
1. Open Chrome extension management.
2. Enable Developer mode.
3. Choose Load unpacked and select the dist directory.

## Permissions
- storage: keep one local profile and overwrite preference
- activeTab: act only on the current page after the user clicks
- scripting: inject the form fill helper when needed

## Supported Fill Behavior
- Matches common text, email, phone, textarea, and select fields when descriptors align with the saved profile
- Skips readonly or disabled fields safely
- Preserves existing values by default unless the user enables overwrite
- Stores profile data locally only
`;
  let popupJs = popupScript();

  const monetization = await applyMonetizationToBuilder({
    runDir,
    repoDir,
    brief,
    plan,
    manifest,
    popupHtml,
    popupCss,
    popupJs,
    privacyHtml,
    readme,
    coreActionFunctionName: "fillCurrentPage",
    coreFeatureId: "single_profile_form_fill.fill_current_page"
  });
  manifest = monetization.manifest;
  popupHtml = monetization.popupHtml;
  popupCss = monetization.popupCss;
  popupJs = monetization.popupJs;
  privacyHtml = monetization.privacyHtml;
  readme = monetization.readme;

  await writeJson(path.join(repoDir, "manifest.json"), manifest);
  await writeText(path.join(repoDir, "popup.html"), popupHtml);
  await writeText(path.join(repoDir, "popup.css"), popupCss);
  await writeText(path.join(repoDir, "popup.js"), popupJs);
  await writeText(path.join(repoDir, "privacy.html"), privacyHtml);
  await writeText(path.join(repoDir, "README.md"), readme);
  await createDraftIcon(path.join(iconsDir, "icon16.png"), 16, "#9d5f2b");
  await createDraftIcon(path.join(iconsDir, "icon48.png"), 48, "#9d5f2b");
  await createDraftIcon(path.join(iconsDir, "icon128.png"), 128, "#9d5f2b");

  await copyDir(repoDir, distDir);
  const zipPath = path.join(workspaceDir, "package.zip");
  const zipSize = await createZipFromDirectory(distDir, zipPath);

  return {
    stage: "BUILD_EXTENSION",
    status: "passed",
    archetype: plan.archetype,
    workspace_repo: repoDir,
    workspace_dist: distDir,
    package_zip: zipPath,
    package_zip_size: zipSize,
    manifest_version: extensionVersion,
    monetization: monetization.monetization,
    generated_files: [
      "manifest.json",
      "popup.html",
      "popup.css",
      "popup.js",
      "privacy.html",
      "README.md",
      ...monetization.monetization.generatedFiles,
      "icons/icon16.png",
      "icons/icon48.png",
      "icons/icon128.png"
    ]
  };
}
