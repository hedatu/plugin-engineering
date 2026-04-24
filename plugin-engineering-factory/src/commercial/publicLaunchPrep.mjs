import path from "node:path";
import {
  buildSafeReport,
  validateArtifact,
  writeManagedJsonArtifact,
  writeManagedMarkdownArtifact
} from "../review/helpers.mjs";
import { fileExists, nowIso, readJson } from "../utils/io.mjs";
import { loadManagedRunArtifact } from "../workflow/runEventArtifacts.mjs";
import { generatePremiumWebRedesign, loadProductRunState } from "../site/pluginPages.mjs";
import { getProductByKey, loadProductCatalog } from "../../packages/product-catalog/index.mjs";

export const HUMAN_VISUAL_REVIEW_CHECKLIST_MARKDOWN = "146_human_visual_review_checklist.md";
export const PRODUCTION_PAYMENT_READINESS_MARKDOWN = "147_production_payment_readiness.md";
export const COMMERCIAL_RESUBMISSION_PACKAGE_MARKDOWN = "148_commercial_resubmission_package.md";
export const NEXT_ACTION_DECISION_NOTE_MARKDOWN = "150_next_action_decision_note.md";

async function loadManagedJson(runDir, runContext, artifactName) {
  return (await loadManagedRunArtifact({
    runDir,
    runContext,
    artifactName
  }))?.data ?? null;
}

async function resolveProductForRun(projectRoot, runId, productKey = null) {
  const catalog = await loadProductCatalog(projectRoot);
  if (productKey) {
    const product = getProductByKey(catalog, productKey);
    if (!product) {
      throw new Error(`Product not found in catalog: ${productKey}`);
    }
    return product;
  }

  const product = (catalog.products ?? []).find((item) => item.releaseRunId === runId);
  if (!product) {
    throw new Error(`No product catalog entry references run ${runId}.`);
  }
  return product;
}

function listMarkdown(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

function truthyStatus(value, expected = "passed") {
  return `${value ?? ""}` === expected;
}

function resolveSitePaymentGateLaunchReadiness(sitePaymentGate) {
  const blockers = sitePaymentGate?.blockers ?? [];
  const nonLaunchBlockers = blockers.filter((blocker) =>
    !["production_payment_not_verified", "user_launch_approval_missing"].includes(blocker)
  );

  return nonLaunchBlockers.length === 0
    && sitePaymentGate?.payment_copy_truthful === true
    && sitePaymentGate?.no_secret_in_site_config === true
    && sitePaymentGate?.no_secret_in_extension === true
    && sitePaymentGate?.plugin_detail_page_generated === true
    && sitePaymentGate?.pricing_page_generated === true;
}

function buildHumanVisualReviewChecklistMarkdown({
  projectRoot,
  runId,
  packageRoot,
  storePackageReportPath,
  redesignPlanPath,
  visualConsistencyPath,
  productSlug,
  localizedPages
}) {
  const englishRoot = path.join(projectRoot, "generated", "plugin-pages", productSlug, "index.html");
  const reviewFiles = [
    path.join(packageRoot, "asset_gallery.html"),
    path.join(packageRoot, "dashboard_upload_checklist.md"),
    path.join(packageRoot, "store_listing_submission.md"),
    storePackageReportPath,
    redesignPlanPath,
    visualConsistencyPath,
    englishRoot,
    ...localizedPages
  ].filter(Boolean);

  return `# Human Visual Review Checklist

Run: ${runId}

Do not record \`passed\` automatically. Open these files first:

${listMarkdown(reviewFiles)}

## Store Package Review

- [ ] The first screen is clear and looks intentional.
- [ ] The $19 lifetime price is obvious.
- [ ] The 10 free fills message is obvious.
- [ ] Local-only / no upload / no cloud sync is obvious.
- [ ] The page looks premium, tidy, and trustworthy.
- [ ] The listing assets match the actual product and do not invent features.
- [ ] Payment and membership wording stays truthful and does not imply production payment is already enabled.

## Website Review

- [ ] The English default page is the clearest version.
- [ ] The checkout guide still explains that successUrl does not unlock locally.
- [ ] The webhook remains the only entitlement-active source of truth in the copy.
- [ ] The site still feels like a maintained commercial product, not a rough internal dashboard.

## Multilingual Spot Check

- [ ] zh-cn page keeps the same structure and premium tone.
- [ ] ja page keeps the same structure and premium tone.
- [ ] es page keeps the same structure and premium tone.
- [ ] No localized page introduces a false claim, hidden feature, or production-payment promise.

## Decision

If the review looks good, then run:

\`\`\`powershell
npm run packaging:record-human-visual-review -- --run runs/${runId} --decision passed --note "<note>"
\`\`\`
`;
}

function buildProductionPaymentReadiness({
  runContext,
  product,
  paymentCandidate
}) {
  const completedItems = [
    "OTP verified",
    "source=chrome_extension verified",
    "test payment verified",
    "webhook verified",
    "entitlement active verified",
    "Pro usage verified"
  ];
  const missingItems = [
    "production payment not verified",
    "public launch approval missing",
    "live checkout mode",
    "live Waffo product and price mapping",
    "live webhook verification",
    "live refund and revoke behavior",
    "support email final",
    "payment disclosure final review"
  ];
  const recommendedOrder = [
    "Complete human visual review on the current test-mode package.",
    "Prepare live checkout configuration without enabling it yet.",
    "Map live Waffo product, price, and webhook target.",
    "Run a controlled live payment verification and confirm refund and revoke behavior.",
    "Finalize payment disclosure and support email copy.",
    "Request public launch approval after live payment is verified."
  ];

  return buildSafeReport({
    stage: "PRODUCTION_PAYMENT_READINESS",
    status: "blocked",
    run_id: runContext.run_id,
    product_key: product.productKey,
    generated_at: nowIso(),
    current_payment_mode: paymentCandidate?.payment_mode ?? product.checkoutMode ?? "test",
    production_payment_ready: false,
    completed_items: completedItems,
    missing_items: missingItems,
    recommended_order: recommendedOrder,
    blockers: [
      "production_payment_not_verified",
      "user_public_launch_approval_missing"
    ],
    next_step: "complete_human_visual_review_then_prepare_live_payment_configuration"
  });
}

function buildProductionPaymentReadinessMarkdown(report) {
  return `# Production Payment Readiness

Run: ${report.run_id}
Product: ${report.product_key}
Current payment mode: ${report.current_payment_mode}
production_payment_ready: ${report.production_payment_ready}

## Already Completed

${listMarkdown(report.completed_items)}

## Still Missing

${listMarkdown(report.missing_items)}

## Recommended Order

${listMarkdown(report.recommended_order)}

## Next Step

${report.next_step}
`;
}

function buildCommercialResubmissionPackage({
  runContext,
  product,
  storePackageReport,
  paymentCandidate,
  productionPaymentReadiness,
  humanVisualReview,
  visualConsistency
}) {
  const visualReviewPassed = humanVisualReview?.decision === "passed";
  const productionPaymentStrategyClear = Array.isArray(productionPaymentReadiness?.recommended_order)
    && productionPaymentReadiness.recommended_order.length > 0;
  const reReviewReadiness = visualReviewPassed && productionPaymentStrategyClear;

  return buildSafeReport({
    stage: "COMMERCIAL_RESUBMISSION_PACKAGE",
    status: reReviewReadiness ? "passed" : "pending",
    run_id: runContext.run_id,
    product_name: product.name,
    package_version: product.version,
    current_run_id: runContext.run_id,
    store_listing_release_package_path: storePackageReport?.package_root ?? null,
    premium_assets_path: product.remotionAssetsPath ?? null,
    payment_integration_status: paymentCandidate?.payment_e2e_status ?? product.paymentE2EStatus,
    test_mode_status: paymentCandidate?.payment_mode === "test" ? "verified_test_mode" : "not_test_mode",
    visual_review_status: visualReviewPassed ? "passed" : "pending",
    monetization_disclosure_status: storePackageReport?.paid_disclosure_status ?? "unknown",
    privacy_disclosure_status: storePackageReport?.privacy_claim_consistency === true ? "passed" : "review_required",
    multilingual_site_status: visualConsistency?.supported_locales ? "generated" : "not_generated",
    supported_locales: visualConsistency?.supported_locales ?? ["en"],
    production_payment_strategy_clear: productionPaymentStrategyClear,
    re_review_readiness: reReviewReadiness,
    blockers: [
      ...(visualReviewPassed ? [] : ["human_visual_review_pending"]),
      "production_payment_not_verified",
      "user_public_launch_approval_missing"
    ],
    next_step: visualReviewPassed
      ? "prepare_controlled_live_payment_verification"
      : "complete_human_visual_review"
  });
}

function buildCommercialResubmissionMarkdown(report) {
  return `# Commercial Resubmission Package

Product: ${report.product_name}
Version: ${report.package_version}
Run: ${report.current_run_id}

## Paths

- Store listing release package: ${report.store_listing_release_package_path}
- Premium assets: ${report.premium_assets_path}

## Status

- Payment integration: ${report.payment_integration_status}
- Test mode: ${report.test_mode_status}
- Visual review: ${report.visual_review_status}
- Monetization disclosure: ${report.monetization_disclosure_status}
- Privacy disclosure: ${report.privacy_disclosure_status}
- Multilingual site: ${report.multilingual_site_status}
- Re-review readiness: ${report.re_review_readiness}

## Blockers

${listMarkdown(report.blockers)}

## Next Step

${report.next_step}
`;
}

function buildPublicLaunchGate({
  runContext,
  product,
  productAcceptance,
  functionalMatrix,
  premiumPackaging,
  assetQuality,
  listingQuality,
  sitePaymentGate,
  monetizationSecurityScan,
  storePackageReport,
  humanVisualReview
}) {
  const humanVisualReviewPassed = humanVisualReview?.decision === "passed";
  const productAcceptancePassed = productAcceptance?.acceptance_status === "passed";
  const functionalScore = functionalMatrix?.test_coverage_score ?? null;
  const premiumPackagingPassed = truthyStatus(premiumPackaging?.status);
  const assetQaPassed = truthyStatus(assetQuality?.status);
  const listingQualityPassed = listingQuality?.passed === true;
  const sitePaymentGatePassed = resolveSitePaymentGateLaunchReadiness(sitePaymentGate);
  const productionPaymentVerified = sitePaymentGate?.production_payment_status === "verified";
  const monetizationSecurityScanPassed = truthyStatus(monetizationSecurityScan?.status);
  const disclosureChecksPassed = storePackageReport?.paid_disclosure_status === "passed"
    && storePackageReport?.privacy_claim_consistency === true;
  const userPublicLaunchApprovalPresent = runContext.user_public_launch_approval_present === true;
  const blockers = [
    ...(humanVisualReviewPassed ? [] : ["human_visual_review_pending"]),
    ...(productAcceptancePassed ? [] : ["product_acceptance_not_passed"]),
    ...(functionalScore === 100 ? [] : ["functional_test_coverage_not_100"]),
    ...(premiumPackagingPassed ? [] : ["premium_packaging_not_passed"]),
    ...(assetQaPassed ? [] : ["asset_qa_not_passed"]),
    ...(listingQualityPassed ? [] : ["listing_quality_gate_not_passed"]),
    ...(sitePaymentGatePassed ? [] : ["site_payment_gate_not_passed"]),
    ...(productionPaymentVerified ? [] : ["production_payment_not_verified"]),
    ...(monetizationSecurityScanPassed ? [] : ["monetization_security_scan_not_passed"]),
    ...(disclosureChecksPassed ? [] : ["disclosure_checks_not_passed"]),
    ...(userPublicLaunchApprovalPresent ? [] : ["user_public_launch_approval_missing"])
  ];

  return buildSafeReport({
    stage: "PUBLIC_LAUNCH_GATE",
    status: blockers.length === 0 ? "passed" : "blocked",
    run_id: runContext.run_id,
    product_key: product.productKey,
    checked_at: nowIso(),
    human_visual_review_passed: humanVisualReviewPassed,
    product_acceptance_passed: productAcceptancePassed,
    functional_test_coverage_score: functionalScore,
    premium_packaging_passed: premiumPackagingPassed,
    asset_qa_passed: assetQaPassed,
    listing_quality_gate_passed: listingQualityPassed,
    site_payment_gate_passed: sitePaymentGatePassed,
    production_payment_verified: productionPaymentVerified,
    monetization_security_scan_passed: monetizationSecurityScanPassed,
    disclosure_checks_passed: disclosureChecksPassed,
    user_public_launch_approval_present: userPublicLaunchApprovalPresent,
    public_launch_allowed: blockers.length === 0,
    blockers,
    warnings: [
      "localized_copy_needs_human_language_review",
      "production_payment_still_test_mode_internal_only"
    ],
    recommended_next_step: !humanVisualReviewPassed
      ? "complete_human_visual_review"
      : (!productionPaymentVerified
        ? "verify_production_payment_in_controlled_mode"
        : "request_public_launch_approval")
  });
}

function buildNextActionDecisionMarkdown(runId) {
  return `# Next Action Decision Note

Run: ${runId}

## A. Do human visual review first

Recommended first. The package is already polished, the web redesign is complete, and the next useful human gate is visual truthfulness and premium feel.

## B. Configure production payment next

Recommended second. After visual review, prepare live checkout mapping and webhook verification without uploading or publishing yet.

## C. Re-submit now

Not allowed. Human visual review is still pending, and production payment is not verified.

## D. Stay test-mode internal only

Safe fallback if you want to pause. This keeps the current candidate stable while blocking any public launch risk.

## Recommended Order

1. Human visual review
2. Production payment readiness and live config planning
3. Controlled production payment verification
4. Prepare the commercial re-review package
`;
}

export async function preparePublicLaunchPrep({ projectRoot, runDir, productKey = null }) {
  const absoluteRunDir = path.resolve(runDir);
  const runContext = await readJson(path.join(absoluteRunDir, "00_run_context.json"));
  const product = await resolveProductForRun(projectRoot, runContext.run_id, productKey);

  await generatePremiumWebRedesign({
    projectRoot,
    productKey: product.productKey
  });

  const state = await loadProductRunState(projectRoot, product);
  state.product = product;

  const storePackageReport = await loadManagedJson(absoluteRunDir, runContext, "120_store_listing_release_package_report.json");
  const packageRoot = storePackageReport?.package_root
    ? path.join(projectRoot, storePackageReport.package_root)
    : path.join(projectRoot, "state", "run_events", state.runContext.run_id, "120_store_listing_release_package");
  const paymentCandidate = await loadManagedJson(absoluteRunDir, runContext, "140_payment_configured_commercial_candidate.json");
  const sitePaymentGate = await loadManagedJson(absoluteRunDir, runContext, "138_plugin_site_payment_gate.json");
  const productAcceptance = await loadManagedJson(absoluteRunDir, runContext, "94_product_acceptance_review.json");
  const functionalMatrix = await loadManagedJson(absoluteRunDir, runContext, "62_functional_test_matrix.json");
  const monetizationSecurityScan = await loadManagedJson(absoluteRunDir, runContext, "110_monetization_security_scan.json");
  const premiumPackaging = await loadManagedJson(absoluteRunDir, runContext, "111_premium_packaging_brief.json");
  const assetQuality = await loadManagedJson(absoluteRunDir, runContext, "118_asset_quality_report.json");
  const listingQuality = await loadManagedJson(absoluteRunDir, runContext, "115_listing_quality_gate.json");
  const humanVisualReview = await loadManagedJson(absoluteRunDir, runContext, "121_human_visual_review.json");
  const visualConsistency = await loadManagedJson(absoluteRunDir, runContext, "145_site_visual_consistency_report.json");

  const productionPaymentReadiness = buildProductionPaymentReadiness({
    runContext,
    product,
    paymentCandidate
  });
  const commercialResubmissionPackage = buildCommercialResubmissionPackage({
    runContext,
    product,
    storePackageReport,
    paymentCandidate,
    productionPaymentReadiness,
    humanVisualReview,
    visualConsistency
  });
  const publicLaunchGate = buildPublicLaunchGate({
    runContext,
    product,
    productAcceptance,
    functionalMatrix,
    premiumPackaging,
    assetQuality,
    listingQuality,
    sitePaymentGate,
    monetizationSecurityScan,
    storePackageReport,
    humanVisualReview
  });

  await validateArtifact(projectRoot, "production_payment_readiness.schema.json", "147_production_payment_readiness.json", productionPaymentReadiness);
  await validateArtifact(projectRoot, "commercial_resubmission_package.schema.json", "148_commercial_resubmission_package.json", commercialResubmissionPackage);
  await validateArtifact(projectRoot, "public_launch_gate.schema.json", "149_public_launch_gate.json", publicLaunchGate);

  await writeManagedJsonArtifact({
    runDir: absoluteRunDir,
    runContext,
    artifactName: "147_production_payment_readiness.json",
    data: productionPaymentReadiness
  });
  await writeManagedJsonArtifact({
    runDir: absoluteRunDir,
    runContext,
    artifactName: "148_commercial_resubmission_package.json",
    data: commercialResubmissionPackage
  });
  await writeManagedJsonArtifact({
    runDir: absoluteRunDir,
    runContext,
    artifactName: "149_public_launch_gate.json",
    data: publicLaunchGate
  });

  const redesignPlanExists = await fileExists(path.join(projectRoot, "state", "run_events", runContext.run_id, "141_web_redesign_plan.md"));
  const visualChecklist = buildHumanVisualReviewChecklistMarkdown({
    projectRoot,
    runId: runContext.run_id,
    packageRoot,
    storePackageReportPath: path.join(projectRoot, "state", "run_events", runContext.run_id, "120_store_listing_release_package_report.json"),
    redesignPlanPath: redesignPlanExists ? path.join(projectRoot, "state", "run_events", runContext.run_id, "141_web_redesign_plan.md") : null,
    visualConsistencyPath: path.join(projectRoot, "state", "run_events", runContext.run_id, "145_site_visual_consistency_report.json"),
    productSlug: product.slug,
    localizedPages: [
      path.join(projectRoot, "generated", "plugin-pages", product.slug, "zh-cn", "index.html"),
      path.join(projectRoot, "generated", "plugin-pages", product.slug, "ja", "index.html"),
      path.join(projectRoot, "generated", "plugin-pages", product.slug, "es", "index.html")
    ]
  });

  await writeManagedMarkdownArtifact({
    runDir: absoluteRunDir,
    runContext,
    fileName: HUMAN_VISUAL_REVIEW_CHECKLIST_MARKDOWN,
    category: "visual_review",
    prefix: "146_human_visual_review_checklist",
    content: visualChecklist
  });
  await writeManagedMarkdownArtifact({
    runDir: absoluteRunDir,
    runContext,
    fileName: PRODUCTION_PAYMENT_READINESS_MARKDOWN,
    category: "commercial_release",
    prefix: "147_production_payment_readiness",
    content: buildProductionPaymentReadinessMarkdown(productionPaymentReadiness)
  });
  await writeManagedMarkdownArtifact({
    runDir: absoluteRunDir,
    runContext,
    fileName: COMMERCIAL_RESUBMISSION_PACKAGE_MARKDOWN,
    category: "commercial_release",
    prefix: "148_commercial_resubmission_package",
    content: buildCommercialResubmissionMarkdown(commercialResubmissionPackage)
  });
  await writeManagedMarkdownArtifact({
    runDir: absoluteRunDir,
    runContext,
    fileName: NEXT_ACTION_DECISION_NOTE_MARKDOWN,
    category: "commercial_release",
    prefix: "150_next_action_decision_note",
    content: buildNextActionDecisionMarkdown(runContext.run_id)
  });

  return {
    run_id: runContext.run_id,
    human_visual_review_passed: humanVisualReview?.decision === "passed",
    public_launch_allowed: publicLaunchGate.public_launch_allowed,
    blockers: publicLaunchGate.blockers,
    recommended_next_step: publicLaunchGate.recommended_next_step
  };
}
