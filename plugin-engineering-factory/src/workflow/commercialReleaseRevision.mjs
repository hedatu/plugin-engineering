import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendProductRevisionHistory,
  loadPortfolioRegistry,
  summarizePortfolioRegistry
} from "../portfolio/registry.mjs";
import { appendReleaseLedgerEntry, loadReleaseLedger } from "../publish/releaseLedger.mjs";
import { generateFunctionalTestMatrix, generateProductAcceptanceReview } from "../review/productQuality.mjs";
import {
  artifactPath,
  buildSafeReport,
  normalizeRelativePath,
  validateArtifact,
  writeManagedJsonArtifact,
  writeManagedMarkdownArtifact
} from "../review/helpers.mjs";
import {
  buildExtensionStage,
  browserSmokeAndCaptureStage,
  decidePublishIntentStage,
  generateAssetsStage,
  prepareListingPackageStage,
  runPolicyGateStage,
  runQaStage
} from "./stages.mjs";
import { runCloseRunStage } from "./closeRun.mjs";
import { loadManagedRunArtifact, runEventsDirectory } from "./runEventArtifacts.mjs";
import { isRunImmutable } from "./runLock.mjs";
import { validateSandboxValidationRun } from "./promoteToSandboxValidation.mjs";
import {
  bumpChromeExtensionVersion,
  compareChromeExtensionVersions,
  ensureChromeExtensionVersionGreaterThan,
  parseChromeExtensionVersion
} from "../utils/chromeVersion.mjs";
import { hasSecretLikeContent, inspectSecretLikeContent, redactSecretLikeValue } from "../utils/redaction.mjs";
import { ensureDir, fileExists, nowIso, readJson, writeJson, writeText } from "../utils/io.mjs";
import { augmentImplementationPlanWithMonetization } from "../monetization/integration.mjs";
import { upsertProductCatalogEntry } from "../../packages/product-catalog/index.mjs";

export const COMMERCIAL_RELEASE_REVISION_ARTIFACT = "128_commercial_release_revision.json";
export const COMMERCIAL_RELEASE_GATE_ARTIFACT = "129_commercial_release_gate.json";
export const COMMERCIAL_PUBLISH_STRATEGY_ARTIFACT = "130_commercial_publish_strategy.json";
export const PAYMENT_CONFIGURED_COMMERCIAL_CANDIDATE_ARTIFACT = "140_payment_configured_commercial_candidate.json";
export const COMMERCIAL_RELEASE_LEDGER_ACTION = "sandbox_prepare_commercial_release_revision";

const COPIED_SOURCE_ARTIFACTS = [
  "31_selected_candidate.json",
  "41_product_brief.json",
  "41_product_brief.md"
];

const REGENERATED_RUN_ARTIFACTS = [
  "42_implementation_plan.json",
  "50_build_report.json",
  "60_qa_report.json",
  "61_browser_smoke.json",
  "70_listing_assets",
  "70_screenshot_manifest.json",
  "71_listing_copy.json",
  "72_policy_gate.json",
  "80_publish_plan.json",
  "81_listing_package",
  "81_listing_package.zip",
  "81_listing_package_report.json",
  "83_sandbox_validation_plan.json",
  "99_close_run.json"
];

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function shortRandom() {
  return crypto.randomBytes(3).toString("hex");
}

function pad(value) {
  return `${value}`.padStart(2, "0");
}

function buildCommercialRunId({ itemId, targetVersion, now = new Date() }) {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const itemSlug = `${itemId ?? "sandbox"}`.replace(/[^a-z0-9]/gi, "").slice(0, 12).toLowerCase() || "sandbox";
  const versionSlug = `${targetVersion}`.replace(/\./g, "-");
  return `commercial-${date}-${time}-${itemSlug}-v${versionSlug}-${shortRandom()}`;
}

function buildPaymentConfiguredRunId({ productSlug = "leadfill", targetVersion, now = new Date() }) {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const safeProductSlug = `${productSlug}`.replace(/[^a-z0-9]/gi, "").slice(0, 16).toLowerCase() || "leadfill";
  const versionSlug = `${targetVersion}`.replace(/\./g, "-");
  return `commercial-payment-${date}-${time}-${safeProductSlug}-v${versionSlug}-${shortRandom()}`;
}

function buildSafeWorkflowReport(reportWithoutChecks) {
  const initialChecks = inspectSecretLikeContent(reportWithoutChecks);
  const redactionGuardTriggered = hasSecretLikeContent(initialChecks);
  const safeReport = redactSecretLikeValue(reportWithoutChecks);
  if (redactionGuardTriggered) {
    safeReport.status = "failed";
    safeReport.next_step = "remove secret-like content from commercial release inputs and retry";
  }
  return {
    ...safeReport,
    redaction_checks: {
      ...inspectSecretLikeContent(safeReport),
      redaction_guard_triggered: redactionGuardTriggered
    }
  };
}

async function hashFile(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function readOptionalJson(filePath) {
  if (!(await fileExists(filePath))) {
    return null;
  }
  return readJson(filePath);
}

async function reserveCommercialRunDir(runsRoot, itemId, targetVersion) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const runId = buildCommercialRunId({ itemId, targetVersion });
    const runDir = path.join(runsRoot, runId);
    if (!(await fileExists(runDir))) {
      await ensureDir(runDir);
      return { runId, runDir };
    }
  }
  throw new Error("Could not allocate a unique commercial release run id.");
}

async function reservePaymentConfiguredRunDir(runsRoot, targetVersion) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const runId = buildPaymentConfiguredRunId({ targetVersion });
    const runDir = path.join(runsRoot, runId);
    if (!(await fileExists(runDir))) {
      await ensureDir(runDir);
      return { runId, runDir };
    }
  }
  throw new Error("Could not allocate a unique payment-configured commercial run id.");
}

async function copySeedArtifacts(sourceRunDir, targetRunDir) {
  const copiedArtifacts = [];
  for (const relativePath of COPIED_SOURCE_ARTIFACTS) {
    const sourcePath = artifactPath(sourceRunDir, relativePath);
    const targetPath = artifactPath(targetRunDir, relativePath);
    await ensureDir(path.dirname(targetPath));
    await fs.copyFile(sourcePath, targetPath);
    copiedArtifacts.push(relativePath.replaceAll("\\", "/"));
  }
  return copiedArtifacts;
}

async function loadManagedArtifactData(runDir, artifactName, runContext) {
  return (await loadManagedRunArtifact({
    runDir,
    artifactName,
    runContext
  }))?.data ?? null;
}

async function loadSourceSandboxState(sourceRunDir) {
  const absoluteRunDir = path.resolve(sourceRunDir);
  const runContext = await readJson(artifactPath(absoluteRunDir, "00_run_context.json"));
  if ((runContext.run_type ?? runContext.task_mode) !== "sandbox_validation") {
    throw new Error(`Run ${runContext.run_id} is not a sandbox_validation run.`);
  }
  if (!(await isRunImmutable(absoluteRunDir))) {
    throw new Error(`Source run ${runContext.run_id} must be immutable before creating a commercial revision.`);
  }

  return {
    runDir: absoluteRunDir,
    runContext,
    selectedReport: await readJson(artifactPath(absoluteRunDir, "31_selected_candidate.json")),
    brief: await readJson(artifactPath(absoluteRunDir, "41_product_brief.json")),
    implementationPlan: await readJson(artifactPath(absoluteRunDir, "42_implementation_plan.json")),
    buildReport: await readJson(artifactPath(absoluteRunDir, "50_build_report.json")),
    sandboxPlan: await readJson(artifactPath(absoluteRunDir, "83_sandbox_validation_plan.json")),
    latestFunctionalMatrix: await loadManagedArtifactData(absoluteRunDir, "62_functional_test_matrix.json", runContext),
    latestAcceptanceReview: await loadManagedArtifactData(absoluteRunDir, "94_product_acceptance_review.json", runContext),
    latestReviewStatus: await loadManagedArtifactData(absoluteRunDir, "91_review_status.json", runContext)
  };
}

function pseudoPublishExecution({ runContext, packageSha256, manifestVersion, selectedReport }) {
  return {
    stage: "EXECUTE_PUBLISH_PLAN",
    status: "passed",
    execution_mode: "sandbox_validate",
    publish_validation_phase: "fetch_status_only",
    publisher_id: runContext.publisher_id ?? runContext.publish?.publisher_id ?? null,
    item_id: runContext.item_id ?? runContext.publish?.sandbox_item_id ?? null,
    package_sha256: packageSha256,
    manifest_version: manifestVersion,
    candidate_id: selectedReport?.selected_candidate_id ?? null,
    sandbox_fetch_status_verified: false,
    sandbox_upload_verified: false,
    publish_response: {
      executed: false,
      ok: null,
      body: null
    }
  };
}

function buildCommercialMonetizationConfig() {
  return {
    enabled: true,
    product_id: "leadfill-one-profile",
    product_name: "LeadFill One Profile",
    pricing_model: "free_trial_then_lifetime",
    free_limit: {
      amount: 10,
      unit: "fills",
      scope: "lifetime"
    },
    price_label: "$19 lifetime",
    upgrade_url: "https://payments.example.com/stripe-payment-link-placeholder/leadfill-one-profile",
    license_verify_url: "https://license.example.com/license/verify-placeholder",
    license_activate_url: "https://license.example.com/license/activate-placeholder",
    support_email: "support@example.com",
    payment_provider: "stripe_payment_link",
    checkout_mode: "disabled",
    local_only_claim: true,
    entitlement_cache_ttl_hours: 24,
    offline_grace_hours: 72,
    privacy_disclosure_required: true,
    free_features: [
      "10 free fills",
      "single local profile",
      "local-only storage"
    ],
    pro_features: [
      "unlimited fills",
      "license restore",
      "lifetime access to the current major version"
    ]
  };
}

function normalizePublicPaySiteConfig(rawConfig) {
  const siteUrl = `${rawConfig?.siteUrl ?? "https://pay.915500.xyz"}`.replace(/\/$/, "");
  const publicSupabaseUrl = `${rawConfig?.publicSupabaseUrl ?? "https://pay-api.915500.xyz"}`.replace(/\/$/, "");
  return {
    siteUrl,
    publicSupabaseUrl,
    publicSupabaseAnonKey: rawConfig?.publicSupabaseAnonKey ?? "<PUBLIC_SUPABASE_ANON_KEY_PLACEHOLDER>",
    productKey: rawConfig?.productKey ?? "leadfill-one-profile",
    planKey: rawConfig?.planKey ?? "lifetime",
    featureKey: rawConfig?.featureKey ?? "leadfill_fill_action",
    chromeExtensionId: rawConfig?.chromeExtensionId ?? "dnnpkaefmlhacigijccbhemgaenjbcpk",
    checkoutSuccessUrl: rawConfig?.checkoutSuccessUrl ?? `${siteUrl}/checkout/success`,
    checkoutCancelUrl: rawConfig?.checkoutCancelUrl ?? `${siteUrl}/checkout/cancel`,
    checkoutMode: rawConfig?.checkoutMode ?? "test",
    authMode: rawConfig?.authMode ?? "email_otp",
    membershipProvider: rawConfig?.membershipProvider ?? "pay_site_supabase_waffo",
    supportEmail: rawConfig?.supportEmail ?? "support@915500.xyz",
    smtpStatus: rawConfig?.smtpStatus ?? "verified_independent",
    otpStatus: rawConfig?.otpStatus ?? "verified",
    checkoutStatus: rawConfig?.checkoutStatus ?? "verified",
    webhookStatus: rawConfig?.webhookStatus ?? "verified",
    entitlementStatus: rawConfig?.entitlementStatus ?? "verified_from_payment",
    consumeUsageStatus: rawConfig?.consumeUsageStatus ?? "verified_free_quota_pro",
    paymentE2EStatus: rawConfig?.paymentE2EStatus ?? "verified_test_mode",
    sourceChromeExtensionStatus: rawConfig?.sourceChromeExtensionStatus ?? "verified",
    productionPaymentStatus: rawConfig?.productionPaymentStatus ?? "not_verified",
    currentPrimaryEnvironment: rawConfig?.currentPrimaryEnvironment ?? "california"
  };
}

function buildHwhPaySiteMonetizationConfig(paySiteConfig) {
  return {
    enabled: true,
    product_id: paySiteConfig.productKey,
    product_name: "LeadFill One Profile",
    pricing_model: "free_trial_then_lifetime",
    free_limit: {
      amount: 10,
      unit: "fills",
      scope: "lifetime"
    },
    price_label: "$19 lifetime",
    upgrade_url: paySiteConfig.siteUrl,
    license_verify_url: `${paySiteConfig.publicSupabaseUrl}/functions/v1/get-entitlement`,
    license_activate_url: `${paySiteConfig.publicSupabaseUrl}/auth/v1/verify`,
    support_email: paySiteConfig.supportEmail || "support@915500.xyz",
    payment_provider: "pay_site_supabase_waffo",
    checkout_mode: paySiteConfig.checkoutMode,
    local_only_claim: true,
    entitlement_cache_ttl_hours: 24,
    offline_grace_hours: 72,
    privacy_disclosure_required: true,
    free_features: [
      "10 free fills",
      "single local profile",
      "local-only form data"
    ],
    pro_features: [
      "unlimited fills",
      "membership restore",
      "lifetime access to the current major version"
    ],
    product_key: paySiteConfig.productKey,
    plan_key: paySiteConfig.planKey,
    default_feature_key: paySiteConfig.featureKey,
    site_url: paySiteConfig.siteUrl,
    public_supabase_url: paySiteConfig.publicSupabaseUrl,
    smtp_status: paySiteConfig.smtpStatus,
    otp_status: paySiteConfig.otpStatus,
    checkout_status: paySiteConfig.checkoutStatus,
    webhook_status: paySiteConfig.webhookStatus,
    entitlement_status: paySiteConfig.entitlementStatus,
    consume_usage_status: paySiteConfig.consumeUsageStatus,
    payment_e2e_status: paySiteConfig.paymentE2EStatus,
    source_chrome_extension_status: paySiteConfig.sourceChromeExtensionStatus,
    production_payment_status: paySiteConfig.productionPaymentStatus,
    smtp_login_blocker_expected: paySiteConfig.smtpStatus !== "verified_independent",
    webhook_unlock_only: true
  };
}

function resolvePaymentConfiguredTargetVersion({ requestedVersion, currentUploadedVersion }) {
  const requested = parseChromeExtensionVersion(requestedVersion).text;
  if (!currentUploadedVersion) {
    return {
      targetVersion: requested,
      strategy: "retain_requested_version_no_uploaded_version_detected"
    };
  }
  const current = parseChromeExtensionVersion(currentUploadedVersion).text;
  if (compareChromeExtensionVersions(requested, current) > 0) {
    return {
      targetVersion: requested,
      strategy: "retain_requested_version_above_uploaded_version"
    };
  }
  return {
    targetVersion: bumpChromeExtensionVersion(current),
    strategy: "bump_patch_because_requested_version_is_already_uploaded_or_not_greater"
  };
}

function buildMonetizationStrategyArtifact(runContext, brief, monetization) {
  const paySiteMode = monetization.payment_provider === "pay_site_supabase_waffo";
  return buildSafeWorkflowReport({
    stage: "MONETIZATION_STRATEGY",
    status: "passed",
    run_id: runContext.run_id,
    product_id: monetization.product_id,
    product_name: monetization.product_name,
    pricing_model: monetization.pricing_model,
    free_limit: monetization.free_limit,
    price_label: monetization.price_label,
    upgrade_url_placeholder: monetization.upgrade_url,
    license_activation_model: paySiteMode
      ? "email OTP login, external HWH checkout, webhook-derived entitlement refresh"
      : "external payment page plus license key activation and verification",
    entitlement_model: paySiteMode
      ? "HWH get-entitlement and consume-usage checks with webhook-confirmed active entitlement as the only Pro unlock source"
      : "remote verification with local cache and offline grace fallback",
    free_features: monetization.free_features,
    pro_features: monetization.pro_features,
    paid_disclosure_copy: [
      `Free plan includes ${monetization.free_limit.amount} ${monetization.free_limit.unit}.`,
      `Unlock Lifetime - ${monetization.price_label}.`,
      paySiteMode
        ? "Upgrade opens the external HWH checkout in test mode until production payment is explicitly approved."
        : "Upgrade opens an external payment page outside the extension.",
      paySiteMode
        ? "Refresh membership after payment; successUrl alone never unlocks Pro locally."
        : "Paste the license key inside the extension to activate or restore Pro access.",
      "The extension does not process cards and does not ship payment or service-role secrets."
    ],
    risk_notes: [
      paySiteMode
        ? "Production payment remains not verified; checkout mode must stay test or controlled until explicit approval."
        : "The current upgrade URL is a placeholder and not configured for live payments.",
      paySiteMode
        ? "Paid activation must remain webhook-derived; successUrl is informational only."
        : "The current license endpoints are placeholders and must be replaced before real commercial collection.",
      "Local-only, no-upload, and no-cloud-sync claims must remain true in the actual bundle."
    ],
    next_step: paySiteMode
      ? "Run monetization:security-scan, premium packaging, listing quality gate, and keep production payment disabled until explicit launch approval."
      : "Run monetization:security-scan and keep listing disclosure truthful until real payment endpoints are configured."
  });
}

function buildPaymentLinkFlowPlanArtifact(brief, monetization) {
  return buildSafeWorkflowReport({
    stage: "PAYMENT_LINK_FLOW_PLAN",
    status: "passed",
    candidate_name: brief.product_name_working,
    wedge_name: brief.single_purpose_statement,
    recommended_checkout_provider: monetization.payment_provider,
    checkout_url_placeholder: monetization.upgrade_url
  });
}

function buildLicenseActivationSpecArtifact(brief, monetization = {}) {
  const paySiteMode = monetization.payment_provider === "pay_site_supabase_waffo";
  return buildSafeWorkflowReport({
    stage: "LICENSE_ACTIVATION_SPEC",
    status: "passed",
    candidate_name: brief.product_name_working,
    wedge_name: brief.single_purpose_statement,
    storage_fields: paySiteMode
      ? [
          "membership.installationId",
          "membership.session",
          "membership.entitlement.<productKey>",
          "membership.usage.<productKey>.<featureKey>"
        ]
      : [
          "license_status",
          "plan",
          "verified_at",
          "expires_at",
          "lifetime",
          "features",
          "masked_license_key",
          "hashed_license_key"
        ]
  });
}

function buildCommercialPublishStrategyArtifact({
  commercialRunId,
  sourceRunId,
  sourceVersion,
  targetVersion
}) {
  return buildSafeWorkflowReport({
    stage: "COMMERCIAL_PUBLISH_STRATEGY",
    status: "passed",
    run_id: commercialRunId,
    current_staged_run_id: sourceRunId,
    current_staged_version: sourceVersion,
    target_commercial_version: targetVersion,
    recommended_option: "submit_commercial_revision",
    options: [
      {
        option_id: "publish_current_staged",
        title: "A. Publish current STAGED 0.1.2",
        summary: "Fastest path, but it ships the technical validation build rather than the commercial packaging and payment-ready revision.",
        pros: [
          "No re-review wait for the current approved package",
          "Technically proven upload and review path"
        ],
        cons: [
          "Misses the intended commercial packaging and monetization entry points",
          "Would publish a version the user explicitly does not want to ship"
        ]
      },
      {
        option_id: "submit_commercial_revision",
        title: "B. Submit 0.2.0 commercial revision",
        summary: "Best match for the current goal: keep 0.1.2 as proof the review path works, then resubmit the commercial candidate.",
        pros: [
          "Keeps the approved STAGED run as evidence the review path works",
          "Allows payment entry, membership activation, premium packaging, and updated listing assets"
        ],
        cons: [
          "Requires a new review cycle",
          "Needs human visual review and dashboard sync before any upload approval"
        ]
      },
      {
        option_id: "hold_staged_and_market_test",
        title: "C. Hold STAGED and market-test first",
        summary: "Useful if pricing or commercial positioning still needs more external proof before re-review.",
        pros: [
          "Lets the team test demand using landing and fake-door assets first",
          "Avoids immediate dashboard churn"
        ],
        cons: [
          "Delays the commercial Chrome Web Store submission",
          "Still does not ship the commercial bundle"
        ]
      }
    ],
    why: "Because the user wants payment entry, membership activation, premium packaging, and store-ready assets before release, the right move is to keep 0.1.2 STAGED as proof and submit 0.2.0 as the commercial candidate.",
    requires_re_review: true,
    no_auto_cancel: true,
    no_auto_publish: true,
    next_step: "Finish premium packaging, human visual review, and dashboard listing sync, then decide whether to request sandbox upload approval for 0.2.0."
  });
}

function commercialPublishStrategyMarkdown(report) {
  return [
    "# Commercial Publish Strategy",
    "",
    `- Current STAGED run: ${report.current_staged_run_id}`,
    `- Current STAGED version: ${report.current_staged_version}`,
    `- Target commercial version: ${report.target_commercial_version}`,
    `- Recommended option: ${report.recommended_option}`,
    "",
    "## Why",
    "",
    report.why,
    "",
    "## Options",
    "",
    ...report.options.flatMap((option) => [
      `### ${option.title}`,
      "",
      option.summary,
      "",
      "Pros:",
      ...option.pros.map((item) => `- ${item}`),
      "",
      "Cons:",
      ...option.cons.map((item) => `- ${item}`),
      ""
    ]),
    "## Next Step",
    "",
    report.next_step
  ].join("\n");
}

async function writeCommercialSupportArtifacts({
  runDir,
  runContext,
  brief,
  monetization,
  sourceRunId,
  sourceVersion,
  targetVersion,
  occurredAt
}) {
  const monetizationStrategy = buildMonetizationStrategyArtifact(runContext, brief, monetization);
  const paymentLinkFlowPlan = buildPaymentLinkFlowPlanArtifact(brief, monetization);
  const licenseActivationSpec = buildLicenseActivationSpecArtifact(brief, monetization);
  const publishStrategy = buildCommercialPublishStrategyArtifact({
    commercialRunId: runContext.run_id,
    sourceRunId,
    sourceVersion,
    targetVersion
  });

  await validateArtifact(runContext.project_root, "monetization_strategy.schema.json", "95_monetization_strategy.json", monetizationStrategy);
  await validateArtifact(runContext.project_root, "payment_link_flow_plan.schema.json", "96_payment_link_flow_plan.json", paymentLinkFlowPlan);
  await validateArtifact(runContext.project_root, "license_activation_spec.schema.json", "97_license_activation_spec.json", licenseActivationSpec);
  await validateArtifact(runContext.project_root, "commercial_publish_strategy.schema.json", COMMERCIAL_PUBLISH_STRATEGY_ARTIFACT, publishStrategy);

  await writeManagedJsonArtifact({
    runDir,
    runContext,
    artifactName: "95_monetization_strategy.json",
    data: monetizationStrategy,
    occurredAt
  });
  await writeManagedJsonArtifact({
    runDir,
    runContext,
    artifactName: "96_payment_link_flow_plan.json",
    data: paymentLinkFlowPlan,
    occurredAt
  });
  await writeManagedJsonArtifact({
    runDir,
    runContext,
    artifactName: "97_license_activation_spec.json",
    data: licenseActivationSpec,
    occurredAt
  });
  await writeManagedJsonArtifact({
    runDir,
    runContext,
    artifactName: COMMERCIAL_PUBLISH_STRATEGY_ARTIFACT,
    data: publishStrategy,
    occurredAt
  });
  await writeManagedMarkdownArtifact({
    runDir,
    runContext,
    fileName: "130_commercial_publish_strategy.md",
    category: "commercial_release",
    prefix: "130_commercial_publish_strategy",
    content: commercialPublishStrategyMarkdown(publishStrategy),
    occurredAt
  });

  return {
    monetizationStrategy,
    paymentLinkFlowPlan,
    licenseActivationSpec,
    publishStrategy
  };
}

export async function ensureCommercialReleaseLineageLedgerEntry({
  projectRoot,
  runDir,
  actionSource = "cli"
}) {
  const absoluteRunDir = path.resolve(runDir);
  const runContext = await readJson(artifactPath(absoluteRunDir, "00_run_context.json"));
  const plan = await readJson(artifactPath(absoluteRunDir, "83_sandbox_validation_plan.json"));
  if ((runContext.run_type ?? runContext.task_mode) !== "sandbox_validation") {
    throw new Error(`Run ${runContext.run_id} is not a sandbox_validation run.`);
  }
  if (
    runContext.revision_kind !== "commercial_release_revision"
    && plan.stage !== "COMMERCIAL_RELEASE_SANDBOX_VALIDATION"
  ) {
    throw new Error(`Run ${runContext.run_id} is not a commercial release revision.`);
  }

  const ledger = await loadReleaseLedger(projectRoot);
  const existingEntry = ledger.entries.find((entry) =>
    entry.action_type === COMMERCIAL_RELEASE_LEDGER_ACTION
    && (
      entry.run_id === runContext.run_id
      || entry.sandbox_run_id === runContext.run_id
      || entry.new_sandbox_run_id === runContext.run_id
    )
  ) ?? null;
  if (existingEntry) {
    return {
      created: false,
      entry: existingEntry
    };
  }

  const functionalMatrix = await loadManagedArtifactData(absoluteRunDir, "62_functional_test_matrix.json", runContext);
  const acceptanceReview = await loadManagedArtifactData(absoluteRunDir, "94_product_acceptance_review.json", runContext);
  const evidenceArtifacts = unique([
    normalizeRelativePath(projectRoot, artifactPath(absoluteRunDir, "83_sandbox_validation_plan.json")),
    functionalMatrix ? `state/run_events/${runContext.run_id}/62_functional_test_matrix.json` : null,
    acceptanceReview ? `state/run_events/${runContext.run_id}/94_product_acceptance_review.json` : null
  ]);

  const entry = await appendReleaseLedgerEntry(projectRoot, {
    run_id: runContext.run_id,
    source_run_id: runContext.source_daily_run_id ?? runContext.source_run_id ?? null,
    sandbox_run_id: runContext.run_id,
    source_sandbox_run_id: runContext.source_sandbox_run_id ?? runContext.source_run_id ?? null,
    new_sandbox_run_id: runContext.run_id,
    item_id: runContext.item_id ?? runContext.publish?.sandbox_item_id ?? null,
    publisher_id: runContext.publisher_id ?? runContext.publish?.publisher_id ?? null,
    item_name: plan.item_name ?? null,
    package_sha256: plan.package_sha256 ?? "",
    manifest_version: plan.manifest_version ?? null,
    current_sandbox_item_version: plan.current_sandbox_item_version ?? null,
    previous_manifest_version: plan.previous_manifest_version ?? null,
    target_manifest_version: plan.target_manifest_version ?? null,
    old_package_sha256: "",
    new_package_sha256: plan.package_sha256 ?? "",
    action_type: COMMERCIAL_RELEASE_LEDGER_ACTION,
    action_source: actionSource,
    action_status: "passed",
    occurred_at: plan.promoted_at ?? nowIso(),
    evidence_artifacts: evidenceArtifacts,
    chrome_webstore_response_summary: null,
    approval_artifact: null,
    production_write: false,
    sandbox_only: true
  });

  return {
    created: true,
    entry
  };
}

export async function createCommercialReleaseRevision({
  projectRoot,
  sourceRunDir,
  targetVersion,
  note,
  preparedBy = os.userInfo().username
}) {
  const state = await loadSourceSandboxState(sourceRunDir);
  const runsRoot = path.dirname(state.runDir);
  const sourceVersion = `${state.buildReport.manifest_version ?? state.sandboxPlan.manifest_version ?? "0.1.0"}`;
  const normalizedTargetVersion = ensureChromeExtensionVersionGreaterThan(
    parseChromeExtensionVersion(targetVersion).text,
    sourceVersion
  );
  const reserved = await reserveCommercialRunDir(
    runsRoot,
    state.runContext.item_id ?? state.runContext.publish?.sandbox_item_id ?? "sandbox",
    normalizedTargetVersion
  );
  const occurredAt = nowIso();
  const registrySummary = summarizePortfolioRegistry(await loadPortfolioRegistry(projectRoot));
  const monetization = buildCommercialMonetizationConfig();

  const runContext = {
    ...state.runContext,
    stage: "COMMERCIAL_RELEASE_REVISION",
    status: "passed",
    generated_at: occurredAt,
    run_id: reserved.runId,
    run_id_strategy: "commercial_release_revision_unique",
    allow_overwrite: false,
    overwrite_blocked: false,
    created_at: occurredAt,
    source_run_id: state.runContext.run_id,
    source_run_path: state.runDir,
    source_sandbox_run_id: state.runContext.run_id,
    source_sandbox_run_path: state.runDir,
    source_daily_run_id: state.runContext.source_daily_run_id ?? state.runContext.source_run_id ?? null,
    source_daily_run_path: state.runContext.source_daily_run_path ?? null,
    latest_revision_run_id: reserved.runId,
    revision_kind: "commercial_release_revision",
    revision_note: `${note ?? ""}`.trim(),
    previous_manifest_version: sourceVersion,
    target_manifest_version: normalizedTargetVersion,
    version_bump_strategy: "explicit_target_version",
    monetization,
    publish: {
      ...state.runContext.publish,
      execution_mode: "sandbox_validate",
      publish_validation_phase: "fetch_status_only",
      allow_public_release: false
    },
    portfolio_registry: {
      path: state.runContext.portfolio_registry?.path ?? path.join(projectRoot, "state", "portfolio_registry.json"),
      active_wedge_families: registrySummary.active_wedge_families,
      blocked_candidate_ids: registrySummary.blocked_candidate_ids,
      archetype_priors: registrySummary.archetype_priors,
      item_count: registrySummary.item_count
    }
  };

  await writeJson(artifactPath(reserved.runDir, "00_run_context.json"), runContext);
  const copiedArtifacts = await copySeedArtifacts(state.runDir, reserved.runDir);

  const revisionPlan = augmentImplementationPlanWithMonetization({
    ...state.implementationPlan,
    generated_at: occurredAt,
    build_version: normalizedTargetVersion
  }, runContext);
  await writeJson(artifactPath(reserved.runDir, "42_implementation_plan.json"), revisionPlan);

  const supportArtifacts = await writeCommercialSupportArtifacts({
    runDir: reserved.runDir,
    runContext,
    brief: state.brief,
    monetization,
    sourceRunId: state.runContext.run_id,
    sourceVersion,
    targetVersion: normalizedTargetVersion,
    occurredAt
  });

  const buildReport = await buildExtensionStage({
    runDir: reserved.runDir,
    brief: state.brief,
    plan: revisionPlan
  });
  const qaReport = await runQaStage({
    runDir: reserved.runDir,
    brief: state.brief,
    plan: revisionPlan,
    buildReport
  });
  const { browserSmokeReport, screenshotManifest } = await browserSmokeAndCaptureStage({
    runDir: reserved.runDir,
    runContext,
    brief: state.brief,
    plan: revisionPlan,
    buildReport,
    qaReport
  });
  const listingCopy = await generateAssetsStage({
    runDir: reserved.runDir,
    runContext,
    brief: state.brief,
    buildReport,
    qaReport,
    screenshotManifest
  });
  const policyGate = await runPolicyGateStage({
    runDir: reserved.runDir,
    runContext,
    brief: state.brief,
    plan: revisionPlan,
    buildReport,
    qaReport,
    listingCopy,
    browserSmokeReport,
    screenshotManifest
  });
  const publishPlan = await decidePublishIntentStage({
    runDir: reserved.runDir,
    runContext,
    selectedReport: state.selectedReport,
    qaReport,
    policyGate,
    buildGateReport: null
  });
  const listingPackageReport = await prepareListingPackageStage({
    runDir: reserved.runDir,
    selectedReport: state.selectedReport,
    brief: state.brief,
    plan: revisionPlan,
    buildReport,
    qaReport,
    browserSmokeReport,
    screenshotManifest,
    listingCopy,
    policyGate,
    publishPlan
  });

  const extensionPackagePath = artifactPath(reserved.runDir, "81_listing_package/extension_package.zip");
  if (!(await fileExists(extensionPackagePath)) || listingPackageReport.status !== "passed") {
    throw new Error("Commercial release revision requires a passed listing package with extension_package.zip.");
  }

  const packageSha256 = await hashFile(extensionPackagePath);
  const sandboxValidationPlan = buildSafeWorkflowReport({
    stage: "COMMERCIAL_RELEASE_SANDBOX_VALIDATION",
    status: "passed",
    run_id: reserved.runId,
    run_type: "sandbox_validation",
    source_run_id: state.runContext.run_id,
    source_sandbox_run_id: state.runContext.run_id,
    source_daily_run_id: runContext.source_daily_run_id,
    publisher_id: runContext.publisher_id ?? runContext.publish?.publisher_id ?? null,
    item_id: runContext.item_id ?? runContext.publish?.sandbox_item_id ?? null,
    item_name: state.brief.product_name_working,
    promoted_at: occurredAt,
    promoted_by: preparedBy,
    promotion_note: `${note ?? ""}`.trim(),
    source_artifacts: COPIED_SOURCE_ARTIFACTS,
    copied_artifacts: copiedArtifacts,
    regenerated_artifacts: unique([
      ...REGENERATED_RUN_ARTIFACTS,
      "95_monetization_strategy.json",
      "96_payment_link_flow_plan.json",
      "97_license_activation_spec.json",
      "109_monetization_test_matrix.json",
      COMMERCIAL_RELEASE_REVISION_ARTIFACT,
      COMMERCIAL_PUBLISH_STRATEGY_ARTIFACT
    ]),
    package_sha256: packageSha256,
    manifest_version: normalizedTargetVersion,
    current_sandbox_item_version: state.sandboxPlan.current_sandbox_item_version ?? null,
    previous_manifest_version: sourceVersion,
    target_manifest_version: normalizedTargetVersion,
    version_bump_strategy: "explicit_target_version",
    revision_reason: `${note ?? ""}`.trim() || "Create commercial release revision",
    extension_name: state.brief.product_name_working,
    archetype: revisionPlan.archetype,
    wedge: state.brief.product_name_working,
    policy_status: policyGate.status,
    qa_status: qaReport.overall_status,
    browser_smoke_status: browserSmokeReport.status,
    screenshot_manifest_status: screenshotManifest.status,
    listing_package_status: listingPackageReport.status,
    publish_allowed: false,
    upload_allowed: false,
    production_write: false,
    required_next_action: "run_monetization_security_scan_then_premium_packaging_and_human_visual_review_before_any_upload_or_publish",
    safety_checks: {
      source_run_immutable: true,
      commercial_version_bumped: normalizedTargetVersion !== sourceVersion,
      monetization_enabled: true,
      payment_flow_placeholder_only: true,
      new_build_generated: buildReport.status === "passed",
      new_browser_smoke_generated: browserSmokeReport.status === "passed",
      new_listing_package_generated: listingPackageReport.status === "passed",
      upload_not_attempted: true,
      publish_not_attempted: true
    }
  });
  await validateArtifact(projectRoot, "sandbox_validation_plan.schema.json", "83_sandbox_validation_plan.json", sandboxValidationPlan);
  await writeJson(artifactPath(reserved.runDir, "83_sandbox_validation_plan.json"), sandboxValidationPlan);

  const functionalMatrix = await generateFunctionalTestMatrix({ runDir: reserved.runDir });
  const acceptanceReview = await generateProductAcceptanceReview({ runDir: reserved.runDir });
  const commercialRevision = buildSafeWorkflowReport({
    stage: "COMMERCIAL_RELEASE_REVISION",
    status: "passed",
    run_id: reserved.runId,
    source_run_id: state.runContext.run_id,
    target_version: normalizedTargetVersion,
    source_version: sourceVersion,
    product_name: state.brief.product_name_working,
    product_acceptance_status: acceptanceReview.report.acceptance_status,
    functional_test_coverage_score: functionalMatrix.report.test_coverage_score,
    monetization_enabled: true,
    payment_flow_enabled: true,
    license_activation_enabled: true,
    premium_packaging_required: true,
    upload_allowed: false,
    publish_allowed: false,
    next_step: "Run monetization security scan, premium packaging, Remotion stills, asset QA, listing quality gate, and store release packaging."
  });
  await validateArtifact(projectRoot, "commercial_release_revision.schema.json", COMMERCIAL_RELEASE_REVISION_ARTIFACT, commercialRevision);
  await writeManagedJsonArtifact({
    runDir: reserved.runDir,
    runContext,
    artifactName: COMMERCIAL_RELEASE_REVISION_ARTIFACT,
    data: commercialRevision,
    occurredAt
  });

  await writeJson(artifactPath(reserved.runDir, "run_status.json"), {
    stage: "COMMERCIAL_RELEASE_REVISION",
    status: "passed",
    generated_at: occurredAt,
    run_id: reserved.runId,
    run_id_strategy: runContext.run_id_strategy,
    allow_overwrite: false,
    overwrite_blocked: false,
    created_at: occurredAt,
    failure_reason: null
  });

  await runCloseRunStage({
    runDir: reserved.runDir,
    runContext,
    selectedReport: state.selectedReport,
    brief: state.brief,
    plan: revisionPlan,
    screenshotManifest,
    publishPlan,
    publishExecution: pseudoPublishExecution({
      runContext,
      packageSha256,
      manifestVersion: normalizedTargetVersion,
      selectedReport: state.selectedReport
    }),
    reviewStatus: null,
    monitoringSnapshot: null,
    learningUpdate: null,
    policyGate
  });

  const validation = await validateSandboxValidationRun({
    projectRoot,
    runDir: reserved.runDir,
    runContext,
    plan: sandboxValidationPlan
  });
  if (validation.status !== "passed") {
    throw new Error(`Commercial revision validation failed: ${validation.blockers.join("; ")}`);
  }

  const lineageLedger = await ensureCommercialReleaseLineageLedgerEntry({
    projectRoot,
    runDir: reserved.runDir,
    actionSource: "cli"
  });

  await appendProductRevisionHistory(projectRoot, {
    event_type: "commercial_release_revision_created",
    source_run_id: state.runContext.run_id,
    new_run_id: reserved.runId,
    source_package_sha256: state.sandboxPlan.package_sha256,
    new_package_sha256: packageSha256,
    previous_manifest_version: sourceVersion,
    target_manifest_version: normalizedTargetVersion,
    acceptance_status: acceptanceReview.report.acceptance_status
  }).catch(() => null);

  return {
    runDir: reserved.runDir,
    runId: reserved.runId,
    manifestVersion: normalizedTargetVersion,
    packageSha256,
    ledgerEntry: lineageLedger.entry,
    functionalMatrix: functionalMatrix.report,
    acceptanceReview: acceptanceReview.report,
    supportArtifacts
  };
}

export async function createPaymentConfiguredCommercialCandidate({
  projectRoot,
  sourceRunDir,
  paySiteConfigPath,
  targetVersion,
  note,
  preparedBy = os.userInfo().username
}) {
  const state = await loadSourceSandboxState(sourceRunDir);
  const runsRoot = path.dirname(state.runDir);
  const sourceVersion = `${state.buildReport.manifest_version ?? state.sandboxPlan.manifest_version ?? "0.1.0"}`;
  const paySiteConfig = normalizePublicPaySiteConfig(await readJson(paySiteConfigPath));
  const resolvedVersion = resolvePaymentConfiguredTargetVersion({
    requestedVersion: targetVersion,
    currentUploadedVersion: state.sandboxPlan.current_sandbox_item_version ?? null
  });
  const normalizedTargetVersion = resolvedVersion.targetVersion;
  const reserved = await reservePaymentConfiguredRunDir(runsRoot, normalizedTargetVersion);
  const occurredAt = nowIso();
  const registrySummary = summarizePortfolioRegistry(await loadPortfolioRegistry(projectRoot));
  const monetization = buildHwhPaySiteMonetizationConfig(paySiteConfig);

  const runContext = {
    ...state.runContext,
    project_root: projectRoot,
    stage: "PAYMENT_CONFIGURED_COMMERCIAL_CANDIDATE",
    status: "passed",
    generated_at: occurredAt,
    run_id: reserved.runId,
    run_id_strategy: "payment_configured_commercial_candidate_unique",
    allow_overwrite: false,
    overwrite_blocked: false,
    created_at: occurredAt,
    source_run_id: state.runContext.run_id,
    source_run_path: state.runDir,
    source_sandbox_run_id: state.runContext.run_id,
    source_sandbox_run_path: state.runDir,
    source_daily_run_id: state.runContext.source_daily_run_id ?? state.runContext.source_run_id ?? null,
    source_daily_run_path: state.runContext.source_daily_run_path ?? null,
    latest_revision_run_id: reserved.runId,
    revision_kind: "payment_configured_commercial_candidate",
    revision_note: `${note ?? ""}`.trim(),
    previous_manifest_version: sourceVersion,
    target_manifest_version: normalizedTargetVersion,
    version_bump_strategy: resolvedVersion.strategy,
    monetization,
    pay_site_config_path: path.resolve(paySiteConfigPath),
    pay_site: {
      local_config_path: path.resolve(paySiteConfigPath),
      membership_provider: paySiteConfig.membershipProvider,
      site_url: paySiteConfig.siteUrl,
      public_supabase_url: paySiteConfig.publicSupabaseUrl,
      product_key: paySiteConfig.productKey,
      plan_key: paySiteConfig.planKey,
      feature_key: paySiteConfig.featureKey,
      checkout_mode: paySiteConfig.checkoutMode,
      production_payment_status: paySiteConfig.productionPaymentStatus,
      current_primary_environment: paySiteConfig.currentPrimaryEnvironment
    },
    payment_mode: paySiteConfig.checkoutMode,
    production_payment_status: paySiteConfig.productionPaymentStatus,
    current_primary_environment: paySiteConfig.currentPrimaryEnvironment,
    publish: {
      ...state.runContext.publish,
      execution_mode: "sandbox_validate",
      publish_validation_phase: "fetch_status_only",
      allow_public_release: false
    },
    portfolio_registry: {
      path: state.runContext.portfolio_registry?.path ?? path.join(projectRoot, "state", "portfolio_registry.json"),
      active_wedge_families: registrySummary.active_wedge_families,
      blocked_candidate_ids: registrySummary.blocked_candidate_ids,
      archetype_priors: registrySummary.archetype_priors,
      item_count: registrySummary.item_count
    }
  };

  await writeJson(artifactPath(reserved.runDir, "00_run_context.json"), runContext);
  const copiedArtifacts = await copySeedArtifacts(state.runDir, reserved.runDir);

  const revisionPlan = augmentImplementationPlanWithMonetization({
    ...state.implementationPlan,
    generated_at: occurredAt,
    build_version: normalizedTargetVersion
  }, runContext);
  await writeJson(artifactPath(reserved.runDir, "42_implementation_plan.json"), revisionPlan);

  const supportArtifacts = await writeCommercialSupportArtifacts({
    runDir: reserved.runDir,
    runContext,
    brief: state.brief,
    monetization,
    sourceRunId: state.runContext.run_id,
    sourceVersion,
    targetVersion: normalizedTargetVersion,
    occurredAt
  });

  const buildReport = await buildExtensionStage({
    runDir: reserved.runDir,
    brief: state.brief,
    plan: revisionPlan
  });
  const qaReport = await runQaStage({
    runDir: reserved.runDir,
    brief: state.brief,
    plan: revisionPlan,
    buildReport
  });
  const { browserSmokeReport, screenshotManifest } = await browserSmokeAndCaptureStage({
    runDir: reserved.runDir,
    runContext,
    brief: state.brief,
    plan: revisionPlan,
    buildReport,
    qaReport
  });
  const listingCopy = await generateAssetsStage({
    runDir: reserved.runDir,
    runContext,
    brief: state.brief,
    buildReport,
    qaReport,
    screenshotManifest
  });
  const policyGate = await runPolicyGateStage({
    runDir: reserved.runDir,
    runContext,
    brief: state.brief,
    plan: revisionPlan,
    buildReport,
    qaReport,
    listingCopy,
    browserSmokeReport,
    screenshotManifest
  });
  const publishPlan = await decidePublishIntentStage({
    runDir: reserved.runDir,
    runContext,
    selectedReport: state.selectedReport,
    qaReport,
    policyGate,
    buildGateReport: null
  });
  const listingPackageReport = await prepareListingPackageStage({
    runDir: reserved.runDir,
    selectedReport: state.selectedReport,
    brief: state.brief,
    plan: revisionPlan,
    buildReport,
    qaReport,
    browserSmokeReport,
    screenshotManifest,
    listingCopy,
    policyGate,
    publishPlan
  });

  const extensionPackagePath = artifactPath(reserved.runDir, "81_listing_package/extension_package.zip");
  if (!(await fileExists(extensionPackagePath)) || listingPackageReport.status !== "passed") {
    throw new Error("Payment-configured commercial candidate requires a passed listing package with extension_package.zip.");
  }

  const packageSha256 = await hashFile(extensionPackagePath);
  const sandboxValidationPlan = buildSafeWorkflowReport({
    stage: "COMMERCIAL_RELEASE_SANDBOX_VALIDATION",
    status: "passed",
    run_id: reserved.runId,
    run_type: "sandbox_validation",
    source_run_id: state.runContext.run_id,
    source_sandbox_run_id: state.runContext.run_id,
    source_daily_run_id: runContext.source_daily_run_id,
    publisher_id: runContext.publisher_id ?? runContext.publish?.publisher_id ?? null,
    item_id: runContext.item_id ?? runContext.publish?.sandbox_item_id ?? null,
    item_name: state.brief.product_name_working,
    promoted_at: occurredAt,
    promoted_by: preparedBy,
    promotion_note: `${note ?? ""}`.trim(),
    source_artifacts: COPIED_SOURCE_ARTIFACTS,
    copied_artifacts: copiedArtifacts,
    regenerated_artifacts: unique([
      ...REGENERATED_RUN_ARTIFACTS,
      "95_monetization_strategy.json",
      "96_payment_link_flow_plan.json",
      "97_license_activation_spec.json",
      "109_monetization_test_matrix.json",
      PAYMENT_CONFIGURED_COMMERCIAL_CANDIDATE_ARTIFACT,
      COMMERCIAL_RELEASE_REVISION_ARTIFACT,
      COMMERCIAL_PUBLISH_STRATEGY_ARTIFACT
    ]),
    package_sha256: packageSha256,
    manifest_version: normalizedTargetVersion,
    current_sandbox_item_version: state.sandboxPlan.current_sandbox_item_version ?? null,
    previous_manifest_version: sourceVersion,
    target_manifest_version: normalizedTargetVersion,
    version_bump_strategy: resolvedVersion.strategy,
    revision_reason: `${note ?? ""}`.trim() || "Create payment-configured commercial candidate",
    extension_name: state.brief.product_name_working,
    archetype: revisionPlan.archetype,
    wedge: state.brief.product_name_working,
    policy_status: policyGate.status,
    qa_status: qaReport.overall_status,
    browser_smoke_status: browserSmokeReport.status,
    screenshot_manifest_status: screenshotManifest.status,
    listing_package_status: listingPackageReport.status,
    publish_allowed: false,
    upload_allowed: false,
    production_write: false,
    required_next_action: "run_monetization_security_scan_premium_packaging_listing_gate_then_human_visual_review_before_any_upload_or_publish",
    safety_checks: {
      source_run_immutable: true,
      target_version_uploadable_against_detected_store_version: compareChromeExtensionVersions(
        normalizedTargetVersion,
        state.sandboxPlan.current_sandbox_item_version ?? "0"
      ) > 0,
      monetization_enabled: true,
      payment_provider: "pay_site_supabase_waffo",
      checkout_mode: paySiteConfig.checkoutMode,
      production_payment_not_enabled: true,
      webhook_unlock_only: true,
      success_url_not_local_unlock: true,
      new_build_generated: buildReport.status === "passed",
      new_browser_smoke_generated: browserSmokeReport.status === "passed",
      new_listing_package_generated: listingPackageReport.status === "passed",
      upload_not_attempted: true,
      publish_not_attempted: true
    }
  });
  await validateArtifact(projectRoot, "sandbox_validation_plan.schema.json", "83_sandbox_validation_plan.json", sandboxValidationPlan);
  await writeJson(artifactPath(reserved.runDir, "83_sandbox_validation_plan.json"), sandboxValidationPlan);

  const functionalMatrix = await generateFunctionalTestMatrix({ runDir: reserved.runDir });
  const acceptanceReview = await generateProductAcceptanceReview({ runDir: reserved.runDir });
  const commercialRevision = buildSafeWorkflowReport({
    stage: "COMMERCIAL_RELEASE_REVISION",
    status: "passed",
    run_id: reserved.runId,
    source_run_id: state.runContext.run_id,
    target_version: normalizedTargetVersion,
    source_version: sourceVersion,
    product_name: state.brief.product_name_working,
    product_acceptance_status: acceptanceReview.report.acceptance_status,
    functional_test_coverage_score: functionalMatrix.report.test_coverage_score,
    monetization_enabled: true,
    payment_flow_enabled: true,
    license_activation_enabled: true,
    premium_packaging_required: true,
    upload_allowed: false,
    publish_allowed: false,
    next_step: "Run monetization security scan, premium packaging, Remotion stills, asset QA, listing quality gate, store release packaging, then human visual review."
  });
  await validateArtifact(projectRoot, "commercial_release_revision.schema.json", COMMERCIAL_RELEASE_REVISION_ARTIFACT, commercialRevision);
  await writeManagedJsonArtifact({
    runDir: reserved.runDir,
    runContext,
    artifactName: COMMERCIAL_RELEASE_REVISION_ARTIFACT,
    data: commercialRevision,
    occurredAt
  });

  const candidate = buildSafeWorkflowReport({
    stage: "PAYMENT_CONFIGURED_COMMERCIAL_CANDIDATE",
    status: "passed",
    run_id: reserved.runId,
    source_run_id: state.runContext.run_id,
    target_version: normalizedTargetVersion,
    source_version: sourceVersion,
    version_bump_strategy: resolvedVersion.strategy,
    payment_mode: paySiteConfig.checkoutMode,
    site_url: paySiteConfig.siteUrl,
    api_url: paySiteConfig.publicSupabaseUrl,
    product_key: paySiteConfig.productKey,
    plan_key: paySiteConfig.planKey,
    feature_key: paySiteConfig.featureKey,
    source_chrome_extension_status: paySiteConfig.sourceChromeExtensionStatus,
    payment_e2e_status: paySiteConfig.paymentE2EStatus,
    production_payment_status: paySiteConfig.productionPaymentStatus,
    current_primary_environment: paySiteConfig.currentPrimaryEnvironment,
    checkout_status: paySiteConfig.checkoutStatus,
    webhook_status: paySiteConfig.webhookStatus,
    entitlement_status: paySiteConfig.entitlementStatus,
    consume_usage_status: paySiteConfig.consumeUsageStatus,
    upload_allowed: false,
    publish_allowed: false,
    production_payment_executed: false,
    chrome_upload_executed: false,
    chrome_publish_executed: false,
    next_step: "Run monetization security scan, premium packaging, listing quality gate, store release package, then human visual review before any upload or publish."
  });
  await validateArtifact(
    projectRoot,
    "payment_configured_commercial_candidate.schema.json",
    PAYMENT_CONFIGURED_COMMERCIAL_CANDIDATE_ARTIFACT,
    candidate
  );
  await writeManagedJsonArtifact({
    runDir: reserved.runDir,
    runContext,
    artifactName: PAYMENT_CONFIGURED_COMMERCIAL_CANDIDATE_ARTIFACT,
    data: candidate,
    occurredAt
  });

  await writeJson(artifactPath(reserved.runDir, "run_status.json"), {
    stage: "PAYMENT_CONFIGURED_COMMERCIAL_CANDIDATE",
    status: "passed",
    generated_at: occurredAt,
    run_id: reserved.runId,
    run_id_strategy: runContext.run_id_strategy,
    allow_overwrite: false,
    overwrite_blocked: false,
    created_at: occurredAt,
    failure_reason: null
  });

  await runCloseRunStage({
    runDir: reserved.runDir,
    runContext,
    selectedReport: state.selectedReport,
    brief: state.brief,
    plan: revisionPlan,
    screenshotManifest,
    publishPlan,
    publishExecution: pseudoPublishExecution({
      runContext,
      packageSha256,
      manifestVersion: normalizedTargetVersion,
      selectedReport: state.selectedReport
    }),
    reviewStatus: null,
    monitoringSnapshot: null,
    learningUpdate: null,
    policyGate
  });

  const validation = await validateSandboxValidationRun({
    projectRoot,
    runDir: reserved.runDir,
    runContext,
    plan: sandboxValidationPlan
  });
  if (validation.status !== "passed") {
    throw new Error(`Payment-configured commercial candidate validation failed: ${validation.blockers.join("; ")}`);
  }

  const lineageLedger = await ensureCommercialReleaseLineageLedgerEntry({
    projectRoot,
    runDir: reserved.runDir,
    actionSource: "cli"
  });

  await appendProductRevisionHistory(projectRoot, {
    event_type: "payment_configured_commercial_candidate_created",
    source_run_id: state.runContext.run_id,
    new_run_id: reserved.runId,
    source_package_sha256: state.sandboxPlan.package_sha256,
    new_package_sha256: packageSha256,
    previous_manifest_version: sourceVersion,
    target_manifest_version: normalizedTargetVersion,
    acceptance_status: acceptanceReview.report.acceptance_status
  }).catch(() => null);

  await upsertProductCatalogEntry(projectRoot, {
    productKey: paySiteConfig.productKey,
    slug: "leadfill-one-profile",
    version: normalizedTargetVersion,
    releaseRunId: reserved.runId,
    listingAssetsPath: normalizeRelativePath(projectRoot, path.join(runEventsDirectory(projectRoot, reserved.runId), "120_store_listing_release_package", "assets")),
    remotionAssetsPath: normalizeRelativePath(projectRoot, path.join(runEventsDirectory(projectRoot, reserved.runId), "80_remotion_assets")),
    siteUrl: paySiteConfig.siteUrl,
    paymentProvider: "hwh_waffo",
    productKeyOnPaySite: paySiteConfig.productKey,
    defaultPlanKey: paySiteConfig.planKey,
    checkoutMode: paySiteConfig.checkoutMode,
    paymentConfigStatus: "test_mode_verified",
    entitlementStatus: "verified_from_payment_test_mode",
    productionPaymentStatus: paySiteConfig.productionPaymentStatus,
    currentPrimaryEnvironment: paySiteConfig.currentPrimaryEnvironment,
    smtpStatus: paySiteConfig.smtpStatus,
    otpStatus: paySiteConfig.otpStatus,
    checkoutStatus: paySiteConfig.checkoutStatus,
    webhookStatus: paySiteConfig.webhookStatus,
    consumeUsageStatus: paySiteConfig.consumeUsageStatus,
    paymentE2EStatus: paySiteConfig.paymentE2EStatus,
    sourceChromeExtensionStatus: paySiteConfig.sourceChromeExtensionStatus
  }, {
    mode: "update",
    commandName: "commercial:create-payment-configured-candidate"
  });

  return {
    runDir: reserved.runDir,
    runId: reserved.runId,
    manifestVersion: normalizedTargetVersion,
    packageSha256,
    ledgerEntry: lineageLedger.entry,
    functionalMatrix: functionalMatrix.report,
    acceptanceReview: acceptanceReview.report,
    supportArtifacts,
    candidate
  };
}

export async function prepareCommercialReleaseGate({ runDir }) {
  const absoluteRunDir = path.resolve(runDir);
  const runContext = await readJson(artifactPath(absoluteRunDir, "00_run_context.json"));
  if ((runContext.run_type ?? runContext.task_mode) !== "sandbox_validation") {
    throw new Error(`Run ${runContext.run_id} is not a sandbox_validation run.`);
  }

  const sandboxPlan = await readJson(artifactPath(absoluteRunDir, "83_sandbox_validation_plan.json"));
  const productAcceptanceReview = await loadManagedArtifactData(absoluteRunDir, "94_product_acceptance_review.json", runContext);
  const functionalTestMatrix = await loadManagedArtifactData(absoluteRunDir, "62_functional_test_matrix.json", runContext);
  const monetizationStrategy = await loadManagedArtifactData(absoluteRunDir, "95_monetization_strategy.json", runContext);
  const paymentLinkFlowPlan = await loadManagedArtifactData(absoluteRunDir, "96_payment_link_flow_plan.json", runContext);
  const licenseActivationSpec = await loadManagedArtifactData(absoluteRunDir, "97_license_activation_spec.json", runContext);
  const monetizationSecurityScan = await loadManagedArtifactData(absoluteRunDir, "110_monetization_security_scan.json", runContext);
  const premiumPackagingBrief = await loadManagedArtifactData(absoluteRunDir, "111_premium_packaging_brief.json", runContext);
  const assetQualityReport = await loadManagedArtifactData(absoluteRunDir, "118_asset_quality_report.json", runContext);
  const listingQualityGate = await loadManagedArtifactData(absoluteRunDir, "115_listing_quality_gate.json", runContext);
  const storeReleasePackage = await loadManagedArtifactData(absoluteRunDir, "120_store_listing_release_package_report.json", runContext);
  const siteVisualConsistencyReport = await loadManagedArtifactData(absoluteRunDir, "145_site_visual_consistency_report.json", runContext);
  const humanVisualReview = await loadManagedArtifactData(absoluteRunDir, "121_human_visual_review.json", runContext);

  const productAcceptancePassed = productAcceptanceReview?.acceptance_status === "passed";
  const functionalCoverageScore = functionalTestMatrix?.test_coverage_score ?? null;
  const monetizationEnabled = runContext.monetization?.enabled === true;
  const paymentFlowSafe = monetizationEnabled
    && Boolean(paymentLinkFlowPlan?.checkout_url_placeholder)
    && monetizationSecurityScan?.status === "passed";
  const licenseFlowDefined = monetizationEnabled && Array.isArray(licenseActivationSpec?.storage_fields) && licenseActivationSpec.storage_fields.length > 0;
  const premiumPackagingPassed = Boolean(premiumPackagingBrief);
  const assetQaPassed = assetQualityReport?.status === "passed";
  const listingQualityPassed = listingQualityGate?.passed === true;
  const storeReleasePackagePassed = storeReleasePackage?.package_status === "passed";
  const webPageQualityPassed = siteVisualConsistencyReport
    ? siteVisualConsistencyReport.status === "passed" && (siteVisualConsistencyReport.overall_score ?? 0) >= 90
    : true;
  const humanVisualReviewRequired = true;
  const humanVisualReviewPassed = `${humanVisualReview?.decision ?? ""}` === "passed";
  const dashboardListingSyncRequired = true;
  const productionPaymentStatus = runContext.production_payment_status
    ?? runContext.monetization?.production_payment_status
    ?? "not_verified";
  const userPublicLaunchApprovalPresent = runContext.user_public_launch_approval_present === true;
  const blockers = unique([
    productAcceptancePassed ? null : "product_acceptance_not_passed",
    functionalCoverageScore !== null && functionalCoverageScore >= 80 ? null : "functional_test_coverage_below_80",
    monetizationEnabled ? null : "monetization_not_enabled",
    paymentFlowSafe ? null : "payment_flow_not_safe",
    licenseFlowDefined ? null : "license_flow_not_defined",
    monetizationSecurityScan?.status === "passed" ? null : "monetization_security_scan_not_passed",
    premiumPackagingPassed ? null : "premium_packaging_missing",
    assetQaPassed ? null : "asset_qa_not_passed",
    listingQualityPassed ? null : "listing_quality_gate_not_passed",
    storeReleasePackagePassed ? null : "store_release_package_not_passed",
    webPageQualityPassed ? null : "web_page_quality_not_passed",
    humanVisualReviewPassed ? null : "human_visual_review_pending",
    productionPaymentStatus === "verified" ? null : "production_payment_not_verified",
    userPublicLaunchApprovalPresent ? null : "user_public_launch_approval_missing"
  ]);

  const allowedNextActions = unique([
    "run_monetization_security_scan",
    "run_premium_packaging",
    "run_assets_qa",
    "run_listing_quality_gate",
    "run_store_release_package",
    humanVisualReviewPassed ? "sync_dashboard_listing_assets" : "record_human_visual_review"
  ]);

  const report = buildSafeWorkflowReport({
    stage: "COMMERCIAL_RELEASE_GATE",
    status: blockers.length === 0 ? "passed" : "failed",
    run_id: runContext.run_id,
    version: sandboxPlan.manifest_version ?? runContext.target_manifest_version ?? null,
    product_acceptance_passed: productAcceptancePassed,
    functional_test_coverage_score: functionalCoverageScore,
    monetization_enabled: monetizationEnabled,
    payment_flow_safe: paymentFlowSafe,
    license_flow_defined: licenseFlowDefined,
    monetization_security_scan_passed: monetizationSecurityScan?.status === "passed",
    premium_packaging_passed: premiumPackagingPassed,
    asset_qa_passed: assetQaPassed,
    listing_quality_passed: listingQualityPassed,
    store_release_package_passed: storeReleasePackagePassed,
    web_page_quality_passed: webPageQualityPassed,
    web_page_quality_score: siteVisualConsistencyReport?.overall_score ?? null,
    human_visual_review_required: humanVisualReviewRequired,
    dashboard_listing_sync_required: dashboardListingSyncRequired,
    production_payment_status: productionPaymentStatus,
    user_public_launch_approval_present: userPublicLaunchApprovalPresent,
    blockers,
    allowed_next_actions: allowedNextActions,
    recommended_next_step: !humanVisualReviewPassed
      ? "record_human_visual_review"
      : "sync_dashboard_listing_assets"
  });

  await validateArtifact(runContext.project_root, "commercial_release_gate.schema.json", COMMERCIAL_RELEASE_GATE_ARTIFACT, report);
  await writeManagedJsonArtifact({
    runDir: absoluteRunDir,
    runContext,
    artifactName: COMMERCIAL_RELEASE_GATE_ARTIFACT,
    data: report,
    occurredAt: nowIso()
  });

  return report;
}
