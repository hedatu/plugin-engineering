import fs from "node:fs/promises";
import path from "node:path";
import { loadPortfolioRegistry } from "../portfolio/registry.mjs";
import { fetchAllowedText } from "../research/liveResearch.mjs";
import {
  buildSafeReport,
  loadOptionalManagedArtifact,
  markdownList,
  markdownSection,
  validateArtifact,
  writeManagedJsonArtifact,
  writeManagedMarkdownArtifact
} from "../review/helpers.mjs";
import { fileExists, readJson } from "../utils/io.mjs";

const MONEY_SCORES_ARTIFACT = "87_money_first_opportunity_scores.json";
const COMPETITOR_MAP_ARTIFACT = "88_competitor_price_value_map.json";
const MONEY_WEDGES_ARTIFACT = "89_money_micro_wedge_candidates.json";
const PRICING_PLAN_ARTIFACT = "90_pricing_experiment_plan.json";
const PAYMENT_PLAN_ARTIFACT = "91_payment_license_architecture_plan.json";
const MONEY_GATE_ARTIFACT = "92_money_first_build_gate.json";
const FAKE_DOOR_ARTIFACT = "93_fake_door_test_plan.json";
const OPS_REPORT_ARTIFACT = "94_money_first_ops_report.json";

const MANUAL_SEED_PLAN_ARTIFACT = "65_manual_seed_plan.json";
const SEED_NEXT_CANDIDATE_ARTIFACT = "72_seed_next_candidate.json";
const SEED_PERFORMANCE_ARTIFACT = "74_seed_performance_report.json";
const SUPPORT_QA_EVIDENCE_SPRINT_ARTIFACT = "80_support_qa_evidence_sprint.json";
const SUPPORT_QA_RESCORE_ARTIFACT = "83_candidate_rescore_with_manual_evidence.json";

const EXISTING_BUILDERS = new Set([
  "single_profile_form_fill",
  "tab_csv_window_export",
  "gmail_snippet"
]);

const COMPETITOR_CATALOG = [
  {
    competitor_name: "Jam",
    category: "support_qa_handoff",
    pricing_model: "freemium_team_subscription",
    pricing_url: "https://jam.dev/pricing",
    main_features: ["bug capture", "screenshots and video", "cloud sharing", "issue tracker integrations"],
    overloaded_features: ["video capture", "team collaboration", "cloud upload", "external integrations"],
    expensive_for_small_users_reason: "A solo support or QA user who only wants copy-ready browser context pays for a larger hosted collaboration workflow.",
    possible_micro_wedges: ["Page Context to Markdown", "Support Ticket Context Packet", "QA Repro Steps Clipboard Helper"],
    what_not_to_copy: ["screenshots", "video capture", "cloud links", "issue creation"],
    differentiation_angle: "Stay local-only, text-first, and clipboard-first.",
    cheap_lifetime_offer: "$19 lifetime for a local-only handoff helper.",
    clone_risk: "medium",
    policy_risk: "low",
    recommended_action: "split out the local text handoff layer only"
  },
  {
    competitor_name: "BugHerd",
    category: "support_qa_handoff",
    pricing_model: "team_subscription",
    pricing_url: "https://bugherd.com/pricing",
    main_features: ["visual feedback", "task management", "collaboration", "website feedback boards"],
    overloaded_features: ["feedback boards", "project workflow", "team seats"],
    expensive_for_small_users_reason: "Small teams that just need faster handoff context do not need a full feedback management suite.",
    possible_micro_wedges: ["Support Ticket Context Packet", "Page Context to Markdown"],
    what_not_to_copy: ["full project management", "visual task boards", "team workspace UX"],
    differentiation_angle: "Focus on one local artifact instead of a shared feedback system.",
    cheap_lifetime_offer: "$19 lifetime for a no-upload handoff packet.",
    clone_risk: "low",
    policy_risk: "low",
    recommended_action: "keep only the one-click context packet"
  },
  {
    competitor_name: "Marker.io",
    category: "support_qa_handoff",
    pricing_model: "team_subscription",
    pricing_url: "https://marker.io/pricing",
    main_features: ["bug reporting", "screenshots", "metadata capture", "Jira and Linear integrations"],
    overloaded_features: ["hosted workflows", "issue tracker sync", "team reporting"],
    expensive_for_small_users_reason: "A one-person QA or support workflow may only need metadata and structured notes, not tracker automation.",
    possible_micro_wedges: ["Page Context to Markdown", "QA Repro Steps Clipboard Helper"],
    what_not_to_copy: ["tracker integrations", "hosted screenshot flows"],
    differentiation_angle: "Keep the output as local Markdown instead of a remote bug-report pipeline.",
    cheap_lifetime_offer: "$19 lifetime for structured handoff notes.",
    clone_risk: "medium",
    policy_risk: "low",
    recommended_action: "narrow to a low-permission local-only wedge"
  },
  {
    competitor_name: "Loom",
    category: "support_qa_handoff",
    pricing_model: "freemium_video_subscription",
    pricing_url: "https://www.loom.com/pricing",
    main_features: ["screen recording", "video sharing", "async communication"],
    overloaded_features: ["video hosting", "workspace collaboration"],
    expensive_for_small_users_reason: "Users who only need structured page context do not need hosted video workflows.",
    possible_micro_wedges: ["QA Repro Steps Clipboard Helper"],
    what_not_to_copy: ["video capture", "video hosting"],
    differentiation_angle: "Offer copyable context instead of recorded media.",
    cheap_lifetime_offer: "$9-$19 lifetime instead of subscription video tooling.",
    clone_risk: "low",
    policy_risk: "low",
    recommended_action: "avoid media features and keep the wedge text-first"
  },
  {
    competitor_name: "Text Blaze",
    category: "email_template_helper",
    pricing_model: "freemium_subscription",
    pricing_url: "https://blaze.today/plans",
    main_features: ["snippets", "templates", "forms", "team sharing"],
    overloaded_features: ["team sharing", "dynamic forms", "cross-app automation"],
    expensive_for_small_users_reason: "A support rep who only needs a few local Gmail inserts may not want a broad productivity suite.",
    possible_micro_wedges: ["Support Email Template Quick Insert", "One-job Gmail snippet helper"],
    what_not_to_copy: ["team sync", "broad expansion system", "template marketplace"],
    differentiation_angle: "Limit scope to a very narrow support reply workflow.",
    cheap_lifetime_offer: "$19 lifetime for a narrow local Gmail helper.",
    clone_risk: "medium",
    policy_risk: "low",
    recommended_action: "only pursue if the target workflow is narrower than generic snippets"
  },
  {
    competitor_name: "Magical",
    category: "email_template_helper",
    pricing_model: "freemium_subscription",
    pricing_url: "https://www.getmagical.com/pricing",
    main_features: ["text expansion", "autofill", "workflow automation"],
    overloaded_features: ["broad automation", "generic autofill", "cross-app sync"],
    expensive_for_small_users_reason: "A small support team may only need one narrow insert workflow, not broad automation.",
    possible_micro_wedges: ["Support Email Template Quick Insert", "SaaS Admin Clipboard Cleanup"],
    what_not_to_copy: ["generic autofill", "workflow automation", "sync-heavy UX"],
    differentiation_angle: "Stay narrow, low-permission, and local-only.",
    cheap_lifetime_offer: "$19 lifetime for a small support workflow helper.",
    clone_risk: "medium",
    policy_risk: "low",
    recommended_action: "keep scope far below generic automation"
  }
];

const WEDGE_TEMPLATES = [
  {
    wedge_id: "page-context-to-markdown",
    wedge_name: "Page Context to Markdown",
    mature_demand_category: "support_qa_handoff",
    seed_ids: ["seed-support-qa-handoff"],
    source_candidate_names: ["Jam", "BetterBugs", "TicketHop"],
    user_segment: "QA testers and support agents",
    painful_job_to_be_done: "Turn the current browser page into a copy-ready bug handoff note without screenshots or uploads.",
    one_sentence_value: "One click generates local Markdown with URL, title, browser info, timestamp, and repro steps.",
    what_it_does: ["captures current page URL and title", "lets the user type repro steps", "copies a Markdown block to the clipboard"],
    what_it_explicitly_does_not_do: ["no screenshot capture", "no video recording", "no upload", "no Jira or Linear creation"],
    why_user_would_pay: "It compresses a repeated support or QA handoff action into one low-risk step.",
    why_lifetime_price_works: "The value is immediate, local-only, and does not require a recurring backend.",
    suggested_price: "$19",
    free_limit: "10 actions",
    upsell_model: "free_with_lifetime_unlock",
    required_permissions: ["activeTab"],
    expected_builder: "support_context_clipboard_builder",
    builder_cost: "small",
    builder_gap: "small_new_builder",
    testability_plan: "Use a fixture page, enter repro steps, copy Markdown, and verify no network requests.",
    distribution_channels: ["Chrome Web Store", "QA communities", "support ops communities"],
    policy_risk_base: 14,
    clone_risk_base: 24,
    maintenance_base: 84,
    support_burden_base: 78,
    distribution_base: 78,
    time_save_base: 36,
    buying_intent_base: 40,
    one_job_bonus: 18,
    base_overlap_score: 34,
    local_only: true,
    dom_fragility: false,
    needs_manual_evidence: true,
    monitor_only: false
  },
  {
    wedge_id: "support-ticket-context-packet",
    wedge_name: "Support Ticket Context Packet",
    mature_demand_category: "support_qa_handoff",
    seed_ids: ["seed-support-qa-handoff"],
    source_candidate_names: ["Jam", "TicketHop", "ProductSights"],
    user_segment: "Support agents and customer success teams",
    painful_job_to_be_done: "Package the current browser context into a helpdesk-ready block without sending data anywhere.",
    one_sentence_value: "Generate a local-only support ticket packet with URL, title, browser info, timestamp, and problem template.",
    what_it_does: ["creates a helpdesk-friendly text block", "includes environment context", "lets the user download or copy the packet locally"],
    what_it_explicitly_does_not_do: ["no helpdesk API calls", "no screenshot upload", "no session replay"],
    why_user_would_pay: "It removes repetitive manual context gathering during ticket escalations.",
    why_lifetime_price_works: "The workflow is narrow and stable enough for a simple buy-once utility.",
    suggested_price: "$19",
    free_limit: "10 packets",
    upsell_model: "free_with_lifetime_unlock",
    required_permissions: ["activeTab"],
    expected_builder: "support_context_clipboard_builder",
    builder_cost: "small",
    builder_gap: "small_new_builder",
    testability_plan: "Validate helpdesk packet generation, clipboard copy, and local download on a fixture page.",
    distribution_channels: ["Chrome Web Store", "support communities", "customer success communities"],
    policy_risk_base: 14,
    clone_risk_base: 28,
    maintenance_base: 82,
    support_burden_base: 76,
    distribution_base: 74,
    time_save_base: 34,
    buying_intent_base: 38,
    one_job_bonus: 17,
    base_overlap_score: 33,
    local_only: true,
    dom_fragility: false,
    needs_manual_evidence: true,
    monitor_only: false
  },
  {
    wedge_id: "qa-repro-steps-clipboard-helper",
    wedge_name: "QA Repro Steps Clipboard Helper",
    mature_demand_category: "support_qa_handoff",
    seed_ids: ["seed-support-qa-handoff"],
    source_candidate_names: ["Jam", "BetterBugs"],
    user_segment: "QA testers",
    painful_job_to_be_done: "Produce structured repro steps with the right browser metadata in one low-permission flow.",
    one_sentence_value: "Generate a repro-steps-first Markdown template plus page metadata and copy it to the clipboard.",
    what_it_does: ["collects repro steps", "adds current page metadata", "generates a copy-ready checklist"],
    what_it_explicitly_does_not_do: ["no screenshot or video tools", "no issue creation"],
    why_user_would_pay: "It makes a frustrating QA ritual faster and more consistent.",
    why_lifetime_price_works: "The output stays local and the feature set is intentionally small.",
    suggested_price: "$19",
    free_limit: "10 reports",
    upsell_model: "free_with_lifetime_unlock",
    required_permissions: ["activeTab"],
    expected_builder: "support_context_clipboard_builder",
    builder_cost: "small",
    builder_gap: "small_new_builder",
    testability_plan: "Verify structured repro step capture, Markdown generation, and no network requests.",
    distribution_channels: ["Chrome Web Store", "QA Slack groups", "testing communities"],
    policy_risk_base: 14,
    clone_risk_base: 26,
    maintenance_base: 84,
    support_burden_base: 78,
    distribution_base: 70,
    time_save_base: 33,
    buying_intent_base: 36,
    one_job_bonus: 18,
    base_overlap_score: 32,
    local_only: true,
    dom_fragility: false,
    needs_manual_evidence: true,
    monitor_only: false
  },
  {
    wedge_id: "saas-admin-clipboard-cleanup",
    wedge_name: "SaaS Admin Clipboard Cleanup",
    mature_demand_category: "saas_admin_cleanup",
    seed_ids: ["seed-saas-admin-cleanup"],
    source_candidate_names: ["Click&Clean"],
    user_segment: "Support ops and admin users in SaaS back offices",
    painful_job_to_be_done: "Clean copied rows or messy admin values before pasting them into the next tool.",
    one_sentence_value: "Normalize selected text or pasted rows into a clean, local-only output block.",
    what_it_does: ["cleans copied table text", "normalizes separators and whitespace", "keeps transformation local"],
    what_it_explicitly_does_not_do: ["no tab export", "no scraping", "no CRM automation"],
    why_user_would_pay: "It saves repeated copy-paste cleanup time in a workflow people already hate.",
    why_lifetime_price_works: "A deterministic local transform can be sold as a small utility instead of a recurring service.",
    suggested_price: "$19",
    free_limit: "10 cleanups",
    upsell_model: "free_with_lifetime_unlock",
    required_permissions: [],
    expected_builder: "clipboard_cleanup_builder",
    builder_cost: "small",
    builder_gap: "small_new_builder",
    testability_plan: "Use deterministic input-output fixtures for messy copied text and cleaned output.",
    distribution_channels: ["Chrome Web Store", "ops communities", "admin workflow posts"],
    policy_risk_base: 10,
    clone_risk_base: 26,
    maintenance_base: 76,
    support_burden_base: 74,
    distribution_base: 72,
    time_save_base: 35,
    buying_intent_base: 37,
    one_job_bonus: 16,
    base_overlap_score: 44,
    local_only: true,
    dom_fragility: false,
    needs_manual_evidence: false,
    monitor_only: false
  },
  {
    wedge_id: "clipboard-table-to-clean-csv",
    wedge_name: "Clipboard Table to Clean CSV",
    mature_demand_category: "csv_table_cleanup",
    seed_ids: ["seed-table-cleanup", "seed-saas-admin-cleanup"],
    source_candidate_names: ["Click&Clean"],
    user_segment: "Operators and analysts copying tables from browser pages",
    painful_job_to_be_done: "Turn copied table text into clean CSV without a spreadsheet detour.",
    one_sentence_value: "Convert copied page-table text into normalized CSV locally and copy or download it.",
    what_it_does: ["parses copied table text", "outputs clean CSV", "offers clipboard or local download"],
    what_it_explicitly_does_not_do: ["no tab export", "no remote ETL", "no cloud sync"],
    why_user_would_pay: "It removes a tiny but frequent operational nuisance and is easy to justify as a cheap utility.",
    why_lifetime_price_works: "The job is narrow, local, and not dependent on a backend.",
    suggested_price: "$19",
    free_limit: "10 conversions",
    upsell_model: "free_with_lifetime_unlock",
    required_permissions: [],
    expected_builder: "clipboard_cleanup_builder",
    builder_cost: "small",
    builder_gap: "small_new_builder",
    testability_plan: "Run input-output fixtures for copied tables, malformed separators, and CSV output.",
    distribution_channels: ["Chrome Web Store", "ops communities", "spreadsheet cleanup forums"],
    policy_risk_base: 10,
    clone_risk_base: 22,
    maintenance_base: 80,
    support_burden_base: 76,
    distribution_base: 68,
    time_save_base: 32,
    buying_intent_base: 34,
    one_job_bonus: 17,
    base_overlap_score: 42,
    local_only: true,
    dom_fragility: false,
    needs_manual_evidence: false,
    monitor_only: false
  },
  {
    wedge_id: "support-email-template-quick-insert",
    wedge_name: "Support Email Template Quick Insert",
    mature_demand_category: "email_template_helper",
    seed_ids: ["seed-email-template-local"],
    source_candidate_names: [],
    user_segment: "Support reps replying to common tickets in Gmail",
    painful_job_to_be_done: "Insert one narrow reply block fast without adopting a whole text-automation suite.",
    one_sentence_value: "Insert local support reply snippets into Gmail compose without auto-send.",
    what_it_does: ["inserts narrow support snippets", "keeps templates local", "stays inside compose only"],
    what_it_explicitly_does_not_do: ["no mailbox automation", "no send automation", "no team sync"],
    why_user_would_pay: "There is proven willingness to pay for snippets when the workflow is repetitive and visible.",
    why_lifetime_price_works: "A narrow insert-only helper can undercut broader subscription suites.",
    suggested_price: "$19",
    free_limit: "10 inserts",
    upsell_model: "free_with_lifetime_unlock",
    required_permissions: ["activeTab", "storage", "scripting"],
    expected_builder: "gmail_snippet",
    builder_cost: "existing",
    builder_gap: "none",
    testability_plan: "Use a Gmail compose fixture to verify insert-only behavior and no automatic sending.",
    distribution_channels: ["Chrome Web Store", "support ops communities", "Gmail productivity communities"],
    policy_risk_base: 14,
    clone_risk_base: 48,
    maintenance_base: 68,
    support_burden_base: 70,
    distribution_base: 80,
    time_save_base: 34,
    buying_intent_base: 44,
    one_job_bonus: 16,
    base_overlap_score: 24,
    local_only: true,
    dom_fragility: true,
    needs_manual_evidence: false,
    monitor_only: false
  },
  {
    wedge_id: "developer-payload-redaction-lite",
    wedge_name: "Developer Payload Redaction Lite",
    mature_demand_category: "developer_payload_utility",
    seed_ids: ["seed-developer-payload", "seed-local-privacy-transform"],
    source_candidate_names: ["SAML Tracer"],
    user_segment: "Developers and operators handling copied payloads",
    painful_job_to_be_done: "Redact or normalize copied request or response payloads before sharing them.",
    one_sentence_value: "Clean and redact pasted payloads locally without network calls.",
    what_it_does: ["accepts pasted payloads", "redacts sensitive keys", "outputs a clean shareable block"],
    what_it_explicitly_does_not_do: ["no network interception", "no scraping", "no remote AI"],
    why_user_would_pay: "Developers pay when a tiny helper removes repetitive privacy work from debugging handoffs.",
    why_lifetime_price_works: "The value is local, deterministic, and does not need a backend.",
    suggested_price: "$29",
    free_limit: "10 redactions",
    upsell_model: "free_with_lifetime_unlock",
    required_permissions: [],
    expected_builder: "developer_payload_utility",
    builder_cost: "medium",
    builder_gap: "future_builder_monitor_only",
    testability_plan: "Use fixture payloads to validate local redaction and deterministic output.",
    distribution_channels: ["Chrome Web Store", "developer communities", "GitHub issue discussions"],
    policy_risk_base: 10,
    clone_risk_base: 20,
    maintenance_base: 82,
    support_burden_base: 72,
    distribution_base: 62,
    time_save_base: 31,
    buying_intent_base: 32,
    one_job_bonus: 18,
    base_overlap_score: 38,
    local_only: true,
    dom_fragility: false,
    needs_manual_evidence: false,
    monitor_only: true
  },
  {
    wedge_id: "crm-micro-intake-from-single-profile",
    wedge_name: "CRM Micro Intake From Single Profile",
    mature_demand_category: "crm_recruiting_intake",
    seed_ids: ["seed-recruiting-intake"],
    source_candidate_names: [],
    user_segment: "Recruiters and CRM operators",
    painful_job_to_be_done: "Fill one narrow intake workflow from a local profile.",
    one_sentence_value: "Use one local profile for one narrow CRM or recruiting intake workflow with explicit overwrite control.",
    what_it_does: ["fills one narrow intake form", "uses one local profile", "shows overwrite boundaries"],
    what_it_explicitly_does_not_do: ["no generic autofill", "no broad form fill", "no sync"],
    why_user_would_pay: "The workflow saves obvious time, but only if it stays narrow and differentiated.",
    why_lifetime_price_works: "A narrow intake helper can be a simple one-time purchase if scope stays tight.",
    suggested_price: "$19",
    free_limit: "10 fills",
    upsell_model: "free_with_lifetime_unlock",
    required_permissions: ["activeTab", "storage", "scripting"],
    expected_builder: "single_profile_form_fill",
    builder_cost: "existing",
    builder_gap: "none",
    testability_plan: "Use a deterministic intake form fixture and verify overwrite safeguards.",
    distribution_channels: ["Chrome Web Store", "recruiting communities", "CRM operator communities"],
    policy_risk_base: 18,
    clone_risk_base: 72,
    maintenance_base: 64,
    support_burden_base: 64,
    distribution_base: 72,
    time_save_base: 36,
    buying_intent_base: 38,
    one_job_bonus: 14,
    base_overlap_score: 72,
    local_only: true,
    dom_fragility: true,
    needs_manual_evidence: false,
    monitor_only: false
  }
];

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

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

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function slugify(value) {
  return lower(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function average(values, fallback = 0) {
  const numbers = (values ?? []).map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (numbers.length === 0) {
    return fallback;
  }
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function stripHtml(value) {
  return normalizeText(`${value ?? ""}`.replace(/<[^>]+>/g, " "));
}

function riskLabelFromScore(score) {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function extractCurrencyValues(text) {
  const matches = [...(`${text ?? ""}`).matchAll(/(?:US\$|\$|USD\s?)(\d{1,3})(?:\.(\d{1,2}))?/gi)];
  return unique(matches
    .map((match) => Number.parseFloat(`${match[1]}${match[2] ? `.${match[2]}` : ""}`))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 500))
    .sort((left, right) => left - right);
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

async function loadRequiredArtifact(runDir, runContext, artifactName) {
  const artifact = await loadOptionalManagedArtifact({ runDir, artifactName, runContext });
  if (!artifact) {
    throw new Error(`Missing ${artifactName} in ${runDir}.`);
  }
  return artifact;
}

async function loadMoneyFirstInputs(projectRoot) {
  const baseRun = await detectLatestRun(projectRoot, [SEED_PERFORMANCE_ARTIFACT, SEED_NEXT_CANDIDATE_ARTIFACT]);
  if (!baseRun) {
    throw new Error("No run containing 72_seed_next_candidate.json and 74_seed_performance_report.json was found.");
  }
  const seedPlanRun = await detectLatestRun(projectRoot, [MANUAL_SEED_PLAN_ARTIFACT]);
  if (!seedPlanRun) {
    throw new Error("No run containing 65_manual_seed_plan.json was found.");
  }
  const supportRun = await detectLatestRun(projectRoot, [SUPPORT_QA_EVIDENCE_SPRINT_ARTIFACT, SUPPORT_QA_RESCORE_ARTIFACT]);

  return {
    projectRoot,
    runDir: baseRun.runDir,
    runContext: baseRun.runContext,
    manualSeedPlan: await loadRequiredArtifact(seedPlanRun.runDir, seedPlanRun.runContext, MANUAL_SEED_PLAN_ARTIFACT),
    seedPerformance: await loadRequiredArtifact(baseRun.runDir, baseRun.runContext, SEED_PERFORMANCE_ARTIFACT),
    seedNextCandidate: await loadRequiredArtifact(baseRun.runDir, baseRun.runContext, SEED_NEXT_CANDIDATE_ARTIFACT),
    supportEvidenceSprint: supportRun
      ? await loadRequiredArtifact(supportRun.runDir, supportRun.runContext, SUPPORT_QA_EVIDENCE_SPRINT_ARTIFACT)
      : null,
    supportRescore: supportRun
      ? await loadRequiredArtifact(supportRun.runDir, supportRun.runContext, SUPPORT_QA_RESCORE_ARTIFACT)
      : null,
    backlog: await readJson(path.join(projectRoot, "state", "opportunity_backlog.json")),
    portfolioRegistry: await loadPortfolioRegistry(projectRoot)
  };
}

function findBacklogMatches(backlog, template) {
  const keywords = unique([
    template.wedge_name,
    ...template.seed_ids,
    ...template.source_candidate_names,
    ...template.what_it_does,
    ...template.what_it_explicitly_does_not_do
  ]).map((value) => lower(value));

  return (backlog.opportunities ?? []).filter((entry) => {
    const haystack = lower([
      entry.candidate_name,
      entry.selected_wedge,
      entry.pain_summary,
      entry.source_url,
      ...(entry.top_pain_clusters ?? [])
    ].join(" "));
    return keywords.some((keyword) => keyword && haystack.includes(keyword));
  });
}

async function fetchCompetitorPriceSignals() {
  const results = [];
  for (const competitor of COMPETITOR_CATALOG) {
    let publicPrice = "unknown";
    let observedPriceRange = [];
    let fetchStatus = "skipped";

    if (competitor.pricing_url) {
      try {
        const hostname = new URL(competitor.pricing_url).hostname;
        const response = await fetchAllowedText(competitor.pricing_url, {
          additionalHosts: [hostname],
          timeoutMs: 15000
        });
        fetchStatus = response.ok ? "ok" : `http_${response.status}`;
        if (response.ok) {
          observedPriceRange = extractCurrencyValues(stripHtml(response.text));
          if (observedPriceRange.length > 0) {
            publicPrice = `from $${observedPriceRange[0]}`;
          }
        }
      } catch (error) {
        fetchStatus = `failed:${normalizeText(error.message).slice(0, 120)}`;
      }
    }

    results.push({
      ...competitor,
      public_price_if_available: publicPrice,
      observed_price_points: observedPriceRange,
      fetch_status: fetchStatus
    });
  }
  return results;
}

function categoryCompetitors(category, competitors) {
  return competitors.filter((competitor) => competitor.category === category);
}

function scoreMoneyFirstCandidate(template, state, competitors) {
  const backlogMatches = findBacklogMatches(state.backlog, template);
  const seedById = new Map((state.seedPerformance.seeds ?? []).map((item) => [item.seed_id, item]));
  const supportingSeeds = template.seed_ids.map((seedId) => seedById.get(seedId)).filter(Boolean);
  const supportEvidence = template.mature_demand_category === "support_qa_handoff" ? state.supportEvidenceSprint : null;
  const supportRescore = supportEvidence ? state.supportRescore : null;

  const observedEvidenceQuality = average(backlogMatches.map((item) => item.evidence_quality_score), null);
  const observedWedgeClarity = average(backlogMatches.map((item) => item.wedge_clarity_score), null);
  const observedTestability = average(backlogMatches.map((item) => item.testability_score), null);
  const observedOverlap = average(backlogMatches.map((item) => item.portfolio_overlap_score), null);

  const evidenceQuality = round(
    template.wedge_id === "page-context-to-markdown"
      ? (supportEvidence?.updated_evidence_quality_score ?? observedEvidenceQuality ?? average(supportingSeeds.map((item) => item.avg_evidence_quality), 56))
      : observedEvidenceQuality ?? average(supportingSeeds.map((item) => item.avg_evidence_quality), 56)
  );
  const wedgeClarity = round(
    template.wedge_id === "page-context-to-markdown"
      ? (supportEvidence?.updated_wedge_clarity_score ?? observedWedgeClarity ?? average(backlogMatches.map((item) => item.wedge_clarity_score), 72))
      : observedWedgeClarity ?? average(backlogMatches.map((item) => item.wedge_clarity_score), 72)
  );
  const testability = round(
    template.wedge_id === "page-context-to-markdown"
      ? (supportEvidence?.updated_testability_score ?? observedTestability ?? average(supportingSeeds.map((item) => item.avg_testability), 78))
      : observedTestability ?? average(supportingSeeds.map((item) => item.avg_testability), 78)
  );
  const overlapPenalty = round(
    template.wedge_id === "page-context-to-markdown"
      ? (supportEvidence?.updated_portfolio_overlap_score ?? template.base_overlap_score)
      : observedOverlap == null
        ? template.base_overlap_score
        : average([observedOverlap, template.base_overlap_score], template.base_overlap_score)
  );

  const categoryCompetitorMap = categoryCompetitors(template.mature_demand_category, competitors);
  const knownPrices = categoryCompetitorMap.flatMap((item) => item.observed_price_points ?? []);
  const minKnownPrice = knownPrices.length > 0 ? Math.min(...knownPrices) : null;
  const hasPaidAlternatives = categoryCompetitorMap.length > 0;
  const paidAlternativeExistsScore = clamp(hasPaidAlternatives ? 72 + (categoryCompetitorMap.length * 4) : 38);
  const competitorPriceScore = clamp(
    minKnownPrice == null
      ? (hasPaidAlternatives ? 58 : 36)
      : (minKnownPrice >= 29 ? 86 : minKnownPrice >= 19 ? 78 : minKnownPrice >= 9 ? 68 : 58)
  );
  const cheapLifetimeAngleScore = clamp(
    72
    + (template.local_only ? 8 : 0)
    + (template.builder_cost === "existing" ? 4 : 0)
    + (template.builder_cost === "small" ? 2 : 0)
    - (template.dom_fragility ? 8 : 0)
  );
  const userTimeSavedScore = clamp(
    template.time_save_base
    + 28
    + Math.max(0, (evidenceQuality - 55) * 0.18)
    + (supportingSeeds.length > 0 ? 4 : 0)
  );
  const buyingIntentScore = clamp(
    template.buying_intent_base
    + (hasPaidAlternatives ? 10 : 0)
    + Math.max(0, (evidenceQuality - 60) * 0.18)
    + (supportingSeeds.length > 0 ? 3 : 0)
    + (supportRescore?.final_decision === "keep_waiting_for_evidence" && template.wedge_id === "page-context-to-markdown" ? 2 : 0)
    - (template.needs_manual_evidence ? 6 : 0)
    - (template.monitor_only ? 8 : 0)
    - (overlapPenalty > 55 ? 6 : 0)
  );
  const maintenanceCostScore = clamp(
    template.maintenance_base
    - (template.builder_cost === "medium" ? 8 : 0)
    - (template.dom_fragility ? 10 : 0)
  );
  const supportBurdenScore = clamp(
    template.support_burden_base
    + (template.builder_cost === "existing" ? 4 : 0)
    - (template.dom_fragility ? 6 : 0)
  );
  const permissionTrustScore = clamp(
    92
    - (template.required_permissions.includes("scripting") ? 10 : 0)
    - (template.required_permissions.includes("storage") ? 4 : 0)
    - (template.required_permissions.includes("downloads") ? 4 : 0)
    - (template.required_permissions.length > 2 ? 6 : 0)
  );
  const oneJobClarityScore = clamp((wedgeClarity * 0.72) + template.one_job_bonus);
  const distributionChannelScore = clamp(
    template.distribution_base
    + Math.min(8, template.distribution_channels.length * 2)
    + (hasPaidAlternatives ? 4 : 0)
  );
  const paymentComplexityScore = clamp(84 - (template.builder_cost === "medium" ? 4 : 0) - (template.monitor_only ? 4 : 0));
  const policyRiskScore = clamp(
    template.policy_risk_base
    + (template.required_permissions.includes("scripting") ? 8 : 0)
    + (template.required_permissions.length > 2 ? 4 : 0)
  );
  const cloneRiskScore = clamp(
    template.clone_risk_base
    + Math.max(0, (overlapPenalty - 40) * 0.5)
    + (hasPaidAlternatives ? 4 : 0)
  );

  const totalMoneyScore = round(clamp(
    (
      paidAlternativeExistsScore * 0.1
      + competitorPriceScore * 0.06
      + cheapLifetimeAngleScore * 0.1
      + userTimeSavedScore * 0.14
      + buyingIntentScore * 0.14
      + maintenanceCostScore * 0.1
      + supportBurdenScore * 0.07
      + permissionTrustScore * 0.1
      + oneJobClarityScore * 0.1
      + distributionChannelScore * 0.05
      + paymentComplexityScore * 0.04
      + testability * 0.1
    )
    - (policyRiskScore * 0.08)
    - (cloneRiskScore * 0.08)
    - (overlapPenalty > 55 ? 8 : 0)
  ));

  return {
    candidate_id: `money-wedge-${slugify(template.wedge_id)}`,
    candidate_name: template.wedge_name,
    wedge_name: template.wedge_name,
    mature_demand_category: template.mature_demand_category,
    supporting_seed_ids: template.seed_ids,
    supporting_source_candidates: unique(backlogMatches.map((item) => item.candidate_name)).slice(0, 5),
    evidence_quality_score: evidenceQuality,
    wedge_clarity_score: wedgeClarity,
    portfolio_overlap_score: overlapPenalty,
    testability_score: testability,
    builder_available_now: EXISTING_BUILDERS.has(template.expected_builder),
    builder_gap: template.builder_gap,
    builder_cost: template.builder_cost,
    money_scores: {
      paid_alternative_exists_score: round(paidAlternativeExistsScore),
      competitor_price_score: round(competitorPriceScore),
      cheap_lifetime_angle_score: round(cheapLifetimeAngleScore),
      user_time_saved_score: round(userTimeSavedScore),
      buying_intent_score: round(buyingIntentScore),
      maintenance_cost_score: round(maintenanceCostScore),
      support_burden_score: round(supportBurdenScore),
      permission_trust_score: round(permissionTrustScore),
      one_job_clarity_score: round(oneJobClarityScore),
      distribution_channel_score: round(distributionChannelScore),
      payment_complexity_score: round(paymentComplexityScore),
      policy_risk_score: round(policyRiskScore),
      clone_risk_score: round(cloneRiskScore),
      total_money_score: totalMoneyScore
    },
    supporting_signals: {
      backlog_match_count: backlogMatches.length,
      seed_match_count: supportingSeeds.length,
      paid_competitor_count: categoryCompetitorMap.length,
      known_public_price_count: knownPrices.length,
      support_rescore_status: supportRescore?.final_decision ?? null
    }
  };
}

function buildMoneyFirstGateEntry(template, candidate) {
  const scores = candidate.money_scores;
  const cloneRisk = riskLabelFromScore(scores.clone_risk_score);
  const policyRisk = riskLabelFromScore(scores.policy_risk_score);
  const gateChecks = {
    one_job_clarity_score: scores.one_job_clarity_score >= 80,
    clone_risk: cloneRisk !== "high",
    policy_risk: policyRisk !== "high",
    maintenance_cost_score: scores.maintenance_cost_score >= 60,
    user_time_saved_score: scores.user_time_saved_score >= 70,
    buying_intent_score: scores.buying_intent_score >= 60,
    permission_trust_score: scores.permission_trust_score >= 75,
    testability_score: candidate.testability_score >= 75,
    suggested_price_exists: Boolean(template.suggested_price),
    distribution_channel_exists: template.distribution_channels.length > 0,
    human_approval_required: true
  };

  let result = "backlog_waiting_for_payment_signal";
  if (cloneRisk === "high" || policyRisk === "high") {
    result = "skip";
  } else if (Object.values(gateChecks).every((value) => value === true) && !template.needs_manual_evidence && !template.monitor_only) {
    result = "money_build_ready";
  } else if (scores.user_time_saved_score >= 70 && scores.one_job_clarity_score >= 80 && cloneRisk !== "high" && policyRisk !== "high") {
    result = "validate_demand_first";
  }
  if (template.monitor_only) {
    result = "backlog_waiting_for_payment_signal";
  }

  return {
    candidate_id: candidate.candidate_id,
    candidate_name: candidate.candidate_name,
    wedge_name: candidate.wedge_name,
    gate_result: result,
    clone_risk: cloneRisk,
    policy_risk: policyRisk,
    gate_checks: gateChecks,
    rationale: result === "money_build_ready"
      ? "The wedge clears the money-first gate and still needs human approval before any build."
      : result === "validate_demand_first"
        ? "The wedge looks commercially plausible, but demand still needs a fake-door or interview validation loop."
        : result === "skip"
          ? "Clone or policy risk is too high for a money-first move."
          : "The wedge still lacks enough payment or buying-intent signal."
  };
}

function createMoneyWedgeCandidate(template, scoredCandidate, gateEntry, competitors) {
  const categoryCompetitorMap = categoryCompetitors(template.mature_demand_category, competitors);
  return {
    candidate_id: scoredCandidate.candidate_id,
    candidate_name: scoredCandidate.candidate_name,
    wedge_name: template.wedge_name,
    mature_demand_category: template.mature_demand_category,
    evidence_quality_score: scoredCandidate.evidence_quality_score,
    wedge_clarity_score: scoredCandidate.wedge_clarity_score,
    portfolio_overlap_score: scoredCandidate.portfolio_overlap_score,
    testability_score: scoredCandidate.testability_score,
    existing_paid_tools: categoryCompetitorMap.map((item) => item.competitor_name),
    user_segment: template.user_segment,
    painful_job_to_be_done: template.painful_job_to_be_done,
    one_sentence_value: template.one_sentence_value,
    what_it_does: template.what_it_does,
    what_it_explicitly_does_not_do: template.what_it_explicitly_does_not_do,
    why_user_would_pay: template.why_user_would_pay,
    why_lifetime_price_works: template.why_lifetime_price_works,
    suggested_price: template.suggested_price,
    free_limit: template.free_limit,
    upsell_model: template.upsell_model,
    required_permissions: template.required_permissions,
    expected_builder: template.expected_builder,
    builder_gap: template.builder_gap,
    testability_plan: template.testability_plan,
    distribution_channels: template.distribution_channels,
    policy_risk: gateEntry.policy_risk,
    clone_risk: gateEntry.clone_risk,
    maintenance_risk: riskLabelFromScore(100 - scoredCandidate.money_scores.maintenance_cost_score),
    build_recommendation: gateEntry.gate_result,
    money_scores: scoredCandidate.money_scores,
    supporting_source_candidates: scoredCandidate.supporting_source_candidates,
    supporting_seed_ids: template.seed_ids
  };
}

function buildPricingPlan(topCandidate, competitors) {
  const competitorAnchor = categoryCompetitors(topCandidate.mature_demand_category, competitors)
    .map((item) => ({
      competitor_name: item.competitor_name,
      public_price_if_available: item.public_price_if_available
    }));

  return buildSafeReport({
    stage: "PRICING_EXPERIMENT_PLAN",
    status: "passed",
    candidate_id: topCandidate.candidate_id,
    candidate_name: topCandidate.wedge_name,
    pricing_model: "free_with_lifetime_unlock",
    suggested_price: topCandidate.suggested_price,
    reasoning: "The wedge is narrow, local-only, and better suited to a one-time unlock than a subscription.",
    competitor_anchor: competitorAnchor,
    value_metric: "times the user avoids a repetitive browser handoff or cleanup action",
    free_limit: topCandidate.free_limit,
    payment_provider_options: [
      "Gumroad/manual license",
      "Stripe payment link + manual license",
      "Lemon Squeezy",
      "Paddle",
      "ExtensionPay"
    ],
    license_check_strategy: "Start with manual license issuance or a simple hosted verifier, then automate only if demand appears.",
    offline_behavior: "Free limits stay available offline; paid unlock can cache locally after license validation.",
    refund_and_support_policy: "14-day refund window and lightweight email support for license issues only.",
    risks: [
      "A price that is too high will lose the cheap-lifetime angle.",
      "A price that is too low may anchor the wedge as disposable even if it saves repeated time."
    ]
  });
}

function buildPaymentPlan(topCandidate) {
  return buildSafeReport({
    stage: "PAYMENT_LICENSE_ARCHITECTURE_PLAN",
    status: "passed",
    candidate_id: topCandidate.candidate_id,
    candidate_name: topCandidate.wedge_name,
    payment_provider_options: [
      "Stripe",
      "Lemon Squeezy",
      "Paddle",
      "ExtensionPay",
      "Gumroad/manual license"
    ],
    recommended_provider_for_mvp: "Gumroad/manual license",
    license_key_flow: [
      "User pays through Gumroad or a Stripe payment link.",
      "A manual or lightweight automated process issues a license key.",
      "The extension stores the local license state after verification.",
      "The extension keeps a short offline grace period and falls back to free limits if verification fails."
    ],
    extension_storage_fields: ["license_key", "license_status", "license_checked_at", "lifetime_unlock_granted"],
    offline_grace_period: "7 days",
    privacy_considerations: [
      "Do not upload user page content during license checks.",
      "Only send license metadata that is strictly required for verification."
    ],
    no_secret_in_extension_rule: true,
    refund_support_process: "Handle refunds and revocations outside the extension and sync revocation state through the verifier when needed.",
    anti_piracy_lightweight_only: true,
    why_not_overbuild_paywall: "The first paid wedge should validate demand before adding a heavy SaaS backend or complex entitlements."
  });
}

function buildOpsReport(wedgeCandidates, gateEntries) {
  const topMoneyFirstOpportunities = wedgeCandidates.slice(0, 5).map((candidate) => ({
    wedge_name: candidate.wedge_name,
    total_money_score: candidate.money_scores.total_money_score,
    suggested_price: candidate.suggested_price,
    build_recommendation: candidate.build_recommendation,
    clone_risk: candidate.clone_risk,
    policy_risk: candidate.policy_risk
  }));
  const topCandidate = wedgeCandidates[0] ?? null;

  return buildSafeReport({
    stage: "MONEY_FIRST_OPS_REPORT",
    status: "passed",
    top_money_first_opportunities: topMoneyFirstOpportunities,
    mature_demand_categories_looking_promising: unique(wedgeCandidates.slice(0, 5).map((item) => item.mature_demand_category)),
    cheap_lifetime_wedges_viable: wedgeCandidates
      .filter((candidate) => candidate.build_recommendation !== "skip")
      .slice(0, 5)
      .map((candidate) => candidate.wedge_name),
    clone_risk_wedges_to_avoid: gateEntries.filter((entry) => entry.clone_risk === "high").map((entry) => entry.wedge_name),
    recommended_first_paid_experiment: topCandidate
      ? {
          wedge_name: topCandidate.wedge_name,
          suggested_price: topCandidate.suggested_price,
          next_action: topCandidate.build_recommendation === "money_build_ready" ? "human_review_before_build" : "fake_door_validation"
        }
      : null,
    recommended_no_build_decisions: gateEntries
      .filter((entry) => entry.gate_result === "skip")
      .map((entry) => entry.wedge_name),
    next_human_decision: topCandidate
      ? `Approve a fake-door demand test for ${topCandidate.wedge_name} before any build.`
      : "No money-first wedge cleared the initial filter; keep exploring."
  });
}

function renderMoneyScoresMarkdown(report) {
  return [
    "# Money-First Opportunity Scores",
    "",
    markdownSection("Top Candidates", markdownList(
      (report.scored_candidates ?? []).slice(0, 10).map((item) => (
        `${item.candidate_name}: money=${item.money_scores.total_money_score}, buying=${item.money_scores.buying_intent_score}, one_job=${item.money_scores.one_job_clarity_score}, clone_risk=${riskLabelFromScore(item.money_scores.clone_risk_score)}, policy_risk=${riskLabelFromScore(item.money_scores.policy_risk_score)}`
      ))
    ))
  ].join("\n");
}

function renderCompetitorMarkdown(report) {
  return [
    "# Competitor Price / Value Map",
    "",
    markdownSection("Competitors", markdownList(
      (report.competitors ?? []).map((item) => (
        `${item.competitor_name}: price=${item.public_price_if_available}, model=${item.pricing_model}, differentiation=${item.differentiation_angle}`
      ))
    ))
  ].join("\n");
}

function renderMoneyWedgesMarkdown(report) {
  return [
    "# Money Micro-Wedge Candidates",
    "",
    markdownSection("Top 5", markdownList(
      (report.candidates ?? []).slice(0, 5).map((item) => (
        `${item.wedge_name}: price=${item.suggested_price}, money=${item.money_scores.total_money_score}, recommendation=${item.build_recommendation}, clone_risk=${item.clone_risk}, policy_risk=${item.policy_risk}`
      ))
    ))
  ].join("\n");
}

function renderPricingMarkdown(report) {
  return [
    "# Pricing Experiment Plan",
    "",
    markdownSection("Plan", markdownList([
      `Candidate: ${report.candidate_name}`,
      `Pricing model: ${report.pricing_model}`,
      `Suggested price: ${report.suggested_price}`,
      `Free limit: ${report.free_limit}`,
      `Reasoning: ${report.reasoning}`
    ]))
  ].join("\n");
}

function renderPaymentMarkdown(report) {
  return [
    "# Payment / License Architecture Plan",
    "",
    markdownSection("MVP Recommendation", markdownList([
      `Candidate: ${report.candidate_name}`,
      `Recommended provider: ${report.recommended_provider_for_mvp}`,
      `Offline grace period: ${report.offline_grace_period}`,
      `No secret in extension: ${report.no_secret_in_extension_rule}`
    ])),
    "",
    markdownSection("License Flow", markdownList(report.license_key_flow))
  ].join("\n");
}

function renderOpsMarkdown(report) {
  return [
    "# Money-First Ops Report",
    "",
    markdownSection("Top Opportunities", markdownList(
      (report.top_money_first_opportunities ?? []).map((item) => (
        `${item.wedge_name}: score=${item.total_money_score}, price=${item.suggested_price}, next=${item.build_recommendation}`
      ))
    )),
    "",
    markdownSection("Next Human Decision", report.next_human_decision)
  ].join("\n");
}

function buildFakeDoorPlan(candidate) {
  return buildSafeReport({
    stage: "FAKE_DOOR_TEST_PLAN",
    status: "passed",
    candidate_id: candidate.candidate_id,
    candidate_name: candidate.wedge_name,
    landing_page_headline: `${candidate.wedge_name}: local-only browser context in one click`,
    value_prop: `A cheap lifetime Chrome extension that solves one painful browser workflow: ${candidate.one_sentence_value}`,
    demo_gif_plan: [
      "Open the extension on a fixture page",
      "Enter one short input if needed",
      "Show the generated local output",
      "Copy it to the clipboard without any network activity"
    ],
    pricing_copy: `Free for ${candidate.free_limit}. Unlock lifetime usage for ${candidate.suggested_price}. Early access, no cloud upload, no subscription.`,
    buy_button_copy: "Unlock Lifetime Access",
    waitlist_copy: "Join the early-access list for the local-only launch.",
    target_channels: candidate.distribution_channels,
    success_metrics: [
      "At least 10 qualified landing-page clicks from relevant users",
      "At least 3 explicit responses that the workflow is painful today",
      "At least 1 response that prefers local-only or no-upload behavior"
    ],
    fail_metrics: [
      "Zero qualified clicks or replies after the test window",
      "Users say they only want screenshot, video, or cloud upload workflows",
      "Users reject the idea of paying for a text-first local-only helper"
    ],
    test_duration: "7 to 10 days",
    minimum_clicks_or_signups: "10 qualified clicks or 3 interview confirmations",
    decision_after_test: "Only move to human build review if the fake-door test gets qualified clicks or strong interview evidence."
  });
}

async function writeMoneyFirstArtifacts({
  state,
  moneyScores,
  competitorMap,
  wedgeCandidates,
  pricingPlan,
  paymentPlan,
  buildGate,
  opsReport
}) {
  await validateArtifact(state.projectRoot, "money_first_opportunity_scores.schema.json", MONEY_SCORES_ARTIFACT, moneyScores);
  await validateArtifact(state.projectRoot, "competitor_price_value_map.schema.json", COMPETITOR_MAP_ARTIFACT, competitorMap);
  await validateArtifact(state.projectRoot, "money_micro_wedge_candidates.schema.json", MONEY_WEDGES_ARTIFACT, wedgeCandidates);
  await validateArtifact(state.projectRoot, "pricing_experiment_plan.schema.json", PRICING_PLAN_ARTIFACT, pricingPlan);
  await validateArtifact(state.projectRoot, "payment_license_architecture_plan.schema.json", PAYMENT_PLAN_ARTIFACT, paymentPlan);
  await validateArtifact(state.projectRoot, "money_first_build_gate.schema.json", MONEY_GATE_ARTIFACT, buildGate);
  await validateArtifact(state.projectRoot, "money_first_ops_report.schema.json", OPS_REPORT_ARTIFACT, opsReport);

  await writeManagedJsonArtifact({ runDir: state.runDir, runContext: state.runContext, artifactName: MONEY_SCORES_ARTIFACT, data: moneyScores });
  await writeManagedJsonArtifact({ runDir: state.runDir, runContext: state.runContext, artifactName: COMPETITOR_MAP_ARTIFACT, data: competitorMap });
  await writeManagedJsonArtifact({ runDir: state.runDir, runContext: state.runContext, artifactName: MONEY_WEDGES_ARTIFACT, data: wedgeCandidates });
  await writeManagedJsonArtifact({ runDir: state.runDir, runContext: state.runContext, artifactName: PRICING_PLAN_ARTIFACT, data: pricingPlan });
  await writeManagedJsonArtifact({ runDir: state.runDir, runContext: state.runContext, artifactName: PAYMENT_PLAN_ARTIFACT, data: paymentPlan });
  await writeManagedJsonArtifact({ runDir: state.runDir, runContext: state.runContext, artifactName: MONEY_GATE_ARTIFACT, data: buildGate });
  await writeManagedJsonArtifact({ runDir: state.runDir, runContext: state.runContext, artifactName: OPS_REPORT_ARTIFACT, data: opsReport });

  await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "87_money_first_opportunity_scores.md",
    category: "money_first",
    prefix: "87_money_first_opportunity_scores",
    content: renderMoneyScoresMarkdown(moneyScores)
  });
  await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "88_competitor_price_value_map.md",
    category: "money_first",
    prefix: "88_competitor_price_value_map",
    content: renderCompetitorMarkdown(competitorMap)
  });
  await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "89_money_micro_wedge_candidates.md",
    category: "money_first",
    prefix: "89_money_micro_wedge_candidates",
    content: renderMoneyWedgesMarkdown(wedgeCandidates)
  });
  await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "90_pricing_experiment_plan.md",
    category: "money_first",
    prefix: "90_pricing_experiment_plan",
    content: renderPricingMarkdown(pricingPlan)
  });
  await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "91_payment_license_architecture_plan.md",
    category: "money_first",
    prefix: "91_payment_license_architecture_plan",
    content: renderPaymentMarkdown(paymentPlan)
  });
  await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "94_money_first_ops_report.md",
    category: "money_first",
    prefix: "94_money_first_ops_report",
    content: renderOpsMarkdown(opsReport)
  });
}

export async function generateMoneyFirstOpportunityEngine({ projectRoot }) {
  const state = await loadMoneyFirstInputs(projectRoot);
  const competitors = await fetchCompetitorPriceSignals();

  const scoredCandidatesRaw = WEDGE_TEMPLATES.map((template) => scoreMoneyFirstCandidate(template, state, competitors));
  const gateEntriesRaw = WEDGE_TEMPLATES.map((template, index) => buildMoneyFirstGateEntry(template, scoredCandidatesRaw[index]));
  const wedgeCandidatesRaw = WEDGE_TEMPLATES.map((template, index) => createMoneyWedgeCandidate(template, scoredCandidatesRaw[index], gateEntriesRaw[index], competitors));

  const combined = wedgeCandidatesRaw
    .map((candidate, index) => ({
      template: WEDGE_TEMPLATES[index],
      candidate,
      scored: scoredCandidatesRaw[index],
      gate: gateEntriesRaw[index]
    }))
    .sort((left, right) => right.scored.money_scores.total_money_score - left.scored.money_scores.total_money_score);

  const scoredCandidates = combined.map((item) => item.scored);
  const wedgeCandidates = combined.map((item) => item.candidate);
  const gateEntries = combined.map((item) => item.gate);
  const topCandidate = wedgeCandidates[0];

  const moneyScores = buildSafeReport({
    stage: "MONEY_FIRST_OPPORTUNITY_SCORES",
    status: "passed",
    source_run_id: state.runContext.run_id,
    candidate_count: scoredCandidates.length,
    scored_candidates: scoredCandidates
  });
  const competitorMap = buildSafeReport({
    stage: "COMPETITOR_PRICE_VALUE_MAP",
    status: "passed",
    source_run_id: state.runContext.run_id,
    competitor_count: competitors.length,
    competitors
  });
  const moneyWedges = buildSafeReport({
    stage: "MONEY_MICRO_WEDGE_CANDIDATES",
    status: "passed",
    source_run_id: state.runContext.run_id,
    candidate_count: wedgeCandidates.length,
    candidates: wedgeCandidates
  });
  const pricingPlan = buildPricingPlan(topCandidate, competitors);
  const paymentPlan = buildPaymentPlan(topCandidate);
  const buildGate = buildSafeReport({
    stage: "MONEY_FIRST_BUILD_GATE",
    status: "passed",
    source_run_id: state.runContext.run_id,
    candidate_count: gateEntries.length,
    entries: gateEntries,
    next_step: topCandidate?.build_recommendation === "money_build_ready" ? "human_review_before_build" : "fake_door_or_manual_demand_validation"
  });
  const opsReport = buildOpsReport(wedgeCandidates, gateEntries);

  await writeMoneyFirstArtifacts({
    state,
    moneyScores,
    competitorMap,
    wedgeCandidates: moneyWedges,
    pricingPlan,
    paymentPlan,
    buildGate,
    opsReport
  });

  return {
    runDir: state.runDir,
    runContext: state.runContext,
    moneyScores,
    competitorMap,
    wedgeCandidates: moneyWedges,
    pricingPlan,
    paymentPlan,
    buildGate,
    opsReport
  };
}

export async function createFakeDoorTest({ projectRoot, candidate }) {
  const state = await loadMoneyFirstInputs(projectRoot);
  let wedgeArtifact = await loadOptionalManagedArtifact({
    runDir: state.runDir,
    artifactName: MONEY_WEDGES_ARTIFACT,
    runContext: state.runContext
  });

  if (!wedgeArtifact) {
    const generated = await generateMoneyFirstOpportunityEngine({ projectRoot });
    wedgeArtifact = generated.wedgeCandidates;
  }

  const selected = (wedgeArtifact.candidates ?? []).find((item) => (
    lower(item.candidate_id) === lower(candidate)
    || lower(item.wedge_name) === lower(candidate)
    || lower(item.candidate_name) === lower(candidate)
  ));
  if (!selected) {
    throw new Error(`No money-first wedge candidate matched "${candidate}".`);
  }

  const report = buildFakeDoorPlan(selected);
  await validateArtifact(projectRoot, "fake_door_test_plan.schema.json", FAKE_DOOR_ARTIFACT, report);
  await writeManagedJsonArtifact({ runDir: state.runDir, runContext: state.runContext, artifactName: FAKE_DOOR_ARTIFACT, data: report });
  await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "93_fake_door_test_plan.md",
    category: "money_first",
    prefix: "93_fake_door_test_plan",
    content: [
      "# Fake Door Test Plan",
      "",
      markdownSection("Candidate", markdownList([
        `Candidate: ${report.candidate_name}`,
        `Headline: ${report.landing_page_headline}`,
        `Pricing: ${report.pricing_copy}`
      ])),
      "",
      markdownSection("Success Metrics", markdownList(report.success_metrics)),
      "",
      markdownSection("Fail Metrics", markdownList(report.fail_metrics))
    ].join("\n")
  });

  return {
    runDir: state.runDir,
    runContext: state.runContext,
    report
  };
}
