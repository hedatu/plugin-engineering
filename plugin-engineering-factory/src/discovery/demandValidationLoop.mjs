import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { loadPortfolioRegistry } from "../portfolio/registry.mjs";
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
import {
  hasSecretLikeContent,
  inspectSecretLikeContent,
  redactSecretLikeValue
} from "../utils/redaction.mjs";
import {
  loadOpportunityBacklog,
  upsertOpportunityEntries
} from "./opportunityBacklog.mjs";

export const DEMAND_VALIDATION_PLAN_ARTIFACT = "82_demand_validation_plan.json";
export const CANDIDATE_RESCORE_WITH_MANUAL_EVIDENCE_ARTIFACT = "83_candidate_rescore_with_manual_evidence.json";

const MANUAL_EVIDENCE_DIR = path.join("state", "manual_evidence");
const SUPPORT_QA_HUMAN_REVIEW_QUEUE_ARTIFACT = "79_support_qa_human_review_queue.json";
const SUPPORT_QA_EVIDENCE_SPRINT_ARTIFACT = "80_support_qa_evidence_sprint.json";
const SUPPORT_QA_CANDIDATE_TEST_PLAN_ARTIFACT = "81_support_qa_candidate_test_plan.json";
const SUPPORT_QA_DEEP_DIVE_ARTIFACT = "76_support_qa_deep_dive.json";
const DEFAULT_CANDIDATE = "Jam";
const MANUAL_EVIDENCE_SOURCE_TYPES = [
  "self_observation",
  "user_interview",
  "customer_support",
  "forum_quote",
  "product_review",
  "internal_workflow",
  "other"
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

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function shortHash(value) {
  return crypto.createHash("sha256").update(`${value ?? ""}`).digest("hex").slice(0, 12);
}

function buildRedactionChecks(value) {
  const checks = inspectSecretLikeContent(value);
  return {
    ...checks,
    redaction_guard_triggered: hasSecretLikeContent(checks)
  };
}

function normalizeWedgeName(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "Page Context to Markdown";
  }
  if (/page-context-to-markdown/i.test(normalized)) {
    return "Page Context to Markdown";
  }
  return normalized
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function inferSourceType(sourceType, source) {
  const normalized = lower(sourceType);
  if (MANUAL_EVIDENCE_SOURCE_TYPES.includes(normalized)) {
    return normalized;
  }
  const sourceText = lower(source);
  if (/self|myself|own observation|i noticed/.test(sourceText)) return "self_observation";
  if (/interview|call|talked to|conversation/.test(sourceText)) return "user_interview";
  if (/support|zendesk|helpdesk|ticket/.test(sourceText)) return "customer_support";
  if (/forum|reddit|hn|hacker news|community|discord|slack/.test(sourceText)) return "forum_quote";
  if (/review|chrome web store|app store|listing/.test(sourceText)) return "product_review";
  if (/internal|team|qa|ops|workflow/.test(sourceText)) return "internal_workflow";
  return "other";
}

function defaultReliabilityWeight(sourceType) {
  return {
    self_observation: 0.32,
    user_interview: 0.85,
    customer_support: 0.88,
    forum_quote: 0.68,
    product_review: 0.66,
    internal_workflow: 0.8,
    other: 0.55
  }[sourceType] ?? 0.55;
}

function defaultLimitations(sourceType) {
  return {
    self_observation: "Self observation only. Useful for hypothesis framing, but not enough to promote the candidate alone.",
    user_interview: "Interview evidence can be directional and may reflect one workflow slice only.",
    customer_support: "Support evidence may be skewed toward the loudest operational problems.",
    forum_quote: "Forum evidence is public and noisy; verify it before promotion.",
    product_review: "Product reviews can over-index on existing tool workflows instead of the narrowed wedge.",
    internal_workflow: "Internal workflow evidence is useful, but still needs external validation before build.",
    other: "Manual evidence requires provenance review before the candidate can be promoted."
  }[sourceType] ?? "Manual evidence requires provenance review before the candidate can be promoted.";
}

function evidenceStrength(record) {
  const combined = lower(`${record.note} ${record.exact_user_words}`);
  const mentionsHandoffPain = /support|qa|bug report|ticket|handoff|copy|paste|clipboard|manual|browser info|browser version|url|title|repro|steps|metadata|zendesk|jira|linear|github/.test(combined);
  const localOnly = /local[- ]only|no upload|without upload|privacy|stay local|clipboard only|offline|do not upload|don't upload/.test(combined);
  const textFirst = /text[- ]first|clipboard|copy|paste|markdown|template|plain text|text only/.test(combined);
  const installIntent = /install|extension|chrome extension|one click|one-click|single button|small extension|would use|would install|want a helper/.test(combined);
  const screenshotOrUploadPreference = /prefer|need|want|only/.test(combined)
    && /screenshot|video|screen recording|loom|upload|cloud|share link/.test(combined);
  const hasExactWords = normalizeText(record.exact_user_words).length > 0;
  const strong = record.source_type !== "self_observation"
    && record.reliability_weight >= 0.65
    && mentionsHandoffPain
    && (hasExactWords || localOnly || textFirst || installIntent);
  return {
    strong,
    mentionsHandoffPain,
    localOnly,
    textFirst,
    installIntent,
    screenshotOrUploadPreference,
    independence_key: `${record.source_type}:${lower(record.source)}`
  };
}

function manualEvidenceSummary(records, analyses) {
  return {
    total_manual_evidence: records.length,
    source_types: unique(records.map((item) => item.source_type)),
    strong_evidence_count: analyses.filter((item) => item.strong).length,
    strongest_notes: records
      .filter((_, index) => analyses[index]?.strong)
      .slice(0, 3)
      .map((item) => ({
        evidence_id: item.evidence_id,
        source_type: item.source_type,
        source: item.source,
        note: item.note
      }))
  };
}

function buildManualEvidenceBacklogTouch(backlogEntry, candidate) {
  return {
    opportunity_id: backlogEntry?.opportunity_id ?? null,
    source_run_id: backlogEntry?.source_run_id ?? null,
    candidate_id: candidate.candidate_id,
    candidate_name: candidate.candidate_name,
    build_recommendation: backlogEntry?.build_recommendation ?? "backlog_waiting",
    status: backlogEntry?.status ?? "backlog_waiting_for_evidence",
    decision_reason: backlogEntry?.decision_reason ?? "Manual evidence recorded; rerun candidate rescore before promotion.",
    linked_run_ids: backlogEntry?.linked_run_ids ?? [],
    linked_portfolio_items: backlogEntry?.linked_portfolio_items ?? [],
    next_step: "rescore_candidate_with_manual_evidence",
    selected_wedge: backlogEntry?.selected_wedge ?? candidate.selected_wedge ?? null,
    last_updated_at: nowIso(),
    status_detail: "manual_evidence_recorded"
  };
}

async function detectLatestDemandValidationRun(projectRoot) {
  const runsRoot = path.join(projectRoot, "runs");
  const entries = await fs.readdir(runsRoot, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));

  for (const name of names) {
    const runDir = path.join(runsRoot, name);
    const runContextPath = path.join(runDir, "00_run_context.json");
    if (!(await fileExists(runContextPath))) {
      continue;
    }
    const runContext = {
      ...(await readJson(runContextPath)),
      project_root: projectRoot
    };
    const requiredArtifacts = await Promise.all([
      loadOptionalManagedArtifact({ runDir, artifactName: SUPPORT_QA_DEEP_DIVE_ARTIFACT, runContext }),
      loadOptionalManagedArtifact({ runDir, artifactName: SUPPORT_QA_HUMAN_REVIEW_QUEUE_ARTIFACT, runContext }),
      loadOptionalManagedArtifact({ runDir, artifactName: SUPPORT_QA_EVIDENCE_SPRINT_ARTIFACT, runContext }),
      loadOptionalManagedArtifact({ runDir, artifactName: SUPPORT_QA_CANDIDATE_TEST_PLAN_ARTIFACT, runContext })
    ]);
    if (requiredArtifacts.every(Boolean)) {
      return runDir;
    }
  }

  return null;
}

async function resolveRunDir(projectRoot, run) {
  if (run) {
    return path.resolve(projectRoot, run);
  }
  const detected = await detectLatestDemandValidationRun(projectRoot);
  if (!detected) {
    throw new Error("No support/QA validation run containing 76, 79, 80, and 81 artifacts was found.");
  }
  return detected;
}

async function loadRequiredArtifact(runDir, runContext, artifactName) {
  const artifact = await loadOptionalManagedArtifact({ runDir, artifactName, runContext });
  if (!artifact) {
    throw new Error(`Missing ${artifactName} in ${runDir}.`);
  }
  return artifact;
}

function selectCandidateFromInputs(backlog, evidenceSprint, candidateInput) {
  const opportunities = backlog.opportunities ?? [];
  const normalized = lower(candidateInput || DEFAULT_CANDIDATE);
  if (
    lower(evidenceSprint.candidate_id) === normalized
    || lower(evidenceSprint.candidate_name) === normalized
    || lower(evidenceSprint.candidate_name).includes(normalized)
  ) {
    const backlogEntry = opportunities.find((item) => item.candidate_id === evidenceSprint.candidate_id) ?? null;
    return {
      candidate_id: evidenceSprint.candidate_id,
      candidate_name: evidenceSprint.candidate_name,
      selected_wedge: evidenceSprint.refined_wedge?.one_sentence_value ?? backlogEntry?.selected_wedge ?? null,
      backlog_entry: backlogEntry
    };
  }

  const backlogEntry = opportunities.find((item) => (
    lower(item.candidate_id) === normalized
    || lower(item.candidate_name) === normalized
    || lower(item.candidate_name).includes(normalized)
  )) ?? null;
  if (backlogEntry) {
    return {
      candidate_id: backlogEntry.candidate_id,
      candidate_name: backlogEntry.candidate_name,
      selected_wedge: backlogEntry.selected_wedge ?? null,
      backlog_entry: backlogEntry
    };
  }

  throw new Error(`Could not resolve candidate "${candidateInput}" from the current support/QA validation state.`);
}

async function loadDemandValidationState(projectRoot, { run = null, candidate = null } = {}) {
  const runDir = await resolveRunDir(projectRoot, run);
  const runContext = {
    ...(await readJson(path.join(runDir, "00_run_context.json"))),
    project_root: projectRoot
  };
  const evidenceSprint = await loadRequiredArtifact(runDir, runContext, SUPPORT_QA_EVIDENCE_SPRINT_ARTIFACT);
  const testPlan = await loadRequiredArtifact(runDir, runContext, SUPPORT_QA_CANDIDATE_TEST_PLAN_ARTIFACT);
  const humanQueue = await loadRequiredArtifact(runDir, runContext, SUPPORT_QA_HUMAN_REVIEW_QUEUE_ARTIFACT);
  const backlog = await loadOpportunityBacklog(projectRoot);
  const portfolioRegistry = await loadPortfolioRegistry(projectRoot);
  const candidateRef = selectCandidateFromInputs(backlog, evidenceSprint, candidate);

  return {
    projectRoot,
    runDir,
    runContext,
    evidenceSprint,
    testPlan,
    humanQueue,
    backlog,
    portfolioRegistry,
    candidateRef
  };
}

async function loadManualEvidenceForCandidate(projectRoot, candidateId) {
  const targetDir = path.join(projectRoot, MANUAL_EVIDENCE_DIR);
  if (!(await fileExists(targetDir))) {
    return [];
  }
  const entries = await fs.readdir(targetDir, { withFileTypes: true });
  const records = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const record = await readJson(path.join(targetDir, entry.name));
    if (record.candidate_id === candidateId) {
      records.push(record);
    }
  }
  records.sort((left, right) => `${left.recorded_at ?? ""}`.localeCompare(`${right.recorded_at ?? ""}`));
  return records;
}

function buildDemandValidationMarkdown(report) {
  return [
    "# Demand Validation Plan",
    "",
    `- Candidate: ${report.candidate_name}`,
    `- Wedge: ${report.wedge_name}`,
    "",
    markdownSection("Hypothesis", report.hypothesis),
    "",
    markdownSection("Target Users", markdownList(report.target_users)),
    "",
    markdownSection("Validation Questions", markdownList(report.validation_questions)),
    "",
    markdownSection("Interview Script", markdownList(report.interview_script)),
    "",
    markdownSection("Survey Questions", markdownList(report.survey_questions)),
    "",
    markdownSection("Success Criteria", markdownList(report.success_criteria)),
    "",
    markdownSection("Failure Criteria", markdownList(report.failure_criteria)),
    "",
    markdownSection("Minimum Evidence Needed", markdownList(report.minimum_evidence_needed)),
    "",
    markdownSection("Next Step", report.next_step)
  ].join("\n");
}

function buildRescoreMarkdown(report) {
  return [
    "# Candidate Rescore With Manual Evidence",
    "",
    `- Candidate: ${report.candidate_name}`,
    `- Wedge: ${report.wedge_name}`,
    `- Final decision: ${report.final_decision}`,
    "",
    markdownSection("Final Reason", report.final_reason),
    "",
    markdownSection("Evidence Summary", markdownList((report.evidence_summary?.strongest_notes ?? []).map((item) => `${item.source_type}: ${item.note}`))),
    "",
    markdownSection("Manual Evidence Count", `- Manual evidence: ${report.manual_evidence_count}\n- Strong manual evidence: ${report.strong_manual_evidence_count}`),
    "",
    markdownSection("Updated Scores", [
      `- evidence_quality: ${report.updated_evidence_quality_score}`,
      `- wedge_clarity: ${report.updated_wedge_clarity_score}`,
      `- install_intent: ${report.updated_install_intent_score}`,
      `- local_only_preference: ${report.updated_local_only_preference_score}`,
      `- text_first_preference: ${report.updated_text_first_preference_score}`,
      `- overlap: ${report.updated_portfolio_overlap_score}`,
      `- testability: ${report.updated_testability_score}`,
      `- permission_risk: ${report.updated_permission_risk}`,
      `- compliance_risk: ${report.updated_compliance_risk}`
    ].join("\n")),
    "",
    markdownSection("Next Step", report.next_step)
  ].join("\n");
}

function buildHumanQueueMarkdown(report, queue) {
  const entry = (queue.entries ?? [])[0];
  return [
    "# Support/QA Human Review Queue",
    "",
    `- Candidate: ${report.candidate_name}`,
    `- Final decision: ${report.final_decision}`,
    `- Recommended decision: ${entry?.recommended_decision ?? "keep_waiting"}`,
    "",
    markdownSection("Why Build", entry?.why_build ?? "n/a"),
    "",
    markdownSection("Why Not Build", entry?.why_not_build ?? "n/a"),
    "",
    markdownSection("Human Question", entry?.human_question ?? "n/a")
  ].join("\n");
}

function buildHumanQueueEntry(state, report, manualSummary) {
  const builderCheck = state.evidenceSprint.builder_fit_check ?? {};
  const queueDecision = report.final_decision === "human_candidate_review_ready"
    ? "approve_build"
    : report.final_decision === "skip"
      ? "skip"
      : "keep_waiting";
  const whyBuild = report.final_decision === "human_candidate_review_ready"
    ? `Strong manual evidence now supports the low-overlap (${report.updated_portfolio_overlap_score}) local-only wedge, with ${report.updated_testability_score} testability and ${report.updated_permission_risk} permission risk.`
    : `The wedge still looks low-overlap, low-permission, and technically feasible for ${builderCheck.builder_name ?? "support_context_clipboard_builder"}.`;
  const humanQuestion = report.final_decision === "human_candidate_review_ready"
    ? "Do we want to build Page Context to Markdown as a local-only support/QA handoff extension?"
    : report.final_decision === "skip"
      ? "Does the available evidence clearly disprove demand for this local-only text-first handoff wedge?"
      : "Can we provide real user evidence or interview notes?";

  return {
    candidate_id: state.candidateRef.candidate_id,
    candidate_name: state.candidateRef.candidate_name,
    wedge_name: report.wedge_name,
    proposed_wedge: state.evidenceSprint.refined_wedge?.one_sentence_value ?? state.candidateRef.selected_wedge ?? "",
    evidence_summary: state.evidenceSprint.user_voice_summary?.summary ?? state.evidenceSprint.final_reason ?? "",
    manual_evidence_summary: manualSummary,
    why_build: whyBuild,
    why_not_build: report.final_reason,
    overlap_risk: `portfolio_overlap_score=${report.updated_portfolio_overlap_score}`,
    permission_risk: report.updated_permission_risk,
    testability_summary: `testability_score=${report.updated_testability_score}`,
    compliance_summary: `compliance_risk=${report.updated_compliance_risk}`,
    builder_fit: builderCheck.builder_name ?? "support_context_clipboard_builder",
    builder_needed: builderCheck.builder_needed ?? true,
    builder_cost: builderCheck.estimated_builder_cost ?? "small",
    expected_permissions: builderCheck.permissions_needed ?? ["activeTab"],
    functional_test_plan: SUPPORT_QA_CANDIDATE_TEST_PLAN_ARTIFACT,
    estimated_build_cost: builderCheck.estimated_builder_cost ?? "small",
    recommended_decision: queueDecision,
    human_question: humanQuestion
  };
}

function buildBacklogUpdate(state, report) {
  const backlogEntry = state.candidateRef.backlog_entry;
  const status = report.final_decision === "human_candidate_review_ready"
    ? "human_candidate_review_ready"
    : report.final_decision === "skip"
      ? "skipped"
      : "backlog_waiting_for_evidence";
  const buildRecommendation = report.final_decision === "human_candidate_review_ready"
    ? "build"
    : report.final_decision === "skip"
      ? "skip"
      : "backlog_waiting";
  const nextStep = report.final_decision === "human_candidate_review_ready"
    ? "human_candidate_review"
    : report.final_decision === "skip"
      ? "skip_support_qa_candidate"
      : "manual_evidence_input";
  const statusDetail = report.final_decision === "human_candidate_review_ready"
    ? "manual_evidence_threshold_met"
    : report.final_decision === "skip"
      ? "manual_evidence_prefers_screenshot_or_upload"
      : "awaiting_independent_manual_user_voice";

  return {
    opportunity_id: backlogEntry?.opportunity_id ?? null,
    source_run_id: state.runContext.run_id,
    candidate_id: state.candidateRef.candidate_id,
    candidate_name: state.candidateRef.candidate_name,
    source_url: backlogEntry?.source_url ?? null,
    category: backlogEntry?.category ?? "Productivity",
    users_estimate: backlogEntry?.users_estimate ?? null,
    rating: backlogEntry?.rating ?? null,
    review_count: backlogEntry?.review_count ?? null,
    latest_update: nowIso(),
    pain_summary: report.final_reason,
    top_pain_clusters: unique([
      ...(backlogEntry?.top_pain_clusters ?? []),
      ...(report.final_decision === "keep_waiting_for_evidence"
        ? [
            "Need at least two independent manual evidence sources confirming support or QA handoff pain.",
            "Need at least one source explicitly preferring local-only or no-upload behavior.",
            "Need at least one source explicitly accepting text-first or clipboard-first output."
          ]
        : [])
    ]),
    evidence_quality_score: report.updated_evidence_quality_score,
    testability_score: report.updated_testability_score,
    wedge_clarity_score: report.updated_wedge_clarity_score,
    portfolio_overlap_score: report.updated_portfolio_overlap_score,
    compliance_risk: report.updated_compliance_risk === "low" ? 20 : report.updated_compliance_risk === "medium" ? 45 : 80,
    build_recommendation: buildRecommendation,
    decision_reason: report.final_reason,
    status,
    linked_run_ids: unique([...(backlogEntry?.linked_run_ids ?? []), state.runContext.run_id]),
    linked_portfolio_items: backlogEntry?.linked_portfolio_items ?? [],
    next_step: nextStep,
    selected_wedge: state.evidenceSprint.refined_wedge?.one_sentence_value ?? state.candidateRef.selected_wedge ?? null,
    research_rounds_completed: Math.max(Number(backlogEntry?.research_rounds_completed ?? 2), 2),
    evidence_requirements: report.final_decision === "keep_waiting_for_evidence"
      ? [
          "At least two independent manual evidence sources from interviews, support workflows, or internal bug-report operations.",
          "At least one explicit statement preferring local-only or no-upload behavior.",
          "At least one explicit statement that a text-first or clipboard-first handoff helper would be used."
        ]
      : [],
    status_detail: statusDetail,
    last_updated_at: nowIso()
  };
}

export async function recordManualEvidence({
  projectRoot,
  run = null,
  candidate = null,
  candidateId = null,
  source,
  sourceType = null,
  note,
  exactUserWords = "",
  supportsWedge,
  reliabilityWeight = null,
  limitations = null,
  reviewer = "human"
}) {
  const backlog = await loadOpportunityBacklog(projectRoot);
  const candidateKey = candidateId ?? candidate ?? DEFAULT_CANDIDATE;
  let candidateRef = null;

  try {
    const state = await loadDemandValidationState(projectRoot, { run, candidate: candidateKey });
    candidateRef = state.candidateRef;
  } catch {
    const normalized = lower(candidateKey);
    const backlogEntry = (backlog.opportunities ?? []).find((item) => (
      lower(item.candidate_id) === normalized
      || lower(item.candidate_name) === normalized
      || lower(item.candidate_name).includes(normalized)
    ));
    if (backlogEntry) {
      candidateRef = {
        candidate_id: backlogEntry.candidate_id,
        candidate_name: backlogEntry.candidate_name,
        selected_wedge: backlogEntry.selected_wedge ?? null,
        backlog_entry: backlogEntry
      };
    }
  }

  if (!candidateRef) {
    throw new Error(`Could not resolve candidate "${candidateKey}" for manual evidence recording.`);
  }
  if (!source || !note || !supportsWedge) {
    throw new Error("candidate, source, note, and supportsWedge are required.");
  }

  const resolvedSourceType = inferSourceType(sourceType, source);
  const recordedAt = nowIso();
  const rawRecord = {
    evidence_id: `manual-${shortHash(`${candidateRef.candidate_id}|${source}|${recordedAt}`)}`,
    candidate_id: candidateRef.candidate_id,
    candidate_name: candidateRef.candidate_name,
    source: normalizeText(source),
    source_type: resolvedSourceType,
    note: normalizeText(note),
    exact_user_words: normalizeText(exactUserWords),
    supports_wedge: normalizeText(supportsWedge),
    reliability_weight: round(
      reliabilityWeight === null || reliabilityWeight === undefined
        ? defaultReliabilityWeight(resolvedSourceType)
        : Number(reliabilityWeight),
      3
    ),
    limitations: normalizeText(limitations) || defaultLimitations(resolvedSourceType),
    recorded_at: recordedAt,
    reviewer: normalizeText(reviewer) || "human"
  };
  const sanitizedCore = redactSecretLikeValue(rawRecord);
  const record = {
    ...sanitizedCore,
    redaction_checks: buildRedactionChecks(sanitizedCore)
  };

  const targetDir = path.join(projectRoot, MANUAL_EVIDENCE_DIR);
  await ensureDir(targetDir);
  const stamp = recordedAt.replace(/[:.]/g, "-");
  const recordPath = path.join(targetDir, `${candidateRef.candidate_id}-${stamp}.json`);
  await validateArtifact(projectRoot, "manual_evidence_note.schema.json", recordPath, record);
  await writeJson(recordPath, record);

  await upsertOpportunityEntries(projectRoot, [
    buildManualEvidenceBacklogTouch(candidateRef.backlog_entry ?? null, candidateRef)
  ]);

  return {
    record,
    recordPath
  };
}

export async function createDemandValidationPlan({
  projectRoot,
  run = null,
  candidate = null,
  wedge = null
}) {
  const state = await loadDemandValidationState(projectRoot, { run, candidate });
  const wedgeName = normalizeWedgeName(wedge ?? state.evidenceSprint.target_micro_wedge);
  const report = buildSafeReport({
    stage: "DEMAND_VALIDATION_PLAN",
    status: "passed",
    run_id: state.runContext.run_id,
    candidate_id: state.candidateRef.candidate_id,
    candidate_name: state.candidateRef.candidate_name,
    wedge_name: wedgeName,
    hypothesis: "Support and QA workers who repeatedly copy page context into tickets or bug reports will use a low-permission extension that outputs a local-only Markdown handoff note instead of uploading screenshots or recordings.",
    target_users: [
      "QA testers writing browser bug reports",
      "Support agents escalating browser issues",
      "Customer success or support engineers creating reproducible ticket context",
      "Developers triaging browser-side bugs from internal support reports"
    ],
    validation_questions: [
      "Do you often need to send current page context to development, support, or QA?",
      "Which fields do you usually copy: URL, page title, browser version, OS, timestamp, repro steps, or screenshot?",
      "Would you prefer text output or screenshot/video for the first handoff?",
      "Do you mind uploading page content to a third-party service?",
      "Would you install a small extension that only copies Markdown to the clipboard?",
      "How do you do this workflow today?",
      "How many times per week does this handoff happen?",
      "Which scenario hurts most: support ticket, QA bug report, customer escalation, or GitHub/Linear/Jira issue?",
      "If the extension only had one button, what should it output?",
      "Why is Jam, Loom, or a screenshot tool not enough for this workflow?"
    ],
    interview_script: [
      "Start with the last time the participant had to hand off a browser bug or support issue.",
      "Ask them to walk through the exact fields they copied and where they pasted them.",
      "Ask what makes the current workflow slow, repetitive, or error-prone.",
      "Probe whether screenshots or videos are actually required, or if text context is enough for the first pass.",
      "Ask directly whether they would prefer local-only / no-upload behavior.",
      "Ask if they would install a tiny extension for one-click context-to-Markdown output.",
      "Capture exact phrases about missing URL, browser version, page title, or repro-step structure."
    ],
    survey_questions: [
      "How often do you manually copy browser or page context into support or bug reports?",
      "Which fields are mandatory in your handoff?",
      "Would clipboard-first Markdown output be useful?",
      "Would you avoid a tool that uploads screenshots or page content?",
      "Would you install a small Chrome extension for this task?"
    ],
    landing_page_copy_draft: {
      headline: "Copy browser bug context into Markdown in one click.",
      subheadline: "Local-only page URL, title, browser info, timestamp, and repro steps. No upload. No automatic sending.",
      bullets: [
        "Generate a clean Markdown handoff block from the current page.",
        "Capture only the fields support and QA need first.",
        "Keep everything local until the user explicitly copies or downloads it."
      ],
      cta: "Try the one-click context packet"
    },
    manual_workflow_test: {
      scenario: "Ask a QA or support participant to file a fresh browser issue with the extension output replaced by a manual template.",
      steps: [
        "Open a page with a reproducible browser issue.",
        "Manually gather URL, title, browser version, timestamp, and repro steps.",
        "Paste them into the draft Markdown template.",
        "Share the resulting handoff note with the downstream developer or support receiver.",
        "Ask whether the output was enough without a screenshot or upload."
      ],
      success_signal: "The participant says the text-first packet saved time and was enough for the first handoff.",
      failure_signal: "The participant insists that screenshot, video, or cloud upload is required before the handoff is useful."
    },
    success_criteria: [
      "At least two independent users or sources explicitly describe the support or QA handoff pain.",
      "At least one source explicitly prefers local-only or no-upload handling.",
      "At least one source explicitly accepts a text-first or clipboard-first workflow.",
      "A clear happy path can still stay inside activeTab and local-only output.",
      "The wedge remains low-permission and low-compliance-risk."
    ],
    failure_criteria: [
      "Users clearly prefer screenshot, video, or cloud upload workflows over text-first output.",
      "Nobody is willing to install a small extension for this action.",
      "The only demand comes from internal speculation or self-observation.",
      "The wedge only becomes useful once it adds higher permissions or external integrations."
    ],
    minimum_evidence_needed: [
      "Two independent strong manual evidence notes from user_interview, customer_support, or internal_workflow sources.",
      "One explicit no-upload or local-only preference signal.",
      "One explicit text-first or clipboard-first acceptance signal.",
      "One install-intent signal that a small extension is acceptable for this job."
    ],
    next_step: "collect_manual_evidence"
  });

  await validateArtifact(state.projectRoot, "demand_validation_plan.schema.json", DEMAND_VALIDATION_PLAN_ARTIFACT, report);
  await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: DEMAND_VALIDATION_PLAN_ARTIFACT,
    data: report
  });
  await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "82_demand_validation_plan.md",
    category: "support_qa_validation",
    prefix: "82_demand_validation_plan",
    content: buildDemandValidationMarkdown(report)
  });

  return {
    runDir: state.runDir,
    report
  };
}

export async function rescoreCandidateWithManualEvidence({
  projectRoot,
  run = null,
  candidate = null
}) {
  const state = await loadDemandValidationState(projectRoot, { run, candidate });
  const manualEvidence = await loadManualEvidenceForCandidate(projectRoot, state.candidateRef.candidate_id);
  const analyses = manualEvidence.map((item) => evidenceStrength(item));
  const strongIndependentEvidenceCount = unique(analyses.filter((item) => item.strong).map((item) => item.independence_key)).length;
  const localOnlyManualEvidenceCount = unique(analyses.filter((item) => item.localOnly).map((item) => item.independence_key)).length;
  const textFirstManualEvidenceCount = unique(analyses.filter((item) => item.textFirst).map((item) => item.independence_key)).length;
  const installIntentManualEvidenceCount = unique(analyses.filter((item) => item.installIntent).map((item) => item.independence_key)).length;
  const screenshotPreferenceCount = unique(analyses.filter((item) => item.screenshotOrUploadPreference).map((item) => item.independence_key)).length;
  const selfObservationOnly = manualEvidence.length > 0 && manualEvidence.every((item) => item.source_type === "self_observation");

  const priorEvidence = Number(state.evidenceSprint.updated_evidence_quality_score ?? 0);
  const priorWedge = Number(state.evidenceSprint.updated_wedge_clarity_score ?? 0);
  const priorOverlap = Number(state.evidenceSprint.updated_portfolio_overlap_score ?? 0);
  const priorTestability = Number(state.evidenceSprint.updated_testability_score ?? state.testPlan.expected_functional_test_matrix?.length * 7 ?? 0);
  const priorInstallSignals = Number(state.evidenceSprint.install_intent_signals?.length ?? 0);
  const priorLocalOnlySignals = Number(state.evidenceSprint.local_only_preference_signals?.length ?? 0);
  const priorTextSignals = Number(state.evidenceSprint.text_first_handoff_signals?.length ?? 0);

  let updatedEvidenceQualityScore = clamp(
    priorEvidence
    + (strongIndependentEvidenceCount * 4.5)
    + (localOnlyManualEvidenceCount * 3.5)
    + (textFirstManualEvidenceCount * 2.5)
    + (installIntentManualEvidenceCount * 3)
    - (screenshotPreferenceCount * 6)
  );
  if (strongIndependentEvidenceCount < 2) {
    updatedEvidenceQualityScore = Math.min(updatedEvidenceQualityScore, 79);
  }

  const updatedWedgeClarityScore = round(clamp(priorWedge + Math.min(6, strongIndependentEvidenceCount * 1.4)));
  const updatedInstallIntentScore = round(clamp((priorInstallSignals * 18) + (installIntentManualEvidenceCount * 24)));
  const updatedLocalOnlyPreferenceScore = round(clamp((priorLocalOnlySignals * 22) + (localOnlyManualEvidenceCount * 26)));
  const updatedTextFirstPreferenceScore = round(clamp((priorTextSignals * 10) + (textFirstManualEvidenceCount * 24)));
  const updatedTestabilityScore = round(clamp(priorTestability + Math.min(2, strongIndependentEvidenceCount * 0.5)));
  const updatedPermissionRisk = "low";
  const updatedComplianceRisk = state.evidenceSprint.updated_compliance_risk ?? "low";

  const manualSummary = manualEvidenceSummary(manualEvidence, analyses);
  let finalDecision = "keep_waiting_for_evidence";
  let finalReason = "The candidate still needs independent manual evidence proving demand for a local-only text-first support or QA handoff helper.";
  let nextStep = "manual_evidence_input";

  if (manualEvidence.length === 0) {
    finalReason = "No new manual evidence was recorded, so the candidate cannot move beyond backlog_waiting_for_evidence.";
  } else if (selfObservationOnly) {
    finalReason = "Only self-observation evidence exists right now. That is not enough to promote the candidate to human review.";
  } else if (
    screenshotPreferenceCount >= Math.max(2, strongIndependentEvidenceCount)
    && localOnlyManualEvidenceCount === 0
    && textFirstManualEvidenceCount === 0
  ) {
    finalDecision = "skip";
    finalReason = "Manual evidence now leans toward screenshot, video, or cloud-upload workflows rather than the local-only text-first wedge.";
    nextStep = "skip_support_qa_candidate";
  } else if (
    strongIndependentEvidenceCount >= 2
    && localOnlyManualEvidenceCount >= 1
    && textFirstManualEvidenceCount >= 1
    && installIntentManualEvidenceCount >= 1
    && updatedEvidenceQualityScore >= 80
    && updatedWedgeClarityScore >= 82
    && updatedTestabilityScore >= 80
    && priorOverlap <= 45
    && updatedComplianceRisk !== "high"
  ) {
    finalDecision = "human_candidate_review_ready";
    finalReason = "Manual evidence now clears the demand threshold for a low-overlap local-only text-first support/QA handoff helper.";
    nextStep = "human_candidate_review";
  }

  const report = buildSafeReport({
    stage: "CANDIDATE_RESCORE_WITH_MANUAL_EVIDENCE",
    status: "passed",
    run_id: state.runContext.run_id,
    candidate_id: state.candidateRef.candidate_id,
    candidate_name: state.candidateRef.candidate_name,
    wedge_name: state.evidenceSprint.refined_wedge?.wedge_name ?? "Page Context to Markdown",
    prior_decision: state.evidenceSprint.final_decision,
    manual_evidence_count: manualEvidence.length,
    strong_manual_evidence_count: strongIndependentEvidenceCount,
    evidence_summary: manualSummary,
    updated_evidence_quality_score: round(updatedEvidenceQualityScore),
    updated_wedge_clarity_score: updatedWedgeClarityScore,
    updated_install_intent_score: updatedInstallIntentScore,
    updated_local_only_preference_score: updatedLocalOnlyPreferenceScore,
    updated_text_first_preference_score: updatedTextFirstPreferenceScore,
    updated_portfolio_overlap_score: priorOverlap,
    updated_testability_score: updatedTestabilityScore,
    updated_permission_risk: updatedPermissionRisk,
    updated_compliance_risk: updatedComplianceRisk,
    portfolio_registry_item_count: state.portfolioRegistry.items?.length ?? 0,
    final_decision: finalDecision,
    final_reason: finalReason,
    next_step: nextStep
  });

  const updatedHumanQueue = buildSafeReport({
    stage: "SUPPORT_QA_HUMAN_REVIEW_QUEUE",
    status: "passed",
    run_id: state.runContext.run_id,
    no_build_today: finalDecision !== "human_candidate_review_ready",
    queue_count: 1,
    entries: [
      buildHumanQueueEntry(state, report, manualSummary)
    ],
    next_step: nextStep
  });

  await validateArtifact(
    state.projectRoot,
    "candidate_rescore_with_manual_evidence.schema.json",
    CANDIDATE_RESCORE_WITH_MANUAL_EVIDENCE_ARTIFACT,
    report
  );
  await validateArtifact(
    state.projectRoot,
    "support_qa_human_review_queue.schema.json",
    SUPPORT_QA_HUMAN_REVIEW_QUEUE_ARTIFACT,
    updatedHumanQueue
  );

  await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: CANDIDATE_RESCORE_WITH_MANUAL_EVIDENCE_ARTIFACT,
    data: report
  });
  await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "83_candidate_rescore_with_manual_evidence.md",
    category: "support_qa_validation",
    prefix: "83_candidate_rescore_with_manual_evidence",
    content: buildRescoreMarkdown(report)
  });
  await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: SUPPORT_QA_HUMAN_REVIEW_QUEUE_ARTIFACT,
    data: updatedHumanQueue
  });
  await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "79_support_qa_human_review_queue.md",
    category: "support_qa_deep_dive",
    prefix: "79_support_qa_human_review_queue",
    content: buildHumanQueueMarkdown(report, updatedHumanQueue)
  });

  await upsertOpportunityEntries(state.projectRoot, [
    buildBacklogUpdate(state, report)
  ]);

  return {
    runDir: state.runDir,
    report,
    humanQueue: updatedHumanQueue
  };
}
