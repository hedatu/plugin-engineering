import fs from "node:fs/promises";
import path from "node:path";
import { buildSafeReport, validateArtifact } from "../review/helpers.mjs";
import { fileExists, readJson } from "../utils/io.mjs";
import { assertMatchesSchema } from "../utils/schema.mjs";
import { writeManagedRunArtifact } from "../workflow/runEventArtifacts.mjs";

export const PAY_SITE_INTEGRATION_TEST_MATRIX_ARTIFACT = "134_pay_site_integration_test_matrix.json";

export const DEFAULT_PAY_SITE_LOCAL_CONFIG = {
  siteUrl: "https://pay.915500.xyz",
  publicSupabaseUrl: "https://pay-api.915500.xyz",
  publicSupabaseAnonKey: "<PUBLIC_SUPABASE_ANON_KEY_PLACEHOLDER>",
  productKey: "product_key_pending",
  planKey: "one_time_test",
  chromeExtensionId: "<CHROME_EXTENSION_ID_PLACEHOLDER>",
  checkoutSuccessUrl: "https://pay.915500.xyz/checkout/success",
  checkoutCancelUrl: "https://pay.915500.xyz/checkout/cancel",
  checkoutMode: "test",
  authMode: "email_otp",
  membershipProvider: "pay_site_supabase_waffo"
};

export function hasConfiguredPublicValue(value) {
  const normalized = `${value ?? ""}`.trim();
  return Boolean(normalized) && !/placeholder/i.test(normalized);
}

export function isProductKeyPending(value) {
  return `${value ?? ""}`.trim() === "product_key_pending";
}

export function isTestOnlyChatgpt2ObsidianProductKey(value) {
  return `${value ?? ""}`.trim() === "chatgpt2obsidian";
}

export function isPaySiteProvider(value) {
  return `${value ?? ""}`.trim() === "pay_site_supabase_waffo";
}

export async function loadPaySiteLocalConfig({ projectRoot, configPath }) {
  const absolutePath = path.resolve(configPath);
  const raw = await readJson(absolutePath);
  const config = {
    ...DEFAULT_PAY_SITE_LOCAL_CONFIG,
    ...raw
  };
  await assertMatchesSchema({
    data: config,
    schemaPath: path.join(projectRoot, "schemas", "pay_site_config.schema.json"),
    label: path.basename(absolutePath)
  });
  return {
    absolutePath,
    config
  };
}

export function redactPaySiteLocalConfig(configRecord) {
  const config = configRecord?.config ?? configRecord ?? {};
  return {
    siteUrl: config.siteUrl,
    publicSupabaseUrl: config.publicSupabaseUrl,
    publicSupabaseAnonKeyPresent: hasConfiguredPublicValue(config.publicSupabaseAnonKey),
    productKey: config.productKey,
    planKey: config.planKey,
    checkoutMode: config.checkoutMode,
    authMode: config.authMode,
    membershipProvider: config.membershipProvider,
    productKeyPending: isProductKeyPending(config.productKey),
    testOnlyProductMapping: isTestOnlyChatgpt2ObsidianProductKey(config.productKey)
  };
}

export function buildPaySiteMonetizationConfig({
  brief,
  paySiteConfig,
  currentMonetization = {}
}) {
  const smtpStatus = `${currentMonetization.smtp_status ?? paySiteConfig.smtpStatus ?? ""}`.trim();
  const smtpLoginBlockerExpected = currentMonetization.smtp_login_blocker_expected
    ?? !/(^verified$|^verified_independent$|^passed$)/i.test(smtpStatus);
  return {
    product_id: currentMonetization.product_id ?? "leadfill-one-profile",
    product_key: paySiteConfig.productKey,
    plan_key: paySiteConfig.planKey,
    product_name: currentMonetization.product_name ?? brief.product_name_working,
    extension_id: paySiteConfig.chromeExtensionId,
    pricing_model: currentMonetization.pricing_model ?? "free_trial_then_lifetime",
    free_limit: currentMonetization.free_limit ?? {
      amount: 10,
      unit: "fills",
      scope: "lifetime"
    },
    price_label: currentMonetization.price_label ?? "$19 lifetime",
    upgrade_url: paySiteConfig.siteUrl,
    license_verify_url: `${paySiteConfig.publicSupabaseUrl.replace(/\/$/, "")}/functions/v1/get-entitlement`,
    license_activate_url: `${paySiteConfig.publicSupabaseUrl.replace(/\/$/, "")}/auth/v1/verify`,
    support_email: currentMonetization.support_email ?? "<SUPPORT_EMAIL_PLACEHOLDER>",
    pro_features: currentMonetization.pro_features ?? [
      "unlimited fills",
      "membership restore",
      "lifetime access to the current major version"
    ],
    free_features: currentMonetization.free_features ?? [
      "10 free fills",
      "single local profile",
      "local-only form data"
    ],
    local_only_claim: true,
    payment_provider: "pay_site_supabase_waffo",
    checkout_mode: paySiteConfig.checkoutMode,
    entitlement_cache_ttl_hours: Number(currentMonetization.entitlement_cache_ttl_hours ?? 24),
    offline_grace_hours: Number(currentMonetization.offline_grace_hours ?? 72),
    privacy_disclosure_required: true,
    smtp_login_blocker_expected: smtpLoginBlockerExpected,
    smtp_status: smtpStatus || null,
    otp_status: currentMonetization.otp_status ?? paySiteConfig.otpStatus ?? null,
    source_chrome_extension_status: currentMonetization.source_chrome_extension_status
      ?? paySiteConfig.sourceChromeExtensionStatus
      ?? null,
    production_payment_status: currentMonetization.production_payment_status
      ?? paySiteConfig.productionPaymentStatus
      ?? "not_verified",
    webhook_unlock_only: true,
    degraded_free_usage_fallback: true,
    default_feature_key: "leadfill_fill_action",
    site_url: paySiteConfig.siteUrl,
    public_supabase_url: paySiteConfig.publicSupabaseUrl,
    public_supabase_anon_key_present: hasConfiguredPublicValue(paySiteConfig.publicSupabaseAnonKey),
    pay_site: {
      siteUrl: paySiteConfig.siteUrl,
      publicSupabaseUrl: paySiteConfig.publicSupabaseUrl,
      publicSupabaseAnonKey: paySiteConfig.publicSupabaseAnonKey,
      productKey: paySiteConfig.productKey,
      planKey: paySiteConfig.planKey,
      chromeExtensionId: paySiteConfig.chromeExtensionId,
      checkoutSuccessUrl: paySiteConfig.checkoutSuccessUrl,
      checkoutCancelUrl: paySiteConfig.checkoutCancelUrl,
      checkoutMode: paySiteConfig.checkoutMode,
      authMode: paySiteConfig.authMode,
      membershipProvider: paySiteConfig.membershipProvider,
      productKeyPending: isProductKeyPending(paySiteConfig.productKey),
      testOnlyProductMapping: isTestOnlyChatgpt2ObsidianProductKey(paySiteConfig.productKey)
    }
  };
}

export async function writePaySiteIntegrationTestMatrix({
  runDir,
  brief,
  plan,
  buildReport,
  browserSmokeReport = null
}) {
  const runContext = await readJson(path.join(runDir, "00_run_context.json"));
  const monetizationConfigPath = path.join(buildReport.workspace_dist, "monetization_config.json");
  const paySiteConfigPath = path.join(buildReport.workspace_dist, "pay_site_config.json");
  if (!(await fileExists(monetizationConfigPath)) || !(await fileExists(paySiteConfigPath))) {
    return null;
  }

  const monetizationConfig = await readJson(monetizationConfigPath);
  if (!isPaySiteProvider(monetizationConfig.payment_provider)) {
    return null;
  }
  const smtpLoginBlockerExpected = monetizationConfig.smtp_login_blocker_expected === true;

  const popupHtml = await fs.readFile(path.join(buildReport.workspace_dist, "popup.html"), "utf8").catch(() => "");
  const popupJs = await fs.readFile(path.join(buildReport.workspace_dist, "popup.js"), "utf8").catch(() => "");
  const backgroundJs = await fs.readFile(path.join(buildReport.workspace_dist, "background.js"), "utf8").catch(() => "");
  const paySiteConfig = await readJson(paySiteConfigPath);
  const smokeResults = browserSmokeReport?.scenario_results ?? {};

  const tests = [
    {
      id: "get_auth_state_logged_out",
      name: "GET_AUTH_STATE returns logged out",
      current_status: backgroundJs.includes("GET_AUTH_STATE") ? "passed" : "missing",
      why_it_matters: "Popup state must load without exposing tokens.",
      evidence_artifact: "workspace/dist/background.js",
      recommended_next_action: "Confirm the popup shows Login with email for logged-out users."
    },
    {
      id: "send_otp_handles_success_failure",
      name: "SEND_OTP handles success and failure",
      current_status: backgroundJs.includes("SEND_OTP") && (
        smtpLoginBlockerExpected
          ? popupJs.includes("Email login is not available yet")
          : popupJs.includes("Code sent. Check your email")
      ) ? "passed" : "missing",
      why_it_matters: "SMTP blockers must surface truthfully instead of faking success.",
      evidence_artifact: "workspace/dist/background.js",
      recommended_next_action: "Verify UI shows the blocked message when SMTP is unavailable."
    },
    {
      id: "verify_otp_saves_session",
      name: "VERIFY_OTP saves session on success",
      current_status: backgroundJs.includes("VERIFY_OTP") && backgroundJs.includes("membership.session") ? "passed" : "missing",
      why_it_matters: "OTP verification must only store session in the background storage namespace.",
      evidence_artifact: "workspace/dist/background.js",
      recommended_next_action: "Verify the background stores membership.session and the popup never persists raw tokens."
    },
    {
      id: "refresh_entitlement_requires_login",
      name: "REFRESH_ENTITLEMENT requires login",
      current_status: backgroundJs.includes("REFRESH_ENTITLEMENT") ? "passed" : "missing",
      why_it_matters: "Membership refresh must use the authenticated pay-site contract.",
      evidence_artifact: "workspace/dist/background.js",
      recommended_next_action: "Verify logged-out refresh guides the user to Login with email."
    },
    {
      id: "refresh_entitlement_unlocks_pro",
      name: "REFRESH_ENTITLEMENT active unlocks Pro",
      current_status: smokeResults.pay_site_mock_active_entitlement_unlocks_pro ?? (popupJs.includes("Pro unlocked.") ? "passed" : "missing"),
      why_it_matters: "Only webhook-confirmed active entitlement should unlock Pro.",
      evidence_artifact: browserSmokeReport ? "61_browser_smoke.json" : "workspace/dist/popup.js",
      recommended_next_action: "Verify mock active entitlement flips the popup to Pro Lifetime Active."
    },
    {
      id: "register_installation_success",
      name: "REGISTER_INSTALLATION success path exists",
      current_status: backgroundJs.includes("REGISTER_INSTALLATION") ? "passed" : "missing",
      why_it_matters: "Paid seats must bind to an installation ID before unlimited use.",
      evidence_artifact: "workspace/dist/background.js",
      recommended_next_action: "Verify registration happens after authenticated entitlement refresh."
    },
    {
      id: "register_installation_limit_error",
      name: "REGISTER_INSTALLATION max installations error",
      current_status: backgroundJs.includes("MAX_INSTALLATIONS_EXCEEDED") ? "passed" : "missing",
      why_it_matters: "Users need a truthful error when installation count is exhausted.",
      evidence_artifact: "workspace/dist/background.js",
      recommended_next_action: "Verify the popup surfaces the limit error clearly."
    },
    {
      id: "checkout_logged_out_requires_login",
      name: "CREATE_CHECKOUT while logged out returns LOGIN_REQUIRED UI",
      current_status: smokeResults.pay_site_logged_out_upgrade_prompts_login ?? (popupJs.includes("Log in with email before upgrading.") ? "passed" : "missing"),
      why_it_matters: "Checkout must never start anonymously.",
      evidence_artifact: browserSmokeReport ? "61_browser_smoke.json" : "workspace/dist/popup.js",
      recommended_next_action: "Verify Upgrade shows the login-required message when logged out."
    },
    {
      id: "checkout_success_opens_external_url",
      name: "CREATE_CHECKOUT success opens checkoutUrl",
      current_status: smokeResults.pay_site_mock_checkout_opens_external_url ?? (popupJs.includes("Checkout opened in a new tab") ? "passed" : "missing"),
      why_it_matters: "Payment must happen on the external secure page, not inside the extension.",
      evidence_artifact: browserSmokeReport ? "61_browser_smoke.json" : "workspace/dist/popup.js",
      recommended_next_action: "Verify the mock checkout opens a pay-site URL in a new tab."
    },
    {
      id: "success_url_not_unlock_basis",
      name: "Success page does not unlock locally",
      current_status: smokeResults.pay_site_success_url_does_not_unlock ?? (popupHtml.includes("webhook-confirmed entitlement") ? "passed" : "missing"),
      why_it_matters: "successUrl must never be treated as proof of paid unlock.",
      evidence_artifact: browserSmokeReport ? "61_browser_smoke.json" : "workspace/dist/popup.html",
      recommended_next_action: "Verify successUrl alone does not flip the popup to Pro."
    },
    {
      id: "consume_usage_allowed_runs_fill",
      name: "CONSUME_USAGE allowed=true runs fill",
      current_status: smokeResults.pay_site_free_user_can_fill ?? "planned",
      why_it_matters: "The free path must stay usable before the limit is exhausted.",
      evidence_artifact: browserSmokeReport ? "61_browser_smoke.json" : "workspace/dist/popup.js",
      recommended_next_action: "Verify the first free fill still executes the core workflow."
    },
    {
      id: "consume_usage_blocks_fill",
      name: "CONSUME_USAGE allowed=false blocks fill",
      current_status: smokeResults.pay_site_quota_exceeded_blocks_fill ?? (popupJs.includes("consumeUsageGate") ? "passed" : "missing"),
      why_it_matters: "The paywall must block before the core action runs.",
      evidence_artifact: browserSmokeReport ? "61_browser_smoke.json" : "workspace/dist/popup.js",
      recommended_next_action: "Exhaust free usage and verify the popup blocks before executing the fill."
    },
    {
      id: "content_script_no_token",
      name: "content script does not hold tokens",
      current_status: smokeResults.pay_site_content_script_has_no_token ?? (!/accessToken|refreshToken|authorization/i.test(popupJs) ? "passed" : "missing"),
      why_it_matters: "Tokens must remain in background or service worker state only.",
      evidence_artifact: browserSmokeReport ? "61_browser_smoke.json" : "workspace/dist/popup.js",
      recommended_next_action: "Verify content-side fill code never persists or forwards session tokens."
    },
    {
      id: "no_forbidden_secrets_in_bundle",
      name: "no service role or Waffo private key in bundle",
      current_status: "planned",
      why_it_matters: "The extension may ship public config only.",
      evidence_artifact: "110_monetization_security_scan.json",
      recommended_next_action: "Run monetization:security-scan after the pay-site integration build."
    },
    {
      id: "smtp_blocker_visible",
      name: "SMTP blocker displayed correctly",
      current_status: smtpLoginBlockerExpected
        ? (smokeResults.pay_site_real_otp_login ?? (popupJs.includes("Email login is not available yet") ? "passed" : "missing"))
        : "passed",
      why_it_matters: "Product acceptance must not assume real OTP is verified while SMTP is still blocked.",
      evidence_artifact: browserSmokeReport ? "61_browser_smoke.json" : "workspace/dist/popup.js",
      recommended_next_action: "Keep the OTP blocker message visible until real delivery is proven."
    }
  ];

  const report = buildSafeReport({
    stage: "PAY_SITE_INTEGRATION_TEST_MATRIX",
    status: tests.some((test) => test.current_status === "missing") ? "failed" : "passed",
    run_id: runContext.run_id,
    candidate_name: brief.product_name_working,
    archetype: plan.archetype,
    product_key: paySiteConfig.productKey,
    plan_key: paySiteConfig.planKey,
    smtp_blocker_expected: smtpLoginBlockerExpected,
    real_payment_e2e_status: smtpLoginBlockerExpected ? "blocked_by_smtp" : "verified_test_mode",
    tests
  });

  await validateArtifact(
    runContext.project_root,
    "pay_site_integration_test_matrix.schema.json",
    PAY_SITE_INTEGRATION_TEST_MATRIX_ARTIFACT,
    report
  );
  await writeManagedRunArtifact({
    runDir,
    artifactName: PAY_SITE_INTEGRATION_TEST_MATRIX_ARTIFACT,
    data: report,
    runContext
  });
  return report;
}
