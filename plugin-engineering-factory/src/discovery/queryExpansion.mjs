import fs from "node:fs/promises";
import path from "node:path";
import {
  buildSafeReport,
  validateArtifact,
  writeManagedJsonArtifact,
  writeManagedMarkdownArtifact
} from "../review/helpers.mjs";
import { fileExists, nowIso, readJson } from "../utils/io.mjs";

export const QUERY_EXPANSION_PLAN_ARTIFACT = "50_query_expansion_plan.json";

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

async function detectLatestExpansionSourceRun(projectRoot) {
  const runsRoot = path.join(projectRoot, "runs");
  const entries = await fs.readdir(runsRoot, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const runDir = path.join(runsRoot, entry.name);
    if (
      await fileExists(path.join(runDir, "46_targeted_research_batch.json"))
      && await fileExists(path.join(runDir, "48_human_candidate_review_queue.json"))
    ) {
      matches.push(runDir);
    }
  }
  matches.sort((left, right) => path.basename(right).localeCompare(path.basename(left)));
  return matches[0] ?? null;
}

async function resolveRunDir(projectRoot, fromRun) {
  if (fromRun) {
    return path.resolve(projectRoot, fromRun);
  }
  const detected = await detectLatestExpansionSourceRun(projectRoot);
  if (!detected) {
    throw new Error("No live queue run with targeted research artifacts was found.");
  }
  return detected;
}

function excludedPatterns(backlog = {}, registry = {}) {
  const backlogItems = backlog.opportunities ?? [];
  const registryItems = registry.items ?? [];
  return unique([
    "generic autofill",
    "generic tab export",
    "Amazon review scraping",
    "broad SEO agents",
    "high-permission security scanners",
    ...backlogItems
      .filter((item) => item.status?.startsWith?.("skipped_"))
      .map((item) => item.selected_wedge ?? item.candidate_name),
    ...registryItems
      .filter((item) => ["single_profile_form_fill", "tab_csv_window_export"].includes(item.family))
      .map((item) => item.wedge)
  ]).slice(0, 16);
}

function buildQueries() {
  return [
    {
      query: "site:chromewebstore.google.com recruiter intake assistant visible fields local only review",
      target_category: "vertical form workflows",
      intended_low_overlap_angle: "Recruiter intake rather than generic autofill.",
      excluded_overlap_patterns: ["generic autofill", "multi-profile dashboards"],
      preferred_archetype: "single_profile_form_fill",
      expected_pain_signal: "Repeated candidate entry with overwrite anxiety.",
      testability_hypothesis: "Controlled recruiter-style form fixture can validate blank-only fill and skipped-field feedback.",
      compliance_risk_hypothesis: "Low if local-only storage and no sensitive sync are required.",
      why_this_is_different_from_portfolio: "Focuses on a vertical trigger moment instead of a general one-profile helper."
    },
    {
      query: "site:chromewebstore.google.com customer support reply form helper local only review",
      target_category: "vertical form workflows",
      intended_low_overlap_angle: "Customer-support macros into browser forms rather than generic lead fill.",
      excluded_overlap_patterns: ["generic autofill", "CRM contact autofill"],
      preferred_archetype: "single_profile_form_fill",
      expected_pain_signal: "Repetitive ticket metadata entry and skipped field confusion.",
      testability_hypothesis: "Fixture can verify textarea and select filling without overwriting existing values.",
      compliance_risk_hypothesis: "Low if data stays local and no background sync exists.",
      why_this_is_different_from_portfolio: "Targets support reply workflows, not general CRM-style profile fill."
    },
    {
      query: "site:chromewebstore.google.com property listing form helper copy paste local only review",
      target_category: "vertical form workflows",
      intended_low_overlap_angle: "Property listing data entry instead of general-purpose fill.",
      excluded_overlap_patterns: ["generic autofill", "resume/job application helpers"],
      preferred_archetype: "single_profile_form_fill",
      expected_pain_signal: "Repeated address, phone, and listing metadata entry.",
      testability_hypothesis: "Controlled property-form fixture can verify supported field coverage and feedback.",
      compliance_risk_hypothesis: "Low if the helper stays local-only and single-profile.",
      why_this_is_different_from_portfolio: "A real-estate listing flow is narrower than the current general portfolio."
    },
    {
      query: "site:chromewebstore.google.com qa screenshot annotator chrome extension review",
      target_category: "screenshot and QA workflows",
      intended_low_overlap_angle: "QA annotation instead of export or fill.",
      excluded_overlap_patterns: ["generic screenshot suite", "heavy cloud collaboration"],
      preferred_archetype: "future_builder_opportunity",
      expected_pain_signal: "Manual screenshot markup and handoff steps.",
      testability_hypothesis: "Browser fixture can validate capture, annotation, and local save flow.",
      compliance_risk_hypothesis: "Medium-low if page capture is explicit and local-only.",
      why_this_is_different_from_portfolio: "It is a QA support artifact workflow, not a tab exporter."
    },
    {
      query: "site:chromewebstore.google.com bug report handoff extension markdown links review",
      target_category: "support and debug handoff",
      intended_low_overlap_angle: "Debug handoff package rather than generic tab export.",
      excluded_overlap_patterns: ["generic tab export", "whole-session backup"],
      preferred_archetype: "tab_csv_window_export",
      expected_pain_signal: "Support teams need quick, bounded context sharing.",
      testability_hypothesis: "Fixture can validate current-window bundle generation and explicit handoff output.",
      compliance_risk_hypothesis: "Low if current-window only and no remote sync.",
      why_this_is_different_from_portfolio: "The output artifact is support handoff oriented instead of CSV export."
    },
    {
      query: "site:chromewebstore.google.com browser handoff checklist extension local only review",
      target_category: "support and debug handoff",
      intended_low_overlap_angle: "Checklist or snapshot handoff, not tab dumps.",
      excluded_overlap_patterns: ["generic tab export", "broad knowledge-base sync"],
      preferred_archetype: "future_builder_opportunity",
      expected_pain_signal: "Operators manually capture browser context before handing off issues.",
      testability_hypothesis: "Local artifact generation can be validated in a deterministic debug fixture.",
      compliance_risk_hypothesis: "Medium-low if scope stays current-tab or current-window only.",
      why_this_is_different_from_portfolio: "It addresses debug handoff workflows instead of export-for-export's-sake."
    },
    {
      query: "site:chromewebstore.google.com csv cleanup browser extension local only review",
      target_category: "data cleanup",
      intended_low_overlap_angle: "CSV and table cleanup, not tab export.",
      excluded_overlap_patterns: ["generic tab export", "cloud spreadsheet integrations"],
      preferred_archetype: "future_builder_opportunity",
      expected_pain_signal: "Manual cleanup before data becomes shareable.",
      testability_hypothesis: "Fixture can validate paste-clean-copy operations fully in-browser.",
      compliance_risk_hypothesis: "Low if clipboard and local-only processing are explicit.",
      why_this_is_different_from_portfolio: "The artifact is cleaned table data, not browser tab metadata."
    },
    {
      query: "site:chromewebstore.google.com table formatter extension copy paste review",
      target_category: "data cleanup",
      intended_low_overlap_angle: "Structured table cleanup instead of session export.",
      excluded_overlap_patterns: ["tab export", "heavy sheet sync"],
      preferred_archetype: "future_builder_opportunity",
      expected_pain_signal: "Operators fight inconsistent pasted table formats.",
      testability_hypothesis: "Deterministic input-output fixture can validate cleanup rules.",
      compliance_risk_hypothesis: "Low because the flow can stay local-only.",
      why_this_is_different_from_portfolio: "It solves copy-paste cleanup, not navigation export."
    },
    {
      query: "site:chromewebstore.google.com json compare chrome extension local only review",
      target_category: "developer utilities",
      intended_low_overlap_angle: "Developer-local diffing instead of consumer productivity.",
      excluded_overlap_patterns: ["generic tab export", "generic autofill"],
      preferred_archetype: "future_builder_opportunity",
      expected_pain_signal: "Two payloads are hard to compare quickly in-browser.",
      testability_hypothesis: "Paste-compare-copy is easy to test locally with fixtures.",
      compliance_risk_hypothesis: "Low if no network access and no host permissions are required.",
      why_this_is_different_from_portfolio: "This is a local developer utility with no overlap to existing portfolio flows."
    },
    {
      query: "site:github.com browser json diff extension issue local only",
      target_category: "developer utilities",
      intended_low_overlap_angle: "External evidence for local JSON debugging demand.",
      excluded_overlap_patterns: ["generic browser automation", "cloud IDE integrations"],
      preferred_archetype: "future_builder_opportunity",
      expected_pain_signal: "Repeated issue reports about manual JSON compare or parse steps.",
      testability_hypothesis: "If corroborated, a local compare happy path is deterministic.",
      compliance_risk_hypothesis: "Low because the wedge can remain paste-in local-only.",
      why_this_is_different_from_portfolio: "Adds independent-source evidence for a non-overlapping builder gap."
    },
    {
      query: "site:chromewebstore.google.com browser response header analyzer extension review",
      target_category: "developer utilities",
      intended_low_overlap_angle: "Read-only diagnostics instead of active security scanning.",
      excluded_overlap_patterns: ["high-permission scanners", "network interception"],
      preferred_archetype: "future_builder_opportunity",
      expected_pain_signal: "Developers struggle to inspect headers or policies quickly.",
      testability_hypothesis: "Fixture can validate read-only header decoding and copy-ready output.",
      compliance_risk_hypothesis: "Medium if permissions expand beyond explicit read-only behavior.",
      why_this_is_different_from_portfolio: "It is read-only diagnostics, not a security mutation tool."
    },
    {
      query: "site:github.com csp header analyzer chrome extension issue read only",
      target_category: "developer utilities",
      intended_low_overlap_angle: "Evidence for read-only CSP diagnostics only.",
      excluded_overlap_patterns: ["policy bypass", "request mutation"],
      preferred_archetype: "future_builder_opportunity",
      expected_pain_signal: "Repeated complaints about slow manual CSP inspection.",
      testability_hypothesis: "Static header fixtures can validate analyzer output.",
      compliance_risk_hypothesis: "Medium-low if the wedge never mutates traffic.",
      why_this_is_different_from_portfolio: "It searches for safer diagnostics evidence rather than risky scanners."
    },
    {
      query: "site:chromewebstore.google.com copy current page as markdown link extension review",
      target_category: "browser workflow friction",
      intended_low_overlap_angle: "Single-page capture rather than current-window export.",
      excluded_overlap_patterns: ["generic tab export", "multi-tab backup"],
      preferred_archetype: "tab_csv_window_export",
      expected_pain_signal: "Writers manually clean and share single-page links.",
      testability_hypothesis: "Fixture can validate a one-click markdown output for the current page only.",
      compliance_risk_hypothesis: "Low because only the active page title and URL are needed.",
      why_this_is_different_from_portfolio: "This narrows the workflow to single-page capture instead of window exports."
    },
    {
      query: "site:chromewebstore.google.com clipboard cleanup chrome extension local only review",
      target_category: "browser workflow friction",
      intended_low_overlap_angle: "Clipboard cleanup rather than export or form fill.",
      excluded_overlap_patterns: ["generic clipboard manager", "cloud sync"],
      preferred_archetype: "future_builder_opportunity",
      expected_pain_signal: "Operators repeatedly clean pasted content before reuse.",
      testability_hypothesis: "Copy-transform-paste fixtures are deterministic and browser-local.",
      compliance_risk_hypothesis: "Low if explicit user action and local-only scope stay intact.",
      why_this_is_different_from_portfolio: "Clipboard cleanup is a separate local workflow with low overlap."
    },
    {
      query: "site:chromewebstore.google.com support macro browser extension no send review",
      target_category: "low-risk email or template workflows",
      intended_low_overlap_angle: "Draft support macros without auto-send behavior.",
      excluded_overlap_patterns: ["broad email automation", "mailbox-wide access"],
      preferred_archetype: "gmail_snippet",
      expected_pain_signal: "Support agents want faster draft insertion without heavy UI.",
      testability_hypothesis: "Fixture can validate insert-only compose behavior and shortcut flow.",
      compliance_risk_hypothesis: "Low if the wedge never sends and permissions stay minimal.",
      why_this_is_different_from_portfolio: "It is an insert-only support macro helper, not a generic snippet suite."
    },
    {
      query: "site:github.com canned response browser extension issue keyboard shortcut",
      target_category: "low-risk email or template workflows",
      intended_low_overlap_angle: "Keyboard-first macro insertion evidence.",
      excluded_overlap_patterns: ["mailbox automation", "auto-send"],
      preferred_archetype: "gmail_snippet",
      expected_pain_signal: "Compose flow feels too slow for frequent canned replies.",
      testability_hypothesis: "Keyboard-first insertion can be validated deterministically.",
      compliance_risk_hypothesis: "Low if insertion stays local and explicit.",
      why_this_is_different_from_portfolio: "It seeks narrower evidence for insert-only compose flows."
    },
    {
      query: "site:chromewebstore.google.com admin panel copy paste helper extension review",
      target_category: "small SaaS admin workflows",
      intended_low_overlap_angle: "Admin-side cleanup or helper actions instead of general fill.",
      excluded_overlap_patterns: ["generic autofill", "multi-page automation"],
      preferred_archetype: "future_builder_opportunity",
      expected_pain_signal: "Admin users repeat the same cleanup or copy-paste steps across records.",
      testability_hypothesis: "Fixture can validate bounded admin helper actions without network side effects.",
      compliance_risk_hypothesis: "Medium-low if the helper stays local and explicit.",
      why_this_is_different_from_portfolio: "It looks for SaaS admin wedges outside the current portfolio families."
    },
    {
      query: "site:chromewebstore.google.com screenshot annotate bug report chrome extension review",
      target_category: "screenshot and QA workflows",
      intended_low_overlap_angle: "Bug-report annotation workflows instead of generic capture.",
      excluded_overlap_patterns: ["generic screenshot editor", "team cloud workspace"],
      preferred_archetype: "future_builder_opportunity",
      expected_pain_signal: "QA and support teams manually mark screenshots before sharing.",
      testability_hypothesis: "A controlled page plus local save path can verify annotation workflow.",
      compliance_risk_hypothesis: "Medium-low if capture stays user-triggered and local-only.",
      why_this_is_different_from_portfolio: "The job is QA handoff, not tab export or form fill."
    },
    {
      query: "site:chromewebstore.google.com browser qa checklist extension review",
      target_category: "screenshot and QA workflows",
      intended_low_overlap_angle: "QA checklist capture instead of workflow automation.",
      excluded_overlap_patterns: ["broad project management", "cloud sync dashboards"],
      preferred_archetype: "future_builder_opportunity",
      expected_pain_signal: "Teams manually track repeat QA checks in the browser.",
      testability_hypothesis: "Deterministic checklist state transitions are easy to validate.",
      compliance_risk_hypothesis: "Low if local-only and single-purpose.",
      why_this_is_different_from_portfolio: "This is a QA checklist wedge with no overlap to current builders."
    },
    {
      query: "site:chromewebstore.google.com privacy local only browser note extension review",
      target_category: "browser-side privacy tools",
      intended_low_overlap_angle: "Private local notes or annotations, not monitoring or scanning.",
      excluded_overlap_patterns: ["security scanner", "remote sync"],
      preferred_archetype: "future_builder_opportunity",
      expected_pain_signal: "Users need private browser-side context capture without cloud accounts.",
      testability_hypothesis: "Local note attach-and-retrieve flow can be validated with fixtures.",
      compliance_risk_hypothesis: "Low if data never leaves the browser.",
      why_this_is_different_from_portfolio: "It is a privacy-local context tool, not a fill/export wedge."
    },
    {
      query: "site:github.com browser debug handoff extension issue local only",
      target_category: "support and debug handoff",
      intended_low_overlap_angle: "External evidence for local debug handoff needs.",
      excluded_overlap_patterns: ["generic tab export", "session backup"],
      preferred_archetype: "future_builder_opportunity",
      expected_pain_signal: "Debug handoff steps remain manual and inconsistent.",
      testability_hypothesis: "Local artifact output can be validated on controlled bug fixtures.",
      compliance_risk_hypothesis: "Medium-low if the artifact is bounded and explicit.",
      why_this_is_different_from_portfolio: "Targets support and debug handoff rather than existing export utilities."
    }
  ];
}

function renderQueryExpansionMarkdown(plan) {
  return [
    "# Query Expansion Plan",
    "",
    `- Run: ${plan.run_id}`,
    `- Source run: ${plan.source_run_id}`,
    `- Query count: ${plan.query_count}`,
    `- Goal: ${plan.goal}`,
    "",
    ...(plan.queries ?? []).map((query, index) => `- ${index + 1}. ${query.query} (${query.target_category})`)
  ].join("\n");
}

export async function generateQueryExpansionPlan({ projectRoot = process.cwd(), fromRun = null }) {
  const runDir = await resolveRunDir(projectRoot, fromRun);
  const runContext = await readJson(path.join(runDir, "00_run_context.json"));
  const backlog = await readJson(path.join(projectRoot, "state", "opportunity_backlog.json"));
  const registry = await readJson(path.join(projectRoot, "state", "portfolio_registry.json"));
  const round2 = await readJson(path.join(runDir, "49_targeted_research_round2.json"));
  const occurredAt = nowIso();
  const queries = buildQueries();

  const report = buildSafeReport({
    stage: "QUERY_EXPANSION_PLAN",
    status: "passed",
    run_id: runContext.run_id,
    source_run_id: runContext.source_run_id ?? null,
    generated_at: occurredAt,
    goal: "Find lower-overlap wedges after round 2 produced no clear build-ready candidate.",
    query_count: queries.length,
    excluded_overlap_patterns: excludedPatterns(backlog, registry),
    no_build_today: round2.build_ready_count === 0,
    queries,
    next_10_search_queries: queries,
    next_step: "run_live_queue_round2"
  });

  await validateArtifact(projectRoot, "query_expansion_plan.schema.json", QUERY_EXPANSION_PLAN_ARTIFACT, report);
  const writeResult = await writeManagedJsonArtifact({
    runDir,
    runContext,
    artifactName: QUERY_EXPANSION_PLAN_ARTIFACT,
    data: report,
    occurredAt
  });
  const markdownWrite = await writeManagedMarkdownArtifact({
    runDir,
    runContext,
    fileName: "50_query_expansion_plan.md",
    category: "query_expansion",
    prefix: "50_query_expansion_plan",
    content: renderQueryExpansionMarkdown(report),
    occurredAt
  });

  return {
    plan: report,
    artifact: writeResult.artifactRelativePath,
    markdown: markdownWrite.artifactRelativePath
  };
}
