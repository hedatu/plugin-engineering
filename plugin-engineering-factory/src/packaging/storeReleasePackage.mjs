import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  artifactPath,
  buildSafeReport,
  loadOptionalManagedArtifact,
  markdownList,
  normalizeRelativePath,
  validateArtifact,
  writeManagedJsonArtifact,
  writeManagedMarkdownArtifact
} from "../review/helpers.mjs";
import {
  ensureDir,
  fileExists,
  listFiles,
  nowIso,
  readJson,
  resetDir,
  writeJson,
  writeText
} from "../utils/io.mjs";
import { runEventsDirectory } from "../workflow/runEventArtifacts.mjs";
import { prepareCommercialReleaseGate } from "../workflow/commercialReleaseRevision.mjs";
import {
  ASSET_QUALITY_REPORT_ARTIFACT,
  BRAND_SYSTEM_ARTIFACT,
  LANDING_PAGE_PACKAGE_ARTIFACT,
  LISTING_QUALITY_GATE_ARTIFACT,
  PREMIUM_PACKAGING_BRIEF_ARTIFACT,
  PRODUCT_POLISH_CHECKLIST_ARTIFACT,
  SCREENSHOT_STORYBOARD_ARTIFACT,
  STORE_ASSET_SPEC_ARTIFACT,
  remotionAssetsRoot
} from "./premiumPackaging.mjs";

export const STORE_RELEASE_PACKAGE_REPORT_ARTIFACT = "120_store_listing_release_package_report.json";
export const HUMAN_VISUAL_REVIEW_ARTIFACT = "121_human_visual_review.json";
export const MARKET_TEST_ASSET_PACKAGE_ARTIFACT = "122_market_test_asset_package.json";
export const STORE_RELEASE_PACKAGE_DIRNAME = "120_store_listing_release_package";

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function hashFile(filePath) {
  return sha256Buffer(await fs.readFile(filePath));
}

async function readOptionalJson(filePath) {
  if (!(await fileExists(filePath))) {
    return null;
  }
  return readJson(filePath);
}

async function readOptionalText(filePath) {
  if (!(await fileExists(filePath))) {
    return null;
  }
  return fs.readFile(filePath, "utf8");
}

function escapeHtml(value) {
  return `${value ?? ""}`
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function isMonetized(state) {
  return Boolean(state.monetizationStrategy || state.paymentLinkFlowPlan || state.licenseActivationSpec);
}

function storeReleasePackageRoot(projectRoot, runId) {
  return path.join(runEventsDirectory(projectRoot, runId), STORE_RELEASE_PACKAGE_DIRNAME);
}

function relativeToPackage(packageDir, absolutePath) {
  return path.relative(packageDir, absolutePath).replaceAll("\\", "/");
}

function fallbackMonetizationReview() {
  return {
    status: "not_present",
    reason: "This revision does not include a monetization strategy artifact."
  };
}

function inferPaidDisclosure(state) {
  if (!isMonetized(state)) {
    return {
      status: "passed",
      markdown: [
        "# Paid Features Disclosure",
        "",
        "This release package is currently free-only.",
        "",
        "No live paywall, payment link, or Pro-only feature is enabled in this revision.",
        "If monetization is enabled later, the listing and popup must disclose the free limit, paid unlock, and license flow before any upload or publish action."
      ].join("\n")
    };
  }

  const strategy = state.monetizationStrategy ?? {};
  const payment = state.paymentLinkFlowPlan ?? {};
  const activation = state.licenseActivationSpec ?? {};
  const freeLimit = strategy.free_limit
    ?? strategy.free_usage_limit
    ?? payment.free_limit
    ?? payment.free_usage_limit
    ?? activation.free_limit
    ?? "unknown";
  const priceLabel = strategy.price_label
    ?? strategy.suggested_price
    ?? payment.lifetime_unlock_price
    ?? payment.price_label
    ?? activation.price_label
    ?? "unknown";
  const upgradeUrl = payment.checkout_url ?? payment.upgrade_url ?? strategy.upgrade_url_placeholder ?? "placeholder only";
  const activationMode = strategy.license_activation_model ?? activation.activation_mode ?? "manual or lightweight license entry";
  return {
    status: "passed",
    markdown: [
      "# Paid Features Disclosure",
      "",
      `- Free limit: ${freeLimit}`,
      `- Unlock price: ${priceLabel}`,
      `- Upgrade flow: external payment page`,
      `- Activation flow: ${activationMode}`,
      `- Upgrade link: ${upgradeUrl}`,
      "",
      "Paid features must stay clearly disclosed in both the listing and the extension UI."
    ].join("\n")
  };
}

function buildPrivacySummary(state) {
  return [
    "# Privacy Summary",
    "",
    state.listingCopy.privacy_disclosure,
    "",
    "## Trust Claims",
    "",
    `- Local-only claim: ${state.premiumPackagingBrief.local_only_claim}`,
    `- No-login claim: ${state.premiumPackagingBrief.no_login_claim}`,
    `- No-upload claim: ${state.premiumPackagingBrief.no_upload_claim}`,
    "",
    "These claims must stay consistent with the real bundle, browser smoke, and policy gate."
  ].join("\n");
}

function buildStoreListingSubmission(state, paidDisclosureMarkdown, versionLabel) {
  return [
    "# Store Listing Submission",
    "",
    `- Product: ${state.premiumPackagingBrief.product_name}`,
    `- Run: ${state.runContext.run_id}`,
    `- Item ID: ${state.sandboxPlan?.item_id ?? state.runContext.item_id ?? "unconfigured"}`,
    `- Version: ${versionLabel}`,
    `- Listing quality gate: ${state.listingQualityGate.status}`,
    `- Asset QA: ${state.assetQualityReport.status}`,
    `- Premium feel score: ${state.listingQualityGate.premium_feel_score ?? 0}`,
    "",
    "## Title",
    "",
    state.premiumPackagingBrief.product_name,
    "",
    "## Short Description",
    "",
    state.listingCopy.store_summary,
    "",
    "## Detailed Description",
    "",
    state.listingCopy.store_description,
    "",
    "## Privacy Disclosure",
    "",
    state.listingCopy.privacy_disclosure,
    "",
    paidDisclosureMarkdown,
    "",
    "## Manual Review Reminder",
    "",
    "- Do not upload or publish with old draft assets.",
    "- Confirm screenshots still match real browser-smoke output.",
    "- Confirm support, homepage, privacy, and paid disclosure text before any dashboard action."
  ].join("\n");
}

function buildDashboardChecklist({
  state,
  versionLabel,
  screenshotPaths,
  smallPromoPath,
  marqueePath,
  paidDisclosureMarkdown,
  galleryPath
}) {
  return [
    "# Dashboard Upload Checklist",
    "",
    `- Chrome Web Store item ID: ${state.sandboxPlan?.item_id ?? state.runContext.item_id ?? "unconfigured"}`,
    `- Current version: ${versionLabel}`,
    `- Asset gallery: ${galleryPath}`,
    "",
    "## Upload Files",
    "",
    markdownList([
      ...screenshotPaths.map((value) => `Screenshot: ${value}`),
      `Small promo: ${smallPromoPath}`,
      marqueePath ? `Marquee: ${marqueePath}` : "Marquee: optional and not present"
    ]),
    "",
    "## Listing Copy",
    "",
    `- Title: ${state.premiumPackagingBrief.product_name}`,
    `- Short description: ${state.listingCopy.store_summary}`,
    "",
    "### Detailed Description",
    "",
    state.listingCopy.store_description,
    "",
    "### Privacy Disclosure",
    "",
    state.listingCopy.privacy_disclosure,
    "",
    "### Paid Feature Disclosure",
    "",
    paidDisclosureMarkdown,
    "",
    "## Support And Homepage",
    "",
    `- Support URL or placeholder: ${path.join(state.landingPackage.output_dir, "support.md")}`,
    `- Homepage URL or placeholder: ${path.join(state.landingPackage.output_dir, "index.html")}`,
    "",
    "## Manual Checklist",
    "",
    markdownList([
      "[ ] screenshots uploaded",
      "[ ] small promo uploaded",
      "[ ] marquee uploaded if desired",
      "[ ] title checked",
      "[ ] short description checked",
      "[ ] privacy checked",
      "[ ] pricing disclosed",
      "[ ] no misleading claims",
      "[ ] no competitor names",
      "[ ] no unimplemented features",
      "[ ] visual review passed"
    ])
  ].join("\n");
}

function buildMarketTestAssetPackage(state) {
  const experimentPath = state.paidInterestExperimentPath
    ? normalizeRelativePath(state.projectRoot, state.paidInterestExperimentPath)
    : null;
  return buildSafeReport({
    stage: "MARKET_TEST_ASSET_PACKAGE",
    status: "passed",
    run_id: state.runContext.run_id,
    product_name: state.premiumPackagingBrief.product_name,
    landing_page_path: normalizeRelativePath(state.projectRoot, state.landingPackage.output_dir),
    hero_image: state.landingPackage.asset_manifest?.hero_asset ?? null,
    pricing_image: state.landingPackage.asset_manifest?.pricing_asset ?? null,
    fake_door_experiment_path: experimentPath,
    payment_link_placeholder: state.paymentLinkFlowPlan?.checkout_url ?? "https://example.com/checkout",
    upgrade_copy: isMonetized(state)
      ? "Use the external payment page and clear lifetime unlock language."
      : "No live upgrade flow is enabled in this revision. Keep payment language in planning materials only until monetization is real.",
    suggested_channels: [
      "Chrome Web Store listing refresh after human visual review",
      "Landing page with premium hero and pricing image",
      "Trusted testers or private share before broader public exposure"
    ],
    first_7_day_metrics: [
      "landing_visits",
      "installs_or_waitlist_signups",
      "core_action_completed",
      "upgrade_clicks"
    ],
    first_14_day_metrics: [
      "repeat_use",
      "upgrade_intent",
      "support_requests",
      "uninstall_feedback_manual"
    ],
    success_thresholds: [
      ">= 100 landing or listing visits",
      ">= 10 installs or waitlist signups",
      ">= 3 upgrade clicks",
      ">= 1 payment intent or explicit would-pay signal"
    ],
    kill_thresholds: [
      "100+ visits and 0 installs or signups",
      "50+ installs and almost no core action use",
      "No upgrade clicks after meaningful use",
      "Policy or review blocker"
    ],
    next_step: "Use the landing package and premium still assets for a manual market test only after human visual review passes."
  });
}

function marketTestAssetMarkdown(report) {
  return [
    "# Market Test Asset Package",
    "",
    `- Run: ${report.run_id}`,
    `- Product: ${report.product_name}`,
    `- Landing page: ${report.landing_page_path}`,
    `- Hero image: ${report.hero_image ?? "missing"}`,
    `- Pricing image: ${report.pricing_image ?? "missing"}`,
    `- Fake-door experiment: ${report.fake_door_experiment_path ?? "not present"}`,
    `- Payment link placeholder: ${report.payment_link_placeholder}`,
    "",
    "## Upgrade Copy",
    "",
    report.upgrade_copy,
    "",
    "## Suggested Channels",
    "",
    markdownList(report.suggested_channels),
    "",
    "## First 7 Day Metrics",
    "",
    markdownList(report.first_7_day_metrics),
    "",
    "## First 14 Day Metrics",
    "",
    markdownList(report.first_14_day_metrics),
    "",
    "## Success Thresholds",
    "",
    markdownList(report.success_thresholds),
    "",
    "## Kill Thresholds",
    "",
    markdownList(report.kill_thresholds),
    "",
    "## Next Step",
    "",
    report.next_step
  ].join("\n");
}

function evaluateHumanVisualReviewStatus(storeReleasePackageReport, humanVisualReview) {
  const required = storeReleasePackageReport?.human_visual_review_required === true;
  const decision = `${humanVisualReview?.decision ?? ""}`.trim().toLowerCase();
  return {
    required,
    passed: !required || decision === "passed",
    blocked: decision === "blocked",
    decision: decision || null
  };
}

export function evaluatePrePublishAssetGate({
  listingQualityGate,
  assetQualityReport,
  storeReleasePackageReport,
  humanVisualReview
}) {
  const humanReview = evaluateHumanVisualReviewStatus(storeReleasePackageReport, humanVisualReview);
  const listingQualityPassed = listingQualityGate?.passed === true;
  const assetQaPassed = assetQualityReport?.status === "passed";
  const storeReleasePackagePassed = storeReleasePackageReport?.package_status === "passed";
  const premiumFeelScore = Number(listingQualityGate?.premium_feel_score ?? 0);
  const paidDisclosurePassed = `${storeReleasePackageReport?.paid_disclosure_status ?? ""}` === "passed";
  const blockers = [];

  if (!listingQualityPassed) blockers.push("listing_quality_gate_not_passed");
  if (!assetQaPassed) blockers.push("asset_quality_report_not_passed");
  if (!storeReleasePackageReport) {
    blockers.push("store_listing_release_package_missing");
  } else if (!storeReleasePackagePassed) {
    blockers.push("store_listing_release_package_not_passed");
  }
  if (premiumFeelScore < 85) blockers.push("premium_feel_score_below_85");
  if (!paidDisclosurePassed) blockers.push("paid_disclosure_not_passed");
  if (humanReview.required && !humanVisualReview) {
    blockers.push("human_visual_review_required_before_publish");
  } else if (humanReview.blocked) {
    blockers.push("blocked_by_human_visual_review");
  } else if (humanReview.required && !humanReview.passed) {
    blockers.push("human_visual_review_not_passed");
  }

  return {
    listing_quality_passed: listingQualityPassed,
    asset_qa_passed: assetQaPassed,
    store_release_package_passed: storeReleasePackagePassed,
    premium_feel_score: premiumFeelScore,
    human_visual_review_required: humanReview.required,
    human_visual_review_passed: humanReview.passed,
    paid_disclosure_passed: paidDisclosurePassed,
    blockers,
    gate_passed: blockers.length === 0
  };
}

async function loadStoreReleaseState({ projectRoot, runDir }) {
  const absoluteRunDir = path.resolve(runDir);
  const rawRunContext = await readJson(artifactPath(absoluteRunDir, "00_run_context.json"));
  const runContext = {
    ...rawRunContext,
    project_root: projectRoot
  };
  const listingCopy = await readJson(artifactPath(absoluteRunDir, "71_listing_copy.json"));
  const productBrief = await readJson(artifactPath(absoluteRunDir, "41_product_brief.json"));
  const buildReport = await readOptionalJson(artifactPath(absoluteRunDir, "50_build_report.json"));
  const sandboxPlan = await readOptionalJson(artifactPath(absoluteRunDir, "83_sandbox_validation_plan.json"));
  const monetizationStrategy = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    artifactName: "95_monetization_strategy.json",
    runContext
  });
  const paymentLinkFlowPlan = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    artifactName: "96_payment_link_flow_plan.json",
    runContext
  });
  const licenseActivationSpec = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    artifactName: "97_license_activation_spec.json",
    runContext
  });
  const paidInterestExperiment = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    artifactName: "100_paid_interest_experiment.json",
    runContext
  });
  const premiumPackagingBrief = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    artifactName: PREMIUM_PACKAGING_BRIEF_ARTIFACT,
    runContext
  });
  const brandSystem = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    artifactName: BRAND_SYSTEM_ARTIFACT,
    runContext
  });
  const storeAssetSpec = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    artifactName: STORE_ASSET_SPEC_ARTIFACT,
    runContext
  });
  const screenshotStoryboard = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    artifactName: SCREENSHOT_STORYBOARD_ARTIFACT,
    runContext
  });
  const listingQualityGate = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    artifactName: LISTING_QUALITY_GATE_ARTIFACT,
    runContext
  });
  const productPolishChecklist = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    artifactName: PRODUCT_POLISH_CHECKLIST_ARTIFACT,
    runContext
  });
  const landingPackage = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    artifactName: LANDING_PAGE_PACKAGE_ARTIFACT,
    runContext
  });
  const assetQualityReport = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    artifactName: ASSET_QUALITY_REPORT_ARTIFACT,
    runContext
  });
  const storeReleasePackageReport = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    artifactName: STORE_RELEASE_PACKAGE_REPORT_ARTIFACT,
    runContext
  });
  const humanVisualReview = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    artifactName: HUMAN_VISUAL_REVIEW_ARTIFACT,
    runContext
  });

  if (!premiumPackagingBrief) throw new Error(`Missing ${PREMIUM_PACKAGING_BRIEF_ARTIFACT}. Run packaging:premium first.`);
  if (!brandSystem) throw new Error(`Missing ${BRAND_SYSTEM_ARTIFACT}. Run packaging:premium first.`);
  if (!storeAssetSpec) throw new Error(`Missing ${STORE_ASSET_SPEC_ARTIFACT}. Run packaging:premium first.`);
  if (!screenshotStoryboard) throw new Error(`Missing ${SCREENSHOT_STORYBOARD_ARTIFACT}. Run packaging:premium first.`);
  if (!listingQualityGate) throw new Error(`Missing ${LISTING_QUALITY_GATE_ARTIFACT}. Run packaging:listing-quality-gate first.`);
  if (!productPolishChecklist) throw new Error(`Missing ${PRODUCT_POLISH_CHECKLIST_ARTIFACT}. Run packaging:premium first.`);
  if (!landingPackage) throw new Error(`Missing ${LANDING_PAGE_PACKAGE_ARTIFACT}. Run packaging:premium first.`);
  if (!assetQualityReport) throw new Error(`Missing ${ASSET_QUALITY_REPORT_ARTIFACT}. Run assets:qa first.`);

  const landingSupportPath = landingPackage.output_dir ? path.join(landingPackage.output_dir, "support.md") : null;
  const landingChangelogPath = landingPackage.output_dir ? path.join(landingPackage.output_dir, "changelog.md") : null;

  return {
    projectRoot,
    runDir: absoluteRunDir,
    runContext,
    productBrief,
    buildReport,
    listingCopy,
    sandboxPlan,
    premiumPackagingBrief,
    brandSystem,
    storeAssetSpec,
    screenshotStoryboard,
    listingQualityGate,
    productPolishChecklist,
    landingPackage,
    assetQualityReport,
    monetizationStrategy,
    paymentLinkFlowPlan,
    licenseActivationSpec,
    paidInterestExperiment,
    paidInterestExperimentPath: paidInterestExperiment
      ? path.join(projectRoot, "state", "run_events", runContext.run_id, "100_paid_interest_experiment.json")
      : null,
    storeReleasePackageReport,
    humanVisualReview,
    remotionRoot: remotionAssetsRoot(projectRoot, runContext.run_id),
    packageRoot: storeReleasePackageRoot(projectRoot, runContext.run_id),
    landingSupportContent: landingSupportPath ? await readOptionalText(landingSupportPath) : null,
    landingChangelogContent: landingChangelogPath ? await readOptionalText(landingChangelogPath) : null
  };
}

function imageDimensionsForPackagePath(relativePath) {
  if (relativePath.includes("screenshots/")) return "1280x800";
  if (relativePath.endsWith("small_promo_440x280.png")) return "440x280";
  if (relativePath.endsWith("marquee_1400x560.png")) return "1400x560";
  if (relativePath.includes("landing/") && relativePath.endsWith(".png")) return "1600x900";
  if (relativePath.endsWith("icon128.png")) return "128x128";
  if (relativePath.endsWith("icon48.png")) return "48x48";
  if (relativePath.endsWith("icon16.png")) return "16x16";
  return "unknown";
}

async function copyPackageFile({ source, target, required = true }) {
  if (!(await fileExists(source))) {
    if (required) {
      throw new Error(`Missing required package file: ${source}`);
    }
    return false;
  }
  await ensureDir(path.dirname(target));
  await fs.copyFile(source, target);
  return true;
}

function buildGallerySection(title, cards) {
  return `
    <section class="gallery-section">
      <h2>${escapeHtml(title)}</h2>
      <div class="gallery-grid">
        ${cards.join("\n")}
      </div>
    </section>
  `;
}

function imageCardHtml({ title, imagePath, captionLines, sha256, dimensions }) {
  return `
    <article class="asset-card">
      <div class="asset-frame">
        <img src="${escapeHtml(imagePath)}" alt="${escapeHtml(title)}" />
      </div>
      <div class="asset-meta">
        <h3>${escapeHtml(title)}</h3>
        <p class="meta-line"><strong>File:</strong> ${escapeHtml(imagePath)}</p>
        <p class="meta-line"><strong>Dimensions:</strong> ${escapeHtml(dimensions)}</p>
        <p class="meta-line meta-hash"><strong>SHA256:</strong> ${escapeHtml(sha256)}</p>
        ${captionLines.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n")}
      </div>
    </article>
  `;
}

function assetGalleryHtml({
  state,
  packageDir,
  assetHashes,
  paidDisclosureMarkdown,
  screenshotRecords,
  promoRecords,
  landingRecords
}) {
  const storyboardByFile = new Map(
    (state.screenshotStoryboard.storyboard ?? []).map((entry) => [entry.expected_file, entry])
  );
  const screenshotCards = screenshotRecords.map((record) => {
    const storyboard = storyboardByFile.get(path.basename(record.relative_path));
    return imageCardHtml({
      title: storyboard?.title ?? path.basename(record.relative_path),
      imagePath: record.relative_path,
      dimensions: record.dimensions,
      sha256: assetHashes[record.relative_path] ?? "",
      captionLines: unique([
        storyboard?.user_question_answered ? `Question: ${storyboard.user_question_answered}` : null,
        storyboard?.overlay_headline ? `Headline: ${storyboard.overlay_headline}` : null,
        storyboard?.overlay_subcopy ? `Subcopy: ${storyboard.overlay_subcopy}` : null,
        storyboard?.trust_signal ? `Trust: ${storyboard.trust_signal}` : null
      ])
    });
  });
  const promoCards = promoRecords.map((record) => imageCardHtml({
    title: path.basename(record.relative_path),
    imagePath: record.relative_path,
    dimensions: record.dimensions,
    sha256: assetHashes[record.relative_path] ?? "",
    captionLines: [
      record.relative_path.includes("small_promo")
        ? "Branded promo tile for Chrome Web Store."
        : "Wide marquee for listing or landing support."
    ]
  }));
  const landingCards = landingRecords.map((record) => imageCardHtml({
    title: path.basename(record.relative_path),
    imagePath: record.relative_path,
    dimensions: record.dimensions,
    sha256: assetHashes[record.relative_path] ?? "",
    captionLines: [
      record.relative_path.includes("hero")
        ? "Landing hero image aligned with the premium brand system."
        : "Pricing or value framing image for landing and market-test use."
    ]
  }));

  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "  <meta charset=\"utf-8\" />",
    `  <title>${escapeHtml(state.premiumPackagingBrief.product_name)} Asset Gallery</title>`,
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
    "  <style>",
    "    :root { color-scheme: light; --bg: #f3f6f8; --surface: #ffffff; --text: #102233; --muted: #5c7085; --line: #d8e2e8; --primary: #17324d; --accent: #13836f; }",
    "    * { box-sizing: border-box; }",
    "    body { margin: 0; font-family: \"Segoe UI Variable Text\", \"Segoe UI\", sans-serif; background: linear-gradient(180deg, #f7fafc 0%, var(--bg) 100%); color: var(--text); }",
    "    main { max-width: 1440px; margin: 0 auto; padding: 40px 28px 56px; }",
    "    h1, h2, h3 { margin: 0; color: var(--primary); }",
    "    h1 { font-family: \"Segoe UI Variable Display\", \"Segoe UI\", sans-serif; font-size: 34px; letter-spacing: -0.02em; }",
    "    h2 { font-size: 22px; margin-bottom: 18px; }",
    "    h3 { font-size: 18px; margin-bottom: 10px; }",
    "    p, li { line-height: 1.55; }",
    "    .hero { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; align-items: start; margin-bottom: 28px; }",
    "    .panel { background: rgba(255,255,255,0.96); border: 1px solid var(--line); border-radius: 20px; padding: 22px; box-shadow: 0 12px 34px rgba(23, 50, 77, 0.06); }",
    "    .hero .panel strong { color: var(--primary); }",
    "    .stat { font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; }",
    "    .copy-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; margin: 28px 0; }",
    "    .gallery-section { margin: 32px 0; }",
    "    .gallery-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 18px; }",
    "    .asset-card { background: var(--surface); border: 1px solid var(--line); border-radius: 20px; overflow: hidden; box-shadow: 0 10px 28px rgba(16, 34, 51, 0.06); }",
    "    .asset-frame { padding: 16px; background: linear-gradient(180deg, #ffffff 0%, #eef4f7 100%); }",
    "    .asset-frame img { width: 100%; display: block; border-radius: 14px; border: 1px solid #d4dde5; background: #fff; }",
    "    .asset-meta { padding: 18px; }",
    "    .meta-line { color: var(--muted); font-size: 14px; margin: 4px 0; }",
    "    .meta-hash { word-break: break-all; }",
    "    pre { white-space: pre-wrap; word-break: break-word; margin: 0; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 13px; background: #0f1720; color: #e8eef3; padding: 16px; border-radius: 16px; }",
    "    ul { margin: 0; padding-left: 18px; }",
    "    .claim-list li { margin-bottom: 6px; }",
    "    @media (max-width: 960px) { .hero, .copy-grid { grid-template-columns: 1fr; } main { padding: 24px 16px 40px; } }",
    "  </style>",
    "</head>",
    "<body>",
    "  <main>",
    "    <section class=\"hero\">",
    "      <div class=\"panel\">",
    "        <div class=\"stat\">Store Release Package V2</div>",
    `        <h1>${escapeHtml(state.premiumPackagingBrief.product_name)}</h1>`,
    `        <p>${escapeHtml(state.premiumPackagingBrief.one_sentence_value)}</p>`,
    "        <ul class=\"claim-list\">",
    `          <li>${escapeHtml(state.premiumPackagingBrief.local_only_claim)}</li>`,
    `          <li>${escapeHtml(state.premiumPackagingBrief.no_login_claim)}</li>`,
    `          <li>${escapeHtml(state.premiumPackagingBrief.no_upload_claim)}</li>`,
    "        </ul>",
    "      </div>",
    "      <div class=\"panel\">",
    "        <div class=\"stat\">Quality Gates</div>",
    `        <p><strong>Listing quality:</strong> ${escapeHtml(state.listingQualityGate.status)}</p>`,
    `        <p><strong>Asset QA:</strong> ${escapeHtml(state.assetQualityReport.status)}</p>`,
    `        <p><strong>Premium feel score:</strong> ${escapeHtml(`${state.listingQualityGate.premium_feel_score ?? 0}`)}</p>`,
    `        <p><strong>Package root:</strong> ${escapeHtml(relativeToPackage(packageDir, packageDir) || ".")}</p>`,
    "      </div>",
    "    </section>",
    "    <section class=\"copy-grid\">",
    "      <div class=\"panel\">",
    "        <h2>Listing Copy</h2>",
    `        <p><strong>Title</strong><br/>${escapeHtml(state.premiumPackagingBrief.product_name)}</p>`,
    `        <p><strong>Short Description</strong><br/>${escapeHtml(state.listingCopy.store_summary)}</p>`,
    "        <p><strong>Detailed Description</strong></p>",
    `        <pre>${escapeHtml(state.listingCopy.store_description)}</pre>`,
    "      </div>",
    "      <div class=\"panel\">",
    "        <h2>Trust And Paid Disclosure</h2>",
    "        <p><strong>Privacy / local-only claims</strong></p>",
    `        <pre>${escapeHtml(buildPrivacySummary(state))}</pre>`,
    "        <p style=\"margin-top:16px;\"><strong>Paid disclosure</strong></p>",
    `        <pre>${escapeHtml(paidDisclosureMarkdown)}</pre>`,
    "      </div>",
    "    </section>",
    buildGallerySection("Store Screenshots", screenshotCards),
    buildGallerySection("Promo Assets", promoCards),
    buildGallerySection("Landing Assets", landingCards),
    "  </main>",
    "</body>",
    "</html>"
  ].join("\n");
}

async function buildPackageManifest({ projectRoot, packageDir, categoryMap }) {
  const files = await listFiles(packageDir);
  const manifestFiles = [];
  for (const entry of files) {
    if (entry.relativePath === "package_manifest.json") continue;
    const absolutePath = path.join(packageDir, entry.relativePath);
    const stats = await fs.stat(absolutePath);
    manifestFiles.push({
      relative_path: entry.relativePath,
      sha256: await hashFile(absolutePath),
      size_bytes: Number(stats.size),
      category: categoryMap.get(entry.relativePath) ?? "misc"
    });
  }
  const manifest = {
    stage: "STORE_LISTING_RELEASE_PACKAGE_V2",
    generated_at: nowIso(),
    package_dir: normalizeRelativePath(projectRoot, packageDir),
    file_count: manifestFiles.length + 1,
    self_hash_strategy: "package_manifest.json does not include its own sha256 because the file is self-referential",
    files: manifestFiles
  };
  await validateArtifact(projectRoot, "store_listing_release_package_manifest.schema.json", "package_manifest.json", manifest);
  await writeJson(path.join(packageDir, "package_manifest.json"), manifest);
  return manifest;
}

export async function runStoreReleasePackage({ projectRoot, runDir }) {
  const state = await loadStoreReleaseState({ projectRoot, runDir });
  const occurredAt = nowIso();
  const packageDir = state.packageRoot;
  const packageManifestPath = path.join(packageDir, "package_manifest.json");
  const assetGalleryPath = path.join(packageDir, "asset_gallery.html");
  const copyDirPath = path.join(packageDir, "copy");
  const reviewDirPath = path.join(packageDir, "review");
  const assetsDirPath = path.join(packageDir, "assets");
  const categoryMap = new Map();
  const assetRecords = [];
  const copyRecords = [];

  await resetDir(packageDir);
  await ensureDir(path.join(assetsDirPath, "screenshots"));
  await ensureDir(path.join(assetsDirPath, "promo"));
  await ensureDir(path.join(assetsDirPath, "landing"));
  await ensureDir(path.join(assetsDirPath, "icon"));
  await ensureDir(copyDirPath);
  await ensureDir(reviewDirPath);

  const screenshotRecords = [];
  for (const entry of state.screenshotStoryboard.storyboard ?? []) {
    const source = path.join(state.remotionRoot, "screenshots", entry.expected_file);
    const target = path.join(assetsDirPath, "screenshots", entry.expected_file);
    await copyPackageFile({ source, target, required: true });
    const relativePath = relativeToPackage(packageDir, target);
    categoryMap.set(relativePath, "asset_screenshot");
    const record = {
      relative_path: relativePath,
      source_path: normalizeRelativePath(projectRoot, source),
      dimensions: imageDimensionsForPackagePath(relativePath)
    };
    screenshotRecords.push(record);
    assetRecords.push(record);
  }

  const promoPlan = [
    {
      source: path.join(state.remotionRoot, "promo", "small_promo_440x280.png"),
      target: path.join(assetsDirPath, "promo", "small_promo_440x280.png"),
      required: true
    },
    {
      source: path.join(state.remotionRoot, "promo", "marquee_1400x560.png"),
      target: path.join(assetsDirPath, "promo", "marquee_1400x560.png"),
      required: false
    }
  ];
  const promoRecords = [];
  for (const record of promoPlan) {
    if (!(await copyPackageFile(record).catch(() => false))) continue;
    const relativePath = relativeToPackage(packageDir, record.target);
    categoryMap.set(relativePath, "asset_promo");
    const assetRecord = {
      relative_path: relativePath,
      source_path: normalizeRelativePath(projectRoot, record.source),
      dimensions: imageDimensionsForPackagePath(relativePath)
    };
    promoRecords.push(assetRecord);
    assetRecords.push(assetRecord);
  }

  const landingPlan = [
    {
      source: path.join(state.remotionRoot, "landing", "hero_1600x900.png"),
      target: path.join(assetsDirPath, "landing", "hero_1600x900.png"),
      required: true
    },
    {
      source: path.join(state.remotionRoot, "landing", "pricing_1600x900.png"),
      target: path.join(assetsDirPath, "landing", "pricing_1600x900.png"),
      required: false
    }
  ];
  const landingRecords = [];
  for (const record of landingPlan) {
    if (!(await copyPackageFile(record).catch(() => false))) continue;
    const relativePath = relativeToPackage(packageDir, record.target);
    categoryMap.set(relativePath, "asset_landing");
    const assetRecord = {
      relative_path: relativePath,
      source_path: normalizeRelativePath(projectRoot, record.source),
      dimensions: imageDimensionsForPackagePath(relativePath)
    };
    landingRecords.push(assetRecord);
    assetRecords.push(assetRecord);
  }

  for (const fileName of ["icon16.png", "icon48.png", "icon128.png"]) {
    const source = path.join(state.runDir, "70_listing_assets", fileName);
    const target = path.join(assetsDirPath, "icon", fileName);
    if (!(await copyPackageFile({ source, target, required: fileName === "icon128.png" }).catch(() => false))) continue;
    const relativePath = relativeToPackage(packageDir, target);
    categoryMap.set(relativePath, "asset_icon");
    assetRecords.push({
      relative_path: relativePath,
      source_path: normalizeRelativePath(projectRoot, source),
      dimensions: imageDimensionsForPackagePath(relativePath)
    });
  }

  const paidDisclosure = inferPaidDisclosure(state);
  const versionLabel = state.sandboxPlan?.manifest_version ?? "unknown";
  const copyOutputs = [
    { fileName: "title.txt", content: `${state.premiumPackagingBrief.product_name}\n`, category: "copy" },
    { fileName: "short_description.txt", content: `${state.listingCopy.store_summary}\n`, category: "copy" },
    { fileName: "detailed_description.md", content: `${state.listingCopy.store_description}\n`, category: "copy" },
    { fileName: "privacy_summary.md", content: `${buildPrivacySummary(state)}\n`, category: "copy" },
    { fileName: "paid_features_disclosure.md", content: `${paidDisclosure.markdown}\n`, category: "copy" },
    {
      fileName: "support_copy.md",
      content: `${state.landingSupportContent ?? "# Support\n\nReplace this placeholder with the real support path before upload.\n"}\n`,
      category: "copy"
    },
    {
      fileName: "changelog.md",
      content: `${state.landingChangelogContent ?? "# Changelog\n\nDocument release notes before any new dashboard submission.\n"}\n`,
      category: "copy"
    }
  ];
  for (const output of copyOutputs) {
    const target = path.join(copyDirPath, output.fileName);
    await writeText(target, output.content);
    const relativePath = relativeToPackage(packageDir, target);
    categoryMap.set(relativePath, output.category);
    copyRecords.push(relativePath);
  }

  const reviewJsonOutputs = [
    { fileName: "premium_packaging_brief.json", data: state.premiumPackagingBrief },
    { fileName: "brand_system.json", data: state.brandSystem },
    { fileName: "screenshot_storyboard.json", data: state.screenshotStoryboard },
    { fileName: "asset_quality_report.json", data: state.assetQualityReport },
    { fileName: "listing_quality_gate.json", data: state.listingQualityGate },
    { fileName: "product_polish_checklist.json", data: state.productPolishChecklist },
    { fileName: "landing_page_package.json", data: state.landingPackage },
    { fileName: "monetization_strategy.json", data: state.monetizationStrategy ?? fallbackMonetizationReview() }
  ];
  if (state.paymentLinkFlowPlan) {
    reviewJsonOutputs.push({ fileName: "payment_link_flow_plan.json", data: state.paymentLinkFlowPlan });
  }
  if (state.licenseActivationSpec) {
    reviewJsonOutputs.push({ fileName: "license_activation_spec.json", data: state.licenseActivationSpec });
  }
  for (const output of reviewJsonOutputs) {
    const target = path.join(reviewDirPath, output.fileName);
    await writeJson(target, output.data);
    categoryMap.set(relativeToPackage(packageDir, target), "review");
  }

  const storeListingSubmissionPath = path.join(packageDir, "store_listing_submission.md");
  await writeText(storeListingSubmissionPath, `${buildStoreListingSubmission(state, paidDisclosure.markdown, versionLabel)}\n`);
  categoryMap.set(relativeToPackage(packageDir, storeListingSubmissionPath), "submission");

  const assetHashes = {};
  for (const asset of assetRecords) {
    const absolutePath = path.join(packageDir, asset.relative_path);
    assetHashes[asset.relative_path] = await hashFile(absolutePath);
  }

  const galleryContent = assetGalleryHtml({
    state,
    packageDir,
    assetHashes,
    paidDisclosureMarkdown: paidDisclosure.markdown,
    screenshotRecords,
    promoRecords,
    landingRecords
  });
  await writeText(assetGalleryPath, galleryContent);
  categoryMap.set(relativeToPackage(packageDir, assetGalleryPath), "gallery");

  const dashboardChecklistPath = path.join(packageDir, "dashboard_upload_checklist.md");
  await writeText(dashboardChecklistPath, `${buildDashboardChecklist({
    state,
    versionLabel,
    screenshotPaths: screenshotRecords.map((entry) => entry.relative_path),
    smallPromoPath: promoRecords.find((entry) => entry.relative_path.includes("small_promo"))?.relative_path ?? "missing",
    marqueePath: promoRecords.find((entry) => entry.relative_path.includes("marquee"))?.relative_path ?? null,
    paidDisclosureMarkdown: paidDisclosure.markdown,
    galleryPath: relativeToPackage(packageDir, assetGalleryPath)
  })}\n`);
  categoryMap.set(relativeToPackage(packageDir, dashboardChecklistPath), "checklist");

  const manifest = await buildPackageManifest({ projectRoot, packageDir, categoryMap });

  const humanVisualReviewStatus = evaluateHumanVisualReviewStatus(
    { human_visual_review_required: true },
    state.humanVisualReview
  );
  const qualityBlockers = unique([
    state.listingQualityGate.passed === true ? null : "listing_quality_gate_not_passed",
    state.assetQualityReport.status === "passed" ? null : "asset_quality_report_not_passed",
    (state.listingQualityGate.premium_feel_score ?? 0) >= 85 ? null : "premium_feel_score_below_85",
    paidDisclosure.status === "passed" ? null : "paid_disclosure_not_passed",
    screenshotRecords.length === 5 ? null : "screenshot_count_invalid"
  ]);
  const packageStatus = qualityBlockers.length === 0 ? "passed" : "blocked";
  const readyForDashboardUpload = packageStatus === "passed" && humanVisualReviewStatus.passed;

  const report = buildSafeReport({
    stage: "STORE_LISTING_RELEASE_PACKAGE_V2",
    status: "passed",
    run_id: state.runContext.run_id,
    product_name: state.premiumPackagingBrief.product_name,
    package_root: normalizeRelativePath(projectRoot, packageDir),
    package_manifest_path: normalizeRelativePath(projectRoot, packageManifestPath),
    asset_gallery_path: normalizeRelativePath(projectRoot, assetGalleryPath),
    dashboard_upload_checklist_path: normalizeRelativePath(projectRoot, dashboardChecklistPath),
    package_status: packageStatus,
    included_assets: assetRecords.map((entry) => entry.relative_path),
    included_copy_files: copyRecords,
    asset_hashes: assetHashes,
    screenshot_count: screenshotRecords.length,
    promo_assets_present: promoRecords.some((entry) => entry.relative_path.includes("small_promo")),
    landing_assets_present: landingRecords.some((entry) => entry.relative_path.includes("hero"))
      && landingRecords.some((entry) => entry.relative_path.includes("pricing")),
    listing_quality_status: state.listingQualityGate.status,
    asset_qa_status: state.assetQualityReport.status,
    premium_feel_score: round(state.listingQualityGate.premium_feel_score ?? 0),
    paid_disclosure_status: paidDisclosure.status,
    privacy_claim_consistency: state.listingQualityGate.checks?.privacy_claim_consistency === true,
    human_visual_review_required: true,
    ready_for_dashboard_upload: readyForDashboardUpload,
    blockers: qualityBlockers,
    next_step: packageStatus !== "passed"
      ? "Resolve listing quality or asset QA blockers before any dashboard action."
      : readyForDashboardUpload
        ? "Dashboard upload materials are packaged locally. Upload remains a separate explicit human action."
        : state.humanVisualReview
          ? "Resolve the recorded human visual review feedback before any upload or publish decision."
          : "Open asset_gallery.html and record a human visual review before any upload or publish decision."
  });

  await validateArtifact(projectRoot, "store_listing_release_package_report.schema.json", STORE_RELEASE_PACKAGE_REPORT_ARTIFACT, report);
  await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: STORE_RELEASE_PACKAGE_REPORT_ARTIFACT,
    data: report,
    occurredAt
  });

  const marketTestAssetPackage = buildMarketTestAssetPackage(state);
  await validateArtifact(projectRoot, "market_test_asset_package.schema.json", MARKET_TEST_ASSET_PACKAGE_ARTIFACT, marketTestAssetPackage);
  await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: MARKET_TEST_ASSET_PACKAGE_ARTIFACT,
    data: marketTestAssetPackage,
    occurredAt
  });
  await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "122_market_test_asset_package.md",
    category: "store_release_package",
    prefix: "122_market_test_asset_package",
    content: marketTestAssetMarkdown(marketTestAssetPackage),
    occurredAt
  });

  if (state.runContext.revision_kind === "commercial_release_revision") {
    await prepareCommercialReleaseGate({ runDir: state.runDir });
  }

  return {
    runDir: state.runDir,
    runContext: state.runContext,
    report,
    marketTestAssetPackage,
    packageDir,
    manifest
  };
}

export async function recordHumanVisualReview({
  projectRoot,
  runDir,
  decision,
  note,
  reviewer = os.userInfo().username
}) {
  const state = await loadStoreReleaseState({ projectRoot, runDir });
  if (!state.storeReleasePackageReport) {
    throw new Error(`Missing ${STORE_RELEASE_PACKAGE_REPORT_ARTIFACT}. Run packaging:store-release-package first.`);
  }

  const normalizedDecision = `${decision ?? ""}`.trim().toLowerCase();
  if (!["passed", "revise", "blocked"].includes(normalizedDecision)) {
    throw new Error(`Unsupported visual review decision: ${decision}`);
  }

  const occurredAt = nowIso();
  const report = buildSafeReport({
    stage: "HUMAN_VISUAL_REVIEW",
    status: "passed",
    run_id: state.runContext.run_id,
    reviewed_at: occurredAt,
    reviewer,
    decision: normalizedDecision,
    note: `${note ?? ""}`.trim(),
    screenshot_feedback: normalizedDecision === "passed" ? ["Screenshots approved for truthful, premium presentation."] : [],
    promo_feedback: normalizedDecision === "passed" ? ["Promo assets are clear and not misleading."] : [],
    landing_feedback: normalizedDecision === "passed" ? ["Landing hero and pricing visuals are aligned with the listing."] : [],
    pricing_feedback: isMonetized(state)
      ? normalizedDecision === "passed"
        ? ["Pricing disclosure is clear enough for review."]
        : []
      : ["Current revision is free-only; no live paid claim was reviewed for dashboard upload."],
    brand_feedback: normalizedDecision === "passed" ? ["Brand direction feels consistent and premium."] : [],
    trust_feedback: normalizedDecision === "passed"
      ? ["Local-only, no-login, and no-upload claims are visually and verbally consistent."]
      : [],
    misleading_claims_found: [],
    required_changes: normalizedDecision === "passed"
      ? []
      : unique([
          `${note ?? ""}`.trim() || null,
          normalizedDecision === "revise" ? "Revise the asset set and rerun asset QA, listing quality gate, and the store release package." : null,
          normalizedDecision === "blocked" ? "Do not use these assets for any upload or publish package until the blocking issues are resolved." : null
        ]),
    would_publish_with_these_assets: normalizedDecision === "passed",
    next_step: normalizedDecision === "passed"
      ? "human_visual_review_passed_for_future_upload_or_publish_gate"
      : normalizedDecision === "revise"
        ? "revise_assets_then_rerun_store_release_package"
        : "blocked_by_human_visual_review"
  });

  await validateArtifact(projectRoot, "human_visual_review.schema.json", HUMAN_VISUAL_REVIEW_ARTIFACT, report);
  await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: HUMAN_VISUAL_REVIEW_ARTIFACT,
    data: report,
    occurredAt
  });
  return report;
}
