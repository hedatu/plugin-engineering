import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { assertMatchesSchema } from "../utils/schema.mjs";
import { ensureDir, fileExists, nowIso, readJson, writeJson } from "../utils/io.mjs";

export const OPPORTUNITY_BACKLOG_PATH = path.join("state", "opportunity_backlog.json");
export const CANDIDATE_REVIEWS_DIR = path.join("state", "candidate_reviews");

function absoluteBacklogPath(projectRoot) {
  return path.join(projectRoot, OPPORTUNITY_BACKLOG_PATH);
}

function backlogLockPath(projectRoot) {
  return path.join(projectRoot, "state", ".locks", "opportunity_backlog.lock.json");
}

function candidateReviewPath(projectRoot, candidateId, occurredAt = nowIso()) {
  const stamp = `${occurredAt}`.replace(/[:.]/g, "-");
  return path.join(projectRoot, CANDIDATE_REVIEWS_DIR, `${candidateId}-${stamp}.json`);
}

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function shortHash(value) {
  return crypto.createHash("sha256").update(`${value ?? ""}`).digest("hex").slice(0, 12);
}

function normalizeString(value) {
  const normalized = `${value ?? ""}`.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeArray(values) {
  return unique((values ?? []).map((value) => normalizeString(value)).filter(Boolean));
}

function normalizeRecommendation(value) {
  const normalized = `${value ?? ""}`.trim().toLowerCase();
  if (normalized === "build") return "build";
  if (normalized === "research_more") return "research_more";
  if (normalized === "backlog_waiting") return "backlog_waiting";
  return "skip";
}

function normalizeStatus(value, recommendation = null) {
  const normalized = `${value ?? ""}`.trim().toLowerCase();
  if ([
    "new",
    "research_more",
    "build_ready",
    "human_candidate_review_ready",
    "skipped",
    "built",
    "killed",
    "backlog_waiting_for_evidence",
    "backlog_waiting_for_builder",
    "backlog_waiting_for_policy_review",
    "skipped_high_overlap",
    "skipped_high_compliance_risk",
    "skipped_low_wedge_clarity"
  ].includes(normalized)) {
    return normalized;
  }
  if (recommendation === "build") return "build_ready";
  if (recommendation === "research_more") return "research_more";
  if (recommendation === "backlog_waiting") return "backlog_waiting_for_evidence";
  if (recommendation === "skip") return "skipped";
  return "new";
}

function normalizeDecisionReason(value) {
  if (Array.isArray(value)) {
    return value.map((item) => `${item ?? ""}`.trim()).filter(Boolean).join("; ");
  }
  return `${value ?? ""}`.trim();
}

function buildOpportunityId(entry) {
  if (normalizeString(entry.opportunity_id)) {
    return entry.opportunity_id;
  }
  const seed = [
    normalizeString(entry.candidate_id),
    normalizeString(entry.selected_wedge),
    normalizeString(entry.source_url),
    normalizeString(entry.candidate_name)
  ].filter(Boolean).join("|");
  return `opp-${shortHash(seed || nowIso())}`;
}

function mergeOpportunityEntry(existing, incoming) {
  const buildRecommendation = normalizeRecommendation(incoming.build_recommendation ?? existing.build_recommendation);
  return {
    opportunity_id: buildOpportunityId({ ...existing, ...incoming }),
    discovered_at: incoming.discovered_at ?? existing.discovered_at ?? nowIso(),
    source_run_id: incoming.source_run_id ?? existing.source_run_id ?? null,
    candidate_id: incoming.candidate_id ?? existing.candidate_id ?? null,
    candidate_name: incoming.candidate_name ?? existing.candidate_name ?? null,
    source_url: incoming.source_url ?? existing.source_url ?? null,
    category: incoming.category ?? existing.category ?? null,
    users_estimate: incoming.users_estimate ?? existing.users_estimate ?? null,
    rating: incoming.rating ?? existing.rating ?? null,
    review_count: incoming.review_count ?? existing.review_count ?? null,
    latest_update: incoming.latest_update ?? existing.latest_update ?? null,
    pain_summary: incoming.pain_summary ?? existing.pain_summary ?? "",
    top_pain_clusters: normalizeArray([...(existing.top_pain_clusters ?? []), ...(incoming.top_pain_clusters ?? [])]),
    evidence_quality_score: incoming.evidence_quality_score ?? existing.evidence_quality_score ?? 0,
    testability_score: incoming.testability_score ?? existing.testability_score ?? 0,
    wedge_clarity_score: incoming.wedge_clarity_score ?? existing.wedge_clarity_score ?? 0,
    portfolio_overlap_score: incoming.portfolio_overlap_score ?? existing.portfolio_overlap_score ?? 0,
    compliance_risk: incoming.compliance_risk ?? existing.compliance_risk ?? null,
    build_recommendation: buildRecommendation,
    decision_reason: normalizeDecisionReason(incoming.decision_reason ?? existing.decision_reason),
    status: normalizeStatus(incoming.status ?? existing.status, buildRecommendation),
    linked_run_ids: normalizeArray([...(existing.linked_run_ids ?? []), ...(incoming.linked_run_ids ?? [])]),
    linked_portfolio_items: normalizeArray([
      ...(existing.linked_portfolio_items ?? []),
      ...(incoming.linked_portfolio_items ?? [])
    ]),
    next_step: incoming.next_step ?? existing.next_step ?? null,
    selected_wedge: incoming.selected_wedge ?? existing.selected_wedge ?? null,
    research_rounds_completed: incoming.research_rounds_completed ?? existing.research_rounds_completed ?? 0,
    evidence_requirements: normalizeArray([...(existing.evidence_requirements ?? []), ...(incoming.evidence_requirements ?? [])]),
    status_detail: incoming.status_detail ?? existing.status_detail ?? null,
    last_updated_at: incoming.last_updated_at ?? nowIso()
  };
}

export function defaultOpportunityBacklog() {
  return {
    stage: "OPPORTUNITY_BACKLOG",
    status: "passed",
    generated_at: nowIso(),
    opportunities: []
  };
}

export async function validateOpportunityBacklog(projectRoot, data) {
  await assertMatchesSchema({
    data,
    schemaPath: path.join(projectRoot, "schemas", "opportunity_backlog.schema.json"),
    label: OPPORTUNITY_BACKLOG_PATH
  });
}

export async function loadOpportunityBacklog(projectRoot) {
  const backlogPath = absoluteBacklogPath(projectRoot);
  if (!(await fileExists(backlogPath))) {
    const initialized = defaultOpportunityBacklog();
    await ensureDir(path.dirname(backlogPath));
    await validateOpportunityBacklog(projectRoot, initialized);
    await writeJson(backlogPath, initialized);
    return initialized;
  }

  const current = await readJson(backlogPath);
  const normalized = {
    ...defaultOpportunityBacklog(),
    ...current,
    opportunities: current.opportunities ?? []
  };
  await validateOpportunityBacklog(projectRoot, normalized);
  return normalized;
}

async function writeOpportunityBacklog(projectRoot, data) {
  const next = {
    ...defaultOpportunityBacklog(),
    ...data,
    generated_at: nowIso(),
    opportunities: data.opportunities ?? []
  };
  await validateOpportunityBacklog(projectRoot, next);
  await ensureDir(path.dirname(absoluteBacklogPath(projectRoot)));
  await writeJson(absoluteBacklogPath(projectRoot), next);
  return next;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withBacklogLock(projectRoot, action) {
  const lockPath = backlogLockPath(projectRoot);
  await ensureDir(path.dirname(lockPath));
  let handle = null;
  let lastError = null;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      handle = await fs.open(lockPath, "wx");
      await handle.writeFile(`${JSON.stringify({
        pid: process.pid,
        acquired_at: nowIso()
      }, null, 2)}\n`, "utf8");
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      lastError = error;
      await sleep(50);
    }
  }

  if (!handle) {
    throw lastError ?? new Error("Could not acquire opportunity backlog lock.");
  }

  try {
    return await action();
  } finally {
    await handle.close().catch(() => {});
    await fs.rm(lockPath, { force: true }).catch(() => {});
  }
}

export async function upsertOpportunityEntries(projectRoot, entries) {
  return withBacklogLock(projectRoot, async () => {
    const backlog = await loadOpportunityBacklog(projectRoot);
    const opportunities = [...(backlog.opportunities ?? [])];

    for (const entry of entries ?? []) {
      const normalizedEntry = mergeOpportunityEntry({}, entry);
      const existingIndex = opportunities.findIndex((item) => (
        item.opportunity_id === normalizedEntry.opportunity_id
          || (item.candidate_id === normalizedEntry.candidate_id && item.selected_wedge === normalizedEntry.selected_wedge)
      ));

      if (existingIndex >= 0) {
        opportunities.splice(existingIndex, 1, mergeOpportunityEntry(opportunities[existingIndex], entry));
      } else {
        opportunities.push(normalizedEntry);
      }
    }

    opportunities.sort((left, right) => `${right.last_updated_at ?? ""}`.localeCompare(`${left.last_updated_at ?? ""}`));
    return writeOpportunityBacklog(projectRoot, {
      ...backlog,
      opportunities
    });
  });
}

export async function inspectOpportunityBacklog(projectRoot) {
  const backlog = await loadOpportunityBacklog(projectRoot);
  const opportunities = backlog.opportunities ?? [];
  const countByStatus = Object.fromEntries(
    [
      "new",
      "research_more",
      "build_ready",
      "human_candidate_review_ready",
      "backlog_waiting_for_evidence",
      "backlog_waiting_for_builder",
      "backlog_waiting_for_policy_review",
      "skipped",
      "skipped_high_overlap",
      "skipped_high_compliance_risk",
      "skipped_low_wedge_clarity",
      "built",
      "killed"
    ]
      .map((status) => [status, opportunities.filter((item) => item.status === status).length])
  );
  return {
    path: absoluteBacklogPath(projectRoot),
    total_opportunities: opportunities.length,
    count_by_status: countByStatus,
    build_ready_candidates: opportunities
      .filter((item) => item.status === "build_ready" || item.status === "human_candidate_review_ready")
      .slice(0, 5)
      .map((item) => ({
        opportunity_id: item.opportunity_id,
        candidate_id: item.candidate_id,
        candidate_name: item.candidate_name,
        evidence_quality_score: item.evidence_quality_score,
        testability_score: item.testability_score,
        portfolio_overlap_score: item.portfolio_overlap_score
      })),
    skipped_candidates: opportunities
      .filter((item) => item.status === "skipped" || item.status.startsWith("skipped_"))
      .slice(0, 5)
      .map((item) => ({
        opportunity_id: item.opportunity_id,
        candidate_id: item.candidate_id,
        candidate_name: item.candidate_name,
        decision_reason: item.decision_reason
      }))
  };
}

export async function recordHumanCandidateReview(projectRoot, review) {
  const occurredAt = review.reviewed_at ?? nowIso();
  const safeReview = {
    candidate_id: normalizeString(review.candidate_id),
    reviewer: normalizeString(review.reviewer) ?? "human",
    decision: normalizeString(review.decision),
    note: `${review.note ?? ""}`.trim(),
    reviewed_at: occurredAt,
    next_step: normalizeString(review.next_step) ?? null
  };
  if (!safeReview.candidate_id || !safeReview.decision) {
    throw new Error("recordHumanCandidateReview requires candidate_id and decision.");
  }

  const targetPath = candidateReviewPath(projectRoot, safeReview.candidate_id, occurredAt);
  await ensureDir(path.dirname(targetPath));
  await writeJson(targetPath, safeReview);
  return {
    review: safeReview,
    review_path: targetPath
  };
}

export async function absoluteOpportunityBacklogPath(projectRoot) {
  await loadOpportunityBacklog(projectRoot);
  return absoluteBacklogPath(projectRoot);
}
