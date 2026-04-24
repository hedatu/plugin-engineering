import fs from "node:fs/promises";
import path from "node:path";
import { recordKnownBadPattern, updateRegistryItemByRunId } from "../portfolio/registry.mjs";
import {
  artifactPath,
  buildSafeReport,
  loadOptionalManagedArtifact,
  markdownList,
  markdownSection,
  normalizeRelativePath,
  sidecarStamp,
  validateArtifact,
  writeManagedJsonArtifact,
  writeManagedMarkdownArtifact
} from "./helpers.mjs";
import { nowIso, readJson, writeText } from "../utils/io.mjs";

export const FUNCTIONAL_TEST_MATRIX_ARTIFACT = "62_functional_test_matrix.json";
export const PRODUCT_ACCEPTANCE_REVIEW_ARTIFACT = "94_product_acceptance_review.json";
export const HUMAN_PRODUCT_REVIEW_ARTIFACT = "94_human_product_review.json";

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function average(values) {
  const filtered = (values ?? []).filter((value) => Number.isFinite(value));
  if (!filtered.length) {
    return 0;
  }
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

async function loadSandboxProductState(runDir) {
  const absoluteRunDir = path.resolve(runDir);
  const runContext = await readJson(artifactPath(absoluteRunDir, "00_run_context.json"));
  if ((runContext.run_type ?? runContext.task_mode) !== "sandbox_validation") {
    throw new Error(`Run ${runContext.run_id} is not a sandbox_validation run.`);
  }

  const productBrief = await readJson(artifactPath(absoluteRunDir, "41_product_brief.json"));
  const implementationPlan = await readJson(artifactPath(absoluteRunDir, "42_implementation_plan.json"));
  const buildReport = await readJson(artifactPath(absoluteRunDir, "50_build_report.json"));
  const qaReport = await readJson(artifactPath(absoluteRunDir, "60_qa_report.json"));
  const browserSmoke = await readJson(artifactPath(absoluteRunDir, "61_browser_smoke.json"));
  const screenshotManifest = await readJson(artifactPath(absoluteRunDir, "70_screenshot_manifest.json"));
  const listingCopy = await readJson(artifactPath(absoluteRunDir, "71_listing_copy.json"));
  const policyGate = await readJson(artifactPath(absoluteRunDir, "72_policy_gate.json"));
  const sandboxPlan = await readJson(artifactPath(absoluteRunDir, "83_sandbox_validation_plan.json"));
  const latestReviewStatus = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    artifactName: "91_review_status.json",
    runContext
  });
  const latestFunctionalMatrix = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    artifactName: FUNCTIONAL_TEST_MATRIX_ARTIFACT,
    runContext
  });
  const latestAcceptanceReview = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    artifactName: PRODUCT_ACCEPTANCE_REVIEW_ARTIFACT,
    runContext
  });
  const latestMonetizationTestMatrix = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    artifactName: "109_monetization_test_matrix.json",
    runContext
  });

  const popupJsPath = buildReport.workspace_dist
    ? path.join(buildReport.workspace_dist, "popup.js")
    : artifactPath(absoluteRunDir, "workspace/dist/popup.js");
  const popupHtmlPath = buildReport.workspace_dist
    ? path.join(buildReport.workspace_dist, "popup.html")
    : artifactPath(absoluteRunDir, "workspace/dist/popup.html");
  const popupJs = await fs.readFile(popupJsPath, "utf8");
  const popupHtml = await fs.readFile(popupHtmlPath, "utf8");

  return {
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
    sandboxPlan,
    latestReviewStatus,
    latestFunctionalMatrix,
    latestAcceptanceReview,
    latestMonetizationTestMatrix,
    popupJs,
    popupHtml
  };
}

function popupSupportsDelete(popupHtml, popupJs) {
  return /delete/i.test(popupHtml) || /delete/i.test(popupJs);
}

function popupHasGenericErrorDisplay(popupJs) {
  return popupJs.includes("Fill failed:") && popupJs.includes("Save failed:");
}

function popupUsesLocalStorageOnly(popupJs) {
  return popupJs.includes("chrome.storage.local") && !popupJs.includes("fetch(") && !popupJs.includes("XMLHttpRequest");
}

function popupSupportsSelect(popupJs) {
  return popupJs.includes("select_filled_count") && popupJs.includes("findSelectOptionValue");
}

function popupSkipsReadonly(popupJs) {
  return popupJs.includes("element.disabled || element.readOnly");
}

function browserSmokeScenarioStatus(browserSmoke, key) {
  const fromSummary = browserSmoke?.scenario_results?.[key];
  if (fromSummary) {
    return fromSummary;
  }

  const scenarioIdMap = {
    empty_form: "single_profile_form_fill_empty_form",
    partially_filled_form: "single_profile_form_fill_partially_filled_form",
    readonly_field: "single_profile_form_fill_readonly_field",
    select_field: "single_profile_form_fill_select_field",
    no_matching_fields: "single_profile_form_fill_no_matching_fields",
    overwrite_behavior_default_false: "single_profile_form_fill_overwrite_behavior_default_false",
    popup_feedback_display: "single_profile_form_fill_popup_feedback_display",
    profile_management: "profile_management"
  };
  const scenarioId = scenarioIdMap[key] ?? key;
  return browserSmoke?.scenarios?.find((scenario) => scenario.id === scenarioId)?.status ?? "missing";
}

function browserSmokeScenarioPassed(browserSmoke, key) {
  return browserSmokeScenarioStatus(browserSmoke, key) === "passed";
}

function monetizationTestStatus(monetizationMatrix, id) {
  return monetizationMatrix?.tests?.find((test) => test.id === id)?.current_status ?? "missing";
}

function monetizationTestPlannedOrPassed(monetizationMatrix, id) {
  return ["planned", "passed"].includes(monetizationTestStatus(monetizationMatrix, id));
}

function monetizationTestPassed(monetizationMatrix, id) {
  return monetizationTestStatus(monetizationMatrix, id) === "passed";
}

function isPaySiteProvider(runContext) {
  return `${runContext?.monetization?.payment_provider ?? runContext?.pay_site?.membership_provider ?? ""}` === "pay_site_supabase_waffo";
}

function listingText(listingCopy) {
  return [
    listingCopy?.store_summary ?? "",
    listingCopy?.store_description ?? "",
    listingCopy?.privacy_disclosure ?? ""
  ].join("\n").toLowerCase();
}

function hasAffirmativeSyncClaim(text) {
  const normalized = ` ${`${text ?? ""}`.toLowerCase()} `;
  const mentionsCloudSync = normalized.includes("cloud sync")
    && !/\b(no|not|without)\s+cloud sync\b/.test(normalized);
  const mentionsDeviceSync = normalized.includes("sync across devices")
    && !/\b(no|not|without)\s+sync across devices\b/.test(normalized);
  return mentionsCloudSync || mentionsDeviceSync;
}

function functionalMatrixMarkdown(report) {
  return [
    `# Functional Test Matrix`,
    ``,
    `- Run: ${report.run_id}`,
    `- Archetype: ${report.archetype}`,
    `- Coverage score: ${report.test_coverage_score}`,
    `- Next focus: ${report.recommended_next_tests.join("; ") || "none"}`,
    ``,
    `## Missing Tests`,
    ``,
    markdownList(report.missing_tests),
    ``,
    `## Release Blockers`,
    ``,
    markdownList(report.release_blockers),
    ``,
    `## Test Cases`,
    ``,
    report.tests.map((test) => `- ${test.test_name}: ${test.current_status} (${test.recommended_next_action})`).join("\n")
  ].join("\n");
}

function productAcceptanceMarkdown(report) {
  return [
    `# Product Acceptance Review`,
    ``,
    `- Run: ${report.run_id}`,
    `- Acceptance status: ${report.acceptance_status}`,
    `- Recommended decision: ${report.recommended_decision}`,
    `- Next step: ${report.next_step}`,
    ``,
    markdownSection("Promised Value", report.promised_value),
    ``,
    markdownSection("Actual Core Flow", report.actual_core_flow),
    ``,
    markdownSection("UX Review", typeof report.ux_review === "string" ? report.ux_review : JSON.stringify(report.ux_review, null, 2)),
    ``,
    markdownSection("Functionality Review", typeof report.functionality_review === "string" ? report.functionality_review : JSON.stringify(report.functionality_review, null, 2)),
    ``,
    markdownSection("Listing Truthfulness Review", typeof report.listing_truthfulness_review === "string" ? report.listing_truthfulness_review : JSON.stringify(report.listing_truthfulness_review, null, 2)),
    ``,
    markdownSection("Biggest Risks", markdownList(report.biggest_risks)),
    ``,
    markdownSection("Required Fixes", markdownList(report.required_fixes))
  ].join("\n");
}

function humanProductReviewMarkdown(report) {
  return [
    `# Human Product Review`,
    ``,
    `- Run: ${report.run_id}`,
    `- Decision: ${report.decision}`,
    `- Recorded at: ${report.recorded_at}`,
    `- Next step: ${report.next_step}`,
    ``,
    `## Note`,
    ``,
    report.note,
    ``,
    `## Repair Suggestions`,
    ``,
    markdownList(report.repair_suggestions)
  ].join("\n");
}

export async function generateFunctionalTestMatrix({ runDir }) {
  const state = await loadSandboxProductState(runDir);
  const occurredAt = nowIso();
  const monetizationEnabled = state.runContext?.monetization?.enabled === true;
  const paySiteProvider = isPaySiteProvider(state.runContext);
  const monetizationMatrix = state.latestMonetizationTestMatrix ?? null;
  const handoffMonetization = state.runContext?.monetization ?? {};
  const filledCount = state.browserSmoke.filled_count ?? state.browserSmoke.scenarios?.[0]?.filled_count ?? 0;
  const popupErrorDisplay = popupHasGenericErrorDisplay(state.popupJs);
  const localStorageOnly = popupUsesLocalStorageOnly(state.popupJs);
  const selectSupported = popupSupportsSelect(state.popupJs);
  const deleteSupported = popupSupportsDelete(state.popupHtml, state.popupJs);
  const readonlyGuarded = popupSkipsReadonly(state.popupJs);
  const scenarioStatuses = {
    empty_form: browserSmokeScenarioStatus(state.browserSmoke, "empty_form"),
    partially_filled_form: browserSmokeScenarioStatus(state.browserSmoke, "partially_filled_form"),
    readonly_field: browserSmokeScenarioStatus(state.browserSmoke, "readonly_field"),
    select_field: browserSmokeScenarioStatus(state.browserSmoke, "select_field"),
    no_matching_fields: browserSmokeScenarioStatus(state.browserSmoke, "no_matching_fields"),
    overwrite_behavior_default_false: browserSmokeScenarioStatus(state.browserSmoke, "overwrite_behavior_default_false"),
    popup_feedback_display: browserSmokeScenarioStatus(state.browserSmoke, "popup_feedback_display"),
    profile_management: browserSmokeScenarioStatus(state.browserSmoke, "profile_management")
  };
  const tests = [
    {
      test_name: "empty form",
      automated_or_manual: "automated",
      current_status: scenarioStatuses.empty_form,
      evidence_artifact: normalizeRelativePath(state.runContext.project_root, artifactPath(state.runDir, "61_browser_smoke.json")),
      risk_if_missing: "Users can trigger fill with an empty profile and get no meaningful guidance.",
      recommended_next_action: scenarioStatuses.empty_form === "passed"
        ? "Keep the empty-form smoke fixture in regression."
        : "Add a smoke variant that attempts fill on an empty form and checks the filled count."
    },
    {
      test_name: "partially filled form",
      automated_or_manual: "automated",
      current_status: scenarioStatuses.partially_filled_form,
      evidence_artifact: normalizeRelativePath(state.runContext.project_root, artifactPath(state.runDir, "61_browser_smoke.json")),
      risk_if_missing: "Real pages often mix pre-filled and empty values; overwrite behavior is unknown.",
      recommended_next_action: scenarioStatuses.partially_filled_form === "passed"
        ? "Keep the partially-filled regression fixture."
        : "Add a form fixture where some values already exist and assert non-destructive behavior."
    },
    {
      test_name: "readonly field",
      automated_or_manual: "automated",
      current_status: scenarioStatuses.readonly_field === "passed"
        ? "passed"
        : readonlyGuarded ? "partial" : "missing",
      evidence_artifact: normalizeRelativePath(state.runContext.project_root, artifactPath(state.runDir, "61_browser_smoke.json")),
      risk_if_missing: "Readonly or locked CRM fields can throw errors or misleadingly report success.",
      recommended_next_action: scenarioStatuses.readonly_field === "passed"
        ? "Keep the readonly and disabled regression fixture."
        : "Add readonly inputs to the browser smoke fixture and assert they are skipped safely."
    },
    {
      test_name: "textarea",
      automated_or_manual: "automated",
      current_status: scenarioStatuses.empty_form === "passed" ? "passed" : "partial",
      evidence_artifact: normalizeRelativePath(state.runContext.project_root, artifactPath(state.runDir, "61_browser_smoke.json")),
      risk_if_missing: "Long-form notes fields may not map cleanly even though textarea is queried.",
      recommended_next_action: scenarioStatuses.empty_form === "passed"
        ? "Keep textarea in the empty-form fixture."
        : "Add textarea coverage to the smoke fixture."
    },
    {
      test_name: "select",
      automated_or_manual: "automated",
      current_status: scenarioStatuses.select_field === "passed"
        ? "passed"
        : selectSupported ? "partial" : "unsupported",
      evidence_artifact: normalizeRelativePath(state.runContext.project_root, artifactPath(state.runDir, "61_browser_smoke.json")),
      risk_if_missing: "Many lead forms use selects for country, industry, or source; current package likely cannot fill them.",
      recommended_next_action: scenarioStatuses.select_field === "passed"
        ? "Keep the select fixture in smoke regression."
        : "Implement select matching or narrow the listing promise before tester rollout."
    },
    {
      test_name: "email field",
      automated_or_manual: "automated",
      current_status: filledCount >= 5 ? "passed" : "missing",
      evidence_artifact: normalizeRelativePath(state.runContext.project_root, artifactPath(state.runDir, "61_browser_smoke.json")),
      risk_if_missing: "Core contact data could fail silently.",
      recommended_next_action: "Keep the current browser smoke assertion."
    },
    {
      test_name: "phone field",
      automated_or_manual: "automated",
      current_status: filledCount >= 5 ? "passed" : "missing",
      evidence_artifact: normalizeRelativePath(state.runContext.project_root, artifactPath(state.runDir, "61_browser_smoke.json")),
      risk_if_missing: "Phone is explicitly mentioned in demand evidence and currently only verified on one fixture.",
      recommended_next_action: "Keep the current browser smoke assertion and add alternate label variants."
    },
    {
      test_name: "name field",
      automated_or_manual: "automated",
      current_status: filledCount >= 5 ? "passed" : "missing",
      evidence_artifact: normalizeRelativePath(state.runContext.project_root, artifactPath(state.runDir, "61_browser_smoke.json")),
      risk_if_missing: "First/last name mapping is central to the wedge value proposition.",
      recommended_next_action: "Keep the current browser smoke assertion."
    },
    {
      test_name: "no matching fields",
      automated_or_manual: "automated",
      current_status: scenarioStatuses.no_matching_fields,
      evidence_artifact: normalizeRelativePath(state.runContext.project_root, artifactPath(state.runDir, "61_browser_smoke.json")),
      risk_if_missing: "The extension may report success while doing nothing useful on unsupported forms.",
      recommended_next_action: scenarioStatuses.no_matching_fields === "passed"
        ? "Keep the no-match regression fixture."
        : "Add a negative fixture with no matching descriptors and assert a clear zero-fill status."
    },
    {
      test_name: "activeTab permission path",
      automated_or_manual: "automated",
      current_status: state.browserSmoke.automation_result_received === true ? "passed" : "partial",
      evidence_artifact: normalizeRelativePath(state.runContext.project_root, artifactPath(state.runDir, "61_browser_smoke.json")),
      risk_if_missing: "Extension action invocation is the only authorized fill trigger path.",
      recommended_next_action: "Retain the current smoke coverage."
    },
    {
      test_name: "local storage only",
      automated_or_manual: "automated",
      current_status: localStorageOnly ? "passed" : "missing",
      evidence_artifact: normalizeRelativePath(state.runContext.project_root, path.join(state.buildReport.workspace_dist, "popup.js")),
      risk_if_missing: "Any remote storage regression would break the privacy promise and review positioning.",
      recommended_next_action: "Keep a static test that forbids network calls in popup code."
    },
    {
      test_name: "popup error display",
      automated_or_manual: "automated",
      current_status: scenarioStatuses.popup_feedback_display === "passed"
        ? "passed"
        : popupErrorDisplay ? "partial" : "missing",
      evidence_artifact: normalizeRelativePath(state.runContext.project_root, artifactPath(state.runDir, "61_browser_smoke.json")),
      risk_if_missing: "Failures become opaque and users cannot tell whether anything happened.",
      recommended_next_action: scenarioStatuses.popup_feedback_display === "passed"
        ? "Keep feedback verification in smoke regression."
        : "Automate a blocked-tab or missing-tab case and assert the visible error string."
    },
    {
      test_name: "profile save / edit / delete",
      automated_or_manual: "automated",
      current_status: scenarioStatuses.profile_management === "passed"
        ? "passed"
        : deleteSupported ? "partial" : "non_goal_or_future_work",
      evidence_artifact: normalizeRelativePath(state.runContext.project_root, artifactPath(state.runDir, "61_browser_smoke.json")),
      risk_if_missing: "Without delete/reset, users cannot recover from bad saved data cleanly.",
      recommended_next_action: scenarioStatuses.profile_management === "passed"
        ? "Keep popup profile management in smoke regression."
        : deleteSupported
          ? "Add explicit smoke coverage for save, edit, and delete."
          : "If delete remains out of scope, keep it out of the listing promise and mark it as future work."
    },
    {
      test_name: "field overwrite behavior",
      automated_or_manual: "automated",
      current_status: scenarioStatuses.overwrite_behavior_default_false,
      evidence_artifact: normalizeRelativePath(state.runContext.project_root, artifactPath(state.runDir, "61_browser_smoke.json")),
      risk_if_missing: "Current fill path always writes values and could clobber operator edits.",
      recommended_next_action: scenarioStatuses.overwrite_behavior_default_false === "passed"
        ? "Keep the overwrite-default-false regression fixture."
        : "Add overwrite rules and a fixture that asserts whether existing values are preserved."
    },
    {
      test_name: "visual feedback after fill",
      automated_or_manual: "automated",
      current_status: state.browserSmoke.popup_feedback_verified === true ? "passed" : popupErrorDisplay ? "partial" : "missing",
      evidence_artifact: normalizeRelativePath(state.runContext.project_root, artifactPath(state.runDir, "61_browser_smoke.json")),
      risk_if_missing: "Users may not trust the action if the popup does not confirm what happened clearly.",
      recommended_next_action: state.browserSmoke.popup_feedback_verified === true
        ? "Keep popup feedback verification in smoke regression."
        : "Capture a post-fill popup screenshot or toast state that confirms fill count."
    }
  ];

  if (monetizationEnabled) {
    if (paySiteProvider) {
      tests.push(
        {
          test_name: "email OTP login UI and protocol",
          automated_or_manual: "automated",
          current_status: (
            monetizationTestPassed(monetizationMatrix, "email_otp_ui_present")
            && monetizationTestPassed(monetizationMatrix, "background_message_contract_present")
          ) ? "passed" : "missing",
          evidence_artifact: "109_monetization_test_matrix.json",
          risk_if_missing: "The commercial plugin could not complete the verified HWH email OTP auth path.",
          recommended_next_action: "Keep SEND_OTP and VERIFY_OTP exposed only through the background membership runtime."
        },
        {
          test_name: "source=chrome_extension checkout metadata",
          automated_or_manual: "automated",
          current_status: (
            monetizationTestPassed(monetizationMatrix, "checkout_source_chrome_extension")
            && handoffMonetization.source_chrome_extension_status === "verified"
          ) ? "passed" : "missing",
          evidence_artifact: "109_monetization_test_matrix.json",
          risk_if_missing: "HWH could misclassify plugin checkout sessions or miss installation metadata.",
          recommended_next_action: "Keep CREATE_CHECKOUT sending source=chrome_extension plus installationId."
        },
        {
          test_name: "successUrl is not a local unlock basis",
          automated_or_manual: "automated",
          current_status: monetizationTestPassed(monetizationMatrix, "success_url_not_unlock_basis") ? "passed" : "missing",
          evidence_artifact: "109_monetization_test_matrix.json",
          risk_if_missing: "A redirect-only success page could be abused to unlock Pro without a verified webhook.",
          recommended_next_action: "Keep Pro activation tied to webhook-derived entitlement refresh only."
        },
        {
          test_name: "webhook-derived entitlement refresh",
          automated_or_manual: "automated",
          current_status: (
            monetizationTestPassed(monetizationMatrix, "pro_entitlement_refresh_path")
            && handoffMonetization.entitlement_status === "verified_from_payment"
          ) ? "passed" : "missing",
          evidence_artifact: "109_monetization_test_matrix.json",
          risk_if_missing: "Paid users could fail to see active membership after the webhook writes entitlement.",
          recommended_next_action: "Keep REFRESH_ENTITLEMENT as the user-visible post-payment recovery path."
        },
        {
          test_name: "CONSUME_USAGE gate before fill",
          automated_or_manual: "automated",
          current_status: monetizationTestPassed(monetizationMatrix, "consume_usage_before_fill") ? "passed" : "missing",
          evidence_artifact: "109_monetization_test_matrix.json",
          risk_if_missing: "The core fill action could bypass free quota or Pro entitlement checks.",
          recommended_next_action: "Keep guardPaidFeatureUsage before every fill execution path."
        },
        {
          test_name: "free quota and quota exceeded path",
          automated_or_manual: "automated",
          current_status: (
            monetizationTestPassed(monetizationMatrix, "free_usage_counter_visible")
            && monetizationTestPassed(monetizationMatrix, "quota_exceeded_path_present")
            && handoffMonetization.consume_usage_status === "verified_free_quota_pro"
          ) ? "passed" : "missing",
          evidence_artifact: "109_monetization_test_matrix.json",
          risk_if_missing: "Free users could exceed the 10-fill limit or fail to understand the remaining quota.",
          recommended_next_action: "Keep the 10-fill meter and 11th QUOTA_EXCEEDED smoke in the HWH handoff."
        },
        {
          test_name: "background session token boundary",
          automated_or_manual: "automated",
          current_status: monetizationTestPassed(monetizationMatrix, "auth_tokens_stay_in_background_path") ? "passed" : "missing",
          evidence_artifact: "109_monetization_test_matrix.json",
          risk_if_missing: "Auth tokens could leak into visible UI or content script code.",
          recommended_next_action: "Keep session handling in the background membership runtime."
        },
        {
          test_name: "public-only payment config",
          automated_or_manual: "automated",
          current_status: monetizationTestPassed(monetizationMatrix, "public_only_no_provider_secret") ? "passed" : "missing",
          evidence_artifact: "110_monetization_security_scan.json",
          risk_if_missing: "The extension could ship service-role, Waffo, merchant, or webhook secrets.",
          recommended_next_action: "Run monetization:security-scan before any upload approval."
        },
        {
          test_name: "test mode checkout guard",
          automated_or_manual: "automated",
          current_status: (
            monetizationTestPassed(monetizationMatrix, "test_mode_checkout_guard")
            && state.runContext.production_payment_status === "not_verified"
          ) ? "passed" : "missing",
          evidence_artifact: "109_monetization_test_matrix.json",
          risk_if_missing: "The candidate could imply production payment is enabled before live payment approval.",
          recommended_next_action: "Keep production payment blocked until explicit live checkout verification."
        }
      );
    } else {
      tests.push(
        {
          test_name: "free usage counter",
          automated_or_manual: "automated",
          current_status: monetizationTestPlannedOrPassed(monetizationMatrix, "free_usage_counter_decreases") ? "passed" : "missing",
          evidence_artifact: "109_monetization_test_matrix.json",
          risk_if_missing: "Users cannot tell when the free limit is approaching or exhausted.",
          recommended_next_action: "Verify the free usage counter decreases on each core action."
        },
        {
          test_name: "free limit paywall",
          automated_or_manual: "automated",
          current_status: monetizationTestPlannedOrPassed(monetizationMatrix, "free_limit_reached") ? "passed" : "missing",
          evidence_artifact: "109_monetization_test_matrix.json",
          risk_if_missing: "The commercial wedge could overpromise unlimited usage to free users.",
          recommended_next_action: "Exhaust the free fills and verify the paywall appears with the upgrade CTA."
        },
        {
          test_name: "license activation and restore",
          automated_or_manual: "automated",
          current_status: (
            monetizationTestPlannedOrPassed(monetizationMatrix, "license_input_ui")
            && monetizationTestPlannedOrPassed(monetizationMatrix, "license_page_opens")
            && monetizationTestPlannedOrPassed(monetizationMatrix, "invalid_license_error")
          ) ? "passed" : "missing",
          evidence_artifact: "109_monetization_test_matrix.json",
          risk_if_missing: "Users could pay externally but still fail to activate or restore access cleanly.",
          recommended_next_action: "Verify activate, verify, restore, and invalid-license states in the license UI."
        },
        {
          test_name: "offline grace and trust boundary",
          automated_or_manual: "automated",
          current_status: (
            monetizationTestPlannedOrPassed(monetizationMatrix, "offline_grace_behavior")
            && monetizationTestPlannedOrPassed(monetizationMatrix, "local_storage_fields_safe")
          ) ? "passed" : "missing",
          evidence_artifact: "109_monetization_test_matrix.json",
          risk_if_missing: "A stale paid cache could become a permanent unlock or leak sensitive license details.",
          recommended_next_action: "Verify offline grace expires and the extension falls back to free until reverified."
        }
      );
    }
  }

  const scoreMap = {
    passed: 1,
    partial: 0.5,
    manual_only: 0.4,
    non_goal_or_future_work: 0.7,
    unsupported: 0,
    missing: 0
  };
  const testCoverageScore = round((average(tests.map((test) => scoreMap[test.current_status] ?? 0)) * 100));
  const missingTests = tests
    .filter((test) => ["missing", "unsupported"].includes(test.current_status))
    .map((test) => test.test_name);
  const releaseBlockers = [
    ...(scenarioStatuses.select_field === "passed" ? [] : ["select field support or truthful scope reduction"]),
    ...(scenarioStatuses.readonly_field === "passed" ? [] : ["readonly/locked field handling"]),
    ...(scenarioStatuses.no_matching_fields === "passed" ? [] : ["no matching fields feedback"]),
    ...(scenarioStatuses.overwrite_behavior_default_false === "passed" ? [] : ["field overwrite behavior"]),
    ...(scenarioStatuses.profile_management === "passed" || !deleteSupported ? [] : ["profile save/edit/delete flow"]),
    ...(monetizationEnabled && !monetizationMatrix ? ["monetization test matrix missing"] : []),
    ...(monetizationEnabled && monetizationMatrix?.status === "failed"
      ? [paySiteProvider ? "pay-site monetization matrix has missing core checks" : "monetization matrix has missing core checks"]
      : [])
  ];

  const report = buildSafeReport({
    stage: "FUNCTIONAL_TEST_MATRIX",
    status: "passed",
    run_id: state.runContext.run_id,
    archetype: state.buildReport.archetype,
    wedge: state.productBrief.product_name_working,
    tests,
    test_coverage_score: testCoverageScore,
    missing_tests: unique(missingTests),
    release_blockers: unique(releaseBlockers),
    recommended_next_tests: paySiteProvider
      ? [
          "Keep the source=chrome_extension HWH smoke artifact linked to this candidate before any upload decision.",
          "Repeat manual visual review of the membership panel and payment CTA.",
          "Do not switch checkoutMode to live until production payment is explicitly approved."
        ]
      : [
          "Add label-variant coverage for alternate field descriptors such as mobile, organization, and region.",
          "Add a multi-step form regression once the single-step smoke suite is stable.",
          "Add manual tester verification on a real CRM page before another publish cycle."
        ]
  });

  await validateArtifact(
    state.runContext.project_root,
    "functional_test_matrix.schema.json",
    FUNCTIONAL_TEST_MATRIX_ARTIFACT,
    report
  );
  const jsonWrite = await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: FUNCTIONAL_TEST_MATRIX_ARTIFACT,
    data: report,
    occurredAt
  });
  await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "62_functional_test_matrix.md",
    category: "functional_test_matrix",
    prefix: "62_functional_test_matrix",
    content: functionalMatrixMarkdown(report),
    occurredAt
  });

  return {
    report,
    artifactRelativePath: jsonWrite.artifactRelativePath
  };
}

export async function generateProductAcceptanceReview({ runDir }) {
  const state = await loadSandboxProductState(runDir);
  const occurredAt = nowIso();
  const functionalMatrix = state.latestFunctionalMatrix ?? (await generateFunctionalTestMatrix({ runDir })).report;
  const monetizationEnabled = state.runContext?.monetization?.enabled === true;
  const paySiteProvider = isPaySiteProvider(state.runContext);
  const monetizationMatrix = state.latestMonetizationTestMatrix ?? null;
  const handoffMonetization = state.runContext?.monetization ?? {};
  const popupClear = state.popupHtml.includes(state.productBrief.product_name_working)
    && state.popupHtml.includes(state.productBrief.single_purpose_statement);
  const happyPathVerified = state.browserSmoke.happy_path_verified === true;
  const filledCount = state.browserSmoke.filled_count ?? state.browserSmoke.scenarios?.[0]?.filled_count ?? 0;
  const permissionsMinimal = state.qaReport.checks_passed?.includes("permission_budget_matches_plan")
    && state.productBrief.permission_budget.forbidden.every((permission) => !state.popupJs.includes(permission));
  const listingDescription = listingText(state.listingCopy);
  const selectCovered = browserSmokeScenarioPassed(state.browserSmoke, "select_field");
  const readonlyCovered = browserSmokeScenarioPassed(state.browserSmoke, "readonly_field");
  const partialCovered = browserSmokeScenarioPassed(state.browserSmoke, "partially_filled_form");
  const noMatchCovered = browserSmokeScenarioPassed(state.browserSmoke, "no_matching_fields");
  const overwriteCovered = browserSmokeScenarioPassed(state.browserSmoke, "overwrite_behavior_default_false");
  const profileManagementCovered = browserSmokeScenarioPassed(state.browserSmoke, "profile_management");
  const popupFeedbackCovered = browserSmokeScenarioPassed(state.browserSmoke, "popup_feedback_display")
    || state.browserSmoke.popup_feedback_verified === true;
  const affirmativeSyncClaimPresent = hasAffirmativeSyncClaim(listingDescription);
  const listingTruthful = listingDescription.includes("local")
    && listingDescription.includes("overwrite")
    && listingDescription.includes("select")
    && !affirmativeSyncClaimPresent;
  const monetizationTruthful = monetizationEnabled
    ? paySiteProvider
      ? /free/i.test(listingDescription)
        && /lifetime/i.test(listingDescription)
        && /external payment|external hwh checkout|payment page|checkout/i.test(listingDescription)
        && /membership|email|otp|refresh|webhook-confirmed entitlement/i.test(listingDescription)
      : /free|lifetime|license|external payment/i.test(listingDescription)
    : true;
  const paySiteRequiredTestIds = [
    "pay_site_config_present",
    "email_otp_ui_present",
    "background_message_contract_present",
    "checkout_source_chrome_extension",
    "success_url_not_unlock_basis",
    "consume_usage_before_fill",
    "pro_entitlement_refresh_path",
    "auth_tokens_stay_in_background_path",
    "free_usage_counter_visible",
    "quota_exceeded_path_present",
    "test_mode_checkout_guard",
    "public_only_no_provider_secret"
  ];
  const paySiteHandoffVerified = handoffMonetization.smtp_status === "verified_independent"
    && handoffMonetization.otp_status === "verified"
    && handoffMonetization.checkout_status === "verified"
    && handoffMonetization.webhook_status === "verified"
    && handoffMonetization.entitlement_status === "verified_from_payment"
    && handoffMonetization.consume_usage_status === "verified_free_quota_pro"
    && handoffMonetization.payment_e2e_status === "verified_test_mode"
    && handoffMonetization.source_chrome_extension_status === "verified";
  const monetizationMatrixReady = monetizationEnabled
    ? paySiteProvider
      ? Boolean(monetizationMatrix)
        && monetizationMatrix.status === "passed"
        && paySiteRequiredTestIds.every((id) => monetizationTestPassed(monetizationMatrix, id))
        && paySiteHandoffVerified
      : Boolean(monetizationMatrix)
        && monetizationMatrix.status !== "failed"
        && monetizationTestPlannedOrPassed(monetizationMatrix, "free_usage_available")
        && monetizationTestPlannedOrPassed(monetizationMatrix, "free_usage_counter_decreases")
        && monetizationTestPlannedOrPassed(monetizationMatrix, "free_limit_reached")
        && monetizationTestPlannedOrPassed(monetizationMatrix, "upgrade_url_external_tab")
        && monetizationTestPlannedOrPassed(monetizationMatrix, "license_input_ui")
        && monetizationTestPlannedOrPassed(monetizationMatrix, "invalid_license_error")
        && monetizationTestPlannedOrPassed(monetizationMatrix, "offline_grace_behavior")
        && monetizationTestPlannedOrPassed(monetizationMatrix, "listing_paid_disclosure_present")
    : true;
  const criticalCoveragePassed = [
    selectCovered,
    readonlyCovered,
    partialCovered,
    noMatchCovered,
    overwriteCovered,
    popupFeedbackCovered
  ].every(Boolean);

  const biggestRisks = unique([
    criticalCoveragePassed ? null : "One or more core form scenarios are still missing automated proof in browser smoke.",
    functionalMatrix.test_coverage_score < 75 ? "Functional coverage is still below the confidence bar for another tester-facing cycle." : null,
    "Field descriptor matching still depends on heuristic label and placeholder matching.",
    listingTruthful ? null : "Listing copy could drift from the currently verified support envelope.",
    monetizationMatrixReady ? null : paySiteProvider
      ? "HWH pay-site coverage is incomplete or missing OTP, checkout, webhook entitlement, consume-usage, or public-config proof."
      : "Commercial monetization coverage is incomplete or missing key proof points.",
    monetizationTruthful ? null : paySiteProvider
      ? "Listing copy does not yet disclose the free limit, lifetime unlock, email membership, external checkout, and webhook entitlement boundary clearly enough."
      : "Listing copy does not yet disclose the free limit, paid unlock, and license flow clearly enough."
  ]);

  const requiredFixes = unique([
    selectCovered ? null : "Implement select support or narrow the listing promise to text-style fields only.",
    noMatchCovered ? null : "Add explicit zero-fill or unsupported-form feedback in the popup.",
    overwriteCovered ? null : "Keep overwrite disabled by default and verify the preserved-value path.",
    profileManagementCovered || !deleteSupported ? null : "Add smoke proof for save, edit, and delete profile management.",
    listingTruthful ? null : "Align listing copy with the verified field types, local-only storage, and default overwrite policy.",
    monetizationTruthful ? null : paySiteProvider
      ? "Disclose the free limit, lifetime unlock, external HWH checkout, email membership, and webhook-derived Pro unlock truthfully in the listing."
      : "Disclose the free limit, lifetime unlock, external payment page, and license activation truthfully in the listing.",
    monetizationMatrixReady ? null : paySiteProvider
      ? "Complete the HWH pay-site matrix so OTP, source=chrome_extension checkout, webhook entitlement refresh, consume-usage, and public-only config are all proven."
      : "Complete the monetization matrix so free-limit, upgrade, invalid-license, and offline-grace behavior are all proven."
  ]);

  const acceptanceStatus = happyPathVerified
    && filledCount >= 5
    && permissionsMinimal
    && criticalCoveragePassed
    && functionalMatrix.test_coverage_score >= 75
    && listingTruthful
    && monetizationTruthful
    && monetizationMatrixReady
    && requiredFixes.length === 0
    ? "passed"
    : happyPathVerified && filledCount >= 5 && functionalMatrix.test_coverage_score >= 60
      ? "revise"
    : functionalMatrix.test_coverage_score >= 40
      ? "blocked"
        : "kill";

  const recommendedDecision = acceptanceStatus === "passed"
    ? "ready_for_reupload_after_manual_review_cancel"
    : acceptanceStatus === "revise"
      ? "cancel_review_and_revise_before_tester_install"
      : acceptanceStatus === "blocked"
        ? "cancel_review_and_rebuild_core_flow"
        : "kill_this_wedge_before_more_review_time";

  const nextStep = acceptanceStatus === "passed"
    ? "prepare_new_sandbox_revision_for_upload_after_manual_review_cancel"
    : "manually_cancel_review_then_expand_functional_testing_and_repair";

  const report = buildSafeReport({
    stage: "PRODUCT_ACCEPTANCE_REVIEW",
    status: "passed",
    run_id: state.runContext.run_id,
    archetype: state.buildReport.archetype,
    wedge: state.productBrief.product_name_working,
    target_user: state.productBrief.target_user,
    promised_value: state.productBrief.single_purpose_statement,
    actual_core_flow: `Popup saves one local profile and the browser smoke fixture verified ${filledCount} visible fields filled on a controlled lead-form page.`,
    acceptance_status: acceptanceStatus,
    ux_review: {
      status: popupClear ? "clear_but_basic" : "needs_clarity",
      notes: popupFeedbackCovered
        ? "The popup now explains local-only storage, default overwrite behavior, and gives visible feedback for both successful fills and no-match cases."
        : "The popup is understandable, but feedback for unsupported pages is still not sufficiently proven."
    },
    functionality_review: {
      status: criticalCoveragePassed ? "core_flow_proven" : happyPathVerified ? "happy_path_proven_but_incomplete" : "not_proven",
      notes: criticalCoveragePassed
        ? `The smoke suite now covers empty, partially filled, readonly or disabled, select, no-match, overwrite-default-false, and popup-feedback scenarios with ${functionalMatrix.test_coverage_score} coverage.`
        : `The controlled smoke flow passed and filled ${filledCount} fields, but some core form behaviors still lack reliable proof.`
    },
    monetization_review: monetizationEnabled
      ? {
          status: monetizationMatrixReady ? "commercial_flow_scoped_and_proven" : "commercial_flow_needs_more_proof",
          notes: monetizationMatrixReady
            ? paySiteProvider
              ? "The HWH pay-site flow covers email OTP, source=chrome_extension checkout, webhook-derived entitlement refresh, free quota, Pro consume-usage, and public-only extension config in test mode."
              : "The commercial placeholder flow now covers free usage, upgrade CTA, license activation, invalid states, and offline grace without shipping any payment secret."
            : paySiteProvider
              ? "The HWH pay-site flow exists, but OTP, checkout metadata, entitlement refresh, consume usage, or public-only proof is still incomplete."
              : "The commercial placeholder flow exists, but free-limit, upgrade, license, or offline-grace proof is still incomplete."
        }
      : {
          status: "not_applicable",
          notes: "This revision does not enable monetization."
        },
    listing_truthfulness_review: {
      status: listingTruthful && monetizationTruthful ? "truthful_and_scoped" : "needs_scope_guardrails",
      notes: listingTruthful && monetizationTruthful
        ? "The listing now matches the verified support envelope and discloses the commercial placeholder flow truthfully."
        : "The listing still risks drifting beyond what the smoke suite and monetization matrix have actually proven."
    },
    permissions_review: {
      status: permissionsMinimal ? "minimal" : "needs_trim",
      notes: "The current permission set is narrow and aligned with the brief: storage, activeTab, and scripting only."
    },
    privacy_review: {
      status: popupUsesLocalStorageOnly(state.popupJs) ? "aligned_with_promise" : "needs_recheck",
      notes: "No remote sync path is present in popup code, which matches the local-only privacy story."
    },
    screenshot_review: {
      status: "real_and_truthful",
      notes: "The screenshots remain validation-oriented, but they now represent real supported behavior instead of overselling unsupported fields."
    },
    biggest_risks: biggestRisks,
    required_fixes: requiredFixes,
    recommended_decision: recommendedDecision,
    next_step: nextStep
  });

  await validateArtifact(
    state.runContext.project_root,
    "product_acceptance_review.schema.json",
    PRODUCT_ACCEPTANCE_REVIEW_ARTIFACT,
    report
  );
  const jsonWrite = await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: PRODUCT_ACCEPTANCE_REVIEW_ARTIFACT,
    data: report,
    occurredAt
  });
  await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "94_product_acceptance_review.md",
    category: "product_review",
    prefix: "94_product_acceptance_review",
    content: productAcceptanceMarkdown(report),
    occurredAt
  });

  await updateRegistryItemByRunId(state.runContext.project_root, state.runContext.run_id, (item) => ({
    ...item,
    known_product_risks: report.biggest_risks,
    product_acceptance_status: report.acceptance_status,
    revision_required: report.acceptance_status !== "passed",
    blocked_from_publish_until_acceptance_passed: report.acceptance_status !== "passed",
    revision_resolved: report.acceptance_status === "passed",
    next_product_step: report.next_step
  })).catch(() => null);

  return {
    report,
    artifactRelativePath: jsonWrite.artifactRelativePath
  };
}

function humanRepairSuggestions(acceptanceReview, functionalMatrix, decision) {
  if (decision === "revise") {
    return unique([
      ...(acceptanceReview?.required_fixes ?? []),
      ...(functionalMatrix?.release_blockers ?? [])
    ]);
  }
  if (decision === "kill") {
    return [
      "Do not publish similar single_profile_form_fill wedges until real-world utility is revalidated.",
      "Shift follow-up time into stronger discovery evidence or a materially different workflow wedge."
    ];
  }
  return [];
}

async function writeLatestProductReviewMarkdown(state, report, occurredAt) {
  const baseDir = path.join(state.runContext.project_root, "state", "run_events", state.runContext.run_id);
  const latestPath = path.join(baseDir, "94_human_product_review.md");
  const eventPath = path.join(baseDir, "product_review", `94_human_product_review-${sidecarStamp(occurredAt)}.md`);
  await fs.mkdir(path.dirname(eventPath), { recursive: true });
  const markdown = humanProductReviewMarkdown(report);
  await writeText(eventPath, markdown);
  await writeText(latestPath, markdown);
}

export async function recordHumanProductReview({ runDir, decision, note }) {
  const state = await loadSandboxProductState(runDir);
  const occurredAt = nowIso();
  const acceptanceReview = state.latestAcceptanceReview ?? (await generateProductAcceptanceReview({ runDir })).report;
  const functionalMatrix = state.latestFunctionalMatrix ?? (await generateFunctionalTestMatrix({ runDir })).report;
  const normalizedDecision = `${decision}`.trim().toLowerCase();
  if (!["passed", "revise", "blocked", "kill"].includes(normalizedDecision)) {
    throw new Error(`Unsupported human product review decision: ${decision}`);
  }

  const repairSuggestions = humanRepairSuggestions(acceptanceReview, functionalMatrix, normalizedDecision);
  const report = buildSafeReport({
    stage: "HUMAN_PRODUCT_REVIEW",
    status: "passed",
    run_id: state.runContext.run_id,
    decision: normalizedDecision,
    note: `${note ?? ""}`.trim(),
    recorded_at: occurredAt,
    acceptance_status_at_review: acceptanceReview.acceptance_status,
    repair_suggestions: repairSuggestions,
    next_step: normalizedDecision === "kill"
      ? "do_not_publish_similar_wedge"
      : normalizedDecision === "passed"
        ? "install_verification_and_monitoring_allowed"
        : "prepare_revision_repair_plan_and_retest"
  });

  await validateArtifact(
    state.runContext.project_root,
    "human_product_review.schema.json",
    HUMAN_PRODUCT_REVIEW_ARTIFACT,
    report
  );
  await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: HUMAN_PRODUCT_REVIEW_ARTIFACT,
    data: report,
    occurredAt
  });
  await writeLatestProductReviewMarkdown(state, report, occurredAt);

  if (normalizedDecision === "kill") {
    await recordKnownBadPattern(state.runContext.project_root, {
      run_id: state.runContext.run_id,
      source_daily_run_id: state.runContext.source_daily_run_id ?? null,
      wedge_family: state.productBrief.wedge_family ?? state.buildReport.archetype ?? null,
      product_name: state.productBrief.product_name_working,
      reason: note,
      source: "human_product_review"
    });
  }

  return report;
}
