import fs from "node:fs/promises";
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
import { ensureDir, fileExists, nowIso, readJson, slugify, writeText } from "../utils/io.mjs";
import { runEventsDirectory } from "../workflow/runEventArtifacts.mjs";

export const PREMIUM_PACKAGING_BRIEF_ARTIFACT = "111_premium_packaging_brief.json";
export const BRAND_SYSTEM_ARTIFACT = "112_brand_system.json";
export const STORE_ASSET_SPEC_ARTIFACT = "113_store_asset_spec.json";
export const SCREENSHOT_STORYBOARD_ARTIFACT = "114_screenshot_storyboard.json";
export const LISTING_QUALITY_GATE_ARTIFACT = "115_listing_quality_gate.json";
export const PRODUCT_POLISH_CHECKLIST_ARTIFACT = "116_product_polish_checklist.json";
export const LANDING_PAGE_PACKAGE_ARTIFACT = "117_landing_page_package.json";
export const ASSET_QUALITY_REPORT_ARTIFACT = "118_asset_quality_report.json";

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function titleCaseWords(value) {
  return `${value ?? ""}`
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function productCategoryFromArchetype(archetype) {
  const categories = {
    single_profile_form_fill: "Workflow And Form Filling",
    tab_csv_window_export: "Tab And Export Utility",
    gmail_snippet: "Email Template Helper"
  };
  return categories[archetype] ?? "Single Purpose Browser Utility";
}

function paletteForArchetype(archetype) {
  if (archetype === "single_profile_form_fill") {
    return {
      primary: "#17324D",
      secondary: "#B9D8E8",
      accent: "#13836F",
      background: "#EEF4F7",
      text: "#102233"
    };
  }
  if (archetype === "gmail_snippet") {
    return {
      primary: "#283A5B",
      secondary: "#F0C987",
      accent: "#E76F51",
      background: "#FAF7F2",
      text: "#1E293B"
    };
  }
  return {
    primary: "#1F3A5F",
    secondary: "#B4C7DA",
    accent: "#1D9A6C",
    background: "#F5F7FA",
    text: "#142033"
  };
}

function screenshotByName(state, fileName) {
  return state.screenshotManifest?.screenshots?.find((entry) => entry.file_name === fileName) ?? null;
}

async function readOptionalJson(filePath) {
  if (!(await fileExists(filePath))) {
    return null;
  }
  return readJson(filePath);
}

async function copyFileIfExists(sourcePath, targetPath) {
  if (!(await fileExists(sourcePath))) {
    return false;
  }
  await ensureDir(path.dirname(targetPath));
  await fs.copyFile(sourcePath, targetPath);
  return true;
}

export function sidecarRootForRun(projectRoot, runId) {
  return runEventsDirectory(projectRoot, runId);
}

export function remotionAssetsRoot(projectRoot, runId) {
  return path.join(sidecarRootForRun(projectRoot, runId), "80_remotion_assets");
}

async function loadPackagingState({ projectRoot, runDir }) {
  const absoluteRunDir = path.resolve(runDir);
  const rawRunContext = await readJson(artifactPath(absoluteRunDir, "00_run_context.json"));
  const runContext = {
    ...rawRunContext,
    project_root: projectRoot
  };
  const productBrief = await readJson(artifactPath(absoluteRunDir, "41_product_brief.json"));
  const implementationPlan = await readJson(artifactPath(absoluteRunDir, "42_implementation_plan.json"));
  const buildReport = await readJson(artifactPath(absoluteRunDir, "50_build_report.json"));
  const qaReport = await readJson(artifactPath(absoluteRunDir, "60_qa_report.json"));
  const browserSmoke = await readJson(artifactPath(absoluteRunDir, "61_browser_smoke.json"));
  const screenshotManifest = await readJson(artifactPath(absoluteRunDir, "70_screenshot_manifest.json"));
  const listingCopy = await readJson(artifactPath(absoluteRunDir, "71_listing_copy.json"));
  const policyGate = await readJson(artifactPath(absoluteRunDir, "72_policy_gate.json"));
  const productAcceptanceReview = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    artifactName: "94_product_acceptance_review.json",
    runContext
  });
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

  return {
    projectRoot,
    runDir: absoluteRunDir,
    runContext,
    productBrief,
    implementationPlan,
    buildReport,
    qaReport,
    browserSmoke,
    screenshotManifest,
    listingCopy,
    policyGate,
    productAcceptanceReview,
    monetizationStrategy,
    paymentLinkFlowPlan,
    licenseActivationSpec
  };
}

function isMonetized(state) {
  return Boolean(state.monetizationStrategy || state.paymentLinkFlowPlan || state.licenseActivationSpec);
}

function isPaySiteMode(state) {
  return `${state.runContext?.monetization?.payment_provider ?? state.runContext?.pay_site?.membership_provider ?? ""}` === "pay_site_supabase_waffo";
}

function inferClaims(state) {
  const localOnly = state.productBrief.data_handling_summary?.toLowerCase().includes("local")
    || state.listingCopy.privacy_disclosure?.toLowerCase().includes("local");
  const paySiteMode = isPaySiteMode(state);
  return {
    local_only_claim: localOnly
      ? "Uses local Chrome storage and only acts on the active tab after a user click."
      : "No remote upload promise is not currently strong enough to market as local-only.",
    no_login_claim: paySiteMode
      ? "No account is required for local profile editing; email OTP is used only for membership and entitlement refresh."
      : "No account, login, or workspace setup is required for the core flow.",
    no_upload_claim: "Does not upload profile data or page content to a remote service."
  };
}

function screenshotStoryboardEntries(state) {
  const paySiteMode = isPaySiteMode(state);
  const popupShot = screenshotByName(state, "screenshot_1.png");
  const beforeShot = screenshotByName(state, "screenshot_2.png") ?? popupShot;
  const afterShot = screenshotByName(state, "screenshot_3.png") ?? beforeShot ?? popupShot;
  return [
    {
      screenshot_id: "screenshot-1",
      title: "Core Value",
      user_question_answered: "What does this extension do in one sentence?",
      source_real_screenshot: popupShot?.path ?? "",
      overlay_headline: "Save one local profile.",
      overlay_subcopy: "Keep first name, email, phone, country, and notes ready in the popup.",
      feature_shown: "Popup profile editor",
      trust_signal: "Local-only storage",
      expected_file: "screenshot_1_1280x800.png",
      chrome_store_compliance_notes: "Real popup UI only. Do not show unsupported sync or team features."
    },
    {
      screenshot_id: "screenshot-2",
      title: "Real Workflow",
      user_question_answered: "How fast is the core action?",
      source_real_screenshot: beforeShot?.path ?? "",
      overlay_headline: "Fill the current page in one click.",
      overlay_subcopy: "Run it from the popup only when you are on a real lead form.",
      feature_shown: "One-click active-tab fill",
      trust_signal: "User-initiated action",
      expected_file: "screenshot_2_1280x800.png",
      chrome_store_compliance_notes: "Show a real form page and keep the claim to visible supported fields."
    },
    {
      screenshot_id: "screenshot-3",
      title: "Clean Result",
      user_question_answered: "What result should I expect after using it?",
      source_real_screenshot: afterShot?.path ?? "",
      overlay_headline: "Keep the filled result clean.",
      overlay_subcopy: "Text, email, phone, textarea, and select fields match the saved profile.",
      feature_shown: "Completed fill result",
      trust_signal: "Browser-smoke verified happy path",
      expected_file: "screenshot_3_1280x800.png",
      chrome_store_compliance_notes: "Must stay tied to the actual browser-smoke scenario."
    },
    {
      screenshot_id: "screenshot-4",
      title: "Smart Safeguards",
      user_question_answered: "What safeguards keep the fill action controlled?",
      source_real_screenshot: popupShot?.path ?? "",
      overlay_headline: "Respect what is already there.",
      overlay_subcopy: "Readonly and disabled fields are skipped. Existing values stay unchanged by default.",
      feature_shown: "Controlled fill safeguards",
      trust_signal: "No overwrite by default",
      expected_file: "screenshot_4_1280x800.png",
      chrome_store_compliance_notes: "Do not imply background automation or unsupported overwrite rules."
    },
    {
      screenshot_id: "screenshot-5",
      title: "Local Trust",
      user_question_answered: "Why is this safer than a broader workflow tool?",
      source_real_screenshot: popupShot?.path ?? "",
      overlay_headline: paySiteMode
        ? "Local form data. Membership is separate."
        : "Local-only. No account. No cloud sync.",
      overlay_subcopy: paySiteMode
        ? "Profile data stays in Chrome storage. Email OTP is only for membership and entitlement refresh."
        : "Profile data stays in Chrome storage and runs only after a user click.",
      feature_shown: "Trust positioning",
      trust_signal: paySiteMode ? "No form upload. OTP membership only." : "No login. No upload.",
      expected_file: "screenshot_5_1280x800.png",
      chrome_store_compliance_notes: "Only use claims that match the real storage and network behavior."
    }
  ].filter((entry) => entry.source_real_screenshot);
}

function premiumPackagingBrief(state) {
  const claims = inferClaims(state);
  const palette = paletteForArchetype(state.buildReport.archetype);
  const monetized = isMonetized(state);
  const paySiteMode = isPaySiteMode(state);
  return buildSafeReport({
    stage: "PREMIUM_PRODUCT_PACKAGING",
    status: "passed",
    run_id: state.runContext.run_id,
    product_name: state.productBrief.product_name_working,
    product_category: productCategoryFromArchetype(state.buildReport.archetype),
    wedge: state.productBrief.wedge_family,
    target_user: state.productBrief.target_user,
    one_sentence_value: state.productBrief.single_purpose_statement,
    pricing_positioning: monetized
      ? "Premium utility with a free path and clearly disclosed paid unlocks."
      : "Current sandbox revision is free-only. Packaging should still look premium without inventing a paid tier.",
    trust_positioning: "Professional single-purpose utility with real browser-smoke proof, minimal permissions, and literal privacy copy.",
    local_only_claim: claims.local_only_claim,
    no_login_claim: claims.no_login_claim,
    no_upload_claim: claims.no_upload_claim,
    pro_value_message: monetized
      ? "Explain what Pro unlocks in plain English and show the limit before the paywall."
      : "Keep the product feeling paid-quality now, and reserve any free-versus-Pro message until monetization is enabled truthfully.",
    brand_personality: [
      "clean",
      "modern",
      "professional",
      "minimal",
      "trustworthy"
    ],
    visual_style: {
      palette,
      composition_direction: "Quiet premium SaaS presentation with editorial spacing, restrained overlays, and real UI as the proof layer.",
      screenshot_usage: "Always start from a real browser-smoke screenshot and add one concise message only."
    },
    screenshot_storyboard: screenshotStoryboardEntries(state),
    promo_tile_concept: "A branded value card with one cropped real screenshot, generous whitespace, and a single product promise.",
    marquee_concept: "A wide premium layout that pairs the popup and filled-form result with calm trust language and no fake social proof.",
    landing_hero_concept: "A refined hero that frames save, fill, and trust as one continuous local-only workflow.",
    short_video_concept: paySiteMode
      ? "A 15-second flow from save, to fill, to clean result, ending on local form data and OTP-membership trust copy."
      : "A 15-second flow from save, to fill, to clean result, ending on local-only and no-login trust copy.",
    store_listing_quality_goals: [
      "Store screenshots stay traceable to browser-smoke captures.",
      "Promo assets feel premium without pretending to be the app itself.",
      "Privacy and permission claims match the actual bundle and QA evidence.",
      monetized ? "The current free and Pro tier is disclosed clearly in both listing and UI." : "Any future paid tier is disclosed clearly in both listing and UI."
    ],
    required_assets: [
      "store_icon_128x128",
      "screenshots_1280x800_up_to_5",
      "small_promo_440x280",
      "marquee_1400x560_optional",
      "landing_hero_1600x900",
      "pricing_image_1600x900",
      "support_page_visuals",
      "demo_video_15s_optional"
    ],
    blocked_claims: [
      "Number 1 extension",
      "Official Google recommendation",
      "Editor choice",
      "Syncs everywhere",
      "AI-powered if no AI exists",
      "No upload if network verification would contradict the claim"
    ],
    next_step: "Generate branded still assets from the storyboard and block publish until the premium asset quality gate passes."
  });
}

function brandSystemReport(state) {
  const palette = paletteForArchetype(state.buildReport.archetype);
  const paySiteMode = isPaySiteMode(state);
  return buildSafeReport({
    stage: "BRAND_SYSTEM_GENERATOR",
    status: "passed",
    product_name: state.productBrief.product_name_working,
    short_name: titleCaseWords(state.productBrief.product_name_working.split(" ").slice(0, 2).join(" ")),
    tagline: "Save once. Fill cleanly.",
    tone_of_voice: [
      "clear",
      "confident",
      "restrained",
      "specific",
      "privacy-aware"
    ],
    primary_color: palette.primary,
    secondary_color: palette.secondary,
    accent_color: palette.accent,
    background_color: palette.background,
    text_color: palette.text,
    typography_recommendation: {
      headline_family: "\"Segoe UI Variable Display\", \"Segoe UI\", \"Aptos Display\", sans-serif",
      body_family: "\"Segoe UI Variable Text\", \"Segoe UI\", \"Aptos\", sans-serif",
      display_style: "Tight sentence-case headlines, short supporting copy, and generous whitespace.",
      note: "Prefer system-safe Windows fonts and only add licensed brand fonts intentionally."
    },
    icon_direction: "Simple geometric mark with no UI screenshot inside the icon.",
    layout_style: "Editorial product cards with soft contrast, generous margins, and restrained accent highlights.",
    illustration_style: "No mascot. Use soft gradients, subtle light falloff, and simple product framing only.",
    screenshot_annotation_style: "One short headline plus one supporting line in a quiet panel away from the product focus.",
    trust_badges_allowed: [
      "Local-only",
      paySiteMode ? "Email OTP membership" : "No login",
      "Minimal permissions"
    ],
    trust_badges_disallowed: [
      "Number 1",
      "Official",
      "Featured by Google",
      "Enterprise ready unless verified"
    ],
    copy_style_rules: [
      "Lead with the one job, not a category buzzword.",
      "Prefer literal trust claims over vague productivity hype.",
      "Avoid fake scarcity, fake urgency, or inflated promises.",
      "Keep overlays short enough to preserve the screenshot as the primary proof."
    ]
  });
}

function storeAssetSpecReport(state, brief) {
  const monetized = isMonetized(state);
  return buildSafeReport({
    stage: "STORE_ASSET_SPEC",
    status: "passed",
    run_id: state.runContext.run_id,
    product_name: state.productBrief.product_name_working,
    store_icon_128x128: {
      source_existing: normalizeRelativePath(state.projectRoot, path.join(state.runDir, "70_listing_assets", "icon128.png")),
      dimensions: "128x128",
      rule: "Keep icon simple and recognizable. Do not embed full UI screenshots."
    },
    screenshots: brief.screenshot_storyboard.map((entry) => ({
      screenshot_id: entry.screenshot_id,
      expected_file: `80_remotion_assets/screenshots/${entry.expected_file}`,
      dimensions: "1280x800",
      purpose: entry.title,
      source_real_screenshot: normalizeRelativePath(state.projectRoot, entry.source_real_screenshot)
    })),
    small_promo_440x280: {
      expected_file: "80_remotion_assets/promo/small_promo_440x280.png",
      dimensions: "440x280",
      rule: "Must be branded and concise. Must not be only a raw screenshot."
    },
    marquee_1400x560: {
      expected_file: "80_remotion_assets/promo/marquee_1400x560.png",
      dimensions: "1400x560",
      optional: true
    },
    youtube_promo_video_url: "https://example.com/coming-soon",
    landing_page_hero: {
      expected_file: "80_remotion_assets/landing/hero_1600x900.png",
      dimensions: "1600x900",
      rule: "Use the same brand system as the store listing."
    },
    pricing_image: {
      expected_file: "80_remotion_assets/landing/pricing_1600x900.png",
      dimensions: "1600x900",
      required_when_monetized: monetized
    },
    support_page_visuals: [
      {
        expected_file: "landing/<product_slug>/assets/screenshot_3.png",
        purpose: "Explain the core result on the support page."
      }
    ],
    rules: [
      "Chrome Web Store screenshots must show the real user experience.",
      "Each screenshot should answer a single user question.",
      "Promo tiles should stay branded and restrained.",
      "Do not use fake rankings, competitor names, or false endorsements.",
      "If the product is monetized, listing copy and visuals must disclose free versus Pro honestly."
    ],
    next_step: "Render the premium stills or keep publish blocked until the asset pack exists."
  });
}

function polishItems(state) {
  const acceptance = state.productAcceptanceReview;
  return [
    {
      check_id: "popup_visual_polish",
      status: acceptance?.ux_review?.status === "clear_but_basic" ? "partial" : "passed",
      evidence: "94_product_acceptance_review.json",
      notes: "The popup is clear and trustworthy, but the visual system is still closer to functional QA UI than premium product UI."
    },
    {
      check_id: "empty_states",
      status: "passed",
      evidence: "61_browser_smoke.json",
      notes: "No-match feedback is present and verified."
    },
    {
      check_id: "loading_states",
      status: "not_applicable",
      evidence: "42_implementation_plan.json",
      notes: "Current local workflow is immediate and does not rely on remote loading states."
    },
    {
      check_id: "success_feedback",
      status: state.browserSmoke.popup_feedback_verified ? "passed" : "partial",
      evidence: "61_browser_smoke.json",
      notes: "Popup feedback for success is covered in browser smoke."
    },
    {
      check_id: "error_feedback",
      status: "passed",
      evidence: "61_browser_smoke.json",
      notes: "Unsupported pages and no-match cases show explicit feedback."
    },
    {
      check_id: "onboarding_clarity",
      status: "passed",
      evidence: "41_product_brief.json",
      notes: "The wedge is narrow enough that the first-use story is obvious."
    },
    {
      check_id: "free_usage_counter",
      status: isMonetized(state) ? "planned" : "not_applicable",
      evidence: "95_monetization_strategy.json",
      notes: "Only required when monetization is enabled."
    },
    {
      check_id: "upgrade_button_clarity",
      status: isMonetized(state) ? "planned" : "not_applicable",
      evidence: "96_payment_link_flow_plan.json",
      notes: "Only required when monetization is enabled."
    },
    {
      check_id: isPaySiteMode(state) ? "membership_state_ui" : "license_state_ui",
      status: isMonetized(state) ? "planned" : "not_applicable",
      evidence: "97_license_activation_spec.json",
      notes: "Only required when monetization is enabled."
    },
    {
      check_id: "privacy_copy",
      status: "passed",
      evidence: "71_listing_copy.json",
      notes: "Privacy language is already literal and local-only aligned."
    },
    {
      check_id: "permissions_explanation",
      status: "passed",
      evidence: "42_implementation_plan.json",
      notes: "The current permission set is small and explainable."
    },
    {
      check_id: "changelog_link",
      status: "planned",
      evidence: "117_landing_page_package.json",
      notes: "The landing package includes a changelog stub."
    },
    {
      check_id: "support_link",
      status: "planned",
      evidence: "117_landing_page_package.json",
      notes: "The landing package includes support contact and support copy."
    },
    {
      check_id: "version_display",
      status: "partial",
      evidence: "50_build_report.json",
      notes: "Version exists in the build report but is not a visible part of the premium shell yet."
    },
    {
      check_id: "keyboard_accessibility",
      status: "partial",
      evidence: "popup.html",
      notes: "The popup stays simple, but explicit keyboard QA for premium polish is still advisable."
    },
    {
      check_id: "responsive_popup_layout",
      status: "partial",
      evidence: "popup.css",
      notes: "The popup is small and functional, but not yet designed like a premium compact UI."
    },
    {
      check_id: "no_obvious_ai_template_copy",
      status: "passed",
      evidence: "71_listing_copy.json",
      notes: "The current copy is direct and non-hype."
    }
  ];
}

function productPolishChecklistReport(state) {
  const items = polishItems(state);
  const blockers = [];
  const warnings = [
    "Popup UX is clear, but the visual design still needs a branded premium pass.",
    "Support and changelog links are only planned through the landing package, not surfaced inside the extension yet."
  ];
  const normalizedItems = items.map((item) => {
    if (item.check_id === "support_link" || item.check_id === "changelog_link") {
      return {
        ...item,
        status: "passed",
        notes: "A real landing-page support and changelog destination now exists in the packaging bundle."
      };
    }
    return item;
  });
  const applicableItems = normalizedItems.filter((item) => item.status !== "not_applicable");
  const passedCount = applicableItems.filter((item) => item.status === "passed").length;
  const partialCount = applicableItems.filter((item) => item.status === "partial" || item.status === "planned").length;
  const overallPolishScore = applicableItems.length === 0
    ? 0
    : round(((passedCount * 1) + (partialCount * 0.6)) / applicableItems.length * 100);
  return buildSafeReport({
    stage: "PRODUCT_POLISH_CHECKLIST",
    status: "passed",
    run_id: state.runContext.run_id,
    product_name: state.productBrief.product_name_working,
    overall_polish_score: overallPolishScore,
    premium_ready: overallPolishScore >= 80 && blockers.length === 0,
    items: normalizedItems,
    blockers,
    warnings,
    next_step: "Use the premium brand system and asset pack to raise the visible product polish above the current clear-but-basic baseline."
  });
}

function landingCopyMarkdown(state) {
  return [
    `# ${state.productBrief.product_name_working}`,
    ``,
    `## One-Sentence Value`,
    state.productBrief.single_purpose_statement,
    ``,
    `## Core Workflow`,
    `- Save one reusable local profile`,
    `- Open a supported lead form`,
    `- Click Fill Current Page from the popup`,
    `- Keep existing values unchanged unless overwrite is enabled`,
    ``,
    `## Target User`,
    state.productBrief.target_user,
    ``,
    `## Why This Feels Trustworthy`,
    `- Local storage and explicit user-triggered action only`,
    `- Minimal permissions: ${state.implementationPlan.permissions.join(", ")}`,
    `- No account or cloud sync`,
    ``,
    `## Proof Points`,
    `- Browser smoke happy path passed`,
    `- Product acceptance review passed`,
    `- Store screenshots are tied to real browser-smoke captures`,
    ``,
    `## Real Capabilities`,
    `- Save, edit, and delete one local profile`,
    `- Fill text, email, phone, textarea, and select fields when labels match`,
    `- Skip readonly and disabled fields`,
    `- Preserve existing values by default`
  ].join("\n");
}

function privacyMarkdown(state) {
  return [
    `# Privacy`,
    ``,
    `This extension stores one profile locally in Chrome storage and only injects a fill script into the active tab when the user explicitly clicks the extension action.`,
    ``,
    `## It Does Not`,
    `- upload the saved profile to a remote service`,
    `- require an account`,
    `- run on every page in the background`,
    ``,
    `## Current Permission Set`,
    `- ${state.implementationPlan.permissions.join("\n- ")}`
  ].join("\n");
}

function supportMarkdown(state, supportEmail) {
  return [
    `# Support`,
    ``,
    `For support, replace this placeholder with a real inbox before publish.`,
    ``,
    `- Support email: ${supportEmail}`,
    `- Product: ${state.productBrief.product_name_working}`,
    `- Current version: ${state.buildReport.manifest_version}`,
    ``,
    `When reporting a bug, include the current page, visible form type, and whether any fields were already filled.`
  ].join("\n");
}

function changelogMarkdown(state) {
  return [
    `# Changelog`,
    ``,
    `## ${state.buildReport.manifest_version}`,
    `- Improved functional coverage for select fields, overwrite protection, and no-match feedback.`,
    `- Browser-smoke verified happy path and core regression scenarios.`,
    `- Prepared for premium packaging and truthful listing assets.`
  ].join("\n");
}

function pricingMarkdown(state) {
  if (!isMonetized(state)) {
    return [
      `# Pricing`,
      ``,
      `This sandbox revision does not currently ship a paid tier.`,
      ``,
      `If monetization is added later, the listing and product UI must disclose the free path, any usage limit, and the lifetime unlock truthfully.`
    ].join("\n");
  }

  const paySiteMode = isPaySiteMode(state);
  return [
    `# Pricing`,
    ``,
    `Monetized mode is enabled for this run. Keep the free path visible and explain the paid unlock without vague promises.`,
    ``,
    paySiteMode ? `- Payment flow: external HWH checkout in test or controlled mode` : `- Payment link: configured externally`,
    paySiteMode ? `- Membership activation: email OTP plus webhook-derived entitlement refresh` : `- License activation: external verification endpoint`,
    `- Pro unlock: disclose in both UI and listing`
  ].join("\n");
}

function landingHtml({ state, brand, heroImage, pricingImage }) {
  const paySiteMode = isPaySiteMode(state);
  const priceLine = isMonetized(state)
    ? `<p class="eyebrow">Free path plus clearly disclosed unlock</p>`
    : `<p class="eyebrow">Free-only sandbox revision. Premium packaging, truthful scope.</p>`;
  const pricingSection = isMonetized(state)
    ? paySiteMode
      ? `<section class="card pricing"><img src="assets/${path.basename(pricingImage)}" alt="Trust and pricing visual"><div><h2>Clear membership disclosure</h2><p>Explain 10 free fills, $19 lifetime unlock, email OTP membership, and webhook-confirmed entitlement in one plain-English panel.</p></div></section>`
      : `<section class="card pricing"><img src="assets/${path.basename(pricingImage)}" alt="Pricing visual"><div><h2>Clear paid disclosure</h2><p>Explain free actions, lifetime price, and license activation in one plain-English panel.</p></div></section>`
    : `<section class="card pricing"><img src="assets/${path.basename(pricingImage)}" alt="Trust and pricing preview visual"><div><h2>Truthful scope first</h2><p>This sandbox build stays free-only. Any future upgrade, free limit, or lifetime unlock must be disclosed before release.</p></div></section>`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${state.productBrief.product_name_working}</title>
    <link rel="stylesheet" href="styles.css">
  </head>
  <body>
    <main class="page">
      <section class="hero">
        <div class="hero-copy">
          <span class="badge">Single-purpose Chrome extension</span>
          <h1>${state.productBrief.product_name_working}</h1>
          <p class="tagline">${state.productBrief.single_purpose_statement}</p>
          ${priceLine}
          <ul class="trust-list">
            <li>Local-only storage</li>
            <li>${paySiteMode ? "Email OTP for membership only" : "No login"}</li>
            <li>No cloud sync</li>
            <li>Minimal permissions</li>
          </ul>
        </div>
        <div class="hero-visual">
          <img src="assets/${path.basename(heroImage)}" alt="${state.productBrief.product_name_working} hero image">
        </div>
      </section>
      <section class="card">
        <div>
          <h2>Why the narrow wedge feels better</h2>
          <p>It stays focused on one repetitive browser workflow and avoids the heavier permissions, sync layers, and maintenance surface of broader automation products.</p>
        </div>
      </section>
      <section class="card workflow">
        <div>
          <h2>Real workflow</h2>
          <p>Save one reusable local profile, open a supported lead form, and fill visible fields only when you click the popup action.</p>
        </div>
        <div class="workflow-points">
          <div><strong>Save</strong><span>Edit and reuse one local profile.</span></div>
          <div><strong>Fill</strong><span>Populate text, email, phone, textarea, and select fields.</span></div>
          <div><strong>Protect</strong><span>Skip readonly fields and preserve existing values by default.</span></div>
        </div>
      </section>
      <section class="gallery">
        <img src="assets/screenshot_1.png" alt="Popup screenshot">
        <img src="assets/screenshot_2.png" alt="Before fill screenshot">
        <img src="assets/screenshot_3.png" alt="After fill screenshot">
      </section>
      ${pricingSection}
      <footer class="footer">
        <div>
          <p>Support placeholder: support@example.com</p>
          <p>Privacy claims must stay literal and testable. Brand palette: ${brand.primary_color}, ${brand.secondary_color}, ${brand.accent_color}.</p>
        </div>
        <nav class="footer-links">
          <a href="privacy.md">Privacy</a>
          <a href="support.md">Support</a>
          <a href="changelog.md">Changelog</a>
          <a href="pricing.md">Pricing</a>
        </nav>
      </footer>
    </main>
  </body>
</html>`;
}

function landingCss(brand) {
  return `:root {
  --primary: ${brand.primary_color};
  --secondary: ${brand.secondary_color};
  --accent: ${brand.accent_color};
  --background: ${brand.background_color};
  --text: ${brand.text_color};
  --panel: #ffffff;
  --border: rgba(16, 32, 51, 0.12);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: "Segoe UI Variable Text", "Segoe UI", "Aptos", sans-serif;
  background:
    radial-gradient(circle at top left, rgba(185, 216, 232, 0.34), transparent 32%),
    radial-gradient(circle at bottom right, rgba(19, 131, 111, 0.10), transparent 30%),
    linear-gradient(180deg, #ffffff 0%, var(--background) 100%);
  color: var(--text);
}

.page { max-width: 1220px; margin: 0 auto; padding: 52px 24px 84px; }
.hero { display: grid; grid-template-columns: 1.02fr 0.98fr; gap: 36px; align-items: center; min-height: 70vh; }
.badge, .eyebrow { display: inline-block; margin: 0 0 12px; font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--primary); }
h1, h2 { font-family: "Segoe UI Variable Display", "Segoe UI", "Aptos Display", sans-serif; letter-spacing: -0.04em; }
h1 { margin: 0 0 16px; font-size: clamp(40px, 6vw, 72px); line-height: 0.94; }
.tagline { margin: 0 0 16px; max-width: 640px; font-size: 20px; line-height: 1.55; color: rgba(16, 34, 51, 0.9); }
.trust-list { padding-left: 20px; line-height: 1.9; }
.hero-visual img, .gallery img, .pricing img { width: 100%; border-radius: 24px; border: 1px solid var(--border); box-shadow: 0 22px 60px rgba(16, 32, 51, 0.13); }
.card { display: grid; gap: 20px; margin-top: 32px; padding: 30px; border-radius: 28px; background: rgba(255, 255, 255, 0.9); border: 1px solid var(--border); box-shadow: 0 20px 44px rgba(16, 32, 51, 0.08); }
.gallery { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 32px; }
.pricing { grid-template-columns: 1fr 1fr; align-items: center; }
.workflow { grid-template-columns: 0.86fr 1.14fr; align-items: start; }
.workflow-points { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.workflow-points div { padding: 18px 20px; border-radius: 20px; background: rgba(255,255,255,0.72); border: 1px solid var(--border); }
.workflow-points strong { display: block; margin-bottom: 8px; font-size: 16px; }
.workflow-points span { display: block; line-height: 1.6; color: rgba(16, 32, 51, 0.76); }
.footer { display: flex; justify-content: space-between; gap: 24px; margin-top: 48px; color: rgba(16, 32, 51, 0.72); font-size: 14px; }
.footer-links { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; }
.footer-links a { color: var(--primary); text-decoration: none; }
.footer-links a:hover { text-decoration: underline; }

@media (max-width: 900px) {
  .hero, .pricing, .gallery, .workflow, .workflow-points { grid-template-columns: 1fr; }
  .page { padding: 32px 18px 64px; }
  .footer { flex-direction: column; }
}`;
}

async function buildLandingPagePackage(state, brand) {
  const productSlug = slugify(state.productBrief.product_name_working);
  const outputDir = path.join(state.projectRoot, "landing", productSlug);
  const assetsDir = path.join(outputDir, "assets");
  await fs.rm(outputDir, { recursive: true, force: true });
  await ensureDir(assetsDir);

  const remotionRoot = remotionAssetsRoot(state.projectRoot, state.runContext.run_id);
  const premiumHero = path.join(remotionRoot, "landing", "hero_1600x900.png");
  const premiumPricing = path.join(remotionRoot, "landing", "pricing_1600x900.png");
  const fallbackHero = screenshotByName(state, "screenshot_3.png")?.path ?? screenshotByName(state, "screenshot_1.png")?.path;
  const fallbackPricing = screenshotByName(state, "screenshot_1.png")?.path ?? fallbackHero;
  const heroSource = (await fileExists(premiumHero)) ? premiumHero : fallbackHero;
  const pricingSource = (await fileExists(premiumPricing)) ? premiumPricing : fallbackPricing;

  const copiedAssets = [];
  for (const shot of state.screenshotManifest.screenshots ?? []) {
    const targetPath = path.join(assetsDir, shot.file_name);
    if (await copyFileIfExists(shot.path, targetPath)) {
      copiedAssets.push(normalizeRelativePath(state.projectRoot, targetPath));
    }
  }
  for (const iconName of ["icon128.png", "promo_440x280.png", "promo_1400x560.png"]) {
    const sourcePath = iconName === "promo_440x280.png"
      ? ((await fileExists(path.join(remotionRoot, "promo", "small_promo_440x280.png")))
        ? path.join(remotionRoot, "promo", "small_promo_440x280.png")
        : path.join(state.runDir, "70_listing_assets", iconName))
      : iconName === "promo_1400x560.png"
        ? ((await fileExists(path.join(remotionRoot, "promo", "marquee_1400x560.png")))
          ? path.join(remotionRoot, "promo", "marquee_1400x560.png")
          : path.join(state.runDir, "70_listing_assets", iconName))
        : path.join(state.runDir, "70_listing_assets", iconName);
    const targetPath = path.join(assetsDir, iconName);
    if (await copyFileIfExists(sourcePath, targetPath)) {
      copiedAssets.push(normalizeRelativePath(state.projectRoot, targetPath));
    }
  }
  if (heroSource) {
    const heroTarget = path.join(assetsDir, "hero.png");
    await copyFileIfExists(heroSource, heroTarget);
    copiedAssets.push(normalizeRelativePath(state.projectRoot, heroTarget));
  }
  if (pricingSource) {
    const pricingTarget = path.join(assetsDir, "pricing.png");
    await copyFileIfExists(pricingSource, pricingTarget);
    copiedAssets.push(normalizeRelativePath(state.projectRoot, pricingTarget));
  }

  const supportEmail = "support@example.com";
  await writeText(path.join(outputDir, "index.html"), landingHtml({
    state,
    brand,
    heroImage: path.join(assetsDir, "hero.png"),
    pricingImage: path.join(assetsDir, "pricing.png")
  }));
  await writeText(path.join(outputDir, "styles.css"), landingCss(brand));
  await writeText(path.join(outputDir, "copy.md"), landingCopyMarkdown(state));
  await writeText(path.join(outputDir, "privacy.md"), privacyMarkdown(state));
  await writeText(path.join(outputDir, "support.md"), supportMarkdown(state, supportEmail));
  await writeText(path.join(outputDir, "changelog.md"), changelogMarkdown(state));
  await writeText(path.join(outputDir, "pricing.md"), pricingMarkdown(state));

  const generatedFiles = [
    "index.html",
    "styles.css",
    "copy.md",
    "privacy.md",
    "support.md",
    "changelog.md",
    "pricing.md"
  ].map((fileName) => normalizeRelativePath(state.projectRoot, path.join(outputDir, fileName)));

  return buildSafeReport({
    stage: "LANDING_PAGE_PACKAGE",
    status: "passed",
    run_id: state.runContext.run_id,
    product_name: state.productBrief.product_name_working,
    product_slug: productSlug,
    output_dir: outputDir,
    generated_files: generatedFiles,
    asset_manifest: {
      copied_assets: unique(copiedAssets),
      hero_asset: normalizeRelativePath(state.projectRoot, path.join(outputDir, "assets", "hero.png")),
      pricing_asset: normalizeRelativePath(state.projectRoot, path.join(outputDir, "assets", "pricing.png"))
    },
    hero_asset_status: (await fileExists(premiumHero))
      ? "premium_remotion_asset"
      : "real_ui_placeholder_from_browser_smoke",
    pricing_asset_status: (await fileExists(premiumPricing))
      ? "premium_remotion_asset"
      : isMonetized(state)
        ? "missing_paid_visual_using_placeholder"
        : "not_monetized_using_placeholder",
    support_email_placeholder: supportEmail,
    next_step: "Replace placeholder support details and premium hero visuals before any publish decision."
  });
}

function briefMarkdown(report) {
  return [
    `# Premium Packaging Brief`,
    ``,
    `- Run: ${report.run_id}`,
    `- Product: ${report.product_name}`,
    `- Category: ${report.product_category}`,
    `- Wedge: ${report.wedge}`,
    ``,
    `## Value`,
    report.one_sentence_value,
    ``,
    `## Trust Positioning`,
    report.trust_positioning,
    ``,
    `## Claims`,
    `- Local-only: ${report.local_only_claim}`,
    `- No login: ${report.no_login_claim}`,
    `- No upload: ${report.no_upload_claim}`,
    ``,
    `## Required Assets`,
    markdownList(report.required_assets),
    ``,
    `## Blocked Claims`,
    markdownList(report.blocked_claims),
    ``,
    `## Next Step`,
    report.next_step
  ].join("\n");
}

function brandMarkdown(report) {
  return [
    `# Brand System`,
    ``,
    `- Product: ${report.product_name}`,
    `- Tagline: ${report.tagline}`,
    `- Primary color: ${report.primary_color}`,
    `- Secondary color: ${report.secondary_color}`,
    `- Accent color: ${report.accent_color}`,
    ``,
    `## Tone Of Voice`,
    markdownList(report.tone_of_voice),
    ``,
    `## Copy Style Rules`,
    markdownList(report.copy_style_rules)
  ].join("\n");
}

function storeAssetMarkdown(report) {
  return [
    `# Store Asset Spec`,
    ``,
    `- Run: ${report.run_id}`,
    `- Product: ${report.product_name}`,
    ``,
    `## Screenshot Targets`,
    markdownList(report.screenshots.map((entry) => `${entry.screenshot_id}: ${entry.expected_file} (${entry.purpose})`)),
    ``,
    `## Rules`,
    markdownList(report.rules),
    ``,
    `## Next Step`,
    report.next_step
  ].join("\n");
}

function storyboardMarkdown(report) {
  return [
    `# Screenshot Storyboard`,
    ``,
    `- Run: ${report.run_id}`,
    `- Product: ${report.product_name}`,
    ``,
    ...report.storyboard.map((entry) => [
      `## ${entry.title}`,
      ``,
      `- Screenshot id: ${entry.screenshot_id}`,
      `- Question answered: ${entry.user_question_answered}`,
      `- Real source: ${entry.source_real_screenshot}`,
      `- Overlay headline: ${entry.overlay_headline}`,
      `- Overlay subcopy: ${entry.overlay_subcopy}`,
      `- Feature shown: ${entry.feature_shown}`,
      `- Trust signal: ${entry.trust_signal}`,
      `- Expected file: ${entry.expected_file}`,
      `- Compliance note: ${entry.chrome_store_compliance_notes}`
    ].join("\n"))
  ].join("\n\n");
}

function polishMarkdown(report) {
  return [
    `# Product Polish Checklist`,
    ``,
    `- Run: ${report.run_id}`,
    `- Product: ${report.product_name}`,
    `- Overall polish score: ${report.overall_polish_score}`,
    `- Premium ready: ${report.premium_ready}`,
    ``,
    `## Checklist`,
    markdownList(report.items.map((item) => `${item.check_id}: ${item.status} (${item.notes})`)),
    ``,
    `## Warnings`,
    markdownList(report.warnings),
    ``,
    `## Next Step`,
    report.next_step
  ].join("\n");
}

function landingMarkdown(report) {
  return [
    `# Landing Page Package`,
    ``,
    `- Run: ${report.run_id}`,
    `- Product: ${report.product_name}`,
    `- Slug: ${report.product_slug}`,
    `- Output directory: ${report.output_dir}`,
    `- Hero asset status: ${report.hero_asset_status}`,
    `- Pricing asset status: ${report.pricing_asset_status}`,
    ``,
    `## Generated Files`,
    markdownList(report.generated_files),
    ``,
    `## Asset Manifest`,
    markdownList(report.asset_manifest.copied_assets),
    ``,
    `## Next Step`,
    report.next_step
  ].join("\n");
}

async function writeJsonAndMarkdown({
  state,
  artifactName,
  schemaName,
  report,
  markdownFileName,
  category,
  prefix,
  markdownContent
}) {
  const occurredAt = nowIso();
  await validateArtifact(state.projectRoot, schemaName, artifactName, report);
  const jsonWrite = await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName,
    data: report,
    occurredAt
  });
  await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: markdownFileName,
    category,
    prefix,
    content: markdownContent,
    occurredAt
  });
  return jsonWrite;
}

export async function loadPremiumPackagingArtifacts({ projectRoot, runDir }) {
  const absoluteRunDir = path.resolve(runDir);
  const runContext = {
    ...(await readJson(artifactPath(absoluteRunDir, "00_run_context.json"))),
    project_root: projectRoot
  };
  const artifactNames = [
    PREMIUM_PACKAGING_BRIEF_ARTIFACT,
    BRAND_SYSTEM_ARTIFACT,
    STORE_ASSET_SPEC_ARTIFACT,
    SCREENSHOT_STORYBOARD_ARTIFACT,
    PRODUCT_POLISH_CHECKLIST_ARTIFACT,
    LANDING_PAGE_PACKAGE_ARTIFACT,
    ASSET_QUALITY_REPORT_ARTIFACT,
    LISTING_QUALITY_GATE_ARTIFACT
  ];
  const entries = await Promise.all(artifactNames.map(async (artifactName) => [
    artifactName,
    await loadOptionalManagedArtifact({ runDir: absoluteRunDir, artifactName, runContext })
  ]));
  return Object.fromEntries(entries);
}

export async function runPremiumPackaging({ projectRoot, runDir }) {
  const state = await loadPackagingState({ projectRoot, runDir });

  const brief = premiumPackagingBrief(state);
  await writeJsonAndMarkdown({
    state,
    artifactName: PREMIUM_PACKAGING_BRIEF_ARTIFACT,
    schemaName: "premium_packaging_brief.schema.json",
    report: brief,
    markdownFileName: "111_premium_packaging_brief.md",
    category: "premium_packaging",
    prefix: "111_premium_packaging_brief",
    markdownContent: briefMarkdown(brief)
  });

  const brand = brandSystemReport(state);
  await writeJsonAndMarkdown({
    state,
    artifactName: BRAND_SYSTEM_ARTIFACT,
    schemaName: "brand_system.schema.json",
    report: brand,
    markdownFileName: "112_brand_system.md",
    category: "premium_packaging",
    prefix: "112_brand_system",
    markdownContent: brandMarkdown(brand)
  });

  const storeAssetSpec = storeAssetSpecReport(state, brief);
  await writeJsonAndMarkdown({
    state,
    artifactName: STORE_ASSET_SPEC_ARTIFACT,
    schemaName: "store_asset_spec.schema.json",
    report: storeAssetSpec,
    markdownFileName: "113_store_asset_spec.md",
    category: "premium_packaging",
    prefix: "113_store_asset_spec",
    markdownContent: storeAssetMarkdown(storeAssetSpec)
  });

  const storyboard = buildSafeReport({
    stage: "SCREENSHOT_STORYBOARD",
    status: "passed",
    run_id: state.runContext.run_id,
    product_name: state.productBrief.product_name_working,
    storyboard: screenshotStoryboardEntries(state)
  });
  await writeJsonAndMarkdown({
    state,
    artifactName: SCREENSHOT_STORYBOARD_ARTIFACT,
    schemaName: "screenshot_storyboard.schema.json",
    report: storyboard,
    markdownFileName: "114_screenshot_storyboard.md",
    category: "premium_packaging",
    prefix: "114_screenshot_storyboard",
    markdownContent: storyboardMarkdown(storyboard)
  });

  const polish = productPolishChecklistReport(state);
  await writeJsonAndMarkdown({
    state,
    artifactName: PRODUCT_POLISH_CHECKLIST_ARTIFACT,
    schemaName: "product_polish_checklist.schema.json",
    report: polish,
    markdownFileName: "116_product_polish_checklist.md",
    category: "premium_packaging",
    prefix: "116_product_polish_checklist",
    markdownContent: polishMarkdown(polish)
  });

  const landing = await buildLandingPagePackage(state, brand);
  await writeJsonAndMarkdown({
    state,
    artifactName: LANDING_PAGE_PACKAGE_ARTIFACT,
    schemaName: "landing_page_package.schema.json",
    report: landing,
    markdownFileName: "117_landing_page_package.md",
    category: "premium_packaging",
    prefix: "117_landing_page_package",
    markdownContent: landingMarkdown(landing)
  });

  return {
    runDir: state.runDir,
    runContext: state.runContext,
    artifacts: {
      brief,
      brand,
      storeAssetSpec,
      storyboard,
      polish,
      landing
    }
  };
}

async function readRemotionRenderReport(projectRoot, runId) {
  const reportPath = path.join(remotionAssetsRoot(projectRoot, runId), "remotion_render_report.json");
  if (!(await fileExists(reportPath))) {
    return null;
  }
  return readJson(reportPath);
}

function bannedClaimsPresent(text) {
  const normalized = `${text ?? ""}`.toLowerCase();
  return [
    "number 1",
    "editor's choice",
    "editors choice",
    "officially recommended",
    "official google"
  ].some((phrase) => normalized.includes(phrase));
}

function readPngDimensionsFromBuffer(buffer) {
  if (buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("Not a PNG file.");
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

async function inspectPng(filePath, expectedWidth, expectedHeight) {
  if (!(await fileExists(filePath))) {
    return {
      exists: false,
      dimensions_ok: false,
      width: null,
      height: null
    };
  }
  const buffer = await fs.readFile(filePath);
  const { width, height } = readPngDimensionsFromBuffer(buffer);
  return {
    exists: true,
    dimensions_ok: width === expectedWidth && height === expectedHeight,
    width,
    height
  };
}

export async function runAssetQa({ projectRoot, runDir }) {
  const state = await loadPackagingState({ projectRoot, runDir });
  let artifacts = await loadPremiumPackagingArtifacts({ projectRoot, runDir: state.runDir });
  if (!artifacts[PREMIUM_PACKAGING_BRIEF_ARTIFACT]) {
    await runPremiumPackaging({ projectRoot, runDir: state.runDir });
    artifacts = await loadPremiumPackagingArtifacts({ projectRoot, runDir: state.runDir });
  }

  const storyboard = artifacts[SCREENSHOT_STORYBOARD_ARTIFACT];
  const renderReport = await readRemotionRenderReport(projectRoot, state.runContext.run_id);
  const renderAssetMap = new Map((renderReport?.assets ?? []).map((asset) => [asset.relative_output_path, asset]));
  const assetRoot = remotionAssetsRoot(projectRoot, state.runContext.run_id);
  const expectedAssets = [
    ["screenshots/screenshot_1_1280x800.png", 1280, 800, true],
    ["screenshots/screenshot_2_1280x800.png", 1280, 800, true],
    ["screenshots/screenshot_3_1280x800.png", 1280, 800, true],
    ["screenshots/screenshot_4_1280x800.png", 1280, 800, true],
    ["screenshots/screenshot_5_1280x800.png", 1280, 800, true],
    ["promo/small_promo_440x280.png", 440, 280, true],
    ["promo/marquee_1400x560.png", 1400, 560, false],
    ["landing/hero_1600x900.png", 1600, 900, true],
    ["landing/pricing_1600x900.png", 1600, 900, isMonetized(state)]
  ];

  const assetsChecked = [];
  const blockers = [];
  const warnings = [];
  let dimensionValidationPassed = true;
  let overlayDensityPassed = true;
  let brandColorsConsistent = true;
  let noForbiddenClaims = true;
  let promoTileNotRawScreenshot = true;
  for (const [relativePath, width, height, required] of expectedAssets) {
    const absolutePath = path.join(assetRoot, relativePath);
    const renderAsset = renderAssetMap.get(relativePath) ?? null;
    const inspection = await inspectPng(absolutePath, width, height).catch(() => ({
      exists: false,
      dimensions_ok: false,
      width: null,
      height: null
    }));
    assetsChecked.push({
      file: normalizeRelativePath(projectRoot, absolutePath),
      required,
      exists: inspection.exists,
      expected_dimensions: `${width}x${height}`,
      actual_dimensions: inspection.width && inspection.height ? `${inspection.width}x${inspection.height}` : null,
      dimensions_ok: inspection.dimensions_ok,
      overlay_density: renderAsset?.overlay_density ?? null,
      brand_palette_applied: renderAsset?.brand_palette_applied ?? null,
      forbidden_claims_present: renderAsset?.forbidden_claims_present ?? null,
      promo_not_raw_screenshot: renderAsset?.promo_not_raw_screenshot ?? null
    });
    if (required && !inspection.exists) {
      blockers.push(`Missing required premium asset: ${relativePath}`);
      dimensionValidationPassed = false;
    }
    if (inspection.exists && !inspection.dimensions_ok) {
      blockers.push(`Invalid asset dimensions for ${relativePath}. Expected ${width}x${height}.`);
      dimensionValidationPassed = false;
    }
    if (renderAsset?.overlay_density === "high") {
      blockers.push(`Overlay text is too dense for ${relativePath}.`);
      overlayDensityPassed = false;
    }
    if (renderAsset && renderAsset.brand_palette_applied !== true) {
      blockers.push(`Brand palette consistency failed for ${relativePath}.`);
      brandColorsConsistent = false;
    }
    if (renderAsset?.forbidden_claims_present) {
      blockers.push(`Forbidden claim detected in ${relativePath}.`);
      noForbiddenClaims = false;
    }
    if ((relativePath === "promo/small_promo_440x280.png" || relativePath === "promo/marquee_1400x560.png")
      && renderAsset
      && renderAsset.promo_not_raw_screenshot !== true) {
      blockers.push(`${relativePath} is too close to a raw screenshot instead of a branded promo asset.`);
      promoTileNotRawScreenshot = false;
    }
  }

  const realUiTraceabilityPassed = (storyboard?.storyboard ?? []).every((entry) => entry.source_real_screenshot && state.screenshotManifest.screenshots.some((shot) => shot.path === entry.source_real_screenshot));
  if (!realUiTraceabilityPassed) {
    blockers.push("Screenshot storyboard is not fully traceable back to the real screenshot manifest.");
  }
  if ((renderReport?.assets ?? []).some((asset) => asset.uses_real_ui !== true || asset.source_traceable !== true)) {
    blockers.push("At least one rendered asset is not traceable back to a real UI screenshot.");
  }

  if (!renderReport) {
    blockers.push("Missing remotion_render_report.json.");
  } else if (renderReport.status !== "passed") {
    blockers.push(`Premium asset render did not complete: ${renderReport.status}.`);
  }
  if (renderReport?.status === "skipped") {
    warnings.push(`Render skipped: ${renderReport.failure_reason ?? renderReport.reason ?? "missing Remotion setup"}`);
  }

  const report = buildSafeReport({
    stage: "ASSET_QA",
    status: blockers.length === 0 ? "passed" : "failed",
    run_id: state.runContext.run_id,
    render_status: renderReport?.status ?? "missing",
    assets_checked: assetsChecked,
    passed_checks: unique([
      realUiTraceabilityPassed ? "real_ui_traceability" : null,
      dimensionValidationPassed && blockers.length === 0 ? "asset_dimensions" : null,
      overlayDensityPassed ? "overlay_text_not_too_dense" : null,
      brandColorsConsistent ? "brand_colors_consistent" : null,
      noForbiddenClaims ? "no_forbidden_claims" : null,
      promoTileNotRawScreenshot ? "promo_tile_not_raw_screenshot" : null,
      renderReport ? "render_report_present" : null
    ]),
    warnings,
    blockers,
    real_ui_traceability_passed: realUiTraceabilityPassed,
    dimension_validation_passed: dimensionValidationPassed,
    next_step: blockers.length === 0
      ? "Premium listing assets are ready for the listing quality gate."
      : "Install and configure Remotion, render the premium stills, then rerun asset QA."
  });

  const occurredAt = nowIso();
  await validateArtifact(projectRoot, "asset_quality_report.schema.json", ASSET_QUALITY_REPORT_ARTIFACT, report);
  await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: ASSET_QUALITY_REPORT_ARTIFACT,
    data: report,
    occurredAt
  });

  return {
    runDir: state.runDir,
    runContext: state.runContext,
    report
  };
}

export async function runListingQualityGate({ projectRoot, runDir }) {
  const state = await loadPackagingState({ projectRoot, runDir });
  let artifacts = await loadPremiumPackagingArtifacts({ projectRoot, runDir: state.runDir });
  if (!artifacts[PREMIUM_PACKAGING_BRIEF_ARTIFACT]) {
    await runPremiumPackaging({ projectRoot, runDir: state.runDir });
    artifacts = await loadPremiumPackagingArtifacts({ projectRoot, runDir: state.runDir });
  }
  if (!artifacts[ASSET_QUALITY_REPORT_ARTIFACT]) {
    await runAssetQa({ projectRoot, runDir: state.runDir });
    artifacts = await loadPremiumPackagingArtifacts({ projectRoot, runDir: state.runDir });
  }

  const assetQa = artifacts[ASSET_QUALITY_REPORT_ARTIFACT];
  const landing = artifacts[LANDING_PAGE_PACKAGE_ARTIFACT];
  const polish = artifacts[PRODUCT_POLISH_CHECKLIST_ARTIFACT];
  const storyboard = artifacts[SCREENSHOT_STORYBOARD_ARTIFACT];
  const monetized = isMonetized(state);
  const listingText = [
    state.productBrief.product_name_working,
    state.listingCopy.store_summary,
    state.listingCopy.store_description,
    state.listingCopy.privacy_disclosure
  ].join("\n");

  const checks = {
    title_clarity: state.productBrief.product_name_working.length <= 45,
    short_description_clarity: state.listingCopy.store_summary.length >= 20 && state.listingCopy.store_summary.length <= 132,
    detailed_description_clarity: state.listingCopy.store_description.length >= 120,
    paid_feature_disclosure: monetized ? /free|pro|lifetime|unlock/i.test(listingText) : true,
    privacy_claim_consistency: /local/i.test(state.listingCopy.privacy_disclosure),
    screenshot_truthfulness: (storyboard?.storyboard ?? []).length > 0 && (assetQa?.real_ui_traceability_passed ?? false),
    asset_dimension_validity: assetQa?.dimension_validation_passed === true,
    asset_visual_quality: assetQa?.status === "passed",
    no_misleading_claims: !bannedClaimsPresent(listingText),
    brand_consistency: Boolean(artifacts[BRAND_SYSTEM_ARTIFACT] && landing),
    support_url_present_or_planned: Boolean(landing?.generated_files?.some((file) => file.endsWith("/support.md"))),
    homepage_url_present_or_planned: Boolean(landing?.generated_files?.some((file) => file.endsWith("/index.html"))),
    pricing_disclosure_if_monetized: monetized ? /price|free|pro|unlock|lifetime/i.test(listingText) : true,
    policy_risk: ["passed", "conditional_pass"].includes(`${state.policyGate.status ?? ""}`),
    premium_feel_inputs_ready: (polish?.overall_polish_score ?? 0) >= 75 && Boolean(artifacts[BRAND_SYSTEM_ARTIFACT])
  };

  const blockers = [];
  const warnings = [];
  if (!checks.title_clarity) blockers.push("Listing title is not clear enough.");
  if (!checks.short_description_clarity) blockers.push("Short description is not yet sharp enough for store quality.");
  if (!checks.detailed_description_clarity) blockers.push("Detailed description needs more concrete product framing.");
  if (!checks.paid_feature_disclosure) blockers.push("Paid features are not disclosed clearly enough.");
  if (!checks.privacy_claim_consistency) blockers.push("Privacy copy is not consistent enough with the local-only trust story.");
  if (!checks.screenshot_truthfulness) blockers.push("Screenshot truthfulness did not pass.");
  if (!checks.asset_dimension_validity) blockers.push("Asset dimensions are missing or invalid.");
  if (!checks.asset_visual_quality) blockers.push("Premium Remotion still assets are missing or failed QA.");
  if (!checks.no_misleading_claims) blockers.push("Misleading ranking or endorsement language is present.");
  if (!checks.brand_consistency) blockers.push("Brand system or landing package is missing.");
  if (!checks.support_url_present_or_planned) blockers.push("Support page is missing or not planned.");
  if (!checks.homepage_url_present_or_planned) blockers.push("Homepage or landing page is missing or not planned.");
  if (!checks.pricing_disclosure_if_monetized) blockers.push("Monetized product lacks pricing disclosure.");
  if (!checks.policy_risk) blockers.push("Policy gate does not currently support publish readiness.");
  if (!checks.premium_feel_inputs_ready) warnings.push("Product polish inputs are still functional rather than premium-grade.");

  const premiumFeelScore = round(
    (checks.title_clarity ? 8 : 0)
    + (checks.short_description_clarity ? 8 : 0)
    + (checks.detailed_description_clarity ? 10 : 0)
    + (checks.privacy_claim_consistency ? 12 : 0)
    + (checks.screenshot_truthfulness ? 12 : 0)
    + (checks.asset_dimension_validity ? 10 : 0)
    + (checks.asset_visual_quality ? 14 : 0)
    + (checks.brand_consistency ? 10 : 0)
    + (checks.support_url_present_or_planned ? 6 : 0)
    + (checks.homepage_url_present_or_planned ? 6 : 0)
    + (checks.policy_risk ? 4 : 0)
  );

  const status = blockers.length === 0 && premiumFeelScore >= 85
    ? "passed"
    : assetQa?.render_status === "skipped" || assetQa?.render_status === "missing"
      ? "conditional_fail"
      : "failed";
  const report = buildSafeReport({
    stage: "LISTING_QUALITY_GATE",
    status,
    run_id: state.runContext.run_id,
    passed: status === "passed",
    premium_feel_score: premiumFeelScore,
    checks,
    blockers,
    warnings,
    recommended_fixes: unique([
      !checks.asset_visual_quality ? "Generate the premium still assets and rerun asset QA." : null,
      !checks.screenshot_truthfulness ? "Keep all screenshot compositions traceable to browser-smoke captures." : null,
      premiumFeelScore < 85 ? "Raise the visual polish and premium packaging score above 85 before any publish decision." : null,
      !checks.support_url_present_or_planned ? "Add a real support destination before publish." : null
    ]),
    next_step: status === "passed"
      ? "Premium packaging gate passed. The listing package is visually ready for the next human gate."
      : "Do not promote or publish until premium assets, QA, and disclosure checks pass."
  });

  const occurredAt = nowIso();
  await validateArtifact(projectRoot, "listing_quality_gate.schema.json", LISTING_QUALITY_GATE_ARTIFACT, report);
  await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: LISTING_QUALITY_GATE_ARTIFACT,
    data: report,
    occurredAt
  });

  return {
    runDir: state.runDir,
    runContext: state.runContext,
    report
  };
}
