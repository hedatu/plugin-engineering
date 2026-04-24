import fs from "node:fs/promises";
import path from "node:path";
import { buildSafeReport, validateArtifact, writeManagedJsonArtifact, writeManagedMarkdownArtifact } from "../review/helpers.mjs";
import { loadOpportunityBacklog } from "./opportunityBacklog.mjs";
import { buildUniqueRunId } from "../workflow/runId.mjs";
import { assertMatchesSchema } from "../utils/schema.mjs";
import { ensureDir, fileExists, nowIso, readJson, writeJson } from "../utils/io.mjs";

export const DISCOVERY_STRATEGY_REVIEW_ARTIFACT = "63_discovery_strategy_review.json";
export const BUILDER_ROADMAP_EVALUATION_ARTIFACT = "64_builder_roadmap_evaluation.json";
export const MANUAL_SEED_PLAN_ARTIFACT = "65_manual_seed_plan.json";
export const THRESHOLD_CALIBRATION_REVIEW_ARTIFACT = "66_threshold_calibration_review.json";
export const NEXT_DISCOVERY_TASK_ARTIFACT = "67_next_discovery_task.json";
export const SEED_QUERY_PLAN_ARTIFACT = "68_seed_query_plan.json";

const REQUIRED_STRATEGY_ARTIFACTS = [
  "55_discovery_strategy_v2.json",
  "56_builder_fit_map.json",
  "57_low_overlap_search_map.json",
  "58_source_priority_model.json"
];

const REQUIRED_EXECUTION_ARTIFACTS = [
  "59_strategy_v2_query_results.json",
  "60_strategy_v2_candidate_scores.json",
  "61_strategy_v2_next_candidate.json",
  "62_no_build_today_report.json"
];

const FUTURE_BUILDER_NAMES = [
  "developer_payload_utility",
  "screenshot_annotation_or_qa_support",
  "csv_table_cleanup",
  "support_debug_handoff",
  "local_only_email_template",
  "vertical_form_workflow"
];

const PAUSE_CATEGORY_PATTERNS = [
  "generic autofill",
  "generic tab manager",
  "generic tab export",
  "broad SEO agent",
  "Amazon review scraping",
  "high-permission security scanner"
];

const MONITOR_ONLY_SEED_IDS = [
  "seed-developer-payload"
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

function average(values) {
  const numeric = (values ?? []).map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (numeric.length === 0) {
    return 0;
  }
  return round(numeric.reduce((sum, value) => sum + value, 0) / numeric.length);
}

async function hasArtifacts(runDir, artifacts) {
  for (const artifact of artifacts) {
    if (!(await fileExists(path.join(runDir, artifact)))) {
      return false;
    }
  }
  return true;
}

async function listRunDirs(projectRoot) {
  const runsRoot = path.join(projectRoot, "runs");
  const entries = await fs.readdir(runsRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(runsRoot, entry.name))
    .sort((left, right) => path.basename(right).localeCompare(path.basename(left)));
}

function basenameFromMaybeRun(projectRoot, maybeRun) {
  if (!maybeRun) {
    return null;
  }
  const resolved = path.isAbsolute(maybeRun)
    ? maybeRun
    : path.resolve(projectRoot, maybeRun);
  return path.basename(resolved);
}

async function readOptionalJson(filePath) {
  return (await fileExists(filePath)) ? readJson(filePath) : null;
}

async function detectStrategyChains(projectRoot) {
  const runDirs = await listRunDirs(projectRoot);
  const chains = [];

  for (const execRunDir of runDirs) {
    if (!(await hasArtifacts(execRunDir, REQUIRED_EXECUTION_ARTIFACTS))) {
      continue;
    }
    const execRunContext = await readJson(path.join(execRunDir, "00_run_context.json"));
    const strategyRunId = execRunContext.source_run_id ?? null;
    if (!strategyRunId) {
      continue;
    }
    const strategyRunDir = path.join(projectRoot, "runs", strategyRunId);
    if (!(await hasArtifacts(strategyRunDir, REQUIRED_STRATEGY_ARTIFACTS))) {
      continue;
    }
    const strategyRunContext = await readJson(path.join(strategyRunDir, "00_run_context.json"));
    chains.push({
      execRunDir,
      execRunId: path.basename(execRunDir),
      execRunContext,
      strategyRunDir,
      strategyRunId,
      strategyRunContext,
      strategySourceRunId: strategyRunContext.source_run_id ?? null,
      originalDiscoverySourceRunId: strategyRunContext.original_discovery_source_run_id ?? null
    });
  }

  return chains;
}

async function resolveStrategyReviewChain(projectRoot, fromRun = null) {
  const chains = await detectStrategyChains(projectRoot);
  if (chains.length === 0) {
    throw new Error("No strategy-v2 execution run with 59-62 artifacts was found.");
  }

  const requestedId = basenameFromMaybeRun(projectRoot, fromRun);
  if (requestedId) {
    const matched = chains.find((chain) => (
      chain.execRunId === requestedId
      || chain.strategyRunId === requestedId
      || chain.strategySourceRunId === requestedId
      || chain.originalDiscoverySourceRunId === requestedId
    ));
    if (matched) {
      return matched;
    }
  }

  return chains[0];
}

async function createStrategyReviewRun(projectRoot, chain) {
  const runId = buildUniqueRunId({
    task: {
      mode: "daily",
      run_slug: "discovery-strategy-review"
    },
    taskPath: "discovery_strategy_review"
  });
  const runDir = path.join(projectRoot, "runs", runId);
  const occurredAt = nowIso();
  await ensureDir(runDir);
  const runContext = {
    ...chain.execRunContext,
    stage: "DISCOVERY_STRATEGY_REVIEW",
    status: "passed",
    generated_at: occurredAt,
    run_id: runId,
    run_type: "daily",
    task_mode: "daily",
    run_id_strategy: "timestamp_slug_unique",
    allow_overwrite: false,
    overwrite_blocked: false,
    created_at: occurredAt,
    source_run_id: chain.execRunId,
    strategy_run_id: chain.strategyRunId,
    strategy_source_run_id: chain.strategySourceRunId,
    original_discovery_source_run_id: chain.originalDiscoverySourceRunId,
    discovery: {
      ...(chain.execRunContext.discovery ?? {}),
      mode: "strategy_review",
      allow_auto_build: false
    }
  };
  await writeJson(path.join(runDir, "00_run_context.json"), runContext);
  await writeJson(path.join(runDir, "run_status.json"), {
    stage: "DISCOVERY_STRATEGY_REVIEW",
    status: "passed",
    generated_at: occurredAt,
    run_id: runId,
    run_id_strategy: "timestamp_slug_unique",
    allow_overwrite: false,
    overwrite_blocked: false,
    created_at: occurredAt,
    failure_reason: null
  });
  return { runDir, runContext };
}

function candidateText(candidate) {
  return lower([
    candidate.candidate_name,
    candidate.name,
    candidate.selected_wedge,
    candidate.final_wedge,
    candidate.decision_reason,
    ...(candidate.decision_rationale ?? [])
  ].join(" "));
}

function classifyRoadmapCandidate(candidate) {
  const text = candidateText(candidate);
  if (/json|payload|apk|schema|formatter|compare|diff/.test(text)) return "developer_payload_utility";
  if (/screenshot|capture|annotat|highlight|bug report|feedback/.test(text)) return "screenshot_annotation_or_qa_support";
  if (/csv|table|cleanup|clipboard|copy ready|copy-ready/.test(text) && !/tab|window export|tab manager/.test(text)) return "csv_table_cleanup";
  if (/support|debug|handoff|qa|feedback tool|issue handoff|checklist/.test(text)) return "support_debug_handoff";
  if (/gmail|email|compose|snippet|template/.test(text) && !/send|campaign|automation/.test(text)) return "local_only_email_template";
  if (/form|autofill|recruit|crm|intake|apply|ticket field|dropdown/.test(text)) return "vertical_form_workflow";
  return null;
}

function complianceRiskLevel(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return "medium";
  if (score <= 25) return "low";
  if (score <= 50) return "medium";
  return "high";
}

const MANUAL_SEEDS = [
  {
    seed_id: "seed-support-qa-handoff",
    vertical_or_workflow: "Support and QA handoff notes for browser bugs",
    target_user: "Support agents and QA testers",
    likely_browser_context: "SaaS admin panels and bug repro pages",
    expected_repetitive_pain: "Collecting page context and notes into one shareable handoff artifact",
    likely_extension_wedge: "Local handoff note with page title, URL, and checklist snippets",
    expected_archetype: "support_debug_handoff",
    why_low_overlap: "Handoff context capture is narrower than generic tab export or generic notes.",
    how_to_find_evidence: "Prioritize support docs, QA issue trackers, extension reviews, and bug-report workflow forums.",
    first_5_queries: [
      "site:chromewebstore.google.com support handoff notes browser extension review",
      "site:chromewebstore.google.com QA bug report helper browser extension review",
      "site:chromewebstore.google.com browser issue handoff checklist extension review",
      "site:github.com browser bug report note taking extension issues",
      "site:reddit.com browser support handoff workflow extension"
    ],
    skip_conditions: ["Requires a full PM suite", "Needs high-permission capture by default"],
    compliance_notes: "Keep local-only and avoid scraping customer data.",
    testability_hypothesis: "A controlled bug-report fixture can validate local note creation and copy-ready output."
  },
  {
    seed_id: "seed-saas-admin-cleanup",
    vertical_or_workflow: "SaaS admin copy-paste cleanup",
    target_user: "Operations and support admins",
    likely_browser_context: "CRM, billing, and support dashboards",
    expected_repetitive_pain: "Cleaning messy copied values before pasting into downstream tools",
    likely_extension_wedge: "Normalize selected text or copied table cells into a clean output",
    expected_archetype: "csv_table_cleanup",
    why_low_overlap: "Clipboard cleanup is not tab management or export.",
    how_to_find_evidence: "Look for support docs, community forums, and admin-tool reviews mentioning messy copy or formatting.",
    first_5_queries: [
      "site:chromewebstore.google.com clipboard cleanup SaaS admin extension review",
      "site:chromewebstore.google.com copy paste cleanup dashboard extension review",
      "site:chromewebstore.google.com CRM data cleanup copy helper extension review",
      "site:reddit.com SaaS admin copy paste cleanup workflow",
      "site:github.com browser clipboard cleanup extension issues"
    ],
    skip_conditions: ["Needs server-side sync", "Overlaps with generic spreadsheet connectors"],
    compliance_notes: "Prefer local-only transforms and explicit user-triggered output.",
    testability_hypothesis: "A deterministic input-output fixture can verify cleanup transformations."
  },
  {
    seed_id: "seed-recruiting-intake",
    vertical_or_workflow: "Recruiting or CRM micro-intake form workflow",
    target_user: "Recruiters and CRM operators",
    likely_browser_context: "Applicant tracking systems and lead intake forms",
    expected_repetitive_pain: "Re-entering the same structured profile fields with overwrite anxiety",
    likely_extension_wedge: "Fill a narrow intake workflow from one local profile with safe overwrite rules",
    expected_archetype: "single_profile_form_fill",
    why_low_overlap: "Vertical intake workflows are narrower than generic autofill.",
    how_to_find_evidence: "Support docs, vertical SaaS communities, and extension reviews mentioning repeat entry pain.",
    first_5_queries: [
      "site:chromewebstore.google.com recruiter intake form filler extension review",
      "site:chromewebstore.google.com CRM lead intake helper extension review",
      "site:reddit.com recruiter repetitive form entry browser extension",
      "site:github.com applicant tracking form fill extension issues",
      "site:chromewebstore.google.com support ticket field fill helper extension review"
    ],
    skip_conditions: ["Becomes generic autofill again", "Needs sensitive-data sync beyond local profile storage"],
    compliance_notes: "Avoid highly sensitive records unless risk is clearly bounded.",
    testability_hypothesis: "A controlled intake form fixture can validate mapped fields, readonly behavior, and overwrite guards."
  },
  {
    seed_id: "seed-developer-payload",
    vertical_or_workflow: "Local-only developer payload utility",
    target_user: "Developers and operators",
    likely_browser_context: "Internal tools and browser payload workflows",
    expected_repetitive_pain: "Repeating small compare, diff, normalize, or extract steps in the browser",
    likely_extension_wedge: "Compare or normalize pasted payloads locally with deterministic output",
    expected_archetype: "developer_payload_utility",
    why_low_overlap: "This sits outside current form-fill and tab-export families.",
    how_to_find_evidence: "GitHub repos, developer-tool docs, issue trackers, and Chrome Web Store reviews.",
    first_5_queries: [
      "site:chromewebstore.google.com local JSON compare extension review",
      "site:chromewebstore.google.com payload diff browser extension review",
      "site:github.com json compare browser extension issues",
      "site:news.ycombinator.com local-only developer browser utility",
      "site:chromewebstore.google.com API payload formatter extension review"
    ],
    skip_conditions: ["Turns into a generic formatter", "Needs heavy DevTools integration or a large new builder"],
    compliance_notes: "Stay local-only and avoid network calls.",
    testability_hypothesis: "Pasted fixture payloads can validate deterministic diff and output rendering."
  },
  {
    seed_id: "seed-table-cleanup",
    vertical_or_workflow: "CSV or table cleanup from page clipboard",
    target_user: "Operators and analysts",
    likely_browser_context: "Admin tables and browser-rendered grids",
    expected_repetitive_pain: "Turning copied table cells into usable CSV without spreadsheet detours",
    likely_extension_wedge: "Convert selected table text into clean CSV rows or normalized clipboard output",
    expected_archetype: "csv_table_cleanup",
    why_low_overlap: "This is page-table cleanup, not exporting browser tabs.",
    how_to_find_evidence: "Store reviews, support pages, and operations forums mentioning messy table copies.",
    first_5_queries: [
      "site:chromewebstore.google.com table cleanup clipboard extension review",
      "site:chromewebstore.google.com copy html table as clean CSV extension review",
      "site:chromewebstore.google.com browser table to clipboard cleanup extension",
      "site:reddit.com browser table copy cleanup workflow",
      "site:github.com browser table clipboard extension issues"
    ],
    skip_conditions: ["Requires ETL or cloud pipelines", "Collapses back into generic tab export"],
    compliance_notes: "User-triggered local transforms only.",
    testability_hypothesis: "Fixture page tables can validate row parsing and cleaned clipboard output."
  },
  {
    seed_id: "seed-screenshot-bug-report",
    vertical_or_workflow: "Screenshot annotation for bug reports",
    target_user: "QA testers and support engineers",
    likely_browser_context: "Bug repro pages and visual QA review flows",
    expected_repetitive_pain: "Capturing one annotated screenshot with enough context for a report",
    likely_extension_wedge: "One local screenshot annotation panel for bug reports with copy-ready notes",
    expected_archetype: "screenshot_annotation_or_qa_support",
    why_low_overlap: "This is bug-report context capture, not generic screenshot tooling.",
    how_to_find_evidence: "QA forums, store reviews, support docs, and issue trackers.",
    first_5_queries: [
      "site:chromewebstore.google.com bug report screenshot annotation extension review",
      "site:chromewebstore.google.com QA screenshot note extension review",
      "site:github.com screenshot annotation browser extension issues",
      "site:reddit.com QA browser screenshot workflow extension",
      "site:chromewebstore.google.com support screenshot feedback extension review"
    ],
    skip_conditions: ["Requires broad recording suite behavior", "Needs high-permission capture across all tabs"],
    compliance_notes: "Keep user-triggered capture and avoid automatic remote upload.",
    testability_hypothesis: "A fixture page plus a static screenshot target can validate annotation save and export."
  },
  {
    seed_id: "seed-email-template-local",
    vertical_or_workflow: "Local-only email template helper without auto-send",
    target_user: "Support and operations teams",
    likely_browser_context: "Gmail compose or ticket reply workflows",
    expected_repetitive_pain: "Re-inserting small template fragments during compose without heavy mailbox automation",
    likely_extension_wedge: "Shortcut-first local snippet insert for a narrow support reply workflow",
    expected_archetype: "gmail_snippet",
    why_low_overlap: "This narrows to insert-only templates and avoids broad email automation.",
    how_to_find_evidence: "Gmail extension reviews, support-team workflow forums, and help-center docs.",
    first_5_queries: [
      "site:chromewebstore.google.com gmail support snippet insert extension review",
      "site:chromewebstore.google.com email template helper no auto send extension review",
      "site:reddit.com support team gmail template browser extension",
      "site:chromewebstore.google.com compose shortcut snippet extension review",
      "site:github.com gmail snippet extension issues"
    ],
    skip_conditions: ["Starts requiring send automation", "Needs full mailbox access beyond compose insertion"],
    compliance_notes: "Stay insert-only and avoid background send behavior.",
    testability_hypothesis: "A controlled compose fixture can validate insertion and no-send guarantees."
  },
  {
    seed_id: "seed-local-privacy-transform",
    vertical_or_workflow: "Browser-side privacy or local-only transformation tool",
    target_user: "Operators, researchers, and privacy-conscious users",
    likely_browser_context: "Copied records and browser text transforms",
    expected_repetitive_pain: "Redacting or transforming copied browser data before sharing it",
    likely_extension_wedge: "Locally transform selected text into a redacted or normalized output artifact",
    expected_archetype: "developer_payload_utility",
    why_low_overlap: "This is privacy-focused transformation, not a generic formatter or scanner.",
    how_to_find_evidence: "Privacy forums, support workflows, local-only tool docs, and extension reviews.",
    first_5_queries: [
      "site:chromewebstore.google.com local text redaction extension review",
      "site:chromewebstore.google.com browser privacy transform clipboard extension review",
      "site:reddit.com local-only text redaction browser tool",
      "site:github.com text redaction browser extension issues",
      "site:chromewebstore.google.com local transform selected text extension review"
    ],
    skip_conditions: ["Needs remote OCR or AI", "Becomes a generic security scanner"],
    compliance_notes: "Keep processing local and avoid broad page inspection permissions.",
    testability_hypothesis: "Selected-text fixtures can verify deterministic transformation and copy-ready output."
  }
];

function builderStaticDefaults(builderName) {
  const map = {
    developer_payload_utility: {
      expected_permissions: ["storage", "clipboardWrite"],
      expected_browser_smoke_complexity: "medium",
      estimated_implementation_cost: "small"
    },
    screenshot_annotation_or_qa_support: {
      expected_permissions: ["activeTab", "scripting", "storage"],
      expected_browser_smoke_complexity: "high",
      estimated_implementation_cost: "medium"
    },
    csv_table_cleanup: {
      expected_permissions: ["activeTab", "scripting", "storage"],
      expected_browser_smoke_complexity: "medium",
      estimated_implementation_cost: "small"
    },
    support_debug_handoff: {
      expected_permissions: ["activeTab", "storage"],
      expected_browser_smoke_complexity: "medium",
      estimated_implementation_cost: "medium"
    },
    local_only_email_template: {
      expected_permissions: ["activeTab", "storage"],
      expected_browser_smoke_complexity: "medium",
      estimated_implementation_cost: "small"
    },
    vertical_form_workflow: {
      expected_permissions: ["activeTab", "scripting", "storage"],
      expected_browser_smoke_complexity: "medium",
      estimated_implementation_cost: "small"
    }
  };
  return map[builderName];
}

function roadmapRecommendation({ builderName, candidateCount, avgEvidence, avgOverlap, avgTestability, complianceRisk }) {
  if (builderName === "local_only_email_template" || builderName === "vertical_form_workflow") {
    return {
      recommendation: "reject",
      decision_rationale: "Existing builders already cover this family; the current blocker is strategy quality, not builder absence."
    };
  }
  if (candidateCount >= 3 && avgEvidence >= 80 && avgOverlap <= 45 && avgTestability >= 75 && complianceRisk !== "high") {
    return {
      recommendation: "prioritize",
      decision_rationale: "Multiple candidates show reusable low-overlap demand with testable workflows."
    };
  }
  if (candidateCount >= 1 && complianceRisk !== "high") {
    return {
      recommendation: "monitor",
      decision_rationale: "The signal is real but not yet strong enough to justify builder investment."
    };
  }
  return {
    recommendation: "reject",
    decision_rationale: "Observed candidates are too weak, too risky, or too overlapping to justify builder investment."
  };
}

function manualSeedArchetypes() {
  return unique(MANUAL_SEEDS.map((seed) => seed.expected_archetype));
}

function monitorOnlySeedIds(selectedSeedIds = []) {
  return selectedSeedIds.filter((seedId) => MONITOR_ONLY_SEED_IDS.includes(seedId));
}

function seedPriority(selectedSeedIds = []) {
  const ordered = [...selectedSeedIds];
  const preferredOrder = [
    "seed-support-qa-handoff",
    "seed-saas-admin-cleanup",
    "seed-developer-payload"
  ];
  preferredOrder.reverse().forEach((seedId) => {
    const index = ordered.indexOf(seedId);
    if (index > 0) {
      ordered.splice(index, 1);
      ordered.unshift(seedId);
    }
  });
  return unique(ordered);
}

function extraSeedQueries(seedId) {
  const extras = {
    "seed-support-qa-handoff": [
      "site:chromewebstore.google.com bug report context capture extension review",
      "site:chromewebstore.google.com screenshot page metadata bug report extension review",
      "site:chromewebstore.google.com support ticket context capture extension review",
      "site:github.com browser reproduce steps helper extension issues",
      "site:chromewebstore.google.com local diagnostics handoff extension review"
    ],
    "seed-saas-admin-cleanup": [
      "site:chromewebstore.google.com admin portal table cleanup extension review",
      "site:chromewebstore.google.com CRM copy paste normalization extension review",
      "site:chromewebstore.google.com browser clipboard normalize table extension review",
      "site:github.com browser copy paste cleanup extension issues",
      "site:reddit.com CRM data cleanup copy paste browser extension"
    ],
    "seed-developer-payload": [
      "site:chromewebstore.google.com webhook payload redaction extension review",
      "site:chromewebstore.google.com request response cleanup browser extension review",
      "site:github.com payload redaction browser extension issues",
      "site:chromewebstore.google.com API debugging handoff extension review",
      "site:news.ycombinator.com browser payload utility local only"
    ]
  };
  return extras[seedId] ?? [
    `site:chromewebstore.google.com ${seedId.replace(/^seed-/, "").replaceAll("-", " ")} extension review`,
    `site:github.com ${seedId.replace(/^seed-/, "").replaceAll("-", " ")} extension issues`,
    `site:reddit.com ${seedId.replace(/^seed-/, "").replaceAll("-", " ")} browser workflow`,
    `site:chromewebstore.google.com ${seedId.replace(/^seed-/, "").replaceAll("-", " ")} helper extension review`,
    `site:github.com browser ${seedId.replace(/^seed-/, "").replaceAll("-", " ")} workflow`
  ];
}

function seedBuilderFitAssumption(seed) {
  if (seed.seed_id === "seed-developer-payload") {
    return "monitor_only_future_builder_no_current_builder";
  }
  if (seed.expected_archetype === "support_debug_handoff" || seed.expected_archetype === "csv_table_cleanup") {
    return "future_builder_monitor_only_until_repeated_low_overlap_signal";
  }
  return "evaluate_against_existing_builders_before_any_build";
}

function seedComplianceRiskHypothesis(seed) {
  if (seed.seed_id === "seed-developer-payload") {
    return "low_to_medium_if_local_only_and_no_network_calls";
  }
  if (seed.seed_id === "seed-support-qa-handoff") {
    return "low_if_local_only_no_auto_send_no_remote_upload";
  }
  if (seed.seed_id === "seed-saas-admin-cleanup") {
    return "low_if_user_triggered_clipboard_or_table_transform_only";
  }
  return "medium_until_live evidence confirms low-permission local-only behavior";
}

function seedSkipIf(seed) {
  return unique([
    ...(seed.skip_conditions ?? []),
    "generic autofill",
    "generic tab manager",
    "generic tab export",
    "Amazon review scraping",
    "broad SEO agent",
    "high-permission security scanner",
    seed.seed_id === "seed-developer-payload"
      ? "generic JSON formatter unless narrow wedge is clear"
      : null
  ]);
}

function buildSeedQueryPlan({ runId, selectedSeeds }) {
  const prioritizedSeeds = seedPriority((selectedSeeds ?? []).map((seed) => seed.seed_id));
  const seedsById = new Map((selectedSeeds ?? []).map((seed) => [seed.seed_id, seed]));
  const queries = prioritizedSeeds.flatMap((seedId, seedIndex) => {
    const seed = seedsById.get(seedId);
    if (!seed) {
      return [];
    }
    const plannedQueries = unique([...(seed.first_5_queries ?? []), ...extraSeedQueries(seed.seed_id)]).slice(0, 10);
    return plannedQueries.map((query, queryIndex) => ({
      query,
      seed_id: seed.seed_id,
      seed_priority: seedIndex + 1,
      query_order: queryIndex + 1,
      target_category: seed.vertical_or_workflow,
      hypothesis: seed.seed_id === "seed-support-qa-handoff"
        ? "Support and QA users may install a lightweight local helper that captures bug context, page metadata, and reproducible handoff notes without auto-sending anything."
        : seed.seed_id === "seed-saas-admin-cleanup"
          ? "Operations users may want a low-permission browser helper that normalizes copied table rows, CRM fields, or admin values before pasting them downstream."
          : "Developer and operator users may show repeat demand for local-only payload cleanup or redaction workflows, but this should remain monitor-only until builder fit improves.",
      target_user: seed.target_user,
      expected_pain: seed.expected_repetitive_pain,
      expected_wedge: seed.likely_extension_wedge,
      preferred_archetype: seed.expected_archetype,
      builder_fit_assumption: seedBuilderFitAssumption(seed),
      compliance_risk_hypothesis: seedComplianceRiskHypothesis(seed),
      testability_hypothesis: seed.testability_hypothesis,
      skip_if: seedSkipIf(seed)
    }));
  });

  return buildSafeReport({
    stage: "SEED_QUERY_PLAN",
    status: "passed",
    run_id: runId,
    seed_ids: prioritizedSeeds,
    query_count: queries.length,
    queries
  });
}

function buildStrategyOptions() {
  return [
    {
      option_id: "continue_strategy_v2_with_new_queries",
      expected_benefit: "Keeps the current low-overlap framework and harvests more live evidence without reopening high-overlap categories.",
      risk: "May repeat the same no-build pattern if queries remain too generic.",
      cost: "medium",
      when_to_choose: "Choose this when the current search map feels directionally right but still too narrow or under-sourced.",
      when_not_to_choose: "Do not choose this if consecutive runs still collapse into the same overlap families.",
      recommended_action: "Refresh the low-overlap search map and rerun Strategy V2 with paused high-overlap categories."
    },
    {
      option_id: "manual_vertical_seed",
      expected_benefit: "Injects domain-specific context and lowers the odds of another generic overlap-heavy queue.",
      risk: "Depends on human domain intuition and can narrow the search too aggressively.",
      cost: "medium",
      when_to_choose: "Choose this when generic discovery keeps surfacing form-fill, tab, or capture variants.",
      when_not_to_choose: "Do not choose this if the team has no clear vertical hypotheses to seed.",
      recommended_action: "Pick 2-3 seeds from the manual seed plan and record a `manual_vertical_seed` strategy decision."
    },
    {
      option_id: "future_builder_roadmap",
      expected_benefit: "Turns repeated builder gaps into a deliberate roadmap instead of silently rediscovering them.",
      risk: "Can distract the factory away from immediate low-overlap opportunities and encourage premature builder work.",
      cost: "medium_high",
      when_to_choose: "Choose this when the same future-builder family appears multiple times with decent evidence and strong testability.",
      when_not_to_choose: "Do not choose this if the signal comes from only one or two borderline candidates.",
      recommended_action: "Record roadmap items as `monitor` or `prioritize`, but do not implement a builder in this round."
    },
    {
      option_id: "tighten_or_adjust_thresholds",
      expected_benefit: "Can reduce edge-case false positives or documented false negatives if the benchmark and human review disagree with current gates.",
      risk: "Lowers quality if thresholds are moved just because there was no build-ready candidate.",
      cost: "low",
      when_to_choose: "Choose this only when benchmark evidence or human review shows the current gates are materially wrong.",
      when_not_to_choose: "Do not choose this when the dominant problem is search-space quality or portfolio overlap.",
      recommended_action: "Keep thresholds unchanged unless a human explicitly approves a narrow threshold adjustment."
    },
    {
      option_id: "pause_high_overlap_categories",
      expected_benefit: "Stops wasting discovery budget on repeat categories that keep colliding with the portfolio.",
      risk: "Could hide a differentiated wedge if the pause is too broad.",
      cost: "low",
      when_to_choose: "Choose this when tab/export, generic autofill, or similar families dominate multiple no-build runs.",
      when_not_to_choose: "Do not choose this if a manual seed clearly defines a narrow differentiated wedge inside one paused family.",
      recommended_action: "Add generic autofill, generic tab manager/export, SEO agents, and similar patterns to exclusions for the next task."
    }
  ];
}

function renderStrategyReviewMarkdown(review) {
  return [
    "# Discovery Strategy Review",
    "",
    `- Reviewed runs: ${(review.reviewed_runs ?? []).join(", ")}`,
    `- Candidates seen: ${review.total_candidates_seen}`,
    `- Build ready: ${review.build_ready_count}`,
    `- Research more: ${review.research_more_count}`,
    `- Skipped: ${review.skipped_count}`,
    `- Backlog waiting: ${review.backlog_waiting_count}`,
    `- Recommended primary strategy: ${review.recommended_primary_strategy}`,
    "",
    "## Top Failure Modes",
    "",
    ...(review.top_failure_modes ?? []).map((item) => `- ${item.mode}: ${item.summary}`),
    "",
    "## Strategy Options",
    "",
    ...(review.recommended_strategy_options ?? []).map((item) => `- ${item.option_id}: ${item.recommended_action}`)
  ].join("\n");
}

function renderBuilderRoadmapMarkdown(report) {
  return [
    "# Builder Roadmap Evaluation",
    "",
    ...(report.builders ?? []).map((builder) => `- ${builder.builder_name}: ${builder.recommendation} (${builder.decision_rationale})`)
  ].join("\n");
}

function renderManualSeedMarkdown(plan) {
  return [
    "# Manual Seed Plan",
    "",
    ...(plan.seeds ?? []).map((seed) => `- ${seed.seed_id}: ${seed.vertical_or_workflow}`)
  ].join("\n");
}

function renderSeedQueryPlanMarkdown(plan) {
  const grouped = new Map();
  for (const query of plan.queries ?? []) {
    const entries = grouped.get(query.seed_id) ?? [];
    entries.push(query);
    grouped.set(query.seed_id, entries);
  }
  return [
    "# Seed Query Plan",
    "",
    `- Seeds: ${(plan.seed_ids ?? []).join(", ")}`,
    `- Query count: ${plan.query_count ?? 0}`,
    "",
    ...[...grouped.entries()].flatMap(([seedId, queries]) => [
      `## ${seedId}`,
      "",
      ...queries.map((query) => `- ${query.query}`),
      ""
    ])
  ].join("\n");
}

async function loadStrategyReviewInputs(projectRoot, chain) {
  const strategyReport = await readJson(path.join(chain.strategyRunDir, "55_discovery_strategy_v2.json"));
  const builderFitMap = await readJson(path.join(chain.strategyRunDir, "56_builder_fit_map.json"));
  const searchMap = await readJson(path.join(chain.strategyRunDir, "57_low_overlap_search_map.json"));
  const sourcePriorityModel = await readJson(path.join(chain.strategyRunDir, "58_source_priority_model.json"));
  const queryResults = await readJson(path.join(chain.execRunDir, "59_strategy_v2_query_results.json"));
  const candidateScores = await readJson(path.join(chain.execRunDir, "60_strategy_v2_candidate_scores.json"));
  const nextCandidate = await readJson(path.join(chain.execRunDir, "61_strategy_v2_next_candidate.json"));
  const noBuildToday = await readJson(path.join(chain.execRunDir, "62_no_build_today_report.json"));
  const round2Report = await readOptionalJson(path.join(projectRoot, "runs", chain.originalDiscoverySourceRunId ?? "", "49_targeted_research_round2.json"));
  const evidenceReport = await readOptionalJson(path.join(chain.execRunDir, "20_feedback_evidence.json"));
  const backlog = await loadOpportunityBacklog(projectRoot);
  return {
    strategyReport,
    builderFitMap,
    searchMap,
    sourcePriorityModel,
    queryResults,
    candidateScores,
    nextCandidate,
    noBuildToday,
    round2Report,
    evidenceReport,
    backlog
  };
}

function evidenceSourceDiagnosis(evidenceReport, candidateScores, sourcePriorityModel) {
  const topCandidateIds = (candidateScores.top_ranked_opportunities ?? []).slice(0, 10).map((item) => item.candidate_id);
  const sourceCounts = new Map();
  for (const candidateId of topCandidateIds) {
    const entries = evidenceReport?.evidence_by_candidate?.[candidateId] ?? [];
    for (const entry of entries) {
      const key = entry.source_type ?? "unknown";
      sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1);
    }
  }
  const observedSourceDistribution = [...sourceCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([source_type, count]) => ({ source_type, count }));
  return {
    observed_source_distribution: observedSourceDistribution,
    underused_sources: (sourcePriorityModel.sources ?? [])
      .filter((item) => !sourceCounts.has(item.source_type))
      .slice(0, 4)
      .map((item) => item.source_type),
    diagnosis: observedSourceDistribution.length === 0
      ? "Live evidence distribution could not be computed."
      : "Store listings and support pages dominate the current evidence mix. Review snippets, GitHub issues, and public docs are still underused for differentiation checks."
  };
}

function buildRoadmapCandidatePool({ builderFitMap, backlog, round2Report }) {
  const pool = [];
  const seen = new Set();
  const pushCandidate = (entry) => {
    if (!entry?.candidate_id || !entry?.category) return;
    const key = `${entry.candidate_id}:${entry.category}`;
    if (seen.has(key)) return;
    seen.add(key);
    pool.push(entry);
  };

  for (const candidate of builderFitMap.candidates ?? []) {
    pushCandidate({
      candidate_id: candidate.candidate_id,
      candidate_name: candidate.candidate_name,
      category: classifyRoadmapCandidate(candidate),
      evidence_quality_score: candidate.evidence_quality_score,
      portfolio_overlap_score: candidate.portfolio_overlap_score,
      testability_score: candidate.testability_score,
      compliance_risk: candidate.portfolio_overlap_score > 65 ? 35 : 20,
      build_recommendation: candidate.build_recommendation
    });
  }
  for (const entry of round2Report?.entries ?? []) {
    pushCandidate({
      candidate_id: entry.candidate_id,
      candidate_name: entry.candidate_name,
      category: classifyRoadmapCandidate(entry),
      evidence_quality_score: entry.updated_score_breakdown?.evidence_quality_score,
      portfolio_overlap_score: entry.updated_score_breakdown?.portfolio_overlap_score,
      testability_score: entry.updated_score_breakdown?.testability_score,
      compliance_risk: entry.final_gate_result?.gate_checks?.compliance_risk === false ? 80 : 20,
      build_recommendation: entry.final_decision
    });
  }
  for (const opportunity of backlog.opportunities ?? []) {
    pushCandidate({
      candidate_id: opportunity.candidate_id,
      candidate_name: opportunity.candidate_name,
      category: classifyRoadmapCandidate(opportunity),
      evidence_quality_score: opportunity.evidence_quality_score,
      portfolio_overlap_score: opportunity.portfolio_overlap_score,
      testability_score: opportunity.testability_score,
      compliance_risk: opportunity.compliance_risk,
      build_recommendation: opportunity.build_recommendation
    });
  }
  return pool.filter((entry) => FUTURE_BUILDER_NAMES.includes(entry.category));
}

function buildBuilderRoadmapEvaluation(inputs) {
  const pool = buildRoadmapCandidatePool(inputs);
  const builders = FUTURE_BUILDER_NAMES.map((builderName) => {
    const candidates = pool.filter((entry) => entry.category === builderName);
    const defaults = builderStaticDefaults(builderName);
    const candidateCount = candidates.length;
    const avgEvidence = average(candidates.map((entry) => entry.evidence_quality_score));
    const avgOverlap = average(candidates.map((entry) => entry.portfolio_overlap_score));
    const avgTestability = average(candidates.map((entry) => entry.testability_score));
    const complianceRisk = complianceRiskLevel(average(candidates.map((entry) => entry.compliance_risk)));
    const productAcceptanceRisk = avgOverlap > 50 || avgEvidence < 75 ? "medium_high" : complianceRisk === "high" ? "high" : "medium";
    const recommendation = roadmapRecommendation({ builderName, candidateCount, avgEvidence, avgOverlap, avgTestability, complianceRisk });
    return {
      builder_name: builderName,
      candidate_count_observed: candidateCount,
      representative_candidates: candidates.slice(0, 3).map((entry) => entry.candidate_name),
      average_evidence_quality: avgEvidence,
      average_overlap_score: avgOverlap,
      average_testability_score: avgTestability,
      compliance_risk: complianceRisk,
      expected_permissions: defaults.expected_permissions,
      expected_browser_smoke_complexity: defaults.expected_browser_smoke_complexity,
      product_acceptance_risk: productAcceptanceRisk,
      estimated_implementation_cost: defaults.estimated_implementation_cost,
      expected_reuse_count: candidateCount,
      recommendation: recommendation.recommendation,
      decision_rationale: recommendation.decision_rationale
    };
  });

  return buildSafeReport({
    stage: "BUILDER_ROADMAP_EVALUATION",
    status: "passed",
    reviewed_at: nowIso(),
    builders
  });
}

function buildManualSeedPlan() {
  return buildSafeReport({
    stage: "MANUAL_SEED_PLAN",
    status: "passed",
    reviewed_at: nowIso(),
    seed_count: MANUAL_SEEDS.length,
    seeds: MANUAL_SEEDS
  });
}

async function latestBenchmarkSummary(projectRoot) {
  const runDirs = await listRunDirs(projectRoot);
  for (const runDir of runDirs) {
    const artifactPath = path.join(runDir, "35_discovery_benchmark_report.json");
    if (await fileExists(artifactPath)) {
      return readJson(artifactPath);
    }
  }
  return null;
}

async function buildThresholdCalibrationReview({ projectRoot, chain }) {
  const benchmark = await latestBenchmarkSummary(projectRoot);
  const scoredPool = await readOptionalJson(path.join(chain.execRunDir, "43_batch_opportunity_scores.json"));
  const ranked = scoredPool?.ranked_opportunities ?? [];
  const distribution = {
    total_ranked_candidates: ranked.length,
    evidence_ge_80: ranked.filter((item) => Number(item.evidence_quality_score ?? 0) >= 80).length,
    wedge_ge_82: ranked.filter((item) => Number(item.wedge_clarity_score ?? 0) >= 82).length,
    testability_ge_75: ranked.filter((item) => Number(item.testability_score ?? 0) >= 75).length,
    overlap_le_45: ranked.filter((item) => Number(item.portfolio_overlap_score ?? item.portfolio_overlap_penalty ?? 100) <= 45).length,
    confidence_ge_65: ranked.filter((item) => Number(item.confidence_score ?? 0) >= 65).length
  };
  return buildSafeReport({
    stage: "THRESHOLD_CALIBRATION_REVIEW",
    status: "passed",
    current_thresholds: {
      baseline_discovery: chain.execRunContext.thresholds ?? {},
      strategy_v2_strict: {
        min_evidence_quality_score: 80,
        min_wedge_clarity_score: 82,
        min_testability_score: 75,
        max_portfolio_overlap_score: 45,
        min_confidence_score: 65,
        min_independent_sources: 2
      }
    },
    observed_candidate_distribution: distribution,
    false_positive_risk: "moderate_if_loosened",
    false_negative_risk: "low_to_moderate",
    suggested_threshold_changes: benchmark
      ? []
      : ["No threshold change recommended. Search-space quality should move before gate quality moves."],
    should_change_thresholds: false,
    rationale: benchmark
      ? "Benchmark evidence is available, but the dominant failures are still overlap, wedge clarity, and search-space quality rather than a clearly mis-set threshold."
      : "No local benchmark artifact was found in the recent run set. Current evidence points to search-space failure, not threshold miscalibration, so thresholds should stay unchanged."
  });
}

function buildStrategyReview({ chain, inputs, builderRoadmap, manualSeedPlan, thresholdCalibration }) {
  const topFailureModes = (inputs.strategyReport.discovery_failure_modes ?? []).map((item) => ({
    mode: item.mode,
    summary: item.summary,
    example_count: Array.isArray(item.examples) ? item.examples.length : 0
  }));
  const repeatedPatterns = inputs.strategyReport.repeated_candidate_patterns ?? [];
  const evidenceDiagnosis = evidenceSourceDiagnosis(inputs.evidenceReport, inputs.candidateScores, inputs.sourcePriorityModel);
  const recommendedStrategyOptions = buildStrategyOptions();
  return buildSafeReport({
    stage: "DISCOVERY_STRATEGY_REVIEW",
    status: "passed",
    reviewed_runs: [
      chain.originalDiscoverySourceRunId,
      chain.strategySourceRunId,
      chain.strategyRunId,
      chain.execRunId
    ].filter(Boolean),
    total_candidates_seen: inputs.candidateScores.candidates_seen ?? 0,
    build_ready_count: inputs.candidateScores.build_ready_count ?? 0,
    research_more_count: inputs.candidateScores.research_more_count ?? 0,
    skipped_count: inputs.candidateScores.skip_count ?? 0,
    backlog_waiting_count: inputs.round2Report?.backlog_waiting_count ?? 0,
    top_failure_modes: topFailureModes,
    repeated_patterns: repeatedPatterns,
    search_space_diagnosis: {
      diagnosis: "Generic low-overlap search is still surfacing families adjacent to the existing portfolio. Stronger vertical seeds are needed.",
      recommended_shift: inputs.strategyReport.recommended_search_space_shift ?? [],
      excluded_query_patterns: inputs.strategyReport.excluded_query_patterns ?? [],
      query_count_reviewed: inputs.searchMap.query_count ?? 0
    },
    builder_gap_diagnosis: {
      diagnosis: "Future builder signals exist, but only developer_payload_utility repeated enough to monitor seriously. This still does not justify immediate builder work.",
      future_builder_summary: (builderRoadmap.builders ?? []).map((item) => ({
        builder_name: item.builder_name,
        recommendation: item.recommendation
      }))
    },
    portfolio_overlap_diagnosis: {
      diagnosis: "Overlap remains the dominant blocker. The top Strategy V2 candidate still failed mostly because the queue keeps collapsing into tab/export-adjacent families.",
      overlap_patterns: inputs.strategyReport.high_overlap_patterns ?? [],
      top_candidate_overlap_score: inputs.nextCandidate.portfolio_overlap_score ?? null,
      paused_category_candidates: PAUSE_CATEGORY_PATTERNS
    },
    evidence_source_diagnosis: evidenceDiagnosis,
    recommended_strategy_options: recommendedStrategyOptions,
    recommended_primary_strategy: "manual_vertical_seed",
    human_decision_required: true,
    next_step: "record_strategy_decision"
  });
}

function defaultDecisionSelections(decision, artifacts, note) {
  const normalized = `${decision ?? ""}`.trim();
  return {
    selected_manual_seed_ids: normalized === "manual_vertical_seed"
      ? (artifacts.manualSeedPlan.seeds ?? []).slice(0, 3).map((seed) => seed.seed_id)
      : [],
    selected_builder_roadmap_items: normalized === "prioritize_builder"
      ? (artifacts.builderRoadmap.builders ?? [])
        .filter((item) => item.recommendation === "prioritize" || item.builder_name === "developer_payload_utility")
        .slice(0, 2)
        .map((item) => item.builder_name)
      : [],
    paused_categories: normalized === "pause_category" ? PAUSE_CATEGORY_PATTERNS : [],
    approved_threshold_changes: normalized === "adjust_thresholds"
      ? (artifacts.thresholdCalibration.suggested_threshold_changes ?? []).filter(Boolean)
      : [],
    next_step: normalized === "manual_vertical_seed"
      ? "create_next_task_from_strategy"
      : normalized === "continue_strategy_v2"
        ? "refresh_strategy_v2_query_plan"
        : normalized === "prioritize_builder"
          ? "record_builder_roadmap_only"
          : normalized === "pause_category"
            ? "refresh_query_exclusions"
            : "apply_approved_threshold_changes_only",
    note: `${note ?? ""}`.trim()
  };
}

function parseCsvArg(value) {
  return unique(`${value ?? ""}`.split(",").map((item) => item.trim()).filter(Boolean));
}

export async function generateDiscoveryStrategyReview({ projectRoot = process.cwd(), fromRun = null }) {
  const chain = await resolveStrategyReviewChain(projectRoot, fromRun);
  const inputs = await loadStrategyReviewInputs(projectRoot, chain);
  const { runDir, runContext } = await createStrategyReviewRun(projectRoot, chain);
  const occurredAt = nowIso();

  const builderRoadmap = buildBuilderRoadmapEvaluation(inputs);
  const manualSeedPlan = buildManualSeedPlan();
  const thresholdCalibration = await buildThresholdCalibrationReview({ projectRoot, chain });
  const review = buildStrategyReview({ chain, inputs, builderRoadmap, manualSeedPlan, thresholdCalibration });

  await validateArtifact(projectRoot, "discovery_strategy_review.schema.json", DISCOVERY_STRATEGY_REVIEW_ARTIFACT, review);
  await validateArtifact(projectRoot, "builder_roadmap_evaluation.schema.json", BUILDER_ROADMAP_EVALUATION_ARTIFACT, builderRoadmap);
  await validateArtifact(projectRoot, "manual_seed_plan.schema.json", MANUAL_SEED_PLAN_ARTIFACT, manualSeedPlan);
  await validateArtifact(projectRoot, "threshold_calibration_review.schema.json", THRESHOLD_CALIBRATION_REVIEW_ARTIFACT, thresholdCalibration);

  await writeManagedJsonArtifact({ runDir, runContext, artifactName: DISCOVERY_STRATEGY_REVIEW_ARTIFACT, data: review, occurredAt });
  await writeManagedJsonArtifact({ runDir, runContext, artifactName: BUILDER_ROADMAP_EVALUATION_ARTIFACT, data: builderRoadmap, occurredAt });
  await writeManagedJsonArtifact({ runDir, runContext, artifactName: MANUAL_SEED_PLAN_ARTIFACT, data: manualSeedPlan, occurredAt });
  await writeManagedJsonArtifact({ runDir, runContext, artifactName: THRESHOLD_CALIBRATION_REVIEW_ARTIFACT, data: thresholdCalibration, occurredAt });

  await writeManagedMarkdownArtifact({
    runDir,
    runContext,
    fileName: "63_discovery_strategy_review.md",
    category: "strategy_review",
    prefix: "63_discovery_strategy_review",
    content: renderStrategyReviewMarkdown(review),
    occurredAt
  });
  await writeManagedMarkdownArtifact({
    runDir,
    runContext,
    fileName: "64_builder_roadmap_evaluation.md",
    category: "strategy_review",
    prefix: "64_builder_roadmap_evaluation",
    content: renderBuilderRoadmapMarkdown(builderRoadmap),
    occurredAt
  });
  await writeManagedMarkdownArtifact({
    runDir,
    runContext,
    fileName: "65_manual_seed_plan.md",
    category: "strategy_review",
    prefix: "65_manual_seed_plan",
    content: renderManualSeedMarkdown(manualSeedPlan),
    occurredAt
  });

  return { runDir, runContext, review, builderRoadmap, manualSeedPlan, thresholdCalibration };
}

export async function recordStrategyDecision({
  projectRoot = process.cwd(),
  run,
  decision,
  note,
  reviewer = "human",
  manualSeeds = null,
  builderItems = null,
  pausedCategories = null,
  thresholdChanges = null
}) {
  const strategyRunDir = path.isAbsolute(run) ? run : path.resolve(projectRoot, run);
  const review = await readJson(path.join(strategyRunDir, DISCOVERY_STRATEGY_REVIEW_ARTIFACT));
  const builderRoadmap = await readJson(path.join(strategyRunDir, BUILDER_ROADMAP_EVALUATION_ARTIFACT));
  const manualSeedPlan = await readJson(path.join(strategyRunDir, MANUAL_SEED_PLAN_ARTIFACT));
  const thresholdCalibration = await readJson(path.join(strategyRunDir, THRESHOLD_CALIBRATION_REVIEW_ARTIFACT));
  const defaultSelections = defaultDecisionSelections(decision, {
    review,
    builderRoadmap,
    manualSeedPlan,
    thresholdCalibration
  }, note);

  const decisionRecord = buildSafeReport({
    reviewed_at: nowIso(),
    reviewer,
    source_run_id: path.basename(strategyRunDir),
    decision: `${decision ?? ""}`.trim(),
    note: defaultSelections.note,
    selected_manual_seed_ids: manualSeeds ? parseCsvArg(manualSeeds) : defaultSelections.selected_manual_seed_ids,
    selected_builder_roadmap_items: builderItems ? parseCsvArg(builderItems) : defaultSelections.selected_builder_roadmap_items,
    paused_categories: pausedCategories ? parseCsvArg(pausedCategories) : defaultSelections.paused_categories,
    approved_threshold_changes: thresholdChanges ? parseCsvArg(thresholdChanges) : defaultSelections.approved_threshold_changes,
    next_step: defaultSelections.next_step
  });

  await assertMatchesSchema({
    data: decisionRecord,
    schemaPath: path.join(projectRoot, "schemas", "discovery_strategy_decision.schema.json"),
    label: "state/discovery_strategy_reviews/<timestamp>.json"
  });

  const targetDir = path.join(projectRoot, "state", "discovery_strategy_reviews");
  await ensureDir(targetDir);
  const stamp = nowIso().replace(/[:.]/g, "-");
  const targetPath = path.join(targetDir, `${stamp}.json`);
  await writeJson(targetPath, decisionRecord);
  return { decisionRecord, decisionPath: targetPath };
}

export async function createNextTaskFromStrategy({ projectRoot = process.cwd(), strategyRun, decisionFile }) {
  const strategyRunDir = path.isAbsolute(strategyRun) ? strategyRun : path.resolve(projectRoot, strategyRun);
  const runContext = await readJson(path.join(strategyRunDir, "00_run_context.json"));
  const review = await readJson(path.join(strategyRunDir, DISCOVERY_STRATEGY_REVIEW_ARTIFACT));
  const manualSeedPlan = await readJson(path.join(strategyRunDir, MANUAL_SEED_PLAN_ARTIFACT));
  const decisionPath = path.isAbsolute(decisionFile) ? decisionFile : path.resolve(projectRoot, decisionFile);
  const decision = await readJson(decisionPath);
  const manualSeedLookup = new Map((manualSeedPlan.seeds ?? []).map((seed) => [seed.seed_id, seed]));
  const prioritizedSeedIds = seedPriority(decision.selected_manual_seed_ids ?? []);
  const selectedSeeds = prioritizedSeedIds.map((seedId) => manualSeedLookup.get(seedId)).filter(Boolean);
  const selectedMonitorOnlySeeds = monitorOnlySeedIds(prioritizedSeedIds);
  const seedQueryPlan = buildSeedQueryPlan({
    runId: path.basename(strategyRunDir),
    selectedSeeds
  });
  await validateArtifact(projectRoot, "seed_query_plan.schema.json", SEED_QUERY_PLAN_ARTIFACT, seedQueryPlan);
  const seedQueryPlanWrite = await writeManagedJsonArtifact({
    runDir: strategyRunDir,
    runContext,
    artifactName: SEED_QUERY_PLAN_ARTIFACT,
    data: seedQueryPlan,
    occurredAt: nowIso()
  });
  const seedQueryPlanPath = seedQueryPlanWrite.artifactPath;
  await writeManagedMarkdownArtifact({
    runDir: strategyRunDir,
    runContext,
    fileName: "68_seed_query_plan.md",
    category: "strategy_review",
    prefix: "68_seed_query_plan",
    content: renderSeedQueryPlanMarkdown(seedQueryPlan),
    occurredAt: nowIso()
  });
  const nextTask = {
    mode: "daily",
    run_slug: "seed-discovery",
    date: nowIso().slice(0, 10),
    allow_auto_build_after_human_review: false,
    allow_build_after_research_resolution: false,
    source_strategy_review_run_id: path.basename(strategyRunDir),
    source_strategy_decision_file: path.relative(projectRoot, decisionPath).replaceAll("\\", "/"),
    allowed_categories: runContext.allowed_categories ?? ["Productivity", "Developer Tools", "Workflow & Planning"],
    blocked_categories: runContext.blocked_categories ?? ["Shopping", "Crypto", "VPN", "Security", "Children"],
    thresholds: {
      ...(runContext.thresholds ?? {}),
      min_evidence_quality_score: 80,
      min_testability_score: 75,
      max_portfolio_overlap_penalty: 45
    },
    builder: {
      allow_families: runContext.builder?.allow_families ?? ["tab_csv_window_export", "single_profile_form_fill", "gmail_snippet"]
    },
    research: {
      ...(runContext.research ?? {}),
      mode: "live",
      fallback_to_fixture: false
    },
    discovery: {
      mode: "live_queue",
      manual_seed_ids: prioritizedSeedIds,
      seed_priority: prioritizedSeedIds,
      monitor_only_seed_ids: selectedMonitorOnlySeeds,
      seed_query_plan_artifact: path.relative(projectRoot, seedQueryPlanPath).replaceAll("\\", "/"),
      query_families: selectedSeeds.length > 0
        ? selectedSeeds.map((seed) => seed.vertical_or_workflow)
        : (review.search_space_diagnosis?.recommended_shift ?? []).slice(0, 3),
      excluded_patterns: unique([
        ...(review.search_space_diagnosis?.excluded_query_patterns ?? []),
        ...(decision.paused_categories ?? []),
        "generic JSON formatter unless narrow wedge is clear"
      ]),
      preferred_archetypes: unique([
        ...(selectedSeeds.map((seed) => seed.expected_archetype)),
        ...(decision.selected_builder_roadmap_items ?? []),
        ...manualSeedArchetypes().filter((value) => value === "gmail_snippet" || value === "single_profile_form_fill")
      ]).slice(0, 6),
      max_candidates: 80,
      query_limit: Math.max(30, seedQueryPlan.query_count ?? 30),
      allow_auto_build: false,
      min_evidence_quality_score: 80,
      max_portfolio_overlap_score: 45,
      min_testability_score: 75
    },
    browser_smoke: runContext.browser_smoke ?? { runtime: "dedicated_chromium" },
    publish: {
      ...(runContext.publish ?? {}),
      allow_public_release: false,
      default_publish_intent: "draft_only",
      execution_mode: "planned",
      publish_validation_phase: "fetch_status_only"
    },
    assets: runContext.assets ?? { locale: "en-US", screenshots_target: 3 },
    brand_rules: runContext.brand_rules ?? { tone: "clear, practical, non-hype", forbid_competitor_name_in_title: true }
  };

  await assertMatchesSchema({
    data: nextTask,
    schemaPath: path.join(projectRoot, "schemas", "task.schema.json"),
    label: NEXT_DISCOVERY_TASK_ARTIFACT
  });

  const outputWrite = await writeManagedJsonArtifact({
    runDir: strategyRunDir,
    runContext,
    artifactName: NEXT_DISCOVERY_TASK_ARTIFACT,
    data: nextTask,
    occurredAt: nowIso()
  });
  const outputPath = outputWrite.artifactPath;
  return { task: nextTask, taskPath: outputPath };
}
