import fs from "node:fs/promises";
import path from "node:path";
import { generateMoneyFirstOpportunityEngine, createFakeDoorTest } from "../discovery/moneyFirstOpportunityEngine.mjs";
import {
  buildSafeReport,
  loadOptionalManagedArtifact,
  markdownList,
  markdownSection,
  validateArtifact,
  writeManagedJsonArtifact,
  writeManagedMarkdownArtifact
} from "../review/helpers.mjs";
import { ensureDir, fileExists, nowIso, readJson, writeJson } from "../utils/io.mjs";
import { assertMatchesSchema } from "../utils/schema.mjs";

const PAYMENT_LINK_FLOW_ARTIFACT = "96_payment_link_flow_plan.json";
const LICENSE_ACTIVATION_ARTIFACT = "97_license_activation_spec.json";
const VALUE_FIRST_PAYWALL_ARTIFACT = "98_value_first_paywall_rules.json";
const PAID_INTEREST_ARTIFACT = "100_paid_interest_experiment.json";
const MARKET_TEST_PLAN_ARTIFACT = "103_market_test_plan.json";
const MARKET_FIRST_GATE_ARTIFACT = "104_market_first_build_gate.json";
const MICRO_MVP_SELECTION_ARTIFACT = "105_micro_mvp_selection.json";
const MARKET_TEST_METRICS_ARTIFACT = "106_market_test_metrics_spec.json";
const MARKET_TEST_LAUNCH_PLAN_ARTIFACT = "107_market_test_launch_plan.json";
const PAGE_CONTEXT_MARKET_TEST_PLAN_ARTIFACT = "108_page_context_market_test_plan.json";

const MONEY_WEDGES_ARTIFACT = "89_money_micro_wedge_candidates.json";
const MONEY_GATE_ARTIFACT = "92_money_first_build_gate.json";
const MONEY_PRICING_ARTIFACT = "90_pricing_experiment_plan.json";
const MONEY_PAYMENT_ARTIFACT = "91_payment_license_architecture_plan.json";
const SUPPORT_RESCORE_ARTIFACT = "83_candidate_rescore_with_manual_evidence.json";
const SUPPORT_SPRINT_ARTIFACT = "80_support_qa_evidence_sprint.json";

const APPROVAL_DIR = path.join("state", "market_test_approvals");

const PRIORITY_ORDER = [
  "page context to markdown",
  "support ticket context packet",
  "qa repro steps clipboard helper",
  "saas admin clipboard cleanup",
  "clipboard table to clean csv"
];

function normalizeText(value) {
  return `${value ?? ""}`.replace(/\s+/g, " ").trim();
}

function lower(value) {
  return normalizeText(value).toLowerCase();
}

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function stamp(value = nowIso()) {
  return `${value}`.replace(/[:.]/g, "-");
}

async function detectLatestRun(projectRoot, artifactNames) {
  const runsRoot = path.join(projectRoot, "runs");
  const entries = await fs.readdir(runsRoot, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));

  for (const name of names) {
    const runDir = path.join(runsRoot, name);
    const contextPath = path.join(runDir, "00_run_context.json");
    if (!(await fileExists(contextPath))) {
      continue;
    }
    const runContext = {
      ...(await readJson(contextPath)),
      project_root: projectRoot
    };
    const required = await Promise.all(
      artifactNames.map((artifactName) => loadOptionalManagedArtifact({ runDir, artifactName, runContext }))
    );
    if (required.every(Boolean)) {
      return { runDir, runContext };
    }
  }

  return null;
}

async function loadRequiredManagedArtifact(runDir, runContext, artifactName) {
  const artifact = await loadOptionalManagedArtifact({ runDir, artifactName, runContext });
  if (!artifact) {
    throw new Error(`Missing ${artifactName} in ${runDir}.`);
  }
  return artifact;
}

async function loadMarketState(projectRoot) {
  let run = await detectLatestRun(projectRoot, [MONEY_WEDGES_ARTIFACT, MONEY_GATE_ARTIFACT]);
  if (!run) {
    await generateMoneyFirstOpportunityEngine({ projectRoot });
    run = await detectLatestRun(projectRoot, [MONEY_WEDGES_ARTIFACT, MONEY_GATE_ARTIFACT]);
  }
  if (!run) {
    throw new Error("No money-first run containing 89_money_micro_wedge_candidates.json and 92_money_first_build_gate.json was found.");
  }

  let wedges = await loadRequiredManagedArtifact(run.runDir, run.runContext, MONEY_WEDGES_ARTIFACT);
  if ((wedges.candidates ?? []).some((candidate) => typeof candidate.testability_score !== "number")) {
    await generateMoneyFirstOpportunityEngine({ projectRoot });
    run = await detectLatestRun(projectRoot, [MONEY_WEDGES_ARTIFACT, MONEY_GATE_ARTIFACT]);
    if (!run) {
      throw new Error("Money-first artifacts could not be regenerated for market mode.");
    }
    wedges = await loadRequiredManagedArtifact(run.runDir, run.runContext, MONEY_WEDGES_ARTIFACT);
  }

  const supportRescoreRun = await detectLatestRun(projectRoot, [SUPPORT_RESCORE_ARTIFACT]);
  const supportSprintRun = await detectLatestRun(projectRoot, [SUPPORT_SPRINT_ARTIFACT]);

  return {
    projectRoot,
    runDir: run.runDir,
    runContext: run.runContext,
    wedges,
    moneyGate: await loadRequiredManagedArtifact(run.runDir, run.runContext, MONEY_GATE_ARTIFACT),
    pricingPlan: await loadRequiredManagedArtifact(run.runDir, run.runContext, MONEY_PRICING_ARTIFACT),
    paymentPlan: await loadRequiredManagedArtifact(run.runDir, run.runContext, MONEY_PAYMENT_ARTIFACT),
    paidInterest: await loadOptionalManagedArtifact({ runDir: run.runDir, runContext: run.runContext, artifactName: PAID_INTEREST_ARTIFACT }),
    supportRescore: supportRescoreRun
      ? await loadRequiredManagedArtifact(supportRescoreRun.runDir, supportRescoreRun.runContext, SUPPORT_RESCORE_ARTIFACT)
      : null,
    supportSprint: supportSprintRun
      ? await loadRequiredManagedArtifact(supportSprintRun.runDir, supportSprintRun.runContext, SUPPORT_SPRINT_ARTIFACT)
      : null,
    backlog: await readJson(path.join(projectRoot, "state", "opportunity_backlog.json")),
    registry: await readJson(path.join(projectRoot, "state", "portfolio_registry.json"))
  };
}

function resolveCandidate(wedges, candidateInput) {
  const items = wedges.candidates ?? [];
  if (!candidateInput) {
    return items[0] ?? null;
  }
  const normalized = lower(candidateInput);
  const normalizedSlug = normalized.replace(/-/g, " ");
  return items.find((item) => (
    lower(item.candidate_id) === normalized
      || lower(item.candidate_id).includes(normalized)
      || lower(item.candidate_name) === normalized
      || lower(item.wedge_name) === normalized
      || lower(item.candidate_name) === normalizedSlug
      || lower(item.wedge_name) === normalizedSlug
      || lower(item.candidate_name).includes(normalized)
      || lower(item.wedge_name).includes(normalized)
      || lower(item.candidate_name).includes(normalizedSlug)
      || lower(item.wedge_name).includes(normalizedSlug)
      || (item.supporting_source_candidates ?? []).some((name) => lower(name) === normalized || lower(name).includes(normalized))
  )) ?? null;
}

function estimatedBuildTimeHours(candidate) {
  if (candidate.builder_gap === "none") return 8;
  if (candidate.builder_gap === "small_new_builder") return 12;
  if (candidate.builder_gap === "future_builder_monitor_only") return 20;
  return 16;
}

function permissionRisk(candidate) {
  const permissions = candidate.required_permissions ?? [];
  if (permissions.some((permission) => /host|webRequest|debugger|history|cookies|management/i.test(permission))) {
    return "high";
  }
  if (permissions.includes("scripting") && permissions.includes("activeTab")) {
    return "medium-low";
  }
  if (permissions.length >= 3) {
    return "medium";
  }
  return "low";
}

function maintenanceCost(candidate) {
  if (candidate.maintenance_risk === "high") return "high";
  if (candidate.maintenance_risk === "medium") return "medium";
  return "low";
}

function marketTestRisk(candidate, paidInterestArtifact = null) {
  const buyingIntentScore = Number(candidate.money_scores?.buying_intent_score ?? 0);
  const paidInterestScore = paidInterestArtifact?.candidate_name === candidate.candidate_name
    ? Number(paidInterestArtifact.paid_interest_score ?? buyingIntentScore)
    : buyingIntentScore;
  const referenceScore = Math.min(buyingIntentScore, paidInterestScore);
  if (referenceScore < 60) return "high";
  if (referenceScore < 75) return "medium";
  return "low";
}

function defaultSuccessMetrics(candidate) {
  return [
    ">= 100 landing or listing visits in the first 14 days",
    ">= 10 installs or waitlist signups",
    ">= 3 upgrade clicks",
    ">= 1 payment intent or explicit would-pay signal",
    `Core action should complete at least once for >= 30% of first_open users for ${candidate.wedge_name}`
  ];
}

function defaultKillCriteria() {
  return [
    "100+ visits and 0 installs or signups",
    "50+ installs and almost no core action use",
    "No upgrade clicks after meaningful usage",
    "Chrome Web Store policy or review blocker appears",
    "Support or maintenance cost grows beyond the time box"
  ];
}

function buildMarketFirstEntry(candidate, paidInterestArtifact = null) {
  const buildHours = estimatedBuildTimeHours(candidate);
  const permission = permissionRisk(candidate);
  const maintenance = maintenanceCost(candidate);
  const policy = `${candidate.policy_risk ?? "low"}`;
  const clone = `${candidate.clone_risk ?? "low"}`;
  const marketRisk = marketTestRisk(candidate, paidInterestArtifact);
  const testabilityScore = Number(candidate.testability_score ?? 0);
  const gateChecks = {
    one_job_clarity_score: Number(candidate.money_scores?.one_job_clarity_score ?? 0) >= 80,
    permission_risk: permission !== "high",
    policy_risk: policy !== "high",
    clone_risk: clone !== "high",
    maintenance_cost: maintenance !== "high",
    estimated_build_time_hours: buildHours <= 16,
    testability_score: testabilityScore >= 70,
    monetization_strategy_exists: Boolean(candidate.suggested_price && candidate.free_limit && candidate.upsell_model),
    suggested_price_exists: Boolean(candidate.suggested_price),
    free_limit_defined: Boolean(candidate.free_limit),
    success_metrics_defined: true,
    kill_criteria_defined: true,
    human_approval_required: true
  };

  let result = "keep_waiting";
  if (clone === "high" || policy === "high" || permission === "high") {
    result = "skip";
  } else if (Object.values(gateChecks).every((value) => value === true)) {
    result = "market_test_build_ready";
  } else if (
    Number(candidate.money_scores?.one_job_clarity_score ?? 0) >= 75
      && Number(candidate.money_scores?.permission_trust_score ?? 0) >= 75
      && maintenance !== "high"
  ) {
    result = "fake_door_first";
  }

  return {
    candidate_id: candidate.candidate_id,
    candidate_name: candidate.candidate_name,
    wedge_name: candidate.wedge_name,
    market_test_mode_enabled: true,
    market_test_score: round(
      (Number(candidate.money_scores?.total_money_score ?? 0) * 0.55)
      + (Number(candidate.money_scores?.one_job_clarity_score ?? 0) * 0.2)
      + (Number(candidate.money_scores?.permission_trust_score ?? 0) * 0.15)
      + (Number(candidate.money_scores?.maintenance_cost_score ?? 0) * 0.1)
      - (marketRisk === "high" ? 6 : marketRisk === "medium" ? 3 : 0)
    ),
    estimated_build_time_hours: buildHours,
    maintenance_cost: maintenance,
    permission_risk: permission,
    policy_risk: policy,
    clone_risk: clone,
    market_test_risk: marketRisk,
    testability_score: testabilityScore,
    suggested_price: candidate.suggested_price,
    free_limit: candidate.free_limit,
    monetization_model: candidate.upsell_model,
    success_metrics: defaultSuccessMetrics(candidate),
    kill_criteria: defaultKillCriteria(),
    gate_checks: gateChecks,
    result,
    rationale: result === "market_test_build_ready"
      ? "The wedge is narrow, low-risk, cheap to build, and measurable enough for a market-first MVP."
      : result === "fake_door_first"
        ? "The wedge is promising, but still better suited to a fake-door or small demand test before code."
        : result === "skip"
          ? "Risk is too high for a market-first MVP."
          : "The wedge is not yet tight or measurable enough for a time-boxed micro launch."
  };
}

function selectionPriority(candidateName) {
  const normalized = lower(candidateName);
  const exactIndex = PRIORITY_ORDER.findIndex((item) => item === normalized);
  if (exactIndex >= 0) {
    return exactIndex;
  }
  const containsIndex = PRIORITY_ORDER.findIndex((item) => normalized.includes(item) || item.includes(normalized));
  return containsIndex >= 0 ? containsIndex : 999;
}

function chooseMicroMvp(entries) {
  const viable = entries
    .filter((entry) => entry.result === "market_test_build_ready" || entry.result === "fake_door_first")
    .sort((left, right) => {
      const priorityDelta = selectionPriority(left.candidate_name) - selectionPriority(right.candidate_name);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return Number(right.market_test_score ?? 0) - Number(left.market_test_score ?? 0);
    });

  return viable[0] ?? entries.sort((left, right) => Number(right.market_test_score ?? 0) - Number(left.market_test_score ?? 0))[0] ?? null;
}

function buildMarketTestPlan(selectedCandidate, gateEntry) {
  const successMetrics = defaultSuccessMetrics(selectedCandidate);
  const killCriteria = defaultKillCriteria();
  return buildSafeReport({
    stage: "MARKET_TEST_PLAN",
    status: "passed",
    candidate_name: selectedCandidate.candidate_name,
    wedge_name: selectedCandidate.wedge_name,
    market_test_mode_enabled: true,
    why_market_test_allowed: "The wedge is one-job, low-risk, measurable, and fits a small time-boxed build instead of a large research loop.",
    minimum_evidence_required: [
      "One-sentence product explanation is clear",
      "Permissions stay low or medium-low",
      "Build fits a 16-hour budget",
      "Price and free-limit strategy already exist"
    ],
    evidence_weaknesses_accepted: [
      "No strong interview pack is required before the MVP",
      "Buying intent can be moderate if the wedge is low-risk and measurable",
      "The first experiment may validate with real install and upgrade behavior instead of interviews"
    ],
    build_time_budget_hours: gateEntry.estimated_build_time_hours,
    maintenance_budget: "low: no DOM-heavy automation, no background sync, no server dependency in MVP",
    permission_risk: gateEntry.permission_risk,
    policy_risk: gateEntry.policy_risk,
    clone_risk: gateEntry.clone_risk,
    price_test: selectedCandidate.suggested_price,
    free_limit: selectedCandidate.free_limit,
    monetization_model: selectedCandidate.monetization_model ?? selectedCandidate.upsell_model,
    launch_channels: [...(selectedCandidate.distribution_channels ?? []), "landing page"],
    success_metrics: successMetrics,
    failure_metrics: [
      "Low install or signup conversion after meaningful traffic",
      "No upgrade interest after people reach value",
      "Review feedback points to clone perception or unclear wedge"
    ],
    test_duration_days: 14,
    kill_criteria: killCriteria,
    iterate_criteria: [
      "Users complete the core action but do not click upgrade yet",
      "Install or waitlist conversion is decent, but value framing needs work",
      "Feedback suggests a narrower output format or onboarding change"
    ],
    scale_criteria: [
      "10+ installs or signups with meaningful core-action usage",
      "3+ upgrade clicks",
      "1+ payment intent or explicit would-pay signal"
    ],
    next_step: "human_approve_micro_mvp_build"
  });
}

function buildMetricsSpec() {
  const events = [
    "install",
    "first_open",
    "core_action_completed",
    "free_action_used",
    "free_limit_reached",
    "upgrade_clicked",
    "payment_page_opened",
    "license_entered",
    "license_activated",
    "uninstall_feedback_manual"
  ].map((eventName) => ({
    event_name: eventName,
    timestamp: "ISO-8601 timestamp",
    extension_version: "manifest version",
    anonymous_install_id: "random local identifier",
    plan: "free|lifetime",
    metadata: "minimal non-sensitive event metadata only",
    privacy_notes: "No page content and no personal sensitive data."
  }));

  return buildSafeReport({
    stage: "MARKET_TEST_METRICS_SPEC",
    status: "passed",
    privacy_default: "local_only_no_upload",
    implementation_mode: "schema_only_for_now",
    events,
    rules: [
      "Default to local-only counters.",
      "Do not collect page content.",
      "Do not collect personal sensitive data.",
      "If remote analytics are added later, disclose them explicitly in privacy copy."
    ]
  });
}

function buildLaunchPlan(selectedCandidate, gateEntry) {
  return buildSafeReport({
    stage: "MARKET_TEST_LAUNCH_PLAN",
    status: "passed",
    candidate_name: selectedCandidate.candidate_name,
    wedge_name: selectedCandidate.wedge_name,
    launch_type: [
      "chrome_web_store_public",
      "unlisted_plus_landing_page",
      "landing_page_only",
      "trusted_testers"
    ],
    recommended_launch_type: gateEntry.market_test_risk === "high" ? "unlisted_plus_landing_page" : "chrome_web_store_public",
    launch_channels: [...(selectedCandidate.distribution_channels ?? []), "small landing page"],
    listing_copy_angle: "One small, local-only browser workflow. No upload. No login. One click to value.",
    first_7_days_actions: [
      "Ship the smallest MVP scope only.",
      "Watch install, first_open, and core_action_completed counts.",
      "Collect explicit upgrade-click and payment-page-open signals."
    ],
    first_14_days_actions: [
      "Evaluate install-to-core-action conversion.",
      "Compare upgrade clicks against free-limit reaches.",
      "Decide kill, iterate, or scale based on the thresholds."
    ],
    success_thresholds: defaultSuccessMetrics(selectedCandidate),
    kill_thresholds: defaultKillCriteria(),
    iteration_plan: [
      "Refine onboarding if first_open is high but core_action_completed is low.",
      "Refine pricing copy if usage is healthy but upgrade clicks are weak.",
      "Kill the experiment if traction is flat after meaningful exposure."
    ]
  });
}

function buildPaymentLinkFlow(selectedCandidate) {
  return buildSafeReport({
    stage: "PAYMENT_LINK_FLOW_PLAN",
    status: "passed",
    candidate_name: selectedCandidate.candidate_name,
    wedge_name: selectedCandidate.wedge_name,
    payment_provider_options: ["Stripe Payment Link", "Stripe Checkout", "Gumroad/manual license", "Lemon Squeezy", "Paddle"],
    recommended_checkout_provider: "Stripe Payment Link",
    checkout_url_placeholder: "https://payments.example.com/checkout/page-context-to-markdown",
    browser_open_flow: [
      "User clicks Upgrade in the popup.",
      "Extension opens an external checkout URL with chrome.tabs.create.",
      "Checkout and card handling stay outside the extension."
    ],
    license_delivery_flow: [
      "User completes payment.",
      "A manual or lightweight automated process sends a license key.",
      "User pastes the key into the extension."
    ],
    upgrade_ui_copy: [
      `Free usage left: show remaining ${selectedCandidate.free_limit}`,
      `Lifetime unlock price: ${selectedCandidate.suggested_price}`,
      "Enter license key"
    ],
    listing_payment_disclosure: "Store listing must clearly state the free tier and the paid lifetime unlock.",
    privacy_notes: [
      "The extension does not process credit cards.",
      "The extension must not contain Stripe secret keys."
    ]
  });
}

function buildLicenseActivationSpec(selectedCandidate) {
  return buildSafeReport({
    stage: "LICENSE_ACTIVATION_SPEC",
    status: "passed",
    candidate_name: selectedCandidate.candidate_name,
    wedge_name: selectedCandidate.wedge_name,
    storage_fields: ["anonymous_install_id", "license_key", "license_status", "license_checked_at", "lifetime_unlock_granted"],
    activation_modes: ["manual key entry", "lightweight verifier endpoint later"],
    offline_grace_period: "7 days",
    invalid_key_behavior: "Keep the user on the free plan and show a retry prompt.",
    privacy_notes: [
      "Do not upload page content during activation.",
      "Only send minimal license metadata if a verifier exists later."
    ],
    first_version_notes: [
      "Manual key issuance is acceptable for the first market test.",
      "No card data or payment secrets live inside the extension."
    ]
  });
}

function buildValueFirstPaywallRules(selectedCandidate) {
  return buildSafeReport({
    stage: "VALUE_FIRST_PAYWALL_RULES",
    status: "passed",
    candidate_name: selectedCandidate.candidate_name,
    wedge_name: selectedCandidate.wedge_name,
    free_limit: selectedCandidate.free_limit,
    lifetime_unlock_price: selectedCandidate.suggested_price,
    rules: [
      "Do not block the first core action before the user sees value.",
      "Always show free usage left.",
      "Upgrade opens an external payment page, not an in-extension card form.",
      "List paid features clearly in the store listing.",
      "No dark patterns and no fake scarcity."
    ]
  });
}

function buildPageContextPlan(selectedCandidate, gateEntry) {
  return buildSafeReport({
    stage: "PAGE_CONTEXT_MARKET_TEST_PLAN",
    status: "passed",
    candidate_name: selectedCandidate.candidate_name,
    wedge_name: selectedCandidate.wedge_name,
    suggested_price: "$19",
    free_limit: "10 actions",
    exact_free_tier: "10 free actions with copy-to-clipboard access included.",
    exact_pro_tier: "Unlimited actions for $19 lifetime unlock, plus license activation and no free-limit cap.",
    one_sentence_value: "Copy the current page context into Markdown for support and QA handoff without uploads or integrations.",
    launch_copy: "Local-only page context to Markdown for bug reports and support tickets.",
    listing_title_candidates: [
      "Page Context to Markdown",
      "Bug Report Context Copier",
      "Support Ticket Context Markdown"
    ],
    short_description_candidates: [
      "Copy URL, title, timestamp, and repro steps into Markdown.",
      "Local-only support and QA handoff helper for the current page.",
      "One click to a clean bug-report context block."
    ],
    payment_cta: "Unlock unlimited Markdown copies for $19 lifetime.",
    screenshot_plan: [
      "Popup with repro-step input",
      "Generated Markdown preview",
      "Free usage counter and upgrade CTA"
    ],
    mvp_scope: [
      "Capture current page title and URL",
      "Capture timestamp",
      "Generate repro steps template",
      "Optional browser info if feasible",
      "Copy Markdown to clipboard",
      "10 free actions",
      "$19 lifetime unlock",
      "No upload",
      "No login",
      "No automatic sending"
    ],
    first_version_feature_list: [
      "Popup input for repro steps",
      "Local Markdown generation",
      "Copy to clipboard",
      "Free-limit counter",
      "External upgrade link and license key entry"
    ],
    non_goals: [
      "screenshot or video upload",
      "Jira, Linear, or GitHub integration",
      "team workspace",
      "AI summarization",
      "cloud sync"
    ],
    build_time_budget: `${gateEntry.estimated_build_time_hours} hours`,
    success_metrics: defaultSuccessMetrics(selectedCandidate),
    kill_criteria: defaultKillCriteria()
  });
}

function renderSimpleMarkdown(title, lines) {
  return [
    `# ${title}`,
    "",
    ...lines
  ].join("\n");
}

async function writeMarketArtifacts(state, artifacts) {
  const validations = [
    ["payment_link_flow_plan.schema.json", PAYMENT_LINK_FLOW_ARTIFACT, artifacts.paymentLinkFlow],
    ["license_activation_spec.schema.json", LICENSE_ACTIVATION_ARTIFACT, artifacts.licenseActivation],
    ["value_first_paywall_rules.schema.json", VALUE_FIRST_PAYWALL_ARTIFACT, artifacts.paywallRules],
    ["market_test_plan.schema.json", MARKET_TEST_PLAN_ARTIFACT, artifacts.marketTestPlan],
    ["market_first_build_gate.schema.json", MARKET_FIRST_GATE_ARTIFACT, artifacts.marketGate],
    ["micro_mvp_selection.schema.json", MICRO_MVP_SELECTION_ARTIFACT, artifacts.selection],
    ["market_test_metrics_spec.schema.json", MARKET_TEST_METRICS_ARTIFACT, artifacts.metricsSpec],
    ["market_test_launch_plan.schema.json", MARKET_TEST_LAUNCH_PLAN_ARTIFACT, artifacts.launchPlan],
    ["page_context_market_test_plan.schema.json", PAGE_CONTEXT_MARKET_TEST_PLAN_ARTIFACT, artifacts.pageContextPlan]
  ];

  for (const [schemaName, artifactName, data] of validations) {
    await validateArtifact(state.projectRoot, schemaName, artifactName, data);
    await writeManagedJsonArtifact({ runDir: state.runDir, runContext: state.runContext, artifactName, data });
  }

  const markdownArtifacts = [
    ["103_market_test_plan.md", "103_market_test_plan", artifacts.marketTestPlan, "Market Test Plan"],
    ["105_micro_mvp_selection.md", "105_micro_mvp_selection", artifacts.selection, "Micro MVP Selection"],
    ["106_market_test_metrics_spec.md", "106_market_test_metrics_spec", artifacts.metricsSpec, "Market Test Metrics Spec"],
    ["107_market_test_launch_plan.md", "107_market_test_launch_plan", artifacts.launchPlan, "Market Test Launch Plan"],
    ["108_page_context_market_test_plan.md", "108_page_context_market_test_plan", artifacts.pageContextPlan, "Page Context Market Test Plan"]
  ];

  for (const [fileName, prefix, report, title] of markdownArtifacts) {
    await writeManagedMarkdownArtifact({
      runDir: state.runDir,
      runContext: state.runContext,
      fileName,
      category: "market_test",
      prefix,
      content: renderSimpleMarkdown(title, [
        markdownSection("Summary", markdownList(
          Object.entries(report)
            .filter(([key, value]) => !["redaction_checks"].includes(key) && typeof value !== "object")
            .map(([key, value]) => `${key}: ${value}`)
        ))
      ])
    });
  }

  await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "96_payment_link_flow_plan.md",
    category: "market_test",
    prefix: "96_payment_link_flow_plan",
    content: renderSimpleMarkdown("Payment Link Flow Plan", [markdownSection("Flow", markdownList(artifacts.paymentLinkFlow.browser_open_flow))])
  });
  await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "97_license_activation_spec.md",
    category: "market_test",
    prefix: "97_license_activation_spec",
    content: renderSimpleMarkdown("License Activation Spec", [markdownSection("Storage Fields", markdownList(artifacts.licenseActivation.storage_fields))])
  });
  await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "98_value_first_paywall_rules.md",
    category: "market_test",
    prefix: "98_value_first_paywall_rules",
    content: renderSimpleMarkdown("Value-First Paywall Rules", [markdownSection("Rules", markdownList(artifacts.paywallRules.rules))])
  });
}

export async function selectMicroMvp({ projectRoot }) {
  const state = await loadMarketState(projectRoot);
  const entries = (state.wedges.candidates ?? []).map((candidate) => buildMarketFirstEntry(candidate, state.paidInterest));
  const selectedEntry = chooseMicroMvp(entries);
  if (!selectedEntry) {
    throw new Error("No market-test candidate could be selected.");
  }
  const selectedCandidate = resolveCandidate(state.wedges, selectedEntry.candidate_name);
  if (!selectedCandidate) {
    throw new Error(`Selected candidate ${selectedEntry.candidate_name} could not be resolved from money wedge artifacts.`);
  }

  const marketGate = buildSafeReport({
    stage: "MARKET_FIRST_BUILD_GATE",
    status: "passed",
    candidate_count: entries.length,
    entries,
    next_step: "human_approve_micro_mvp_build"
  });
  const selection = buildSafeReport({
    stage: "MICRO_MVP_SELECTION",
    status: "passed",
    selected: selectedEntry.result !== "skip",
    candidate_name: selectedCandidate.candidate_name,
    wedge_name: selectedCandidate.wedge_name,
    reason: selectedEntry.rationale,
    market_test_score: selectedEntry.market_test_score,
    build_cost: `${selectedEntry.estimated_build_time_hours}h`,
    permission_risk: selectedEntry.permission_risk,
    clone_risk: selectedEntry.clone_risk,
    policy_risk: selectedEntry.policy_risk,
    expected_price: selectedCandidate.suggested_price,
    free_limit: selectedCandidate.free_limit,
    launch_strategy: selectedEntry.market_test_risk === "high" ? "small_launch_after_human_approval" : "micro_public_launch_after_human_approval",
    success_metrics: defaultSuccessMetrics(selectedCandidate),
    kill_criteria: defaultKillCriteria(),
    next_step: "human_approve_micro_mvp_build"
  });
  const artifacts = {
    paymentLinkFlow: buildPaymentLinkFlow(selectedCandidate),
    licenseActivation: buildLicenseActivationSpec(selectedCandidate),
    paywallRules: buildValueFirstPaywallRules(selectedCandidate),
    marketTestPlan: buildMarketTestPlan(selectedCandidate, selectedEntry),
    marketGate,
    selection,
    metricsSpec: buildMetricsSpec(),
    launchPlan: buildLaunchPlan(selectedCandidate, selectedEntry),
    pageContextPlan: buildPageContextPlan(resolveCandidate(state.wedges, "Page Context to Markdown") ?? selectedCandidate, selectedEntry)
  };

  await writeMarketArtifacts(state, artifacts);

  return {
    runDir: state.runDir,
    runContext: state.runContext,
    selectedCandidate,
    selectedEntry,
    artifacts
  };
}

export async function createMonetizationFakeDoor({ projectRoot, candidate }) {
  const state = await loadMarketState(projectRoot);
  const resolved = resolveCandidate(state.wedges, candidate);
  if (!resolved) {
    throw new Error(`No market candidate matched "${candidate}".`);
  }
  return createFakeDoorTest({ projectRoot, candidate: resolved.candidate_id });
}

export async function scorePaidInterestExperiment({ projectRoot, experiment }) {
  const state = await loadMarketState(projectRoot);
  const candidate = resolveCandidate(state.wedges, experiment);
  if (!candidate) {
    throw new Error(`No market candidate matched "${experiment}".`);
  }
  const risk = marketTestRisk(candidate, null);
  const report = buildSafeReport({
    stage: "PAID_INTEREST_EXPERIMENT",
    status: "passed",
    experiment_id: lower(experiment).replace(/[^a-z0-9]+/g, "-"),
    source_run_id: state.runContext.run_id,
    candidate_name: candidate.candidate_name,
    wedge_name: candidate.wedge_name,
    suggested_price: candidate.suggested_price,
    free_limit: candidate.free_limit,
    paid_interest_score: round(
      (Number(candidate.money_scores?.buying_intent_score ?? 0) * 0.45)
      + (Number(candidate.money_scores?.user_time_saved_score ?? 0) * 0.2)
      + (Number(candidate.money_scores?.one_job_clarity_score ?? 0) * 0.15)
      + (Number(candidate.money_scores?.distribution_channel_score ?? 0) * 0.1)
      + (Number(candidate.money_scores?.permission_trust_score ?? 0) * 0.1)
    ),
    market_test_risk: risk,
    fake_door_available: true,
    evidence_summary: {
      money_total_score: candidate.money_scores?.total_money_score ?? 0,
      buying_intent_score: candidate.money_scores?.buying_intent_score ?? 0,
      time_saved_score: candidate.money_scores?.user_time_saved_score ?? 0,
      pricing_ready: Boolean(candidate.suggested_price && candidate.free_limit)
    },
    limitations: [
      "No real paid traffic yet.",
      "No direct payment intent logs yet.",
      "This score is a planning artifact, not real revenue proof."
    ],
    recommended_action: risk === "high" ? "small_launch_only_after_human_approval" : "approve_micro_mvp_then_measure_paid_interest"
  });

  await validateArtifact(projectRoot, "paid_interest_experiment.schema.json", PAID_INTEREST_ARTIFACT, report);
  await writeManagedJsonArtifact({ runDir: state.runDir, runContext: state.runContext, artifactName: PAID_INTEREST_ARTIFACT, data: report });
  await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "100_paid_interest_experiment.md",
    category: "market_test",
    prefix: "100_paid_interest_experiment",
    content: renderSimpleMarkdown("Paid Interest Experiment", [
      markdownSection("Summary", markdownList([
        `candidate_name: ${report.candidate_name}`,
        `wedge_name: ${report.wedge_name}`,
        `suggested_price: ${report.suggested_price}`,
        `paid_interest_score: ${report.paid_interest_score}`,
        `market_test_risk: ${report.market_test_risk}`,
        `recommended_action: ${report.recommended_action}`
      ]))
    ])
  });

  return {
    runDir: state.runDir,
    runContext: state.runContext,
    report
  };
}

export async function approveMicroMvp({ projectRoot, candidate, note, approvedBy = "human" }) {
  const state = await loadMarketState(projectRoot);
  const resolved = resolveCandidate(state.wedges, candidate);
  if (!resolved) {
    throw new Error(`No market candidate matched "${candidate}".`);
  }

  const approval = {
    candidate_name: resolved.candidate_name,
    wedge_name: resolved.wedge_name,
    approval_status: "approved_for_market_test_build_scope_only",
    approved_by: approvedBy,
    approved_at: nowIso(),
    build_time_budget_hours: estimatedBuildTimeHours(resolved),
    max_scope: [
      "single-purpose MVP only",
      "no upload",
      "no login",
      "no automatic sending",
      "no extra integrations outside the approved scope"
    ],
    allowed_price_test: resolved.suggested_price,
    allowed_payment_mode: "external_payment_link_plus_manual_license",
    approval_notes: note
  };

  await assertMatchesSchema({
    data: approval,
    schemaPath: path.join(projectRoot, "schemas", "market_test_approval.schema.json"),
    label: "state/market_test_approvals"
  });
  const filePath = path.join(projectRoot, APPROVAL_DIR, `${stamp()}-${resolved.candidate_id}.json`);
  await ensureDir(path.dirname(filePath));
  await writeJson(filePath, approval);
  return { filePath, approval };
}
