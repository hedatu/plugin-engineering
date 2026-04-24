import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";
import puppeteer from "puppeteer-core";
import { ensureDir, fileExists, nowIso } from "../utils/io.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_IXBROWSER_API_URL = process.env.IXBROWSER_API_URL ?? "http://127.0.0.1:53200/api/v2";
const DEFAULT_IXBROWSER_PROFILE_ID = Number.parseInt(
  process.env.BROWSER_SMOKE_IXBROWSER_PROFILE_ID ?? process.env.IXBROWSER_PROFILE_ID ?? "56",
  10
);
const EXECUTE_ACTION_SHORTCUT_LABEL = "Ctrl+Shift+Y";
const EXECUTE_ACTION_SHORTCUT_KEYSTROKE = "Control+Shift+Y";

function joinUrl(baseUrl, pathname) {
  return new URL(pathname, baseUrl).toString();
}

function safeNumber(value) {
  return Number.isInteger(value) ? value : null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pressExecuteActionShortcut(keyboard) {
  await keyboard.down("Control");
  await keyboard.down("Shift");
  await keyboard.press("Y");
  await keyboard.up("Shift");
  await keyboard.up("Control");
}

function normalizeBrowserSmokeRuntime(value) {
  return ["auto", "dedicated_chromium", "ixbrowser"].includes(value)
    ? value
    : "auto";
}

function resolveCanonicalRuntime(value) {
  const requested = normalizeBrowserSmokeRuntime(value);
  return requested === "auto" ? "dedicated_chromium" : requested;
}

function browserRuntimeFields(browserDetails = null) {
  return {
    runtime: browserDetails?.runtime ?? null,
    browser_driver: browserDetails?.driver ?? null,
    browser_version: browserDetails?.browser_version ?? null,
    incompatibility_reason: browserDetails?.ixbrowser_incompatibility
      ?? browserDetails?.fallback_reason
      ?? null
  };
}

async function createAsciiExtensionCopy(sourceDir) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cef-browser-smoke-"));
  const extensionDir = path.join(tempRoot, "extension");
  await fs.cp(sourceDir, extensionDir, { recursive: true });
  return { tempRoot, extensionDir };
}

async function postIxBrowser({ baseUrl, action, payload }) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload ?? {})
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`iXBrowser HTTP ${response.status}: ${JSON.stringify(data)}`);
  }
  const error = data?.error ?? {};
  if (error.code && error.code !== 0) {
    throw new Error(`iXBrowser API error code=${error.code}: ${error.message ?? "unknown"}`);
  }
  return data?.data;
}

async function openIxBrowserProfile({ extensionDir }) {
  const profileId = DEFAULT_IXBROWSER_PROFILE_ID;
  if (!Number.isInteger(profileId)) {
    throw new Error("BROWSER_SMOKE_IXBROWSER_PROFILE_ID is not a valid integer.");
  }

  const profileList = await postIxBrowser({
    baseUrl: DEFAULT_IXBROWSER_API_URL,
    action: "profile-list",
    payload: { profile_id: profileId }
  });
  const profiles = Array.isArray(profileList?.data) ? profileList.data : [];
  if (profiles.length === 0) {
    throw new Error(`iXBrowser profile ${profileId} is not available.`);
  }

  const openResult = await postIxBrowser({
    baseUrl: DEFAULT_IXBROWSER_API_URL,
    action: "profile-open",
    payload: {
      profile_id: profileId,
      load_extensions: true,
      load_profile_info_page: false,
      cookies_backup: false,
      args: [
        "--disable-extension-welcome-page",
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`
      ]
    }
  });

  const debuggingAddress = openResult?.debugging_address;
  if (!debuggingAddress) {
    throw new Error(`iXBrowser profile ${profileId} did not return a debugging address.`);
  }

  const browser = await chromium.connectOverCDP(`http://${debuggingAddress}`);
  const browserVersion = await browser.version();
  return {
    browser,
    browserDetails: {
      driver: "playwright",
      runtime: "ixbrowser",
      browser_version: browserVersion,
      profile_id: profileId,
      api_url: DEFAULT_IXBROWSER_API_URL,
      debugging_address: debuggingAddress
    }
  };
}

async function resolveStandaloneChromeExecutablePath() {
  if (process.env.BROWSER_SMOKE_CHROME_EXECUTABLE && await fileExists(process.env.BROWSER_SMOKE_CHROME_EXECUTABLE)) {
    return process.env.BROWSER_SMOKE_CHROME_EXECUTABLE;
  }

  const directCandidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ].filter(Boolean);

  for (const candidate of directCandidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  const ixChromeRoot = path.join(os.homedir(), "AppData", "Roaming", "ixBrowser-Resources", "chrome");
  try {
    const entries = await fs.readdir(ixChromeRoot, { withFileTypes: true });
    const candidates = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(ixChromeRoot, entry.name, "chrome.exe"))
      .sort((left, right) => right.localeCompare(left));
    for (const candidate of candidates) {
      if (await fileExists(candidate)) {
        return candidate;
      }
    }
  } catch {
    // Fall through to the final error.
  }

  throw new Error("Could not find a standalone Chrome executable for browser smoke.");
}

async function openDedicatedPlaywrightContext({ extensionDir, incompatibility }) {
  const executablePath = await resolveStandaloneChromeExecutablePath();
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "cef-browser-smoke-profile-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath,
    acceptDownloads: true,
    args: [
      "--disable-extension-welcome-page",
      "--no-first-run",
      "--no-default-browser-check",
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`
    ]
  });
  const browserVersion = context.browser()?.version() ?? "";

  return {
    context,
    userDataDir,
    browserDetails: {
      driver: "playwright",
      runtime: "dedicated_chromium",
      browser_version: browserVersion,
      executable_path: executablePath,
      ixbrowser_incompatibility: incompatibility ?? null
    }
  };
}

async function openIxBrowserPuppeteerBrowser({ extensionDir }) {
  const profileId = DEFAULT_IXBROWSER_PROFILE_ID;
  if (!Number.isInteger(profileId)) {
    throw new Error("BROWSER_SMOKE_IXBROWSER_PROFILE_ID is not a valid integer.");
  }

  const openResult = await postIxBrowser({
    baseUrl: DEFAULT_IXBROWSER_API_URL,
    action: "profile-open",
    payload: {
      profile_id: profileId,
      load_extensions: true,
      load_profile_info_page: false,
      cookies_backup: false,
      args: [
        "--disable-extension-welcome-page",
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`
      ]
    }
  });

  const wsEndpoint = openResult?.ws ?? "";
  if (!wsEndpoint) {
    throw new Error(`iXBrowser profile ${profileId} did not return a browser websocket endpoint.`);
  }

  const browser = await puppeteer.connect({
    browserWSEndpoint: wsEndpoint,
    protocolTimeout: 120000
  });
  const browserVersion = await browser.version();

  return {
    browser,
    browserDetails: {
      driver: "puppeteer",
      runtime: "ixbrowser",
      browser_version: browserVersion,
      profile_id: profileId,
      api_url: DEFAULT_IXBROWSER_API_URL,
      browser_ws_endpoint: wsEndpoint
    }
  };
}

async function resolveDedicatedPuppeteerExecutablePath() {
  const directCandidates = [
    process.env.BROWSER_SMOKE_PUPPETEER_CHROME_EXECUTABLE,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ].filter(Boolean);

  for (const candidate of directCandidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return resolveStandaloneChromeExecutablePath();
}

async function openDedicatedPuppeteerBrowser({ incompatibility }) {
  const executablePath = await resolveDedicatedPuppeteerExecutablePath();
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "cef-puppeteer-browser-smoke-profile-"));
  const browser = await puppeteer.launch({
    headless: false,
    pipe: true,
    executablePath,
    userDataDir,
    enableExtensions: true,
    protocolTimeout: 120000,
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--window-position=0,0",
      "--window-size=1280,900"
    ]
  });
  const browserVersion = await browser.version();

  return {
    browser,
    userDataDir,
    browserDetails: {
      driver: "puppeteer",
      runtime: "dedicated_chromium",
      browser_version: browserVersion,
      executable_path: executablePath,
      ixbrowser_incompatibility: incompatibility ?? null
    }
  };
}

async function getPuppeteerExtensionById(browser, extensionId) {
  const extensions = await browser.extensions();
  const extension = extensions.get(extensionId) ?? null;
  if (!extension) {
    throw new Error(`Installed extension ${extensionId} was not visible through browser.extensions().`);
  }
  return extension;
}

async function recordPuppeteerScreenshot({ page, assetsDir, screenshots, fileName, stepId, sourceUrl }) {
  const targetPath = path.join(assetsDir, fileName);
  await page.setViewport({ width: 1280, height: 800 });
  await page.screenshot({ path: targetPath, type: "png" });
  screenshots.push({
    file_name: fileName,
    path: targetPath,
    step_id: stepId,
    source_url: sourceUrl,
    capture_kind: "viewport_png",
    capture_source: "browser_smoke_happy_path",
    from_happy_path: true,
    captured_at: nowIso()
  });
}

async function setPuppeteerDownloadBehavior({ browser, page, downloadDir }) {
  const browserSession = await browser.target().createCDPSession();
  await browserSession.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloadDir
  }).catch(() => {});

  const session = await page.target().createCDPSession();
  await session.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloadDir
  }).catch(() => {});
}

function expectedFormFillValues() {
  return {
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    company: "Analytical Engines",
    phone: "+1-415-555-0108",
    country: "United States",
    notes: "Interested in the enterprise rollout."
  };
}

function summarizeFormFillAutomationResult(automationResult, extra = {}, browserDriver = "puppeteer") {
  const {
    browser_driver: explicitBrowserDriver,
    ...restExtra
  } = extra ?? {};
  return {
    target_tab_id: safeNumber(automationResult?.target_tab_id),
    trigger_surface: automationResult?.trigger_surface ?? "action_popup",
    trigger_method: automationResult?.trigger_method ?? "_execute_action_shortcut",
    popup_opened: automationResult?.popup_opened === true,
    automation_result_received: Boolean(automationResult),
    fill_executed_via: automationResult?.fill_executed_via ?? "popup_domcontentloaded",
    active_tab_expected: safeNumber(automationResult?.active_tab_expected),
    automation_run_id: automationResult?.run_id ?? null,
    filled_count: safeNumber(automationResult?.filled_count ?? automationResult?.filled),
    skipped_count: safeNumber(automationResult?.skipped_count),
    readonly_skipped_count: safeNumber(automationResult?.readonly_skipped_count),
    select_filled_count: safeNumber(automationResult?.select_filled_count),
    matched_count: safeNumber(automationResult?.matched_count),
    no_match_detected: automationResult?.no_match_detected === true,
    overwrite_prevented: automationResult?.overwrite_prevented === true,
    overwrite_prevented_count: safeNumber(automationResult?.overwrite_prevented_count),
    status_text: automationResult?.status_text ?? null,
    ...restExtra,
    browser_driver: explicitBrowserDriver ?? browserDriver
  };
}

async function populatePopupProfile(setupPage, profile, overwriteExisting = false) {
  await setupPage.evaluate(({ nextProfile, nextOverwrite }) => {
    const fields = ["firstName", "lastName", "email", "company", "phone", "country", "notes"];
    for (const field of fields) {
      const input = document.getElementById(field);
      if (input) {
        input.value = nextProfile[field] ?? "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    const overwriteNode = document.getElementById("overwriteExisting");
    if (overwriteNode) {
      overwriteNode.checked = nextOverwrite === true;
      overwriteNode.dispatchEvent(new Event("input", { bubbles: true }));
      overwriteNode.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, {
    nextProfile: profile,
    nextOverwrite: overwriteExisting
  });
}

async function savePopupProfile(setupPage, profile, overwriteExisting = false) {
  await populatePopupProfile(setupPage, profile, overwriteExisting);
  const result = await setupPage.evaluate(async () => {
    if (typeof globalThis.__leadFillTestHooks?.saveProfile !== "function") {
      throw new Error("Popup saveProfile test hook is unavailable.");
    }
    await globalThis.__leadFillTestHooks.saveProfile();
    return document.getElementById("status")?.textContent?.trim() ?? "";
  });
  if (!result.includes("Profile saved locally.")) {
    throw new Error(`Unexpected save profile status: ${result}`);
  }
  return result;
}

async function deletePopupProfile(setupPage) {
  const result = await setupPage.evaluate(async () => {
    if (typeof globalThis.__leadFillTestHooks?.deleteProfile !== "function") {
      throw new Error("Popup deleteProfile test hook is unavailable.");
    }
    await globalThis.__leadFillTestHooks.deleteProfile();
    return document.getElementById("status")?.textContent?.trim() ?? "";
  });
  if (!result.includes("Profile deleted from local storage.")) {
    throw new Error(`Unexpected delete profile status: ${result}`);
  }
  return result;
}

async function getPopupStorageState(setupPage) {
  const stored = await getExtensionStorage(setupPage, ["profile", "profile_options"]);
  return {
    profile: stored.profile ?? null,
    profile_options: stored.profile_options ?? null
  };
}

async function openLeadFormVariantPage(browser, fixtureBaseUrl, variant) {
  const page = await browser.newPage();
  await page.goto(joinUrl(fixtureBaseUrl, `/lead-form?variant=${variant}`), { waitUntil: "load" });
  return page;
}

async function triggerFormFillAutomation({ setupPage, targetPage, scenarioId, extension }) {
  const automationRunId = `${scenarioId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const automationKeys = [
    "automation_mode",
    "automation_target_tab_id",
    "automation_trigger_surface",
    "automation_trigger_method",
    "automation_run_id",
    "automation_result"
  ];

  await targetPage.bringToFront();
  await targetPage.locator("body").click({ position: { x: 20, y: 20 } }).catch(() => {});

  let automationResult = null;
  let targetTabId = null;
  try {
    targetTabId = await setupPage.evaluate(async () => {
      const [target] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!target?.id) {
        throw new Error("Could not find the active target tab for automation.");
      }
      return target.id;
    });

    await setExtensionStorage(setupPage, {
      automation_mode: "form_fill_smoke",
      automation_target_tab_id: targetTabId,
      automation_trigger_surface: "action_popup",
      automation_trigger_method: "extension_action_trigger",
      automation_run_id: automationRunId,
      automation_result: {
        run_id: automationRunId,
        status: "pending",
        popup_opened: false,
        active_tab_expected: targetTabId,
        created_at: nowIso()
      }
    });

    if (typeof extension?.triggerAction === "function") {
      await extension.triggerAction(targetPage);
    } else {
      await targetPage.bringToFront();
      await delay(250);
      await pressExecuteActionShortcut(targetPage.keyboard);
      automationResult = await pollAutomationResult({
        page: setupPage,
        runId: automationRunId,
        timeoutMs: 2500
      });
      if (!automationResult && process.platform === "win32") {
        await sendWindowsExecuteActionShortcut({
          titleIncludes: await targetPage.title()
        });
        await delay(500);
      }
    }
    automationResult = automationResult ?? await waitForAutomationResult({
      page: setupPage,
      runId: automationRunId,
      timeoutMs: 15000
    });
  } finally {
    await removeExtensionStorage(setupPage, automationKeys).catch(() => {});
  }

  if (automationResult?.status !== "passed") {
    throw new Error(`Form-fill automation failed: ${automationResult?.failure_reason ?? "unknown failure"}`);
  }

  return {
    ...automationResult,
    target_tab_id: automationResult.target_tab_id ?? targetTabId,
    active_tab_expected: automationResult.active_tab_expected ?? targetTabId
  };
}

async function runLeadFormVariantScenario({
  browser,
  setupPage,
  extension,
  profile,
  fixtureBaseUrl,
  variant,
  scenarioId,
  verify,
  assetsDir = "",
  screenshots = [],
  screenshotBefore = null,
  screenshotAfter = null
}) {
  const page = await openLeadFormVariantPage(browser, fixtureBaseUrl, variant);
  try {
    await savePopupProfile(setupPage, profile, false);

    if (screenshotBefore) {
      await recordPuppeteerScreenshot({
        page,
        assetsDir,
        screenshots,
        fileName: screenshotBefore.fileName,
        stepId: screenshotBefore.stepId,
        sourceUrl: page.url()
      });
    }

    const automationResult = await triggerFormFillAutomation({
      setupPage,
      targetPage: page,
      scenarioId,
      extension
    });
    const verification = await verify({
      page,
      automationResult
    });

    if (screenshotAfter) {
      await recordPuppeteerScreenshot({
        page,
        assetsDir,
        screenshots,
        fileName: screenshotAfter.fileName,
        stepId: screenshotAfter.stepId,
        sourceUrl: page.url()
      });
    }

    return {
      id: scenarioId,
      status: "passed",
      verified: true,
      ...summarizeFormFillAutomationResult(automationResult, verification)
    };
  } catch (error) {
    return {
      id: scenarioId,
      status: "failed",
      verified: false,
      failure_reason: error.message
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function verifyEmptyFormScenario({ page, automationResult }) {
  const values = await page.evaluate(() => ({
    firstName: document.getElementById("lead-first-name")?.value ?? "",
    lastName: document.getElementById("lead-last-name")?.value ?? "",
    email: document.getElementById("lead-email")?.value ?? "",
    company: document.getElementById("lead-company")?.value ?? "",
    phone: document.getElementById("lead-phone")?.value ?? "",
    country: document.getElementById("lead-country")?.value ?? "",
    notes: document.getElementById("lead-notes")?.value ?? ""
  }));
  const expected = expectedFormFillValues();
  const requiredMatches = ["firstName", "lastName", "email", "company", "phone", "country", "notes"]
    .every((key) => values[key] === expected[key]);
  if (!requiredMatches) {
    throw new Error(`Empty-form fill verification failed: ${JSON.stringify(values)}`);
  }
  const filledCount = automationResult?.filled_count ?? automationResult?.filled ?? 0;
  if (filledCount < 7) {
    throw new Error(`Expected at least 7 fields filled on the empty-form fixture, saw ${filledCount}.`);
  }
  return {
    filled_values: values,
    happy_path: true
  };
}

async function verifyPartiallyFilledScenario({ page, automationResult }) {
  const values = await page.evaluate(() => ({
    firstName: document.getElementById("lead-first-name")?.value ?? "",
    lastName: document.getElementById("lead-last-name")?.value ?? "",
    email: document.getElementById("lead-email")?.value ?? "",
    company: document.getElementById("lead-company")?.value ?? "",
    phone: document.getElementById("lead-phone")?.value ?? "",
    country: document.getElementById("lead-country")?.value ?? "",
    notes: document.getElementById("lead-notes")?.value ?? ""
  }));
  const expected = expectedFormFillValues();
  if (values.firstName !== "Already There" || values.email !== "existing@crm.test") {
    throw new Error(`Partially-filled fixture overwrote preserved values: ${JSON.stringify(values)}`);
  }
  if (
    values.lastName !== expected.lastName
    || values.company !== expected.company
    || values.phone !== expected.phone
    || values.country !== expected.country
    || values.notes !== expected.notes
  ) {
    throw new Error(`Partially-filled fixture did not fill the remaining values: ${JSON.stringify(values)}`);
  }
  if (automationResult?.overwrite_prevented !== true || (automationResult?.overwrite_prevented_count ?? 0) < 2) {
    throw new Error("Partially-filled fixture did not report overwrite prevention.");
  }
  return {
    preserved_fields: ["firstName", "email"],
    filled_values: values
  };
}

async function verifyReadonlyScenario({ page, automationResult }) {
  const values = await page.evaluate(() => ({
    firstName: document.getElementById("lead-first-name")?.value ?? "",
    lastName: document.getElementById("lead-last-name")?.value ?? "",
    email: document.getElementById("lead-email")?.value ?? "",
    phone: document.getElementById("lead-phone")?.value ?? "",
    company: document.getElementById("lead-company")?.value ?? "",
    readonlyEmail: document.getElementById("lead-email")?.readOnly === true,
    disabledPhone: document.getElementById("lead-phone")?.disabled === true
  }));
  const expected = expectedFormFillValues();
  if (values.email !== "" || values.phone !== "") {
    throw new Error(`Readonly or disabled fields were overwritten: ${JSON.stringify(values)}`);
  }
  if (values.firstName !== expected.firstName || values.lastName !== expected.lastName || values.company !== expected.company) {
    throw new Error(`Readonly-field fixture did not fill remaining editable fields: ${JSON.stringify(values)}`);
  }
  if (!values.readonlyEmail || !values.disabledPhone || (automationResult?.readonly_skipped_count ?? 0) < 2) {
    throw new Error("Readonly-field fixture did not report the skipped locked fields.");
  }
  return {
    readonly_field_preserved: true,
    disabled_field_preserved: true
  };
}

async function verifySelectScenario({ page, automationResult }) {
  const value = await page.evaluate(() => ({
    country: document.getElementById("lead-country")?.value ?? "",
    selectedText: document.getElementById("lead-country")?.selectedOptions?.[0]?.textContent?.trim() ?? ""
  }));
  if (value.country !== "United States") {
    throw new Error(`Select fixture was not filled correctly: ${JSON.stringify(value)}`);
  }
  if ((automationResult?.select_filled_count ?? 0) < 1) {
    throw new Error("Select fixture did not report select_filled_count.");
  }
  return {
    select_value: value.country,
    select_text: value.selectedText
  };
}

async function verifyNoMatchingScenario({ page, automationResult }) {
  const values = await page.evaluate(() => ({
    projectCode: document.getElementById("project-code")?.value ?? "",
    teamName: document.getElementById("team-name")?.value ?? "",
    website: document.getElementById("website")?.value ?? ""
  }));
  if (values.projectCode || values.teamName || values.website) {
    throw new Error(`No-match fixture changed unrelated fields: ${JSON.stringify(values)}`);
  }
  const filledCount = automationResult?.filled_count ?? automationResult?.filled ?? 0;
  const matchedCount = automationResult?.matched_count ?? null;
  const statusText = automationResult?.status_text ?? "";
  if (filledCount !== 0 || matchedCount !== 0 || automationResult?.no_match_detected !== true) {
    throw new Error(`No-match fixture did not report zero matches: ${JSON.stringify(automationResult)}`);
  }
  if (!statusText.includes("No matching fields found")) {
    throw new Error(`No-match fixture did not expose clear popup feedback: ${statusText}`);
  }
  return {
    unrelated_values: values,
    popup_feedback: statusText
  };
}

async function verifyOverwriteScenario({ page, automationResult }) {
  const values = await page.evaluate(() => ({
    firstName: document.getElementById("lead-first-name")?.value ?? "",
    email: document.getElementById("lead-email")?.value ?? "",
    company: document.getElementById("lead-company")?.value ?? "",
    phone: document.getElementById("lead-phone")?.value ?? ""
  }));
  const expected = expectedFormFillValues();
  if (values.firstName !== "Manual First" || values.email !== "manual@crm.test") {
    throw new Error(`Overwrite-default-false fixture overwrote existing values: ${JSON.stringify(values)}`);
  }
  if (values.company !== expected.company || values.phone !== expected.phone) {
    throw new Error(`Overwrite-default-false fixture failed to fill blank values: ${JSON.stringify(values)}`);
  }
  if (automationResult?.overwrite_prevented !== true || (automationResult?.overwrite_prevented_count ?? 0) < 2) {
    throw new Error("Overwrite-default-false fixture did not report preserved values.");
  }
  return {
    preserved_fields: ["firstName", "email"],
    popup_feedback: automationResult?.status_text ?? null
  };
}

async function runProfileManagementScenario(setupPage) {
  try {
    const editedProfile = {
      ...expectedFormFillValues(),
      company: "Analytical Engines Revision"
    };
    const editStatus = await savePopupProfile(setupPage, editedProfile, false);
    const editedStorage = await getPopupStorageState(setupPage);
    if (editedStorage.profile?.company !== editedProfile.company) {
      throw new Error(`Edited profile was not persisted: ${JSON.stringify(editedStorage)}`);
    }

    const deleteStatus = await deletePopupProfile(setupPage);
    const deletedStorage = await getPopupStorageState(setupPage);
    const deleteCleared = !deletedStorage.profile && !deletedStorage.profile_options;
    if (!deleteCleared) {
      throw new Error(`Delete profile did not clear storage: ${JSON.stringify(deletedStorage)}`);
    }

    return {
      id: "profile_management",
      status: "passed",
      verified: true,
      edit_status: editStatus,
      delete_status: deleteStatus,
      deleted_storage_cleared: true
    };
  } catch (error) {
    return {
      id: "profile_management",
      status: "failed",
      verified: false,
      failure_reason: error.message
    };
  }
}

async function runFormFillPuppeteerScenario({
  buildReport,
  brief,
  runtime,
  fixtureBaseUrl,
  assetsDir,
  screenshots
}) {
  let browser = null;
  let browserDetails = null;
  let extension = null;
  let extensionId = "";
  let extensionName = brief.product_name_working;
  let cleanupMode = "disconnect";
  let dedicatedUserDataDir = "";
  let tempRoot = "";

  try {
    const copy = await createAsciiExtensionCopy(buildReport.workspace_dist);
    tempRoot = copy.tempRoot;

    if (runtime === "ixbrowser") {
      const connected = await openIxBrowserPuppeteerBrowser({ extensionDir: copy.extensionDir });
      browser = connected.browser;
      const existingExtensions = await browser.extensions();
      browserDetails = {
        ...connected.browserDetails,
        ixbrowser_extensions_api_supported: true,
        installed_extensions_seen: existingExtensions.size
      };
      extensionId = await browser.installExtension(copy.extensionDir);
      extension = await getPuppeteerExtensionById(browser, extensionId);
      extensionName = extension.name;
    } else {
      const dedicated = await openDedicatedPuppeteerBrowser({
        incompatibility: null
      });
      browser = dedicated.browser;
      browserDetails = dedicated.browserDetails;
      cleanupMode = "close";
      dedicatedUserDataDir = dedicated.userDataDir;
      extensionId = await browser.installExtension(copy.extensionDir);
      extension = await getPuppeteerExtensionById(browser, extensionId);
      extensionName = extension.name;
    }

    const setupPage = await browser.newPage();
    await setupPage.goto(`chrome-extension://${extensionId}/popup.html?automation_setup=1`, { waitUntil: "load" });
    await savePopupProfile(setupPage, expectedFormFillValues(), false);

    await recordPuppeteerScreenshot({
      page: setupPage,
      assetsDir,
      screenshots,
      fileName: "screenshot_1.png",
      stepId: "popup_profile_saved",
      sourceUrl: setupPage.url()
    });

    const emptyFormScenario = await runLeadFormVariantScenario({
      browser,
      setupPage,
      extension,
      profile: expectedFormFillValues(),
      fixtureBaseUrl,
      variant: "empty-form",
      scenarioId: "single_profile_form_fill_empty_form",
      verify: verifyEmptyFormScenario,
      assetsDir,
      screenshots,
      screenshotBefore: {
        fileName: "screenshot_2.png",
        stepId: "form_before_fill"
      },
      screenshotAfter: {
        fileName: "screenshot_3.png",
        stepId: "form_after_fill"
      }
    });
    const partiallyFilledScenario = await runLeadFormVariantScenario({
      browser,
      setupPage,
      extension,
      profile: expectedFormFillValues(),
      fixtureBaseUrl,
      variant: "partially-filled",
      scenarioId: "single_profile_form_fill_partially_filled_form",
      verify: verifyPartiallyFilledScenario
    });
    const readonlyScenario = await runLeadFormVariantScenario({
      browser,
      setupPage,
      extension,
      profile: expectedFormFillValues(),
      fixtureBaseUrl,
      variant: "readonly-field",
      scenarioId: "single_profile_form_fill_readonly_field",
      verify: verifyReadonlyScenario
    });
    const selectScenario = await runLeadFormVariantScenario({
      browser,
      setupPage,
      extension,
      profile: expectedFormFillValues(),
      fixtureBaseUrl,
      variant: "select-field",
      scenarioId: "single_profile_form_fill_select_field",
      verify: verifySelectScenario
    });
    const noMatchScenario = await runLeadFormVariantScenario({
      browser,
      setupPage,
      extension,
      profile: expectedFormFillValues(),
      fixtureBaseUrl,
      variant: "no-matching",
      scenarioId: "single_profile_form_fill_no_matching_fields",
      verify: verifyNoMatchingScenario
    });
    const overwriteScenario = await runLeadFormVariantScenario({
      browser,
      setupPage,
      extension,
      profile: expectedFormFillValues(),
      fixtureBaseUrl,
      variant: "overwrite-default-false",
      scenarioId: "single_profile_form_fill_overwrite_behavior_default_false",
      verify: verifyOverwriteScenario
    });
    const profileManagementScenario = await runProfileManagementScenario(setupPage);

    const popupFeedbackVerified = [
      emptyFormScenario.status_text?.includes("Filled"),
      noMatchScenario.status_text?.includes("No matching fields found"),
      overwriteScenario.status_text?.includes("Preserved")
    ].every(Boolean);
    const popupFeedbackScenario = {
      id: "single_profile_form_fill_popup_feedback_display",
      status: popupFeedbackVerified ? "passed" : "failed",
      verified: popupFeedbackVerified,
      success_feedback: emptyFormScenario.status_text ?? null,
      no_match_feedback: noMatchScenario.status_text ?? null,
      overwrite_feedback: overwriteScenario.status_text ?? null
    };

    const scenarios = [
      emptyFormScenario,
      partiallyFilledScenario,
      readonlyScenario,
      selectScenario,
      noMatchScenario,
      overwriteScenario,
      popupFeedbackScenario,
      profileManagementScenario
    ];
    const failureReasons = scenarios
      .filter((scenario) => scenario.status !== "passed")
      .map((scenario) => `${scenario.id}: ${scenario.failure_reason ?? "verification failed"}`);
    const scenarioResults = {
      empty_form: emptyFormScenario.status,
      partially_filled_form: partiallyFilledScenario.status,
      readonly_field: readonlyScenario.status,
      select_field: selectScenario.status,
      no_matching_fields: noMatchScenario.status,
      overwrite_behavior_default_false: overwriteScenario.status,
      popup_feedback_display: popupFeedbackScenario.status,
      profile_management: profileManagementScenario.status
    };

    return {
      browserDetails: {
        ...browserDetails,
        extension_runtime: extensionName,
        extension_id: extensionId
      },
      extensionId,
      extensionName,
      extensionPath: copy.extensionDir,
      scenarios,
      summary: {
        status: failureReasons.length === 0 ? "passed" : "failed",
        happy_path_verified: emptyFormScenario.verified === true,
        trigger_surface: emptyFormScenario.trigger_surface ?? null,
        trigger_method: emptyFormScenario.trigger_method ?? null,
        browser_driver: emptyFormScenario.browser_driver ?? "puppeteer",
        popup_opened: emptyFormScenario.popup_opened ?? null,
        automation_result_received: [
          emptyFormScenario,
          partiallyFilledScenario,
          readonlyScenario,
          selectScenario,
          noMatchScenario,
          overwriteScenario
        ].every((scenario) => scenario.automation_result_received === true),
        fill_executed_via: emptyFormScenario.fill_executed_via ?? null,
        active_tab_expected: safeNumber(emptyFormScenario.active_tab_expected),
        filled_count: safeNumber(emptyFormScenario.filled_count),
        skipped_count: Math.max(
          emptyFormScenario.skipped_count ?? 0,
          partiallyFilledScenario.skipped_count ?? 0,
          readonlyScenario.skipped_count ?? 0,
          overwriteScenario.skipped_count ?? 0
        ),
        readonly_skipped_count: safeNumber(readonlyScenario.readonly_skipped_count),
        select_filled_count: safeNumber(selectScenario.select_filled_count),
        no_match_detected: noMatchScenario.no_match_detected === true,
        overwrite_prevented: partiallyFilledScenario.overwrite_prevented === true
          || overwriteScenario.overwrite_prevented === true,
        popup_feedback_verified: popupFeedbackVerified,
        scenario_results: scenarioResults,
        failure_reason: failureReasons.length > 0 ? failureReasons.join(" | ") : null
      }
    };
  } finally {
    if (cleanupMode === "disconnect") {
      await browser?.disconnect?.().catch(() => {});
    } else {
      await browser?.close?.().catch(() => {});
    }
    if (dedicatedUserDataDir) {
      await fs.rm(dedicatedUserDataDir, { recursive: true, force: true }).catch(() => {});
    }
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function runTabExportPuppeteerScenario({
  buildReport,
  brief,
  runtime,
  fixtureBaseUrl,
  assetsDir,
  downloadDir,
  screenshots
}) {
  if (runtime === "ixbrowser") {
    throw new Error("tab_csv_window_export dedicated smoke uses dedicated_chromium; ixbrowser runtime is not supported in the canonical path.");
  }

  let browser = null;
  let browserDetails = null;
  let extension = null;
  let extensionId = "";
  let extensionName = brief.product_name_working;
  let dedicatedUserDataDir = "";
  let tempRoot = "";

  try {
    const copy = await createAsciiExtensionCopy(buildReport.workspace_dist);
    tempRoot = copy.tempRoot;

    const dedicated = await openDedicatedPuppeteerBrowser({
      incompatibility: null
    });
    browser = dedicated.browser;
    browserDetails = dedicated.browserDetails;
    dedicatedUserDataDir = dedicated.userDataDir;
    extensionId = await browser.installExtension(copy.extensionDir);
    extension = await getPuppeteerExtensionById(browser, extensionId);
    extensionName = extension.name;

    const tabOne = await browser.newPage();
    await tabOne.goto(joinUrl(fixtureBaseUrl, "/tabs/window-alpha"), { waitUntil: "load" });

    const tabTwo = await browser.newPage();
    await tabTwo.goto(joinUrl(fixtureBaseUrl, "/tabs/window-beta"), { waitUntil: "load" });

    const tabThree = await browser.newPage();
    await tabThree.goto(joinUrl(fixtureBaseUrl, "/tabs/window-gamma"), { waitUntil: "load" });

    const popupPage = await browser.newPage();
    await setPuppeteerDownloadBehavior({ browser, page: popupPage, downloadDir });
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html?automation_disable_save_as=1`, { waitUntil: "load" });

    await recordPuppeteerScreenshot({
      page: popupPage,
      assetsDir,
      screenshots,
      fileName: "screenshot_1.png",
      stepId: "popup_ready",
      sourceUrl: popupPage.url()
    });

    const expectedCsv = path.join(downloadDir, "quicktab-current-window.csv");
    await popupPage.click("#export-tabs");
    await popupPage.waitForFunction(() => {
      return document.getElementById("status")?.textContent?.includes("CSV exported for");
    }, { timeout: 15000 });
    const downloadedCsvPath = await waitForCsvDownload(downloadDir, 15000);
    if (downloadedCsvPath !== expectedCsv) {
      await fs.copyFile(downloadedCsvPath, expectedCsv);
    }

    await recordPuppeteerScreenshot({
      page: popupPage,
      assetsDir,
      screenshots,
      fileName: "screenshot_2.png",
      stepId: "popup_success",
      sourceUrl: popupPage.url()
    });

    await tabOne.bringToFront();
    await recordPuppeteerScreenshot({
      page: tabOne,
      assetsDir,
      screenshots,
      fileName: "screenshot_3.png",
      stepId: "fixture_tabs_window",
      sourceUrl: tabOne.url()
    });

    const statusText = await popupPage.$eval("#status", (node) => node.innerText);
    const csvText = await fs.readFile(expectedCsv, "utf8");
    const csvHasFixtureTabs = ["Smoke Tab window-alpha", "Smoke Tab window-beta", "Smoke Tab window-gamma"]
      .every((token) => csvText.includes(token));
    if (!csvHasFixtureTabs) {
      throw new Error("Exported CSV did not contain the expected fixture tabs.");
    }

    return {
      browserDetails: {
        ...browserDetails,
        extension_runtime: extensionName,
        extension_id: extensionId
      },
      extensionId,
      extensionName,
      extensionPath: copy.extensionDir,
      scenario: {
        id: "tab_csv_window_export_happy_path",
        status: "passed",
        verified: true,
        browser_driver: "puppeteer",
        downloaded_file: expectedCsv,
        downloaded_file_name: "quicktab-current-window.csv",
        popup_status: statusText.trim(),
        screenshot_files: screenshots.map((item) => item.file_name)
      }
    };
  } finally {
    await browser?.close?.().catch(() => {});
    if (dedicatedUserDataDir) {
      await fs.rm(dedicatedUserDataDir, { recursive: true, force: true }).catch(() => {});
    }
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function createFixtureServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    response.setHeader("cache-control", "no-store");

    if (url.pathname.startsWith("/tabs/")) {
      const label = url.pathname.split("/").pop() ?? "tab";
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Smoke Tab ${label}</title>
    <style>
      body { margin: 0; font-family: "Segoe UI", sans-serif; background: #eef5f1; color: #173522; }
      main { padding: 48px; }
      h1 { margin: 0 0 12px; font-size: 40px; }
      p { margin: 0; font-size: 18px; max-width: 720px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Smoke Tab ${label}</h1>
      <p>Browser smoke fixture for current-window tab export verification.</p>
    </main>
  </body>
</html>`);
      return;
    }

    if (url.pathname === "/lead-form") {
      const variant = url.searchParams.get("variant") ?? "empty-form";
      const variantMap = {
        "empty-form": {
          title: "Empty Lead Intake Fixture",
          description: "Blank form fixture used for the happy-path fill proof.",
          fields: `
        <label>First name <input id="lead-first-name" name="first_name" placeholder="First name" /></label>
        <label>Last name <input id="lead-last-name" name="last_name" placeholder="Last name" /></label>
        <label class="full">Email <input id="lead-email" name="email" type="email" placeholder="Work email" /></label>
        <label>Company <input id="lead-company" name="company" placeholder="Company" /></label>
        <label>Phone <input id="lead-phone" name="phone" type="tel" placeholder="Phone number" /></label>
        <label>Country
          <select id="lead-country" name="country">
            <option value="">Select country</option>
            <option value="Canada">Canada</option>
            <option value="United States">United States</option>
          </select>
        </label>
        <label class="full">Notes <textarea id="lead-notes" name="notes" rows="4" placeholder="Notes"></textarea></label>`
        },
        "partially-filled": {
          title: "Partially Filled Fixture",
          description: "Some matching fields already contain values and should be preserved by default.",
          fields: `
        <label>First name <input id="lead-first-name" name="first_name" value="Already There" placeholder="First name" /></label>
        <label>Last name <input id="lead-last-name" name="last_name" placeholder="Last name" /></label>
        <label class="full">Email <input id="lead-email" name="email" type="email" value="existing@crm.test" placeholder="Work email" /></label>
        <label>Company <input id="lead-company" name="company" placeholder="Company" /></label>
        <label>Phone <input id="lead-phone" name="phone" type="tel" placeholder="Phone number" /></label>
        <label>Country
          <select id="lead-country" name="country">
            <option value="">Select country</option>
            <option value="Canada">Canada</option>
            <option value="United States">United States</option>
          </select>
        </label>
        <label class="full">Notes <textarea id="lead-notes" name="notes" rows="4" placeholder="Notes"></textarea></label>`
        },
        "readonly-field": {
          title: "Readonly And Disabled Fixture",
          description: "Locked fields should be skipped without being overwritten.",
          fields: `
        <label>First name <input id="lead-first-name" name="first_name" placeholder="First name" /></label>
        <label>Last name <input id="lead-last-name" name="last_name" placeholder="Last name" /></label>
        <label class="full">Email <input id="lead-email" name="email" type="email" placeholder="Work email" readonly /></label>
        <label>Company <input id="lead-company" name="company" placeholder="Company" /></label>
        <label>Phone <input id="lead-phone" name="phone" type="tel" placeholder="Phone number" disabled /></label>
        <label>Country
          <select id="lead-country" name="country">
            <option value="">Select country</option>
            <option value="Canada">Canada</option>
            <option value="United States">United States</option>
          </select>
        </label>`
        },
        "select-field": {
          title: "Select Field Fixture",
          description: "Country select controls should be matched and updated safely.",
          fields: `
        <label>Country
          <select id="lead-country" name="country">
            <option value="">Select country</option>
            <option value="Canada">Canada</option>
            <option value="United States">United States</option>
          </select>
        </label>
        <label>Source
          <select id="lead-source" name="source">
            <option value="">Select source</option>
            <option value="referral">Referral</option>
            <option value="web">Web</option>
          </select>
        </label>`
        },
        "no-matching": {
          title: "No Matching Fields Fixture",
          description: "Unsupported forms should return explicit zero-match feedback.",
          fields: `
        <label>Project code <input id="project-code" name="project_code" placeholder="Project code" /></label>
        <label>Team name <input id="team-name" name="team_name" placeholder="Team name" /></label>
        <label class="full">Website <input id="website" name="website" type="url" placeholder="https://example.com" /></label>`
        },
        "overwrite-default-false": {
          title: "Overwrite Default False Fixture",
          description: "Existing values must stay unchanged unless overwrite is explicitly enabled.",
          fields: `
        <label>First name <input id="lead-first-name" name="first_name" value="Manual First" placeholder="First name" /></label>
        <label>Last name <input id="lead-last-name" name="last_name" placeholder="Last name" /></label>
        <label class="full">Email <input id="lead-email" name="email" type="email" value="manual@crm.test" placeholder="Work email" /></label>
        <label>Company <input id="lead-company" name="company" placeholder="Company" /></label>
        <label>Phone <input id="lead-phone" name="phone" type="tel" placeholder="Phone number" /></label>`
        }
      };
      const selected = variantMap[variant] ?? variantMap["empty-form"];

      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${selected.title}</title>
    <style>
      :root { font-family: "Segoe UI", sans-serif; color-scheme: light; }
      body { margin: 0; background: #f7f0e7; color: #3b2616; }
      main { max-width: 980px; margin: 0 auto; padding: 48px 32px 80px; }
      h1 { margin: 0 0 12px; font-size: 42px; }
      p { margin: 0 0 28px; max-width: 760px; font-size: 18px; }
      form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; background: #fff; padding: 28px; border-radius: 18px; }
      label { display: grid; gap: 8px; font-size: 14px; }
      input, textarea, select { border: 1px solid #d5c2ae; border-radius: 10px; padding: 12px 14px; font-size: 16px; }
      textarea { resize: vertical; min-height: 96px; }
      .full { grid-column: 1 / -1; }
      .fixture-badge { display: inline-block; margin-bottom: 12px; padding: 6px 10px; border-radius: 999px; background: #ecd5be; font-size: 12px; }
    </style>
  </head>
  <body>
    <main>
      <span class="fixture-badge">${variant}</span>
      <h1>${selected.title}</h1>
      <p>${selected.description}</p>
      <form>
${selected.fields}
      </form>
    </main>
  </body>
</html>`);
      return;
    }

    response.statusCode = 404;
    response.setHeader("content-type", "text/plain; charset=utf-8");
    response.end("Not found");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not resolve browser smoke fixture server address.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  };
}

async function resolveLoadedExtension({ page, extensionDir, productName }) {
  await page.goto("chrome://extensions/", { waitUntil: "load" });
  await page.waitForFunction(() => {
    const manager = document.querySelector("extensions-manager");
    return Boolean(manager && Array.isArray(manager.extensions_));
  });
  await page.waitForFunction(({ expectedPath, expectedName }) => {
    const manager = document.querySelector("extensions-manager");
    const items = manager?.extensions_ ?? [];
    const normalizedPath = `${expectedPath}`.toLowerCase();
    const normalizedName = `${expectedName}`.toLowerCase();
    const unpackedItems = items.filter((item) => `${item.location ?? ""}`.toLowerCase().includes("unpacked"));
    return items.some((item) => `${item.path ?? ""}`.toLowerCase() === normalizedPath)
      || items.some((item) => `${item.name ?? ""}`.toLowerCase() === normalizedName)
      || unpackedItems.length === 1;
  }, {
    expectedPath: extensionDir,
    expectedName: productName
  }, { timeout: 15000 });

  const extensions = await page.evaluate(() => {
    const manager = document.querySelector("extensions-manager");
    return manager?.extensions_?.map((item) => ({
      id: item.id,
      name: item.name,
      location: item.location,
      state: item.state,
      path: item.path ?? ""
    })) ?? [];
  });

  const exactPath = extensions.find((item) => item.path.toLowerCase() === extensionDir.toLowerCase());
  const exactName = extensions.find((item) => item.name.toLowerCase() === productName.toLowerCase());
  const unpackedExtensions = extensions.filter((item) => `${item.location ?? ""}`.toLowerCase().includes("unpacked"));
  const match = exactPath ?? exactName ?? (unpackedExtensions.length === 1 ? unpackedExtensions[0] : null);
  if (!match?.id) {
    throw new Error(`Loaded extension ${productName} from ${extensionDir} was not visible in chrome://extensions. Seen: ${JSON.stringify(extensions)}`);
  }
  return match;
}

async function loadUnpackedExtension({ page, extensionDir }) {
  await page.goto("chrome://extensions/", { waitUntil: "load" });
  await page.waitForFunction(() => {
    const toolbar = document.querySelector("extensions-manager")?.shadowRoot?.querySelector("extensions-toolbar");
    return Boolean(toolbar?.shadowRoot?.querySelector("#devMode"));
  }, { timeout: 15000 });

  const developerModeEnabled = await page.evaluate(() => {
    const toolbar = document.querySelector("extensions-manager")?.shadowRoot?.querySelector("extensions-toolbar");
    const toggle = toolbar?.shadowRoot?.querySelector("#devMode");
    return toggle?.checked === true;
  });

  if (!developerModeEnabled) {
    const toggled = await page.evaluate(() => {
      const toolbar = document.querySelector("extensions-manager")?.shadowRoot?.querySelector("extensions-toolbar");
      const toggle = toolbar?.shadowRoot?.querySelector("#devMode");
      toggle?.click();
      return Boolean(toggle);
    });
    if (!toggled) {
      throw new Error("Could not enable Chrome extensions developer mode.");
    }
    await page.waitForTimeout(250);
  }

  const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 10000 });
  const clicked = await page.evaluate(() => {
    const toolbar = document.querySelector("extensions-manager")?.shadowRoot?.querySelector("extensions-toolbar");
    const button = toolbar?.shadowRoot?.querySelector("#loadUnpacked");
    button?.click();
    return Boolean(button);
  });
  if (!clicked) {
    throw new Error("Could not open the Load unpacked dialog in chrome://extensions.");
  }

  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(extensionDir);
}

async function readExecuteActionShortcutState(page, extensionId) {
  return page.evaluate((targetExtensionId) => {
    const keyboard = document
      .querySelector("extensions-manager")
      ?.shadowRoot?.querySelector("extensions-keyboard-shortcuts")
      ?? document.querySelector("extensions-keyboard-shortcuts");
    const root = keyboard?.shadowRoot;
    const entry = [...(root?.querySelectorAll(".command-entry") ?? [])].find((node) => {
      const select = node.querySelector("select");
      return select?.dataset?.extensionId === targetExtensionId
        && select?.dataset?.commandName === "_execute_action";
    });
    const shortcutInput = entry?.querySelector("cr-shortcut-input");
    return {
      found: Boolean(entry),
      shortcut: shortcutInput?.shortcut ?? "",
      command_text: entry?.innerText ?? ""
    };
  }, extensionId);
}

async function ensureExecuteActionShortcut({ page, extensionId }) {
  await page.goto("chrome://extensions/shortcuts", { waitUntil: "load" });
  await page.waitForFunction(() => {
    const keyboard = document
      .querySelector("extensions-manager")
      ?.shadowRoot?.querySelector("extensions-keyboard-shortcuts")
      ?? document.querySelector("extensions-keyboard-shortcuts");
    return Boolean(keyboard?.shadowRoot?.querySelector(".command-entry"));
  }, { timeout: 15000 });
  await page.waitForFunction((targetExtensionId) => {
    const keyboard = document
      .querySelector("extensions-manager")
      ?.shadowRoot?.querySelector("extensions-keyboard-shortcuts")
      ?? document.querySelector("extensions-keyboard-shortcuts");
    const root = keyboard?.shadowRoot;
    return [...(root?.querySelectorAll(".command-entry") ?? [])].some((node) => {
      const select = node.querySelector("select");
      return select?.dataset?.extensionId === targetExtensionId
        && select?.dataset?.commandName === "_execute_action";
    });
  }, extensionId, { timeout: 15000 });

  const current = await readExecuteActionShortcutState(page, extensionId);
  if (current.shortcut === EXECUTE_ACTION_SHORTCUT_LABEL) {
    return current;
  }

  const clicked = await page.evaluate((targetExtensionId) => {
    const keyboard = document
      .querySelector("extensions-manager")
      ?.shadowRoot?.querySelector("extensions-keyboard-shortcuts")
      ?? document.querySelector("extensions-keyboard-shortcuts");
    const root = keyboard?.shadowRoot;
    const entry = [...(root?.querySelectorAll(".command-entry") ?? [])].find((node) => {
      const select = node.querySelector("select");
      return select?.dataset?.extensionId === targetExtensionId
        && select?.dataset?.commandName === "_execute_action";
    });
    const editButton = entry?.querySelector("cr-shortcut-input")?.shadowRoot?.querySelector("#edit");
    editButton?.click();
    return Boolean(editButton);
  }, extensionId);

  if (!clicked) {
    throw new Error(`Could not open _execute_action shortcut editor for extension ${extensionId}.`);
  }

  await page.waitForTimeout(250);
  await pressExecuteActionShortcut(page.keyboard);
  await page.waitForFunction(({ targetExtensionId, shortcut }) => {
    const keyboard = document
      .querySelector("extensions-manager")
      ?.shadowRoot?.querySelector("extensions-keyboard-shortcuts")
      ?? document.querySelector("extensions-keyboard-shortcuts");
    const root = keyboard?.shadowRoot;
    const entry = [...(root?.querySelectorAll(".command-entry") ?? [])].find((node) => {
      const select = node.querySelector("select");
      return select?.dataset?.extensionId === targetExtensionId
        && select?.dataset?.commandName === "_execute_action";
    });
    return entry?.querySelector("cr-shortcut-input")?.shortcut === shortcut;
  }, {
    targetExtensionId: extensionId,
    shortcut: EXECUTE_ACTION_SHORTCUT_LABEL
  }, { timeout: 10000 });

  return readExecuteActionShortcutState(page, extensionId);
}

async function getExtensionStorage(page, keys) {
  return page.evaluate(async (requestedKeys) => chrome.storage.local.get(requestedKeys), keys);
}

async function setExtensionStorage(page, values) {
  await page.evaluate(async (items) => chrome.storage.local.set(items), values);
}

async function removeExtensionStorage(page, keys) {
  await page.evaluate(async (requestedKeys) => chrome.storage.local.remove(requestedKeys), keys);
}

async function pollAutomationResult({ page, runId, timeoutMs = 15000 }) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const stored = await getExtensionStorage(page, ["automation_result"]);
    const result = stored.automation_result;
    if (result?.run_id === runId && ["passed", "failed"].includes(result.status)) {
      return result;
    }
    await delay(250);
  }
  return null;
}

async function waitForAutomationResult({ page, runId, timeoutMs = 15000 }) {
  const result = await pollAutomationResult({ page, runId, timeoutMs });
  if (result) {
    return result;
  }
  throw new Error(`Timed out waiting for form-fill automation result ${runId}.`);
}

async function sendWindowsExecuteActionShortcut({ titleIncludes }) {
  const script = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class CodexSmokeWin32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@
$needle = ${JSON.stringify(titleIncludes)}
$script:target = [IntPtr]::Zero
$callback = [CodexSmokeWin32+EnumWindowsProc]{
  param([IntPtr]$hWnd, [IntPtr]$lParam)
  if (-not [CodexSmokeWin32]::IsWindowVisible($hWnd)) { return $true }
  $titleBuilder = New-Object System.Text.StringBuilder 512
  [CodexSmokeWin32]::GetWindowText($hWnd, $titleBuilder, $titleBuilder.Capacity) | Out-Null
  if ($titleBuilder.ToString().Contains($needle)) {
    $script:target = $hWnd
    return $false
  }
  return $true
}
[CodexSmokeWin32]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
if ($script:target -eq [IntPtr]::Zero) { throw "Could not find a visible browser window containing '$needle'." }
[CodexSmokeWin32]::ShowWindow($script:target, 9) | Out-Null
[CodexSmokeWin32]::SetForegroundWindow($script:target) | Out-Null
Start-Sleep -Milliseconds 250
[CodexSmokeWin32]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
[CodexSmokeWin32]::keybd_event(0x10, 0, 0, [UIntPtr]::Zero)
[CodexSmokeWin32]::keybd_event(0x59, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 80
[CodexSmokeWin32]::keybd_event(0x59, 0, 2, [UIntPtr]::Zero)
[CodexSmokeWin32]::keybd_event(0x10, 0, 2, [UIntPtr]::Zero)
[CodexSmokeWin32]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)
`;
  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script
  ], { timeout: 10000 });
}

async function waitForFile(filePath, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fileExists(filePath)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for file ${filePath}.`);
}

async function waitForCsvDownload(downloadDir, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const entries = await fs.readdir(downloadDir, { withFileTypes: true }).catch(() => []);
    const csvFile = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .find((name) => name.toLowerCase().endsWith(".csv") && !name.toLowerCase().endsWith(".crdownload"));
    if (csvFile) {
      return path.join(downloadDir, csvFile);
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for a completed CSV download in ${downloadDir}.`);
}

async function recordScreenshot({ page, assetsDir, screenshots, fileName, stepId, sourceUrl }) {
  const targetPath = path.join(assetsDir, fileName);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: targetPath, type: "png" });
  screenshots.push({
    file_name: fileName,
    path: targetPath,
    step_id: stepId,
    source_url: sourceUrl,
    capture_kind: "viewport_png",
    capture_source: "browser_smoke_happy_path",
    from_happy_path: true,
    captured_at: nowIso()
  });
}

async function savePlaywrightPopupProfile(page, profile, overwriteExisting = false) {
  await page.fill("#firstName", profile.firstName ?? "");
  await page.fill("#lastName", profile.lastName ?? "");
  await page.fill("#email", profile.email ?? "");
  await page.fill("#company", profile.company ?? "");
  await page.fill("#phone", profile.phone ?? "");
  await page.fill("#country", profile.country ?? "");
  await page.fill("#notes", profile.notes ?? "");
  const overwriteCheckbox = page.locator("#overwriteExisting");
  if ((await overwriteCheckbox.isChecked()) !== overwriteExisting) {
    await overwriteCheckbox.click();
  }
  const result = await page.evaluate(async () => {
    if (typeof globalThis.__leadFillTestHooks?.saveProfile !== "function") {
      throw new Error("Popup saveProfile test hook is unavailable.");
    }
    await globalThis.__leadFillTestHooks.saveProfile();
    return document.getElementById("status")?.textContent?.trim() ?? "";
  });
  if (!result.includes("Profile saved locally.")) {
    throw new Error(`Unexpected save profile status: ${result}`);
  }
  return result;
}

async function deletePlaywrightPopupProfile(page) {
  const result = await page.evaluate(async () => {
    if (typeof globalThis.__leadFillTestHooks?.deleteProfile !== "function") {
      throw new Error("Popup deleteProfile test hook is unavailable.");
    }
    await globalThis.__leadFillTestHooks.deleteProfile();
    return document.getElementById("status")?.textContent?.trim() ?? "";
  });
  if (!result.includes("Profile deleted from local storage.")) {
    throw new Error(`Unexpected delete profile status: ${result}`);
  }
  return result;
}

async function getPlaywrightPopupStorageState(page) {
  const stored = await getExtensionStorage(page, ["profile", "profile_options"]);
  return {
    profile: stored.profile ?? null,
    profile_options: stored.profile_options ?? null
  };
}

async function runPlaywrightVariantScenario({
  context,
  popupPage,
  profile,
  fixtureBaseUrl,
  variant,
  scenarioId,
  verify,
  assetsDir = "",
  screenshots = [],
  screenshotBefore = null,
  screenshotAfter = null
}) {
  const formPage = await context.newPage();
  try {
    await savePlaywrightPopupProfile(popupPage, profile, false);
    await formPage.goto(joinUrl(fixtureBaseUrl, `/lead-form?variant=${variant}`), { waitUntil: "load" });
    await formPage.bringToFront();
    await formPage.locator("body").click({ position: { x: 20, y: 20 } }).catch(() => {});

    if (screenshotBefore) {
      await recordScreenshot({
        page: formPage,
        assetsDir,
        screenshots,
        fileName: screenshotBefore.fileName,
        stepId: screenshotBefore.stepId,
        sourceUrl: formPage.url()
      });
    }

    const automationRunId = `${scenarioId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let automationResult = null;
    let targetTab = null;
    const automationKeys = [
      "automation_mode",
      "automation_target_tab_id",
      "automation_run_id",
      "automation_result"
    ];

    try {
      targetTab = await popupPage.evaluate(async () => {
        const [target] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!target?.id) {
          throw new Error("Could not find the active target tab for automation.");
        }
        return target.id;
      });

      await setExtensionStorage(popupPage, {
        automation_mode: "form_fill_smoke",
        automation_target_tab_id: targetTab,
        automation_run_id: automationRunId,
        automation_result: {
          run_id: automationRunId,
          status: "pending",
          popup_opened: false,
          active_tab_expected: targetTab,
          created_at: nowIso()
        }
      });

      await formPage.bringToFront();
      await delay(250);
      await pressExecuteActionShortcut(formPage.keyboard);
      automationResult = await pollAutomationResult({
        page: popupPage,
        runId: automationRunId,
        timeoutMs: 2500
      });
      if (!automationResult && process.platform === "win32") {
        await sendWindowsExecuteActionShortcut({
          titleIncludes: await formPage.title()
        });
        await delay(500);
      }
      automationResult = automationResult ?? await waitForAutomationResult({
        page: popupPage,
        runId: automationRunId,
        timeoutMs: 15000
      });
    } finally {
      await removeExtensionStorage(popupPage, automationKeys).catch(() => {});
    }

    if (automationResult?.status !== "passed") {
      throw new Error(`Form-fill automation failed: ${automationResult?.failure_reason ?? "unknown failure"}`);
    }

    const verification = await verify({
      page: formPage,
      automationResult
    });

    if (screenshotAfter) {
      await recordScreenshot({
        page: formPage,
        assetsDir,
        screenshots,
        fileName: screenshotAfter.fileName,
        stepId: screenshotAfter.stepId,
        sourceUrl: formPage.url()
      });
    }

    return {
      id: scenarioId,
      status: "passed",
      verified: true,
      ...summarizeFormFillAutomationResult(automationResult, {
        ...verification,
        target_tab_id: safeNumber(automationResult.target_tab_id ?? targetTab),
        active_tab_expected: safeNumber(automationResult.active_tab_expected ?? targetTab)
      }, "playwright")
    };
  } catch (error) {
    return {
      id: scenarioId,
      status: "failed",
      verified: false,
      failure_reason: error.message
    };
  } finally {
    await formPage.close().catch(() => {});
  }
}

async function runPlaywrightProfileManagementScenario(popupPage) {
  try {
    const editedProfile = {
      ...expectedFormFillValues(),
      company: "Analytical Engines Revision"
    };
    const editStatus = await savePlaywrightPopupProfile(popupPage, editedProfile, false);
    const editedStorage = await getPlaywrightPopupStorageState(popupPage);
    if (editedStorage.profile?.company !== editedProfile.company) {
      throw new Error(`Edited profile was not persisted: ${JSON.stringify(editedStorage)}`);
    }
    const deleteStatus = await deletePlaywrightPopupProfile(popupPage);
    const deletedStorage = await getPlaywrightPopupStorageState(popupPage);
    if (deletedStorage.profile || deletedStorage.profile_options) {
      throw new Error(`Delete profile did not clear storage: ${JSON.stringify(deletedStorage)}`);
    }
    return {
      id: "profile_management",
      status: "passed",
      verified: true,
      edit_status: editStatus,
      delete_status: deleteStatus,
      deleted_storage_cleared: true
    };
  } catch (error) {
    return {
      id: "profile_management",
      status: "failed",
      verified: false,
      failure_reason: error.message
    };
  }
}

async function runTabExportScenario({ browser, context, popupPage, extensionId, fixtureBaseUrl, assetsDir, downloadDir, screenshots }) {
  const tabOne = await context.newPage();
  await tabOne.goto(joinUrl(fixtureBaseUrl, "/tabs/window-alpha"), { waitUntil: "load" });

  const tabTwo = await context.newPage();
  await tabTwo.goto(joinUrl(fixtureBaseUrl, "/tabs/window-beta"), { waitUntil: "load" });

  const tabThree = await context.newPage();
  await tabThree.goto(joinUrl(fixtureBaseUrl, "/tabs/window-gamma"), { waitUntil: "load" });

  await popupPage.goto(`chrome-extension://${extensionId}/popup.html?automation_disable_save_as=1`, { waitUntil: "load" });

  await recordScreenshot({
    page: popupPage,
    assetsDir,
    screenshots,
    fileName: "screenshot_1.png",
    stepId: "popup_ready",
    sourceUrl: popupPage.url()
  });

  const expectedCsv = path.join(downloadDir, "quicktab-current-window.csv");
  const downloadPromise = popupPage.waitForEvent("download", { timeout: 15000 }).catch(() => null);
  await popupPage.click("#export-tabs");
  await popupPage.waitForFunction(() => {
    const node = document.getElementById("status");
    return Boolean(node?.textContent?.includes("CSV exported for"));
  }, { timeout: 15000 });
  const download = await downloadPromise;
  if (download) {
    await download.saveAs(expectedCsv).catch(async () => {
      await waitForFile(expectedCsv);
    });
  } else {
    await waitForFile(expectedCsv);
  }

  await recordScreenshot({
    page: popupPage,
    assetsDir,
    screenshots,
    fileName: "screenshot_2.png",
    stepId: "popup_success",
    sourceUrl: popupPage.url()
  });

  await tabOne.bringToFront();
  await recordScreenshot({
    page: tabOne,
    assetsDir,
    screenshots,
    fileName: "screenshot_3.png",
    stepId: "fixture_tabs_window",
    sourceUrl: tabOne.url()
  });

  const statusText = await popupPage.locator("#status").innerText();
  const csvText = await fs.readFile(expectedCsv, "utf8");
  const csvHasFixtureTabs = ["Smoke Tab window-alpha", "Smoke Tab window-beta", "Smoke Tab window-gamma"].every((token) => csvText.includes(token));
  if (!csvHasFixtureTabs) {
    throw new Error("Exported CSV did not contain the expected fixture tabs.");
  }

  return {
    id: "tab_csv_window_export_happy_path",
    status: "passed",
    verified: true,
    downloaded_file: expectedCsv,
    downloaded_file_name: "quicktab-current-window.csv",
    popup_status: statusText.trim(),
    screenshot_files: screenshots.map((item) => item.file_name)
  };
}

async function runFormFillScenario({ context, popupPage, extensionId, fixtureBaseUrl, assetsDir, screenshots }) {
  await ensureExecuteActionShortcut({ page: popupPage, extensionId });
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html?automation_setup=1`, { waitUntil: "load" });
  await savePlaywrightPopupProfile(popupPage, expectedFormFillValues(), false);

  await recordScreenshot({
    page: popupPage,
    assetsDir,
    screenshots,
    fileName: "screenshot_1.png",
    stepId: "popup_profile_saved",
    sourceUrl: popupPage.url()
  });

  const profile = expectedFormFillValues();
  const emptyFormScenario = await runPlaywrightVariantScenario({
    context,
    popupPage,
    profile,
    fixtureBaseUrl,
    variant: "empty-form",
    scenarioId: "single_profile_form_fill_empty_form",
    verify: verifyEmptyFormScenario,
    assetsDir,
    screenshots,
    screenshotBefore: {
      fileName: "screenshot_2.png",
      stepId: "form_before_fill"
    },
    screenshotAfter: {
      fileName: "screenshot_3.png",
      stepId: "form_after_fill"
    }
  });
  const partiallyFilledScenario = await runPlaywrightVariantScenario({
    context,
    popupPage,
    profile,
    fixtureBaseUrl,
    variant: "partially-filled",
    scenarioId: "single_profile_form_fill_partially_filled_form",
    verify: verifyPartiallyFilledScenario
  });
  const readonlyScenario = await runPlaywrightVariantScenario({
    context,
    popupPage,
    profile,
    fixtureBaseUrl,
    variant: "readonly-field",
    scenarioId: "single_profile_form_fill_readonly_field",
    verify: verifyReadonlyScenario
  });
  const selectScenario = await runPlaywrightVariantScenario({
    context,
    popupPage,
    profile,
    fixtureBaseUrl,
    variant: "select-field",
    scenarioId: "single_profile_form_fill_select_field",
    verify: verifySelectScenario
  });
  const noMatchScenario = await runPlaywrightVariantScenario({
    context,
    popupPage,
    profile,
    fixtureBaseUrl,
    variant: "no-matching",
    scenarioId: "single_profile_form_fill_no_matching_fields",
    verify: verifyNoMatchingScenario
  });
  const overwriteScenario = await runPlaywrightVariantScenario({
    context,
    popupPage,
    profile,
    fixtureBaseUrl,
    variant: "overwrite-default-false",
    scenarioId: "single_profile_form_fill_overwrite_behavior_default_false",
    verify: verifyOverwriteScenario
  });
  const profileManagementScenario = await runPlaywrightProfileManagementScenario(popupPage);

  const popupFeedbackVerified = [
    emptyFormScenario.status_text?.includes("Filled"),
    noMatchScenario.status_text?.includes("No matching fields found"),
    overwriteScenario.status_text?.includes("Preserved")
  ].every(Boolean);
  const popupFeedbackScenario = {
    id: "single_profile_form_fill_popup_feedback_display",
    status: popupFeedbackVerified ? "passed" : "failed",
    verified: popupFeedbackVerified,
    success_feedback: emptyFormScenario.status_text ?? null,
    no_match_feedback: noMatchScenario.status_text ?? null,
    overwrite_feedback: overwriteScenario.status_text ?? null
  };

  const scenarios = [
    emptyFormScenario,
    partiallyFilledScenario,
    readonlyScenario,
    selectScenario,
    noMatchScenario,
    overwriteScenario,
    popupFeedbackScenario,
    profileManagementScenario
  ];
  const failureReasons = scenarios
    .filter((scenario) => scenario.status !== "passed")
    .map((scenario) => `${scenario.id}: ${scenario.failure_reason ?? "verification failed"}`);
  const scenarioResults = {
    empty_form: emptyFormScenario.status,
    partially_filled_form: partiallyFilledScenario.status,
    readonly_field: readonlyScenario.status,
    select_field: selectScenario.status,
    no_matching_fields: noMatchScenario.status,
    overwrite_behavior_default_false: overwriteScenario.status,
    popup_feedback_display: popupFeedbackScenario.status,
    profile_management: profileManagementScenario.status
  };

  return {
    id: "single_profile_form_fill_suite",
    status: failureReasons.length === 0 ? "passed" : "failed",
    verified: emptyFormScenario.verified === true,
    trigger_surface: emptyFormScenario.trigger_surface ?? null,
    trigger_method: emptyFormScenario.trigger_method ?? null,
    browser_driver: "playwright",
    popup_opened: emptyFormScenario.popup_opened ?? null,
    automation_result_received: [
      emptyFormScenario,
      partiallyFilledScenario,
      readonlyScenario,
      selectScenario,
      noMatchScenario,
      overwriteScenario
    ].every((scenario) => scenario.automation_result_received === true),
    fill_executed_via: emptyFormScenario.fill_executed_via ?? null,
    active_tab_expected: safeNumber(emptyFormScenario.active_tab_expected),
    filled_count: safeNumber(emptyFormScenario.filled_count),
    skipped_count: Math.max(
      emptyFormScenario.skipped_count ?? 0,
      partiallyFilledScenario.skipped_count ?? 0,
      readonlyScenario.skipped_count ?? 0,
      overwriteScenario.skipped_count ?? 0
    ),
    readonly_skipped_count: safeNumber(readonlyScenario.readonly_skipped_count),
    select_filled_count: safeNumber(selectScenario.select_filled_count),
    no_match_detected: noMatchScenario.no_match_detected === true,
    overwrite_prevented: partiallyFilledScenario.overwrite_prevented === true
      || overwriteScenario.overwrite_prevented === true,
    popup_feedback_verified: popupFeedbackVerified,
    scenario_results: scenarioResults,
    scenario_details: scenarios,
    failure_reason: failureReasons.length > 0 ? failureReasons.join(" | ") : null
  };
}

function buildUnsupportedScenario(archetype) {
  return {
    id: `${archetype}_happy_path`,
    status: "unsupported",
    verified: false,
    failure_reason: `Browser smoke is not implemented for archetype ${archetype}.`
  };
}

export async function runBrowserSmokeAndCapture({
  runDir,
  runContext,
  brief,
  plan,
  buildReport,
  qaReport
}) {
  const resolvedRuntime = resolveCanonicalRuntime(runContext?.browser_smoke?.runtime);
  const assetsDir = path.join(runDir, "70_listing_assets");
  const downloadDir = path.join(runDir, "61_browser_smoke_downloads");
  await ensureDir(assetsDir);
  await fs.rm(downloadDir, { recursive: true, force: true });
  await ensureDir(downloadDir);

  const smokeBase = {
    stage: "BROWSER_SMOKE_AND_CAPTURE",
    generated_at: nowIso(),
    build_generated_at: buildReport.generated_at ?? "",
    candidate_id: brief.candidate_id,
    archetype: plan.archetype,
    happy_path_verified: false,
    runtime: resolvedRuntime,
    trigger_surface: null,
    trigger_method: null,
    browser_driver: null,
    browser_version: null,
    popup_opened: null,
    automation_result_received: null,
    fill_executed_via: null,
    active_tab_expected: null,
    incompatibility_reason: null,
    extension_id: null,
    extension_name: "",
    extension_path: buildReport.workspace_dist ?? "",
    scenarios: [],
    screenshot_manifest: path.join(runDir, "70_screenshot_manifest.json")
  };

  const screenshotBase = {
    stage: "BROWSER_SMOKE_AND_CAPTURE",
    generated_at: nowIso(),
    build_generated_at: buildReport.generated_at ?? "",
    candidate_id: brief.candidate_id,
    archetype: plan.archetype,
    capture_source: "browser_smoke_happy_path",
    screenshots: []
  };

  if (qaReport.overall_status !== "passed" || buildReport.status !== "passed") {
    return {
      smokeReport: {
        ...smokeBase,
        status: "failed",
        browser: null,
        failure_reason: "Browser smoke requires a passed build and QA report."
      },
      screenshotManifest: {
        ...screenshotBase,
        status: "failed",
        smoke_generated_at: smokeBase.generated_at,
        failure_reason: "Browser smoke requires a passed build and QA report."
      }
    };
  }

  if (!["tab_csv_window_export", "single_profile_form_fill"].includes(plan.archetype)) {
    return {
      smokeReport: {
        ...smokeBase,
        status: "failed",
        browser: null,
        happy_path_verified: false,
        scenarios: [buildUnsupportedScenario(plan.archetype)],
        failure_reason: `Browser smoke is not implemented for archetype ${plan.archetype}.`
      },
      screenshotManifest: {
        ...screenshotBase,
        status: "failed",
        smoke_generated_at: smokeBase.generated_at,
        failure_reason: `Browser smoke is not implemented for archetype ${plan.archetype}.`
      }
    };
  }

  if (plan.archetype === "tab_csv_window_export" && resolvedRuntime !== "ixbrowser") {
    let fixtureServer = null;
    try {
      const fixture = await createFixtureServer();
      fixtureServer = fixture;
      const result = await runTabExportPuppeteerScenario({
        buildReport,
        brief,
        runtime: resolvedRuntime,
        fixtureBaseUrl: fixture.baseUrl,
        assetsDir,
        downloadDir,
        screenshots: screenshotBase.screenshots
      });
      const { scenario } = result;
      const smokeReport = {
        ...smokeBase,
        status: scenario.status === "passed" ? "passed" : "failed",
        browser: result.browserDetails,
        ...browserRuntimeFields(result.browserDetails),
        extension_id: result.extensionId,
        extension_path: result.extensionPath,
        extension_name: result.extensionName,
        happy_path_verified: scenario.verified === true,
        browser_driver: scenario.browser_driver,
        scenarios: [scenario]
      };

      return {
        smokeReport,
        screenshotManifest: {
          ...screenshotBase,
          status: screenshotBase.screenshots.length > 0 && scenario.verified === true ? "passed" : "failed",
          smoke_generated_at: smokeReport.generated_at
        }
      };
    } catch (error) {
      return {
        smokeReport: {
          ...smokeBase,
          status: "failed",
          browser: null,
          incompatibility_reason: resolvedRuntime === "ixbrowser" ? error.message : null,
          failure_reason: error.message
        },
        screenshotManifest: {
          ...screenshotBase,
          status: "failed",
          smoke_generated_at: smokeBase.generated_at,
          failure_reason: error.message
        }
      };
    } finally {
      await fixtureServer?.close?.().catch(() => {});
    }
  }

  const preferredFormFillDriver = runContext?.browser_smoke?.driver
    ?? (plan.archetype === "single_profile_form_fill" ? "puppeteer" : null);

  if (plan.archetype === "single_profile_form_fill" && preferredFormFillDriver === "puppeteer") {
    let fixtureServer = null;
    try {
      const fixture = await createFixtureServer();
      fixtureServer = fixture;
      const result = await runFormFillPuppeteerScenario({
        buildReport,
        brief,
        runtime: resolvedRuntime,
        fixtureBaseUrl: fixture.baseUrl,
        assetsDir,
        screenshots: screenshotBase.screenshots
      });
      const summary = result.summary;
      const smokeReport = {
        ...smokeBase,
        status: summary.status,
        browser: result.browserDetails,
        ...browserRuntimeFields(result.browserDetails),
        extension_id: result.extensionId,
        extension_path: result.extensionPath,
        extension_name: result.extensionName,
        happy_path_verified: summary.happy_path_verified === true,
        trigger_surface: summary.trigger_surface,
        trigger_method: summary.trigger_method,
        browser_driver: summary.browser_driver,
        popup_opened: summary.popup_opened,
        automation_result_received: summary.automation_result_received,
        fill_executed_via: summary.fill_executed_via,
        active_tab_expected: safeNumber(summary.active_tab_expected),
        filled_count: safeNumber(summary.filled_count),
        skipped_count: safeNumber(summary.skipped_count),
        readonly_skipped_count: safeNumber(summary.readonly_skipped_count),
        select_filled_count: safeNumber(summary.select_filled_count),
        no_match_detected: summary.no_match_detected === true,
        overwrite_prevented: summary.overwrite_prevented === true,
        popup_feedback_verified: summary.popup_feedback_verified === true,
        scenario_results: summary.scenario_results,
        scenarios: result.scenarios,
        ...(summary.failure_reason ? { failure_reason: summary.failure_reason } : {})
      };

      return {
        smokeReport,
        screenshotManifest: {
          ...screenshotBase,
          status: screenshotBase.screenshots.length > 0 && summary.happy_path_verified === true ? "passed" : "failed",
          smoke_generated_at: smokeReport.generated_at
        }
      };
    } catch (error) {
      return {
        smokeReport: {
          ...smokeBase,
          status: "failed",
          browser: null,
          incompatibility_reason: resolvedRuntime === "ixbrowser" ? error.message : null,
          failure_reason: error.message
        },
        screenshotManifest: {
          ...screenshotBase,
          status: "failed",
          smoke_generated_at: smokeBase.generated_at,
          failure_reason: error.message
        }
      };
    } finally {
      await fixtureServer?.close?.().catch(() => {});
    }
  }

  let browser = null;
  let context = null;
  let cleanupMode = "browser";
  let standaloneUserDataDir = "";
  let fixtureServer = null;
  let tempRoot = "";
  try {
    const copy = await createAsciiExtensionCopy(buildReport.workspace_dist);
    tempRoot = copy.tempRoot;
    let browserDetails = null;
    let page = null;
    let loadedExtension = null;

    if (resolvedRuntime === "ixbrowser") {
      const ixBrowser = await openIxBrowserProfile({ extensionDir: copy.extensionDir });
      browser = ixBrowser.browser;
      browserDetails = ixBrowser.browserDetails;
      context = browser.contexts()[0] ?? await browser.newContext();
      page = context.pages()[0] ?? await context.newPage();
      try {
        loadedExtension = await resolveLoadedExtension({
          page,
          extensionDir: copy.extensionDir,
          productName: brief.product_name_working
        });
      } catch {
        await loadUnpackedExtension({ page, extensionDir: copy.extensionDir });
        loadedExtension = await resolveLoadedExtension({
          page,
          extensionDir: copy.extensionDir,
          productName: brief.product_name_working
        });
      }
    } else {
      const dedicated = await openDedicatedPlaywrightContext({
        extensionDir: copy.extensionDir,
        incompatibility: null
      });
      context = dedicated.context;
      cleanupMode = "context";
      standaloneUserDataDir = dedicated.userDataDir;
      browserDetails = dedicated.browserDetails;
      page = context.pages()[0] ?? await context.newPage();
      loadedExtension = await resolveLoadedExtension({
        page,
        extensionDir: copy.extensionDir,
        productName: brief.product_name_working
      });
    }

    const fixture = await createFixtureServer();
    fixtureServer = fixture;

    const popupPage = await context.newPage();
    let scenario = null;
    if (plan.archetype === "tab_csv_window_export") {
      scenario = await runTabExportScenario({
        browser,
        context,
        popupPage,
        extensionId: loadedExtension.id,
        fixtureBaseUrl: fixture.baseUrl,
        assetsDir,
        downloadDir,
        screenshots: screenshotBase.screenshots
      });
    } else if (plan.archetype === "single_profile_form_fill") {
      scenario = await runFormFillScenario({
        context,
        popupPage,
        extensionId: loadedExtension.id,
        fixtureBaseUrl: fixture.baseUrl,
        assetsDir,
        screenshots: screenshotBase.screenshots
      });
    }

    const isFormFillSuite = plan.archetype === "single_profile_form_fill"
      && Array.isArray(scenario?.scenario_details);
    const smokeScenarios = isFormFillSuite
      ? scenario.scenario_details
      : (scenario ? [scenario] : []);
    const smokeReport = {
      ...smokeBase,
      status: scenario?.status === "passed" ? "passed" : "failed",
      browser: browserDetails,
      ...browserRuntimeFields(browserDetails),
      extension_id: loadedExtension.id,
      extension_path: copy.extensionDir,
      extension_name: loadedExtension.name,
      happy_path_verified: scenario?.verified === true,
      trigger_surface: scenario?.trigger_surface ?? null,
      browser_driver: scenario?.browser_driver ?? browserDetails?.driver ?? null,
      trigger_method: scenario?.trigger_method ?? null,
      popup_opened: scenario?.popup_opened ?? null,
      automation_result_received: scenario?.automation_result_received ?? null,
      fill_executed_via: scenario?.fill_executed_via ?? null,
      active_tab_expected: safeNumber(scenario?.active_tab_expected),
      filled_count: safeNumber(scenario?.filled_count),
      skipped_count: safeNumber(scenario?.skipped_count),
      readonly_skipped_count: safeNumber(scenario?.readonly_skipped_count),
      select_filled_count: safeNumber(scenario?.select_filled_count),
      no_match_detected: typeof scenario?.no_match_detected === "boolean"
        ? scenario.no_match_detected
        : null,
      overwrite_prevented: typeof scenario?.overwrite_prevented === "boolean"
        ? scenario.overwrite_prevented
        : null,
      popup_feedback_verified: typeof scenario?.popup_feedback_verified === "boolean"
        ? scenario.popup_feedback_verified
        : null,
      scenario_results: scenario?.scenario_results ?? null,
      scenarios: smokeScenarios,
      ...(scenario?.failure_reason ? { failure_reason: scenario.failure_reason } : {})
    };

    const screenshotManifest = {
      ...screenshotBase,
      status: screenshotBase.screenshots.length > 0 && scenario?.verified === true ? "passed" : "failed",
      smoke_generated_at: smokeReport.generated_at
    };

    return { smokeReport, screenshotManifest };
  } catch (error) {
    return {
      smokeReport: {
        ...smokeBase,
        status: "failed",
        browser: null,
        incompatibility_reason: resolvedRuntime === "ixbrowser" ? error.message : null,
        failure_reason: error.message
      },
      screenshotManifest: {
        ...screenshotBase,
        status: "failed",
        smoke_generated_at: smokeBase.generated_at,
        failure_reason: error.message
      }
    };
  } finally {
    await fixtureServer?.close?.().catch(() => {});
    if (cleanupMode === "context") {
      await context?.close?.().catch(() => {});
    } else {
      await browser?.close?.().catch(() => {});
    }
    if (standaloneUserDataDir) {
      await fs.rm(standaloneUserDataDir, { recursive: true, force: true }).catch(() => {});
    }
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
}
