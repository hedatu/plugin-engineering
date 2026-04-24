import fs from "node:fs/promises";
import path from "node:path";
import {
  copyDir,
  ensureDir,
  fileExists,
  listFiles,
  readJson,
  slugify,
  writeJson,
  writeText
} from "../utils/io.mjs";
import {
  hasSecretLikeContent,
  inspectSecretLikeContent,
  redactSecretLikeText
} from "../utils/redaction.mjs";
import { assertMatchesSchema } from "../utils/schema.mjs";
import { writeManagedRunArtifact } from "../workflow/runEventArtifacts.mjs";
import {
  buildPaySiteMonetizationConfig,
  isPaySiteProvider,
  loadPaySiteLocalConfig
} from "./paySiteWorkflow.mjs";

const MONETIZATION_TEMPLATE_FILES = [
  "monetization/licenseClient.js",
  "monetization/usageMeter.js",
  "monetization/upgradeFlow.js",
  "monetization/paywallView.js",
  "monetization/licensePage.html",
  "monetization/licensePage.js",
  "monetization_config.json"
];

const PAY_SITE_TEMPLATE_FILES = [
  "background.js",
  "monetization/paySiteConfig.js",
  "monetization/paySiteRuntime.js",
  "monetization/membershipClient.js",
  "monetization/usageGate.js",
  "monetization/checkoutFlow.js",
  "monetization/authFlow.js",
  "monetization/licensePage.html",
  "monetization/licensePage.js",
  "monetization_config.json",
  "pay_site_config.json"
];

const SECURITY_PATTERNS = [
  { name: "stripe_secret_key", pattern: /\bsk_(live|test)_[A-Za-z0-9]+\b/i },
  { name: "authorization_bearer", pattern: /authorization\s*:\s*bearer|bearer\s+[A-Za-z0-9._-]{10,}/i },
  { name: "private_key", pattern: /-----BEGIN(?: RSA| EC|)? PRIVATE KEY-----/i },
  { name: "webhook_secret", pattern: /webhook secret/i },
  { name: "lemon_squeezy_api_key", pattern: /lemon squeezy api key|lemon[_\s-]?squeezy[_\s-]?secret/i },
  { name: "stripe_secret_phrase", pattern: /stripe.{0,20}secret/i }
];

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function normalizeFreeLimit(value) {
  if (value && typeof value === "object") {
    return {
      amount: Number(value.amount ?? 10),
      unit: value.unit ?? "actions",
      scope: value.scope ?? "lifetime"
    };
  }
  return {
    amount: 10,
    unit: "actions",
    scope: "lifetime"
  };
}

function monetizationReadmeSection(config) {
  return `

## Monetization
- Free usage limit: ${config.free_limit.amount} ${config.free_limit.unit}
- Price: ${config.price_label}
- Upgrade flow: external payment page only
- License flow: user-pasted license key with remote verification
`;
}

function trustDisclosureText() {
  return "Local-only. No upload. No cloud sync. Lifetime access applies to the current major version.";
}

function monetizationPrivacyLines(config) {
  return [
    `<p>The extension enforces a free limit of ${config.free_limit.amount} ${config.free_limit.unit} before showing an upgrade prompt.</p>`,
    "<p>The Upgrade action opens an external payment page. The extension does not process card data or store provider secrets.</p>",
    "<p>License verification sends only the license key, product id, runtime extension id, anonymous install id, and version to the configured license service.</p>",
    `<p>${trustDisclosureText()}</p>`
  ].join("\n      ");
}

function monetizationPanelHtml(config) {
  const buttonPriceLabel = `${config.price_label ?? "$19 lifetime"}`.replace(/\s*lifetime$/i, "").trim() || config.price_label;
  return `      <section class="monetization-card" aria-label="Monetization">
        <p id="plan-badge" class="monetization-line monetization-label">Plan: Free</p>
        <p id="free-limit-copy" class="monetization-line">${config.free_limit.amount} free ${config.free_limit.unit}</p>
        <p id="usage-remaining" class="monetization-line">Free usage left: ${config.free_limit.amount} ${config.free_limit.unit}</p>
        <p id="monetization-message" class="monetization-line">Try the core action for free, then unlock unlimited fills on an external payment page.</p>
        <p id="monetization-trust" class="monetization-line monetization-trust">${trustDisclosureText()}</p>
        <div class="monetization-actions">
          <button id="upgrade-button" type="button" class="secondary">Unlock Lifetime - ${buttonPriceLabel}</button>
          <button id="open-license-page" type="button" class="secondary">Enter License Key</button>
          <button id="restore-license-button" type="button" class="secondary">Restore / Verify License</button>
        </div>
      </section>
`;
}

function monetizationCssBlock() {
  return `

.monetization-card {
  margin: 14px 0;
  padding: 12px;
  border: 1px solid rgba(25, 42, 62, 0.12);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.8);
}

.monetization-line {
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.4;
}

.monetization-label {
  font-weight: 700;
}

.monetization-trust {
  color: #4f5e71;
}

.monetization-actions {
  display: grid;
  gap: 8px;
}
`;
}

function injectMonetizationIntoPopupHtml(popupHtml, config) {
  if (popupHtml.includes('id="upgrade-button"')) {
    return popupHtml;
  }
  return popupHtml.replace(/(\s+<p id="status"[\s\S]*?<\/p>)/, (match) => `\n${monetizationPanelHtml(config)}${match}`);
}

function injectMonetizationIntoPopupCss(popupCss) {
  if (popupCss.includes(".monetization-card")) {
    return popupCss;
  }
  return `${popupCss}${monetizationCssBlock()}`;
}

function injectMonetizationIntoPopupJs(popupJs, { coreActionFunctionName, coreFeatureId }) {
  if (popupJs.includes("createMonetizationRuntime")) {
    return popupJs;
  }

  const importBlock = `import { createMonetizationRuntime } from "./monetization/upgradeFlow.js";\n\n`;
  const runtimeBlock = `
let monetizationRuntimePromise = null;

function monetizationStatusNodes() {
  return {
    statusNode,
    planNode: document.getElementById("plan-badge"),
    freeLimitNode: document.getElementById("free-limit-copy"),
    usageNode: document.getElementById("usage-remaining"),
    messageNode: document.getElementById("monetization-message"),
    trustNode: document.getElementById("monetization-trust"),
    upgradeButton: document.getElementById("upgrade-button"),
    licenseButton: document.getElementById("open-license-page"),
    restoreButton: document.getElementById("restore-license-button")
  };
}

async function ensureMonetizationRuntime() {
  if (!monetizationRuntimePromise) {
    monetizationRuntimePromise = createMonetizationRuntime({
      configUrl: chrome.runtime.getURL("monetization_config.json"),
      licensePageUrl: chrome.runtime.getURL("monetization/licensePage.html"),
      ...monetizationStatusNodes()
    });
  }
  return monetizationRuntimePromise;
}

async function guardPaidFeatureUsage(featureId = "${coreFeatureId}") {
  const runtime = await ensureMonetizationRuntime();
  const gate = await runtime.consumeOrBlock(featureId);
  if (!gate.allowed) {
    statusNode.textContent = gate.message;
  }
  return gate;
}

`;

  let next = `${importBlock}${popupJs}`;
  next = next.replace("const statusNode = document.getElementById(\"status\");", `const statusNode = document.getElementById("status");${runtimeBlock}`);
  next = next.replace(
    new RegExp(`async function ${coreActionFunctionName}\\(([^)]*)\\) \\{`),
    `async function ${coreActionFunctionName}($1) {\n  const monetizationGate = await guardPaidFeatureUsage("${coreFeatureId}");\n  if (!monetizationGate.allowed) {\n    return null;\n  }\n`
  );
  next = `${next}\n\nensureMonetizationRuntime().catch((error) => {\n  statusNode.textContent = "Monetization failed: " + error.message;\n});\n\nglobalThis.__monetizationTestHooks = {\n  ensureMonetizationRuntime,\n  guardPaidFeatureUsage\n};\n`;
  return next;
}

function isPaySiteMode(runContext) {
  return runContext?.monetization?.enabled === true
    && isPaySiteProvider(runContext?.monetization?.payment_provider ?? runContext?.pay_site?.membership_provider);
}

function paySiteReadmeSection(config) {
  return `

## Membership
- Free usage limit: ${config.free_limit.amount} ${config.free_limit.unit}
- Price: ${config.price_label}
- Login: email OTP through the external pay site stack
- Upgrade flow: external secure payment page only
- Unlock rule: webhook-confirmed entitlement only
`;
}

function paySiteTrustDisclosureText() {
  return "Local-only form data. No upload of form content. Payment handled on external secure page. Membership unlocks after webhook-confirmed entitlement.";
}

function paySitePrivacyLines(config) {
  return [
    `<p>The extension enforces a free limit of ${config.free_limit.amount} ${config.free_limit.unit} before showing an upgrade prompt.</p>`,
    "<p>Form data stays local to the extension and current tab. No upload of form content and no cloud sync are used.</p>",
    "<p>Email login, checkout, entitlement refresh, and usage metering are routed through the background service worker with public pay-site config only.</p>",
    "<p>The extension never stores payment provider secrets, service-role keys, or merchant secrets.</p>",
    "<p>successUrl does not unlock Pro locally. Only webhook-confirmed active entitlement unlocks Pro.</p>",
    `<p>${paySiteTrustDisclosureText()}</p>`
  ].join("\n      ");
}

function paySitePanelHtml(config) {
  return `      <section class="monetization-card" aria-label="Membership">
        <p id="plan-badge" class="monetization-line monetization-label">Plan: Free</p>
        <p id="free-limit-copy" class="monetization-line">${config.free_limit.amount} free ${config.free_limit.unit}</p>
        <p id="usage-remaining" class="monetization-line">${config.free_limit.amount} free actions left</p>
        <p id="monetization-message" class="monetization-line">Login with email, then upgrade on the external secure payment page.</p>
        <p id="monetization-trust" class="monetization-line monetization-trust">${paySiteTrustDisclosureText()}</p>
        <div class="membership-auth-grid">
          <label class="full">Email <input id="auth-email" type="email" placeholder="you@example.com" autocomplete="email" /></label>
          <button id="send-otp-button" type="button" class="secondary">Send code</button>
          <label class="full">Code <input id="auth-code" type="text" placeholder="123456" inputmode="numeric" /></label>
          <button id="verify-otp-button" type="button" class="secondary">Verify</button>
        </div>
        <p id="auth-state-copy" class="monetization-line">Login with email</p>
        <p id="member-email" class="monetization-line">Not signed in</p>
        <p id="config-state-copy" class="monetization-line monetization-trust">Membership unlocks after webhook-confirmed entitlement.</p>
        <div class="monetization-actions">
          <button id="upgrade-button" type="button" class="secondary">Unlock Lifetime - $19</button>
          <button id="refresh-membership-button" type="button" class="secondary">I've paid / Refresh membership</button>
          <button id="open-license-page" type="button" class="secondary">Open Membership Page</button>
          <button id="restore-license-button" type="button" class="secondary">Restore Membership</button>
          <button id="sign-out-button" type="button" class="secondary">Sign out</button>
        </div>
      </section>
`;
}

function paySiteCssBlock() {
  return `

.monetization-card {
  margin: 14px 0;
  padding: 12px;
  border: 1px solid rgba(25, 42, 62, 0.12);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.82);
}

.monetization-line {
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.45;
}

.monetization-label {
  font-weight: 700;
}

.monetization-trust {
  color: #4f5e71;
}

.membership-auth-grid {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  margin: 8px 0 12px;
}

.membership-auth-grid .full {
  grid-column: 1 / -1;
}

.membership-auth-grid button {
  align-self: end;
}

.monetization-actions {
  display: grid;
  gap: 8px;
}
`;
}

function injectPaySiteIntoPopupHtml(popupHtml, config) {
  if (popupHtml.includes('id="send-otp-button"')) {
    return popupHtml;
  }
  return popupHtml.replace(/(\s+<p id="status"[\s\S]*?<\/p>)/, (match) => `\n${paySitePanelHtml(config)}${match}`);
}

function injectPaySiteIntoPopupCss(popupCss) {
  if (popupCss.includes(".membership-auth-grid")) {
    return popupCss;
  }
  return `${popupCss}${paySiteCssBlock()}`;
}

function injectPaySiteIntoPopupJs(popupJs, { coreActionFunctionName, coreFeatureId }) {
  if (popupJs.includes("createPaySiteRuntime")) {
    return popupJs;
  }

  const importBlock = `import { createPaySiteRuntime } from "./monetization/paySiteRuntime.js";\n\n`;
  const runtimeBlock = `
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

async function guardPaidFeatureUsage(featureId = "${coreFeatureId}") {
  const runtime = await ensurePaySiteRuntime();
  const gate = await runtime.consumeUsageGate(featureId);
  if (!gate.allowed) {
    statusNode.textContent = gate.message;
  }
  return gate;
}

`;

  let next = `${importBlock}${popupJs}`;
  next = next.replace("const statusNode = document.getElementById(\"status\");", `const statusNode = document.getElementById("status");${runtimeBlock}`);
  next = next.replace(
    new RegExp(`async function ${coreActionFunctionName}\\(([^)]*)\\) \\{`),
    `async function ${coreActionFunctionName}($1) {\n  const monetizationGate = await guardPaidFeatureUsage("${coreFeatureId}");\n  if (!monetizationGate.allowed) {\n    return null;\n  }\n`
  );
  next = `${next}\n\nensurePaySiteRuntime().catch((error) => {\n  statusNode.textContent = "Membership failed: " + error.message;\n});\n\nglobalThis.__monetizationTestHooks = {\n  ensurePaySiteRuntime,\n  guardPaidFeatureUsage\n};\n`;
  return next;
}

function paySiteBackgroundScript() {
  return `import { installMembershipBackgroundHandlers } from "./monetization/membershipClient.js";

installMembershipBackgroundHandlers().catch((error) => {
  console.error("Membership background init failed:", error.message);
});
`;
}

function paySiteLicensePageHtml(config) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${config.product_name} Membership</title>
    <style>
      :root { color-scheme: light; font-family: "Segoe UI", sans-serif; }
      body { margin: 0; background: #f5f2ec; color: #213244; }
      main { max-width: 720px; margin: 0 auto; padding: 28px 20px 40px; }
      .card { background: #fff; border-radius: 18px; padding: 20px; box-shadow: 0 12px 32px rgba(20, 30, 45, 0.08); }
      h1 { margin: 0 0 8px; }
      p { line-height: 1.55; }
      .grid { display: grid; gap: 12px; }
      label { display: block; font-size: 13px; }
      input { width: 100%; box-sizing: border-box; margin-top: 6px; padding: 10px 12px; border-radius: 10px; border: 1px solid #cfd8df; }
      button { border: 0; border-radius: 10px; padding: 10px 14px; background: #1f5f9b; color: #fff; cursor: pointer; }
      .secondary { background: #d8e3ed; color: #213244; }
      .actions { display: grid; gap: 8px; margin-top: 12px; }
      .muted { color: #576675; }
    </style>
  </head>
  <body>
    <main>
      <div class="card">
        <h1>${config.product_name} Membership</h1>
        <p class="muted">Login with email, pay on the external secure page, then refresh membership. successUrl does not unlock locally.</p>
        <div class="grid">
          <label>Email <input id="auth-email" type="email" placeholder="you@example.com" autocomplete="email" /></label>
          <button id="send-otp-button" type="button" class="secondary">Send code</button>
          <label>Code <input id="auth-code" type="text" placeholder="123456" inputmode="numeric" /></label>
          <button id="verify-otp-button" type="button" class="secondary">Verify</button>
        </div>
        <p id="auth-state-copy">Login with email</p>
        <p id="member-email" class="muted">Not signed in</p>
        <p id="plan-badge">Plan: Free</p>
        <p id="free-limit-copy">${config.free_limit.amount} free ${config.free_limit.unit}</p>
        <p id="usage-remaining">${config.free_limit.amount} free actions left</p>
        <p id="monetization-message">Payment handled on external secure page.</p>
        <p id="monetization-trust" class="muted">${paySiteTrustDisclosureText()}</p>
        <p id="config-state-copy" class="muted">Membership unlocks after webhook-confirmed entitlement.</p>
        <div class="actions">
          <button id="upgrade-button" type="button">Unlock Lifetime - $19</button>
          <button id="refresh-membership-button" type="button" class="secondary">I've paid / Refresh membership</button>
          <button id="restore-license-button" type="button" class="secondary">Restore Membership</button>
          <button id="sign-out-button" type="button" class="secondary">Sign out</button>
        </div>
        <p id="status" class="muted">Ready.</p>
      </div>
    </main>
    <script type="module" src="licensePage.js"></script>
  </body>
</html>
`;
}

function paySiteLicensePageScript() {
  return `import { createPaySiteRuntime } from "./paySiteRuntime.js";

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
`;
}

async function copyPaySiteRuntimeSources({ projectRoot, repoDir }) {
  const monetizationDir = path.join(repoDir, "monetization");
  await ensureDir(monetizationDir);
  const sourceDir = path.join(projectRoot, "src", "monetization");
  const runtimeFiles = [
    "paySiteConfig.js",
    "paySiteRuntime.js",
    "membershipClient.js",
    "usageGate.js",
    "checkoutFlow.js",
    "authFlow.js"
  ];
  for (const fileName of runtimeFiles) {
    await fs.copyFile(
      path.join(sourceDir, fileName),
      path.join(monetizationDir, fileName)
    );
  }
}

function buildDefaultMonetizationConfig(runContext, brief, plan) {
  const taskMonetization = runContext.monetization ?? {};
  const productId = taskMonetization.product_id ?? slugify(brief.product_name_working ?? brief.candidate_id ?? plan.archetype);
  const freeLimit = normalizeFreeLimit(taskMonetization.free_limit);
  return {
    product_id: productId,
    product_name: brief.product_name_working,
    extension_id: "runtime:auto",
    pricing_model: taskMonetization.pricing_model ?? "free_trial_then_lifetime",
    free_limit: freeLimit,
    price_label: taskMonetization.price_label ?? "$19 lifetime",
    upgrade_url: taskMonetization.upgrade_url ?? `https://payments.example.com/stripe-payment-link-placeholder/${productId}`,
    license_verify_url: taskMonetization.license_verify_url ?? "https://license.example.com/license/verify-placeholder",
    license_activate_url: taskMonetization.license_activate_url ?? "https://license.example.com/license/activate-placeholder",
    support_email: taskMonetization.support_email ?? "support@example.com",
    pro_features: taskMonetization.pro_features ?? [
      "unlimited_fills",
      "license_restore",
      "priority_placeholder_support"
    ],
    free_features: taskMonetization.free_features ?? [
      `${freeLimit.amount}_free_${freeLimit.unit}`,
      "single_local_profile",
      "local_only_fill"
    ],
    local_only_claim: taskMonetization.local_only_claim !== false,
    payment_provider: taskMonetization.payment_provider ?? "stripe_payment_link",
    checkout_mode: taskMonetization.checkout_mode ?? "disabled",
    entitlement_cache_ttl_hours: Number(taskMonetization.entitlement_cache_ttl_hours ?? 24),
    offline_grace_hours: Number(taskMonetization.offline_grace_hours ?? 72),
    privacy_disclosure_required: taskMonetization.privacy_disclosure_required !== false
  };
}

export async function loadRunContextForMonetization(runDir) {
  return readJson(path.join(runDir, "00_run_context.json"));
}

export function monetizationEnabled(runContext) {
  return runContext?.monetization?.enabled === true;
}

export function augmentImplementationPlanWithMonetization(plan, runContext) {
  if (!monetizationEnabled(runContext)) {
    return plan;
  }
  const paySiteMode = isPaySiteMode(runContext);
  return {
    ...plan,
    module_plan: unique([
      ...(plan.module_plan ?? []),
      "monetization config",
      ...(paySiteMode
        ? [
            "background membership runtime",
            "email OTP auth UI",
            "entitlement refresh",
            "usage gate",
            "external checkout flow"
          ]
        : [
            "paywall UI",
            "license client",
            "usage meter",
            "external upgrade flow"
          ])
    ]),
    files_to_generate: unique([
      ...(plan.files_to_generate ?? []),
      ...(paySiteMode ? PAY_SITE_TEMPLATE_FILES : MONETIZATION_TEMPLATE_FILES)
    ]),
    permissions: unique([
      ...(plan.permissions ?? []),
      "storage"
    ]),
    test_matrix: unique([
      ...(plan.test_matrix ?? []),
      ...(paySiteMode
        ? [
            "email otp ui exists",
            "entitlement refresh exists",
            "usage gate runs before fill",
            "upgrade opens external pay site",
            "successUrl does not unlock locally",
            "smtp blocker message is truthful",
            "content script has no token"
          ]
        : [
            "free usage works",
            "usage count decreases",
            "upgrade opens external tab",
            "license activation page exists",
            "restore license flow exists",
            "mock active entitlement unlocks Pro",
            "listing paid disclosure present",
            "offline grace does not become permanent pro unlock"
          ])
    ]),
    storage_plan: paySiteMode
      ? `${plan.storage_plan ?? "Local storage."} Also stores membership.installationId, membership.session, membership.entitlement.<productKey>, and local degraded free-usage counters in chrome.storage.local. Tokens stay in the background/service worker path only.`
      : `${plan.storage_plan ?? "Local storage."} Also stores free-usage counters, cached entitlement state, anonymous install id, and masked license metadata in chrome.storage.local.`,
    qa_checks: unique([
      ...(plan.qa_checks ?? []),
      "monetization_config_present",
      ...(paySiteMode
        ? [
            "pay_site_config_present",
            "auth_ui_present",
            "background_runtime_present",
            "usage_gate_present",
            "success_url_not_unlock_basis"
          ]
        : [
            "license_ui_present",
            "upgrade_button_present",
            "free_usage_counter_present",
            "restore_license_ui_present"
          ])
    ]),
    risk_flags: unique([
      ...(plan.risk_flags ?? []),
      "no provider secrets in bundle",
      ...(paySiteMode
        ? [
            runContext.monetization?.smtp_status === "verified_independent"
              ? "smtp verified independent"
              : "smtp blocker may prevent real otp verification",
            "successUrl must not unlock membership locally",
            "do not trust local storage alone for paid unlock"
          ]
        : [
            "do not trust local storage alone for paid unlock"
          ])
    ])
  };
}

export async function applyMonetizationToBuilder({
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
  coreActionFunctionName,
  coreFeatureId
  }) {
  const runContext = await loadRunContextForMonetization(runDir);
  if (!monetizationEnabled(runContext)) {
    return {
      manifest,
      popupHtml,
      popupCss,
      popupJs,
      privacyHtml,
      readme,
      monetization: {
        enabled: false,
        config: null,
        generatedFiles: []
      }
    };
  }

  const paySiteMode = isPaySiteMode(runContext);
  const paySiteConfigRecord = paySiteMode
    ? await loadPaySiteLocalConfig({
        projectRoot: runContext.project_root,
        configPath: runContext.pay_site?.local_config_path ?? runContext.pay_site_config_path
      })
    : null;
  const paySiteConfig = paySiteConfigRecord?.config ?? null;
  const config = paySiteMode
    ? buildPaySiteMonetizationConfig({
        brief,
        paySiteConfig,
        currentMonetization: runContext.monetization ?? {}
      })
    : buildDefaultMonetizationConfig(runContext, brief, plan);
  await assertMatchesSchema({
    data: config,
    schemaPath: path.join(runContext.project_root, "schemas", "monetization_config.schema.json"),
    label: "monetization_config.json"
  });

  await ensureDir(repoDir);
  await copyDir(path.join(runContext.project_root, "templates", "monetization"), path.join(repoDir, "monetization"));
  await writeJson(path.join(repoDir, "monetization_config.json"), config);
  if (paySiteMode) {
    await copyPaySiteRuntimeSources({
      projectRoot: runContext.project_root,
      repoDir
    });
    await writeJson(path.join(repoDir, "pay_site_config.json"), paySiteConfig);
    await writeText(path.join(repoDir, "background.js"), paySiteBackgroundScript());
    await writeText(path.join(repoDir, "monetization", "licensePage.html"), paySiteLicensePageHtml(config));
    await writeText(path.join(repoDir, "monetization", "licensePage.js"), paySiteLicensePageScript());
  }

  const nextManifest = paySiteMode
    ? {
        ...manifest,
        permissions: unique([...(manifest.permissions ?? []), "storage"]),
        host_permissions: unique([
          ...((manifest.host_permissions ?? [])),
          `${paySiteConfig.publicSupabaseUrl.replace(/\/$/, "")}/*`,
          `${paySiteConfig.siteUrl.replace(/\/$/, "")}/*`
        ]),
        background: {
          service_worker: "background.js",
          type: "module"
        }
      }
    : {
        ...manifest,
        permissions: unique([...(manifest.permissions ?? []), "storage"])
      };
  const nextPopupHtml = paySiteMode
    ? injectPaySiteIntoPopupHtml(popupHtml, config)
    : injectMonetizationIntoPopupHtml(popupHtml, config);
  const nextPopupCss = paySiteMode
    ? injectPaySiteIntoPopupCss(popupCss)
    : injectMonetizationIntoPopupCss(popupCss);
  const nextPopupJs = paySiteMode
    ? injectPaySiteIntoPopupJs(popupJs, { coreActionFunctionName, coreFeatureId })
    : injectMonetizationIntoPopupJs(popupJs, { coreActionFunctionName, coreFeatureId });
  const nextPrivacyHtml = privacyHtml.replace(
    "</main>",
    `      ${paySiteMode ? paySitePrivacyLines(config) : monetizationPrivacyLines(config)}\n    </main>`
  );
  const nextReadme = `${readme}${paySiteMode ? paySiteReadmeSection(config) : monetizationReadmeSection(config)}`;

  return {
    manifest: nextManifest,
    popupHtml: nextPopupHtml,
    popupCss: nextPopupCss,
    popupJs: nextPopupJs,
    privacyHtml: nextPrivacyHtml,
    readme: nextReadme,
    monetization: {
      enabled: true,
      config,
      generatedFiles: (paySiteMode ? PAY_SITE_TEMPLATE_FILES : MONETIZATION_TEMPLATE_FILES).slice()
    }
  };
}

export async function writeMonetizationTestMatrix({ runDir, brief, plan, buildReport }) {
  const runContext = await loadRunContextForMonetization(runDir);
  if (!monetizationEnabled(runContext) || buildReport.status !== "passed") {
    return null;
  }
  const paySiteMode = isPaySiteMode(runContext);

  const distDir = buildReport.workspace_dist;
  const popupJsPath = path.join(distDir, "popup.js");
  const popupHtmlPath = path.join(distDir, "popup.html");
  const licensePagePath = path.join(distDir, "monetization", "licensePage.html");
  const licensePageJsPath = path.join(distDir, "monetization", "licensePage.js");
  const licenseClientPath = path.join(distDir, "monetization", "licenseClient.js");
  const upgradeFlowPath = path.join(distDir, "monetization", "upgradeFlow.js");
  const popupJs = await fs.readFile(popupJsPath, "utf8").catch(() => "");
  const popupHtml = await fs.readFile(popupHtmlPath, "utf8").catch(() => "");
  const licensePageJs = await fs.readFile(licensePageJsPath, "utf8").catch(() => "");
  const licenseClient = await fs.readFile(licenseClientPath, "utf8").catch(() => "");
  const upgradeFlow = await fs.readFile(upgradeFlowPath, "utf8").catch(() => "");

  if (paySiteMode) {
    const backgroundJs = await fs.readFile(path.join(distDir, "background.js"), "utf8").catch(() => "");
    const paySiteConfig = await fs.readFile(path.join(distDir, "pay_site_config.json"), "utf8").catch(() => "");
    const membershipClient = await fs.readFile(path.join(distDir, "monetization", "membershipClient.js"), "utf8").catch(() => "");
    const checkoutFlow = await fs.readFile(path.join(distDir, "monetization", "checkoutFlow.js"), "utf8").catch(() => "");
    const usageGate = await fs.readFile(path.join(distDir, "monetization", "usageGate.js"), "utf8").catch(() => "");
    const authFlow = await fs.readFile(path.join(distDir, "monetization", "authFlow.js"), "utf8").catch(() => "");
    const sessionStorageBoundaryPresent = (
      authFlow.includes("MEMBERSHIP_STORAGE_KEYS.session")
      || authFlow.includes("[MEMBERSHIP_STORAGE_KEYS.session]")
      || paySiteConfig.includes('"membership.session"')
      || paySiteConfig.includes('session: "membership.session"')
    ) && !popupHtml.includes("access_token") && !popupJs.includes("access_token");
    const tests = [
      {
        id: "pay_site_config_present",
        name: "pay site public config present",
        current_status: paySiteConfig.includes("leadfill-one-profile") && paySiteConfig.includes("https://pay-api.915500.xyz") ? "passed" : "missing",
        why_it_matters: "The extension must point at the California primary HWH APIs.",
        evidence_artifact: "workspace/dist/pay_site_config.json",
        recommended_next_action: "Keep this file public-only and rerun security scan before any upload."
      },
      {
        id: "email_otp_ui_present",
        name: "email OTP UI present",
        current_status: popupHtml.includes('id=\"send-otp-button\"') && popupHtml.includes('id=\"verify-otp-button\"') ? "passed" : "missing",
        why_it_matters: "The commercial plugin must let users log in through the HWH email OTP flow.",
        evidence_artifact: "workspace/dist/popup.html",
        recommended_next_action: "Use real plugin smoke to verify SEND_OTP and VERIFY_OTP before launch."
      },
      {
        id: "background_message_contract_present",
        name: "background message contract present",
        current_status: ["SEND_OTP", "VERIFY_OTP", "REGISTER_INSTALLATION", "CREATE_CHECKOUT", "REFRESH_ENTITLEMENT", "CONSUME_USAGE"].every((type) => backgroundJs.includes(type) || membershipClient.includes(type)) ? "passed" : "missing",
        why_it_matters: "The extension-side protocol must match the verified HWH handoff.",
        evidence_artifact: "workspace/dist/monetization/membershipClient.js",
        recommended_next_action: "Do not add service-role or Waffo private keys to this client contract."
      },
      {
        id: "checkout_source_chrome_extension",
        name: "checkout source is chrome_extension",
        current_status: checkoutFlow.includes('source: \"chrome_extension\"') ? "passed" : "missing",
        why_it_matters: "The HWH payment trace must distinguish plugin checkouts from web checkouts.",
        evidence_artifact: "workspace/dist/monetization/checkoutFlow.js",
        recommended_next_action: "Confirm the backend still receives source=chrome_extension in real plugin smoke."
      },
      {
        id: "success_url_not_unlock_basis",
        name: "successUrl does not unlock locally",
        current_status: popupHtml.includes("webhook-confirmed entitlement") && checkoutFlow.includes("successUrl") ? "passed" : "missing",
        why_it_matters: "Paid access must come only from webhook-derived entitlement.",
        evidence_artifact: "workspace/dist/popup.html",
        recommended_next_action: "Keep the success page as informational only."
      },
      {
        id: "consume_usage_before_fill",
        name: "CONSUME_USAGE gate exists before fill",
        current_status: popupJs.includes("guardPaidFeatureUsage") && usageGate.includes("consume-usage") ? "passed" : "missing",
        why_it_matters: "Free quota and Pro unlimited behavior must be enforced before the core fill action runs.",
        evidence_artifact: "workspace/dist/popup.js",
        recommended_next_action: "Run the 10 free fills plus 11th quota exceeded smoke before publish."
      },
      {
        id: "pro_entitlement_refresh_path",
        name: "REFRESH_ENTITLEMENT active path exists",
        current_status: membershipClient.includes("get-entitlement") && popupJs.includes("refreshMembershipButton") ? "passed" : "missing",
        why_it_matters: "Users must refresh membership after payment rather than relying on successUrl.",
        evidence_artifact: "workspace/dist/monetization/membershipClient.js",
        recommended_next_action: "Verify active, free, invalid, expired, and revoked states in plugin smoke."
      },
      {
        id: "auth_tokens_stay_in_background_path",
        name: "auth tokens stay in background path",
        current_status: sessionStorageBoundaryPresent ? "passed" : "missing",
        why_it_matters: "Content scripts and visible UI must not persist raw session tokens.",
        evidence_artifact: "workspace/dist/monetization/authFlow.js",
        recommended_next_action: "Inspect storage during smoke and verify content script has no token."
      },
      {
        id: "free_usage_counter_visible",
        name: "free usage counter visible",
        current_status: popupHtml.includes('id=\"usage-remaining\"') ? "passed" : "missing",
        why_it_matters: "Free users must see the remaining fill allowance before hitting the paywall.",
        evidence_artifact: "workspace/dist/popup.html",
        recommended_next_action: "Keep the 10-fill copy and remaining counter visible in the popup."
      },
      {
        id: "quota_exceeded_path_present",
        name: "quota exceeded path present",
        current_status: usageGate.includes("QUOTA_EXCEEDED") && usageGate.includes("remaining: 0") ? "passed" : "missing",
        why_it_matters: "The 11th free fill must stop with a quota error instead of silently allowing more usage.",
        evidence_artifact: "workspace/dist/monetization/usageGate.js",
        recommended_next_action: "Keep the quota-exceeded path covered in plugin smoke before upload."
      },
      {
        id: "test_mode_checkout_guard",
        name: "test mode checkout guard",
        current_status: paySiteConfig.includes('\"checkoutMode\"') && paySiteConfig.includes('\"test\"') ? "passed" : "missing",
        why_it_matters: "This candidate must not imply production payment is enabled.",
        evidence_artifact: "workspace/dist/pay_site_config.json",
        recommended_next_action: "Keep production payment disabled until explicit approval and live payment verification."
      },
      {
        id: "public_only_no_provider_secret",
        name: "public-only payment config",
        current_status: !/(SUPABASE_SERVICE_ROLE_KEY|WAFFO_PRIVATE_KEY|merchant secret|webhook secret|sk_live|sk_test)/i.test(`${paySiteConfig}\n${popupJs}\n${backgroundJs}`) ? "passed" : "missing",
        why_it_matters: "The extension may ship public Supabase config only, never payment or service-role secrets.",
        evidence_artifact: "110_monetization_security_scan.json",
        recommended_next_action: "Run monetization:security-scan before any upload decision."
      }
    ];
    const report = {
      stage: "MONETIZATION_TEST_MATRIX",
      status: tests.some((test) => test.current_status === "missing") ? "failed" : "passed",
      run_id: runContext.run_id,
      candidate_name: brief.product_name_working,
      archetype: plan.archetype,
      payment_provider: "pay_site_supabase_waffo",
      checkout_mode: runContext.monetization?.checkout_mode ?? null,
      tests
    };
    await assertMatchesSchema({
      data: report,
      schemaPath: path.join(runContext.project_root, "schemas", "monetization_test_matrix.schema.json"),
      label: "109_monetization_test_matrix.json"
    });
    await writeManagedRunArtifact({
      runDir,
      artifactName: "109_monetization_test_matrix.json",
      data: report,
      runContext
    });
    return report;
  }

  const tests = [
    {
      id: "free_usage_available",
      name: "free usage available",
      current_status: popupJs.includes("guardPaidFeatureUsage") ? "planned" : "missing",
      why_it_matters: "The user must be able to try the core value before the paywall.",
      evidence_artifact: "workspace/dist/popup.js",
      recommended_next_action: "Use browser smoke to confirm the first free action succeeds."
    },
    {
      id: "free_usage_counter_decreases",
      name: "free usage counter decreases",
      current_status: popupHtml.includes('id=\"usage-remaining\"') ? "planned" : "missing",
      why_it_matters: "The free meter must show what the user has left before the paywall appears.",
      evidence_artifact: "workspace/dist/popup.html",
      recommended_next_action: "Consume one free action and confirm the remaining count updates."
    },
    {
      id: "free_limit_reached",
      name: "free limit reached",
      current_status: upgradeFlow.includes("free_limit_reached") ? "planned" : "missing",
      why_it_matters: "The popup must block only after the configured free limit is exhausted.",
      evidence_artifact: "workspace/dist/monetization/upgradeFlow.js",
      recommended_next_action: "Run repeated core actions and confirm the paywall appears at the right threshold."
    },
    {
      id: "upgrade_url_external_tab",
      name: "upgrade URL opens external tab",
      current_status: upgradeFlow.includes("chrome.tabs.create") ? "planned" : "missing",
      why_it_matters: "The extension must not host card entry or embed provider secrets.",
      evidence_artifact: "workspace/dist/monetization/upgradeFlow.js",
      recommended_next_action: "Browser smoke should verify the placeholder checkout URL opens."
    },
    {
      id: "no_secret_in_bundle",
      name: "no secret in extension bundle",
      current_status: "planned",
      why_it_matters: "Provider secrets must never ship in the extension.",
      evidence_artifact: null,
      recommended_next_action: "Run monetization:security-scan on the run before any upload."
    },
    {
      id: "license_input_ui",
      name: "license input UI works",
      current_status: await fileExists(licensePagePath) ? "planned" : "missing",
      why_it_matters: "The user must be able to activate or restore access without editing config files.",
      evidence_artifact: "workspace/dist/monetization/licensePage.html",
      recommended_next_action: "Open the extension license page and verify input, activate, and restore actions."
    },
    {
      id: "license_page_opens",
      name: "license page opens",
      current_status: popupHtml.includes('id=\"open-license-page\"') && popupHtml.includes('id=\"restore-license-button\"') ? "planned" : "missing",
      why_it_matters: "The popup must expose both initial activation and restore or verify paths clearly.",
      evidence_artifact: "workspace/dist/popup.html",
      recommended_next_action: "Click both popup license buttons and confirm the license page opens."
    },
    {
      id: "mock_active_entitlement_unlocks_pro",
      name: "mock active entitlement unlocks Pro",
      current_status: upgradeFlow.includes("setMockActiveEntitlement") ? "planned" : "missing",
      why_it_matters: "Test mode needs a safe way to verify paid unlock behavior without a real payment backend.",
      evidence_artifact: "workspace/dist/monetization/upgradeFlow.js",
      recommended_next_action: "Use the test hook to set a mock active entitlement and confirm the usage cap is bypassed."
    },
    {
      id: "invalid_license_error",
      name: "invalid license shows error",
      current_status: /invalid|expired|revoked|network_error|offline_grace/.test(licensePageJs) ? "planned" : "missing",
      why_it_matters: "The user must see clear invalid, expired, or revoked states.",
      evidence_artifact: "workspace/dist/monetization/licensePage.js",
      recommended_next_action: "Exercise invalid and revoked fixture responses from the payment system."
    },
    {
      id: "offline_grace_behavior",
      name: "offline grace behavior",
      current_status: /offline_grace|Reconnect and verify your license/.test(licenseClient) ? "planned" : "missing",
      why_it_matters: "The paid experience should survive short outages without trusting storage forever.",
      evidence_artifact: "workspace/dist/monetization/licenseClient.js",
      recommended_next_action: "Verify cached active entitlements degrade only after offline grace expires."
    },
    {
      id: "local_storage_fields_safe",
      name: "local storage fields safe",
      current_status: licenseClient.includes("MASKED_LICENSE_STORAGE_KEY") && !licenseClient.includes("client_secret") ? "planned" : "missing",
      why_it_matters: "The extension should store masked or hashed license metadata only.",
      evidence_artifact: "workspace/dist/monetization/licenseClient.js",
      recommended_next_action: "Inspect chrome.storage.local during smoke and confirm no full provider secret or raw license vault is stored."
    },
    {
      id: "local_only_claim_visible",
      name: "local-only claim visible",
      current_status: /Local-only|No upload|No cloud sync/.test(popupHtml) ? "planned" : "missing",
      why_it_matters: "The user must understand the local-only trust boundary before paying.",
      evidence_artifact: "workspace/dist/popup.html",
      recommended_next_action: "Verify the popup and privacy page keep the trust claim visible."
    },
    {
      id: "no_payment_secret_in_source_dist",
      name: "no payment secret in source or dist",
      current_status: "planned",
      why_it_matters: "Public or placeholder endpoints are allowed, but secrets are not.",
      evidence_artifact: null,
      recommended_next_action: "Run monetization:security-scan against the commercial run."
    },
    {
      id: "listing_paid_disclosure_present",
      name: "listing paid disclosure present",
      current_status: "planned",
      why_it_matters: "The store listing must truthfully disclose limits and paid unlocks.",
      evidence_artifact: null,
      recommended_next_action: "Verify listing copy mentions the free limit, paid features, and external payment page."
    }
  ];

  const report = {
    stage: "MONETIZATION_TEST_MATRIX",
    status: tests.some((test) => test.current_status === "missing") ? "failed" : "planned",
    run_id: runContext.run_id,
    candidate_name: brief.product_name_working,
    archetype: plan.archetype,
    tests
  };

  await assertMatchesSchema({
    data: report,
    schemaPath: path.join(runContext.project_root, "schemas", "monetization_test_matrix.schema.json"),
    label: "109_monetization_test_matrix.json"
  });
  await writeManagedRunArtifact({
    runDir,
    artifactName: "109_monetization_test_matrix.json",
    data: report,
    runContext
  });
  return report;
}

async function findLatestRun(projectRoot) {
  const runsRoot = path.join(projectRoot, "runs");
  const entries = await fs.readdir(runsRoot, { withFileTypes: true });
  const names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort((a, b) => b.localeCompare(a));
  for (const name of names) {
    const runDir = path.join(runsRoot, name);
    if (await fileExists(path.join(runDir, "00_run_context.json"))) {
      return runDir;
    }
  }
  return null;
}

function isTextLike(relativePath) {
  return /\.(json|js|html|css|md|txt|mjs)$/i.test(relativePath);
}

function isAcceptablePublicUrl(url) {
  if (!url || typeof url !== "string") {
    return false;
  }
  if (!/^https?:\/\//i.test(url)) {
    return false;
  }
  if (/@/.test(url)) {
    return false;
  }
  return true;
}

export async function runMonetizationSecurityScan({ projectRoot, runDir: explicitRunDir = null }) {
  const runDir = explicitRunDir ? path.resolve(explicitRunDir) : await findLatestRun(projectRoot);
  if (!runDir) {
    throw new Error("No run with 00_run_context.json was found.");
  }

  const runContext = await loadRunContextForMonetization(runDir);
  const distDir = path.join(runDir, "workspace", "dist");
  const repoDir = path.join(runDir, "workspace", "repo");
  const candidatePaths = [
    path.join(distDir, "monetization_config.json"),
    path.join(repoDir, "monetization_config.json"),
    path.join(runDir, "monetization_config.json")
  ];
  let configFile = null;
  for (const candidate of candidatePaths) {
    if (await fileExists(candidate)) {
      configFile = candidate;
      break;
    }
  }
  const scannedPaths = [];
  const findings = [];
  const notes = [];

  let checkoutMode = null;
  let paymentProvider = null;
  let configScanStatus = "missing_config";
  if (configFile) {
    scannedPaths.push(path.relative(projectRoot, configFile).replaceAll("\\", "/"));
    const config = await readJson(configFile);
    checkoutMode = config.checkout_mode ?? null;
    paymentProvider = config.payment_provider ?? null;
    configScanStatus = "passed";
    await assertMatchesSchema({
      data: config,
      schemaPath: path.join(projectRoot, "schemas", "monetization_config.schema.json"),
      label: "monetization_config.json"
    }).catch((error) => {
      configScanStatus = "failed";
      findings.push({
        severity: "high",
        path: path.relative(projectRoot, configFile).replaceAll("\\", "/"),
        reason: `monetization_config_schema_invalid: ${error.message}`,
        sample: null
      });
    });
    for (const [field, value] of Object.entries({
      upgrade_url: config.upgrade_url,
      license_verify_url: config.license_verify_url,
      license_activate_url: config.license_activate_url
    })) {
      if (!isAcceptablePublicUrl(value)) {
        findings.push({
          severity: "high",
          path: path.relative(projectRoot, configFile).replaceAll("\\", "/"),
          reason: `${field} must be a public or placeholder URL without embedded credentials.`,
          sample: `${value ?? ""}`.slice(0, 120)
        });
      }
    }
    const redactionChecks = inspectSecretLikeContent(config);
    if (hasSecretLikeContent(redactionChecks)) {
      findings.push({
        severity: "high",
        path: path.relative(projectRoot, configFile).replaceAll("\\", "/"),
        reason: "monetization_config contains secret-like material.",
        sample: null
      });
    }
  } else {
    notes.push("No monetization_config.json was found in workspace/dist, workspace/repo, or the run root.");
  }

  let bundleScanStatus = "skipped_no_built_extension";
  if (await fileExists(distDir)) {
    bundleScanStatus = "passed";
    const files = await listFiles(distDir);
    for (const entry of files) {
      if (!isTextLike(entry.relativePath)) {
        continue;
      }
      const absolutePath = entry.absolutePath;
      scannedPaths.push(path.relative(projectRoot, absolutePath).replaceAll("\\", "/"));
      const text = await fs.readFile(absolutePath, "utf8").catch(() => "");
      const secretChecks = inspectSecretLikeContent(text);
      const relativePath = path.relative(projectRoot, absolutePath).replaceAll("\\", "/");
      const allowedPaySiteTokenRuntimeIdentifier = paymentProvider === "pay_site_supabase_waffo"
        && /workspace\/dist\/monetization\/(?:authFlow|membershipClient)\.js$/i.test(relativePath)
        && secretChecks.secret_marker_pattern_present
        && !secretChecks.secret_values_present_in_artifact
        && !secretChecks.authorization_header_pattern_present
        && !secretChecks.key_material_pattern_present;
      if (hasSecretLikeContent(secretChecks) && !allowedPaySiteTokenRuntimeIdentifier) {
        findings.push({
          severity: "high",
          path: relativePath,
          reason: "secret-like content detected by generic redaction scan.",
          sample: null
        });
      } else if (allowedPaySiteTokenRuntimeIdentifier) {
        notes.push(`${relativePath} contains public auth token field names used by the background OTP/session runtime; no concrete secret value was detected.`);
      }
      for (const pattern of SECURITY_PATTERNS) {
        const match = text.match(pattern.pattern);
        if (match) {
          findings.push({
            severity: "high",
            path: path.relative(projectRoot, absolutePath).replaceAll("\\", "/"),
            reason: `Matched blocked pattern ${pattern.name}.`,
            sample: redactSecretLikeText(match[0].slice(0, 120))
          });
        }
      }
    }
  } else {
    notes.push("workspace/dist is missing, so the extension bundle was not scanned.");
  }

  const liveCheckoutBlockedWithoutApproval = checkoutMode === "live";
  if (liveCheckoutBlockedWithoutApproval) {
    findings.push({
      severity: "high",
      path: configFile ? path.relative(projectRoot, configFile).replaceAll("\\", "/") : path.relative(projectRoot, runDir).replaceAll("\\", "/"),
      reason: "checkout_mode=live requires explicit human approval before build or release.",
      sample: null
    });
  }

  const report = {
    stage: "MONETIZATION_SECURITY_SCAN",
    status: findings.length > 0
      ? "failed"
      : (configFile || bundleScanStatus === "passed" ? "passed" : "skipped"),
    run_id: runContext.run_id,
    run_dir: runDir,
    scanned_paths: unique(scannedPaths),
    patterns_checked: SECURITY_PATTERNS.map((pattern) => pattern.name),
    findings,
    checkout_mode: checkoutMode,
    human_approval_required_for_live: true,
    live_checkout_blocked_without_approval: liveCheckoutBlockedWithoutApproval,
    bundle_scan_status: bundleScanStatus,
    config_scan_status: configScanStatus,
    notes
  };

  await assertMatchesSchema({
    data: report,
    schemaPath: path.join(projectRoot, "schemas", "monetization_security_scan.schema.json"),
    label: "110_monetization_security_scan.json"
  });
  await writeManagedRunArtifact({
    runDir,
    artifactName: "110_monetization_security_scan.json",
    data: report,
    runContext
  });
  return { runDir, runContext, report };
}
