import path from "node:path";
import {
  buildCandidateDiscoveryArtifacts,
  buildClusterReport,
  buildDiscoveryGate,
  buildEvidenceReport,
  buildOpportunityArtifacts,
  normalizeDiscoveryThresholds
} from "./engine.mjs";
import {
  absoluteOpportunityBacklogPath,
  loadOpportunityBacklog,
  recordHumanCandidateReview,
  upsertOpportunityEntries
} from "./opportunityBacklog.mjs";
import { supportedFamilies } from "../builders/index.mjs";
import {
  collectLiveEvidenceForCandidate,
  extractDetailUrlsFromSearchHtml,
  fetchAllowedText,
  parseChromeListing
} from "../research/liveResearch.mjs";
import {
  buildSafeReport,
  markdownList,
  markdownSection,
  validateArtifact,
  writeManagedJsonArtifact,
  writeManagedMarkdownArtifact
} from "../review/helpers.mjs";
import { computeRegistryCandidateAdjustments, loadPortfolioRegistry } from "../portfolio/registry.mjs";
import { buildUniqueRunId } from "../workflow/runId.mjs";
import { ensureDir, fileExists, nowIso, readJson, writeJson as writePlainJson } from "../utils/io.mjs";

export const LIVE_QUERY_RESULTS_ARTIFACT = "40_live_query_results.json";
export const LIVE_CANDIDATE_QUEUE_ARTIFACT = "41_live_candidate_queue.json";
export const LOW_OVERLAP_FILTER_ARTIFACT = "42_low_overlap_filter_report.json";
export const BATCH_OPPORTUNITY_SCORES_ARTIFACT = "43_batch_opportunity_scores.json";
export const NEXT_BUILD_CANDIDATE_ARTIFACT = "44_next_build_candidate.json";
export const DISCOVERY_OPS_REPORT_ARTIFACT = "45_discovery_ops_report.json";

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function normalizeString(value) {
  const normalized = `${value ?? ""}`.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeState(value) {
  return `${value ?? ""}`.trim().toLowerCase();
}

function extractQueryDomain(query) {
  const match = `${query ?? ""}`.match(/site:([^\s/]+)/i);
  return `${match?.[1] ?? ""}`.trim().toLowerCase();
}

function stripSitePrefix(query) {
  return `${query ?? ""}`.replace(/site:[^\s]+\s*/i, "").trim();
}

function extractGithubIssueUrls(html) {
  return unique([...(`${html ?? ""}`).matchAll(/\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/\d+/g)]
    .map((match) => `https://github.com${match[0]}`));
}

function resolveQueriesArtifactPath(projectRoot, queriesFrom) {
  const directPath = path.isAbsolute(queriesFrom)
    ? queriesFrom
    : path.resolve(projectRoot, queriesFrom);
  if (directPath.includes(`${path.sep}runs${path.sep}`)) {
    const runId = directPath.split(`${path.sep}runs${path.sep}`)[1]?.split(path.sep)[0];
    const sidecarPath = path.join(projectRoot, "state", "run_events", runId ?? "", path.basename(directPath));
    return {
      directPath,
      sidecarPath
    };
  }
  return {
    directPath,
    sidecarPath: null
  };
}

async function loadQueriesArtifact(projectRoot, queriesFrom) {
  const { directPath, sidecarPath } = resolveQueriesArtifactPath(projectRoot, queriesFrom);
  if (await fileExists(directPath)) {
    return {
      artifactPath: directPath,
      data: await readJson(directPath)
    };
  }
  if (sidecarPath && await fileExists(sidecarPath)) {
    return {
      artifactPath: sidecarPath,
      data: await readJson(sidecarPath)
    };
  }
  throw new Error(`Queries artifact not found: ${queriesFrom}`);
}

function relativePath(projectRoot, absolutePath) {
  return path.relative(projectRoot, absolutePath).replaceAll("\\", "/");
}

async function loadSourceRunContext(projectRoot, sourceRunId) {
  const sourceRunDir = path.join(projectRoot, "runs", sourceRunId);
  if (!(await fileExists(sourceRunDir))) {
    throw new Error(`Source run directory not found for ${sourceRunId}.`);
  }
  return {
    sourceRunDir,
    sourceRunContext: await readJson(path.join(sourceRunDir, "00_run_context.json"))
  };
}

function buildLiveQueueDiscoveryConfig(sourceRunContext, queriesArtifactRelativePath, queryLimit, maxCandidates) {
  const thresholds = normalizeDiscoveryThresholds(sourceRunContext.thresholds ?? {});
  return {
    mode: "live_queue",
    query_limit: queryLimit,
    max_candidates: maxCandidates,
    allow_auto_build: false,
    min_evidence_quality_score: sourceRunContext.discovery?.min_evidence_quality_score ?? thresholds.min_evidence_quality_score,
    max_portfolio_overlap_score: sourceRunContext.discovery?.max_portfolio_overlap_score ?? thresholds.max_portfolio_overlap_penalty,
    min_testability_score: sourceRunContext.discovery?.min_testability_score ?? thresholds.min_testability_score,
    queries_from: queriesArtifactRelativePath
  };
}

export async function createDiscoveryLiveQueueRun({
  projectRoot,
  queriesArtifactPath,
  plan,
  sourceRunContext,
  runSlug = "live-queue",
  queryLimit,
  maxCandidates
}) {
  const runsRoot = path.join(projectRoot, "runs");
  const runId = buildUniqueRunId({
    task: {
      mode: "daily",
      run_slug: runSlug
    },
    taskPath: "discovery_live_queue"
  });
  const runDir = path.join(runsRoot, runId);
  await ensureDir(runDir);

  const queriesArtifactRelativePath = relativePath(projectRoot, queriesArtifactPath);
  const runContext = {
    ...sourceRunContext,
    stage: "DISCOVERY_LIVE_QUEUE",
    status: "passed",
    generated_at: nowIso(),
    task_mode: "daily",
    run_type: "daily",
    run_id: runId,
    run_id_strategy: "timestamp_slug_unique",
    allow_build_after_research_resolution: false,
    allow_overwrite: false,
    overwrite_blocked: false,
    created_at: nowIso(),
    source_run_id: sourceRunContext.run_id ?? plan.run_id ?? null,
    requested_task_run_id: null,
    date: nowIso().slice(0, 10),
    research: {
      ...(sourceRunContext.research ?? {}),
      mode: "live",
      fallback_to_fixture: false
    },
    discovery: buildLiveQueueDiscoveryConfig(
      sourceRunContext,
      queriesArtifactRelativePath,
      queryLimit,
      maxCandidates
    ),
    supported_builder_families: sourceRunContext.supported_builder_families ?? supportedFamilies()
  };

  await writePlainJson(path.join(runDir, "00_run_context.json"), runContext);
  await writePlainJson(path.join(runDir, "run_status.json"), {
    stage: "DISCOVERY_LIVE_QUEUE",
    status: "passed",
    generated_at: nowIso(),
    run_id: runId,
    run_id_strategy: runContext.run_id_strategy,
    allow_overwrite: false,
    overwrite_blocked: false,
    created_at: runContext.created_at,
    failure_reason: null
  });

  return {
    runDir,
    runContext
  };
}

async function executeChromeWebStoreQuery(queryConfig, runContext, maxCandidates) {
  const queryText = stripSitePrefix(queryConfig.query);
  const searchUrl = `https://chromewebstore.google.com/search/${encodeURIComponent(queryText)}`;
  const searchResponse = await fetchAllowedText(searchUrl, {
    timeoutMs: runContext.research?.timeout_ms ?? 15000
  });
  const detailUrls = searchResponse.ok
    ? extractDetailUrlsFromSearchHtml(searchResponse.text).slice(0, maxCandidates)
    : [];

  const candidates = [];
  const listingResults = [];
  for (const detailUrl of detailUrls) {
    try {
      const listingResponse = await fetchAllowedText(detailUrl, {
        timeoutMs: runContext.research?.timeout_ms ?? 15000
      });
      listingResults.push({
        url: detailUrl,
        status: listingResponse.status,
        ok: listingResponse.ok
      });
      if (!listingResponse.ok) {
        continue;
      }
      const candidate = parseChromeListing(detailUrl, listingResponse.text, runContext.builder.allow_families ?? []);
      candidates.push({
        ...candidate,
        source_query: queryConfig.query,
        target_category: queryConfig.target_category ?? null
      });
    } catch (error) {
      listingResults.push({
        url: detailUrl,
        status: "failed",
        ok: false,
        error: error.message
      });
    }
  }

  return {
    queryResult: {
      query: queryConfig.query,
      target_category: queryConfig.target_category ?? null,
      attempted: true,
      executed: true,
      live_unavailable: false,
      candidates_found: candidates.length,
      source_summary: {
        source_type: "chrome_web_store_search",
        search_url: searchUrl,
        search_status: searchResponse.status,
        detail_urls_found: detailUrls.length,
        listing_results: listingResults
      },
      failure_reason: searchResponse.ok ? null : `search_http_${searchResponse.status}`,
      strongest_signal: candidates.length > 0
        ? `Parsed ${candidates.length} Chrome Web Store listings for ${queryText}.`
        : "Search executed but no parseable Chrome Web Store listings were found.",
      weak_signal_reason: candidates.length > 0 ? null : "no_parseable_listing_pages",
      recommended_followup: candidates.length > 0
        ? "Score the queue and compare against portfolio overlap before building."
        : "Refine the search query or widen the category surface.",
      candidate_ids: candidates.map((candidate) => candidate.candidate_id)
    },
    candidates
  };
}

async function executeGithubQuery(queryConfig, runContext) {
  const queryText = stripSitePrefix(queryConfig.query);
  const searchUrl = `https://github.com/search?q=${encodeURIComponent(queryText)}&type=issues`;
  const response = await fetchAllowedText(searchUrl, {
    timeoutMs: runContext.research?.timeout_ms ?? 15000
  });
  const issues = response.ok ? extractGithubIssueUrls(response.text) : [];
  return {
    queryResult: {
      query: queryConfig.query,
      target_category: queryConfig.target_category ?? null,
      attempted: true,
      executed: true,
      live_unavailable: false,
      candidates_found: 0,
      source_summary: {
        source_type: "github_issue_search",
        search_url: searchUrl,
        status: response.status,
        issue_urls_found: issues.length
      },
      failure_reason: response.ok ? null : `github_search_http_${response.status}`,
      strongest_signal: issues.length > 0
        ? `Found ${issues.length} GitHub issue URLs for follow-up evidence.`
        : "GitHub issue search did not yield parseable issue links.",
      weak_signal_reason: issues.length > 0 ? null : "no_parseable_github_issue_links",
      recommended_followup: issues.length > 0
        ? "Use the issue URLs as corroborating evidence, not direct build candidates."
        : "Retry later or replace with a Chrome Web Store query for candidate generation.",
      candidate_ids: []
    },
    candidates: []
  };
}

async function executeQuery(queryConfig, runContext, maxCandidates) {
  const domain = extractQueryDomain(queryConfig.query);
  try {
    if (domain === "chromewebstore.google.com") {
      return executeChromeWebStoreQuery(queryConfig, runContext, maxCandidates);
    }
    if (domain === "github.com") {
      return executeGithubQuery(queryConfig, runContext);
    }
    return {
      queryResult: {
        query: queryConfig.query,
        target_category: queryConfig.target_category ?? null,
        attempted: true,
        executed: false,
        live_unavailable: false,
        candidates_found: 0,
        source_summary: {
          source_type: "unsupported_live_source",
          domain
        },
        failure_reason: "source_not_supported_by_live_queue_runner",
        strongest_signal: null,
        weak_signal_reason: `The live queue runner does not support ${domain || "this query source"} yet.`,
        recommended_followup: "Use Chrome Web Store or GitHub issue queries for the current live queue runner.",
        candidate_ids: []
      },
      candidates: []
    };
  } catch (error) {
    return {
      queryResult: {
        query: queryConfig.query,
        target_category: queryConfig.target_category ?? null,
        attempted: true,
        executed: false,
        live_unavailable: true,
        candidates_found: 0,
        source_summary: {
          source_type: domain || "unknown",
          domain
        },
        failure_reason: error.message,
        strongest_signal: null,
        weak_signal_reason: error.message,
        recommended_followup: "Retry when live internet or proxy connectivity is available.",
        candidate_ids: []
      },
      candidates: []
    };
  }
}

function dedupeCandidates(rawCandidates) {
  const candidateMap = new Map();
  const duplicateCandidates = [];

  for (const candidate of rawCandidates ?? []) {
    const key = candidate.candidate_id ?? candidate.store_url;
    if (!key) {
      continue;
    }
    if (!candidateMap.has(key)) {
      candidateMap.set(key, {
        ...candidate,
        source_queries: [candidate.source_query].filter(Boolean)
      });
      continue;
    }
    const existing = candidateMap.get(key);
    existing.source_queries = unique([...(existing.source_queries ?? []), candidate.source_query]);
    duplicateCandidates.push({
      candidate_id: candidate.candidate_id,
      name: candidate.name,
      reason: "duplicate_candidate_from_multiple_queries"
    });
  }

  return {
    candidates: [...candidateMap.values()],
    duplicateCandidates
  };
}

async function collectEvidenceForCandidates(candidates, runContext) {
  const evidenceByCandidate = {};
  const evidenceProvenance = {};

  for (const candidate of candidates ?? []) {
    const { evidence, provenance } = await collectLiveEvidenceForCandidate(candidate, {
      timeoutMs: runContext.research?.timeout_ms ?? 15000,
      maxGithubIssues: runContext.research?.max_github_issues ?? 5
    });
    evidenceByCandidate[candidate.candidate_id] = evidence.map((item) => ({
      ...item,
      candidate_id: candidate.candidate_id
    }));
    evidenceProvenance[candidate.candidate_id] = provenance;
  }

  return {
    evidenceByCandidate,
    evidenceProvenance
  };
}

function queueQualityScore({ queryResults, candidateReport, evidenceReport }) {
  const executedCount = queryResults.filter((item) => item.executed === true).length;
  const executedRate = queryResults.length > 0 ? executedCount / queryResults.length : 0;
  const candidateCoverage = clamp(((candidateReport.candidate_count ?? 0) / Math.max(1, queryResults.length * 2)) * 100);
  const evidenceCoverage = clamp((evidenceReport.total_evidence_count ?? 0) * 6);
  const supportCoverage = clamp((candidateReport.candidates ?? []).filter((candidate) => candidate.has_support_site).length * 18);
  return round((executedRate * 35) + (candidateCoverage * 0.25) + (evidenceCoverage * 0.2) + (supportCoverage * 0.2));
}

function differentiationTokens(candidate) {
  const text = `${candidate.name ?? ""} ${candidate.live_summary ?? ""}`.toLowerCase();
  const tokens = [];
  if (/markdown/.test(text)) tokens.push("markdown");
  if (/handoff|share|support|debug/.test(text)) tokens.push("handoff");
  if (/csv/.test(text)) tokens.push("csv");
  if (/current window/.test(text)) tokens.push("current_window");
  if (/session/.test(text)) tokens.push("session");
  if (/local-only|local only/.test(text)) tokens.push("local_only");
  if (/snippet|template|compose|reply/.test(text)) tokens.push("compose");
  if (/form|profile|fill|intake/.test(text)) tokens.push("form_fill");
  return unique(tokens);
}

function buildOverlapAnalysis(candidate, portfolioRegistry) {
  const registryAdjustments = computeRegistryCandidateAdjustments(candidate, portfolioRegistry);
  const similarExistingItems = (portfolioRegistry.items ?? [])
    .filter((item) => item.family === candidate.wedge_family || (item.overlap_tags ?? []).some((tag) => (candidate.signals ?? []).includes(tag)))
    .map((item) => ({
      item_id: item.item_id,
      run_id: item.run_id,
      family: item.family,
      wedge: item.wedge,
      overlap_tags: item.overlap_tags ?? []
    }));
  const sharedTagCount = similarExistingItems.reduce((maxCount, item) => {
    const shared = (item.overlap_tags ?? []).filter((tag) => (candidate.signals ?? []).includes(tag));
    return Math.max(maxCount, shared.length);
  }, 0);
  const differentiators = differentiationTokens(candidate).filter((token) => !(candidate.signals ?? []).includes(token));
  let overlapScore = Number(candidate.portfolio_overlap_score ?? 0);
  overlapScore += registryAdjustments.overlap_penalty ?? 0;
  overlapScore += Math.min(30, similarExistingItems.length * 10);
  overlapScore += Math.min(18, sharedTagCount * 4);
  if (candidate.wedge_family === "tab_csv_window_export" && /csv|current window|session|export/i.test(`${candidate.name ?? ""} ${candidate.live_summary ?? ""}`)) {
    overlapScore += 10;
  }
  if (candidate.wedge_family === "single_profile_form_fill" && /form|fill|profile|intake/i.test(`${candidate.name ?? ""} ${candidate.live_summary ?? ""}`)) {
    overlapScore += 8;
  }
  overlapScore -= Math.min(12, differentiators.length * 4);
  overlapScore = round(clamp(overlapScore));

  return {
    candidate_id: candidate.candidate_id,
    candidate_name: candidate.name,
    portfolio_overlap_score: overlapScore,
    overlap_reason: similarExistingItems.length === 0
      ? "No closely related portfolio item was found."
      : `${similarExistingItems.length} portfolio items already occupy a similar family or tag set.`,
    similar_existing_items: similarExistingItems,
    differentiation_required: [
      "Different target user or trigger moment than the current portfolio.",
      "Different workflow output or artifact than the closest existing item.",
      "Explain clearly why this is not just a small surface variant."
    ],
    allowed_if_differentiated: overlapScore < 70 && differentiators.length >= 2,
    reject_if_too_similar: overlapScore >= 70,
    differentiation_tokens: differentiators
  };
}

function buildLowOverlapFilterReport({ runContext, candidateReport, portfolioRegistry }) {
  const analyses = (candidateReport.candidates ?? []).map((candidate) => buildOverlapAnalysis(candidate, portfolioRegistry));
  return buildSafeReport({
    stage: "LOW_OVERLAP_FILTER",
    status: "passed",
    run_id: runContext.run_id,
    candidate_count: analyses.length,
    analyses,
    rejected_candidates: analyses
      .filter((item) => item.reject_if_too_similar)
      .map((item) => ({
        candidate_id: item.candidate_id,
        candidate_name: item.candidate_name,
        portfolio_overlap_score: item.portfolio_overlap_score,
        overlap_reason: item.overlap_reason
      })),
    next_step: analyses.some((item) => item.reject_if_too_similar !== true)
      ? "score_low_overlap_candidates"
      : "continue_live_discovery_for_more_differentiated_candidates"
  });
}

function targetedResearchQuestions(candidate, overlapAnalysis) {
  const family = candidate.wedge_family;
  const questions = [];
  if (overlapAnalysis.portfolio_overlap_score >= 50) {
    questions.push("What makes this candidate meaningfully different from the existing portfolio?");
  }
  if (family === "tab_csv_window_export") {
    questions.push("Is the user really asking for a different output or workflow than current-window CSV export?");
  }
  if (family === "single_profile_form_fill") {
    questions.push("Can the form-fill wedge narrow to a specific workflow instead of generic autofill?");
  }
  if (family === "gmail_snippet") {
    questions.push("Can the compose flow stay low-permission and obviously single-purpose?");
  }
  questions.push("What single happy path would prove this wedge is install-worthy?");
  return unique(questions).slice(0, 4);
}

function buildBatchOpportunityScores({
  runContext,
  candidateReport,
  clusterReport,
  evidenceReport,
  portfolioRegistry,
  shortlistQuality,
  lowOverlapReport,
  originalCandidateReport = null
}) {
  const thresholds = normalizeDiscoveryThresholds(runContext.thresholds ?? {});
  const baseline = buildOpportunityArtifacts({
    runContext,
    candidateReport,
    clusterReport,
    evidenceReport,
    portfolioRegistry,
    shortlistQuality
  });
  const overlapByCandidate = new Map((lowOverlapReport.analyses ?? []).map((item) => [item.candidate_id, item]));
  const originalRejectionByCandidate = new Map((originalCandidateReport?.discarded ?? []).map((item) => [item.candidate_id, item]));
  const scoredOpportunities = (baseline.scoresReport.scores ?? []).map((score) => {
    const overlapAnalysis = overlapByCandidate.get(score.candidate_id) ?? {
      portfolio_overlap_score: score.portfolio_overlap_penalty,
      overlap_reason: "No overlap analysis available.",
      similar_existing_items: [],
      differentiation_required: [],
      allowed_if_differentiated: false,
      reject_if_too_similar: false
    };
    const originalRejection = originalRejectionByCandidate.get(score.candidate_id) ?? null;
    const originalRejectionReasons = originalRejection?.reasons ?? [];
    const overlapPenalty = overlapAnalysis.portfolio_overlap_score;
    const differentiationScore = round(clamp(100 - overlapPenalty + (overlapAnalysis.allowed_if_differentiated ? 8 : 0)));
    const totalScore = round(clamp(
      (score.demand_score * 0.16)
      + (score.pain_score * 0.18)
      + (score.evidence_quality_score * 0.15)
      + (score.wedge_clarity_score * 0.12)
      + (score.feasibility_score * 0.1)
      + (score.testability_score * 0.11)
      + (score.compliance_score * 0.08)
      + (differentiationScore * 0.06)
      + (score.confidence_score * 0.1)
      - (overlapPenalty * 0.05)
      - (score.maintenance_risk_score * 0.03)
    ));

    let buildRecommendation = "research_more";
    if (score.compliance_score < 50 || overlapAnalysis.reject_if_too_similar) {
      buildRecommendation = "skip";
    } else if (
      score.evidence_quality_score < thresholds.min_evidence_quality_score
      || score.testability_score < thresholds.min_testability_score
      || score.wedge_clarity_score < thresholds.min_single_purpose_score
      || score.confidence_score < thresholds.min_confidence_score
      || overlapPenalty >= 50
    ) {
      buildRecommendation = "research_more";
    } else if (score.supported_builder && totalScore >= thresholds.min_overall_score) {
      buildRecommendation = "build";
    } else {
      buildRecommendation = "skip";
    }

    if (originalRejectionReasons.includes("builder_family_not_allowed") || originalRejectionReasons.includes("category_blocked")) {
      buildRecommendation = "skip";
    } else if (
      originalRejectionReasons.some((reason) => reason === "users_below_threshold" || reason === "reviews_below_threshold")
      && buildRecommendation === "build"
    ) {
      buildRecommendation = "research_more";
    } else if (originalRejectionReasons.includes("missing_support_site") && buildRecommendation === "build") {
      buildRecommendation = "research_more";
    }

    return {
      ...score,
      portfolio_overlap_penalty: overlapPenalty,
      portfolio_overlap_score: overlapPenalty,
      differentiation_score: differentiationScore,
      total_score: totalScore,
      overall_score: totalScore,
      build_recommendation: buildRecommendation,
      overlap_reason: overlapAnalysis.overlap_reason,
      similar_existing_items: overlapAnalysis.similar_existing_items,
      differentiation_required: overlapAnalysis.differentiation_required,
      allowed_if_differentiated: overlapAnalysis.allowed_if_differentiated,
      reject_if_too_similar: overlapAnalysis.reject_if_too_similar,
      original_shortlist_stage: originalRejection?.rejected_at_stage ?? null,
      original_shortlist_reasons: originalRejectionReasons,
      targeted_research_questions: buildRecommendation === "research_more"
        ? targetedResearchQuestions(
            (candidateReport.candidates ?? []).find((candidate) => candidate.candidate_id === score.candidate_id) ?? {},
            overlapAnalysis
          )
        : [],
      decision_rationale: [
        ...(score.decision_rationale ?? []),
        originalRejection
          ? `original_shortlist_rejection=${originalRejection.rejected_at_stage}:${originalRejectionReasons.join(",")}`
          : "original_shortlist_rejection=none",
        `low_overlap_filter=${overlapPenalty}`,
        overlapAnalysis.overlap_reason
      ]
    };
  }).sort((left, right) => (
    (right.total_score - left.total_score)
    || (right.confidence_score - left.confidence_score)
    || (right.evidence_quality_score - left.evidence_quality_score)
  ));

  return buildSafeReport({
    stage: "BATCH_OPPORTUNITY_SCORES",
    status: "passed",
    run_id: runContext.run_id,
    ranked_opportunities: scoredOpportunities,
    top_ranked_opportunities: scoredOpportunities.slice(0, 10),
    build_ready_count: scoredOpportunities.filter((item) => item.build_recommendation === "build").length,
    next_step: scoredOpportunities.some((item) => item.build_recommendation === "build")
      ? "select_next_build_candidate"
      : "run_targeted_research_or_continue_live_discovery"
  });
}

function deriveSelectedWedge(candidate) {
  if (!candidate) {
    return null;
  }
  if (candidate.wedge_family === "tab_csv_window_export") {
    return "One-click current-window tab export with a clearly bounded output.";
  }
  if (candidate.wedge_family === "single_profile_form_fill") {
    return "A low-permission local-only helper for one repetitive browser form workflow.";
  }
  if (candidate.wedge_family === "gmail_snippet") {
    return "A lightweight compose-time snippet insertion flow.";
  }
  return `${candidate.name ?? "Selected candidate"} with a narrower single-purpose wedge.`;
}

function buildSelectedCandidateArtifact({ runContext, scoredReport }) {
  const firstBuildReady = (scoredReport.ranked_opportunities ?? []).find((item) => item.build_recommendation === "build") ?? null;
  const topRanked = scoredReport.ranked_opportunities?.[0] ?? null;
  if (!firstBuildReady) {
    return buildSafeReport({
      stage: "NEXT_BUILD_CANDIDATE_SELECTION",
      status: "passed",
      run_id: runContext.run_id,
      selected: false,
      candidate_id: topRanked?.candidate_id ?? null,
      candidate_name: topRanked?.name ?? null,
      selected_wedge: null,
      build_recommendation: topRanked?.build_recommendation ?? "skip",
      reason: topRanked
        ? `Top ranked candidate is ${topRanked.build_recommendation}, so no build-ready candidate was selected.`
        : "No candidate survived live queue scoring.",
      confidence_score: topRanked?.confidence_score ?? 0,
      evidence_quality_score: topRanked?.evidence_quality_score ?? 0,
      testability_score: topRanked?.testability_score ?? 0,
      portfolio_overlap_score: topRanked?.portfolio_overlap_score ?? 0,
      blockers: topRanked?.build_recommendation === "research_more"
        ? ["run_targeted_research"]
        : ["no_build_ready_candidate"],
      next_step: topRanked?.build_recommendation === "research_more"
        ? "run_targeted_research"
        : "continue_live_discovery_for_lower_overlap_candidates"
    });
  }

  return buildSafeReport({
    stage: "NEXT_BUILD_CANDIDATE_SELECTION",
    status: "passed",
    run_id: runContext.run_id,
    selected: true,
    candidate_id: firstBuildReady.candidate_id,
    candidate_name: firstBuildReady.name,
    selected_wedge: deriveSelectedWedge(firstBuildReady),
    build_recommendation: firstBuildReady.build_recommendation,
    reason: "This is the highest-ranked build-ready candidate after applying live evidence and low-overlap filtering.",
    confidence_score: firstBuildReady.confidence_score,
    evidence_quality_score: firstBuildReady.evidence_quality_score,
    testability_score: firstBuildReady.testability_score,
    portfolio_overlap_score: firstBuildReady.portfolio_overlap_score,
    blockers: [],
    next_step: "human_review_candidate_or_auto_build_if_task_allows"
  });
}

function buildStandardSelectedReport(scoresReport, candidateReport) {
  const selected = (scoresReport.ranked_opportunities ?? []).find((item) => item.build_recommendation === "build")
    ?? scoresReport.ranked_opportunities?.[0]
    ?? null;
  const candidate = selected
    ? (candidateReport.candidates ?? []).find((item) => item.candidate_id === selected.candidate_id) ?? null
    : null;
  if (!candidate || !selected) {
    return {
      stage: "SCORE_OPPORTUNITIES",
      status: "no_go",
      generated_at: nowIso(),
      selected_candidate_id: null,
      selected_reason: ["No candidate was available after live queue scoring."],
      build_recommendation: "skip",
      candidate: null,
      score: null
    };
  }

  return {
    stage: "SCORE_OPPORTUNITIES",
    status: "passed",
    generated_at: nowIso(),
    selected_candidate_id: candidate.candidate_id,
    selected_reason: selected.decision_rationale,
    selected_reason_summary: selected.build_recommendation,
    build_recommendation: selected.build_recommendation,
    candidate,
    score: selected
  };
}

function discoveryOpsMarkdown(report) {
  return [
    "# Discovery Ops Report",
    "",
    `- Run: ${report.run_id}`,
    `- Total queries: ${report.total_queries}`,
    `- Total candidates found: ${report.total_candidates_found}`,
    `- Build-ready count: ${report.build_ready_count}`,
    `- Next step: ${report.next_step}`,
    "",
    markdownSection(
      "Top Ranked Opportunities",
      markdownList((report.top_ranked_opportunities ?? []).map((item) => (
        `${item.name} | ${item.build_recommendation} | overlap=${item.portfolio_overlap_score} | evidence=${item.evidence_quality_score}`
      )))
    ),
    "",
    markdownSection(
      "Skipped Opportunities",
      markdownList((report.skipped_candidates ?? []).map((item) => `${item.name}: ${item.reason}`))
    ),
    "",
    markdownSection(
      "Research More Candidates",
      markdownList((report.research_more_candidates ?? []).map((item) => `${item.name}: ${item.reason}`))
    )
  ].join("\n");
}

function buildDiscoveryOpsReport({ runContext, queryReport, candidateQueue, scoredReport, selectedCandidate }) {
  return buildSafeReport({
    stage: "DISCOVERY_OPS_REPORT",
    status: "passed",
    run_id: runContext.run_id,
    total_queries: queryReport.query_results?.length ?? 0,
    total_candidates_found: candidateQueue.total_candidates_found ?? 0,
    top_ranked_opportunities: scoredReport.top_ranked_opportunities ?? [],
    skipped_candidates: (scoredReport.ranked_opportunities ?? [])
      .filter((item) => item.build_recommendation === "skip")
      .slice(0, 10)
      .map((item) => ({
        candidate_id: item.candidate_id,
        name: item.name,
        reason: item.overlap_reason ?? item.decision_rationale?.[0] ?? "skip"
      })),
    research_more_candidates: (scoredReport.ranked_opportunities ?? [])
      .filter((item) => item.build_recommendation === "research_more")
      .slice(0, 10)
      .map((item) => ({
        candidate_id: item.candidate_id,
        name: item.name,
        reason: item.targeted_research_questions?.[0] ?? item.overlap_reason ?? "research_more"
      })),
    build_ready_count: scoredReport.build_ready_count ?? 0,
    selected_candidate: selectedCandidate.selected === true ? {
      candidate_id: selectedCandidate.candidate_id,
      candidate_name: selectedCandidate.candidate_name
    } : null,
    overlap_summary: (scoredReport.top_ranked_opportunities ?? []).slice(0, 10).map((item) => ({
      candidate_id: item.candidate_id,
      candidate_name: item.name,
      portfolio_overlap_score: item.portfolio_overlap_score
    })),
    recommended_tomorrow_directions: unique([
      "Favor lower-overlap wedges outside the existing tab export family.",
      "Use Chrome Web Store search as the primary candidate generator and GitHub issues as corroboration.",
      selectedCandidate.selected === false ? "Human review is useful before committing to another same-family wedge." : null
    ]),
    human_intervention_recommended: selectedCandidate.selected !== true,
    next_step: selectedCandidate.next_step
  });
}

function mapBacklogEntries({ sourceRunId, candidateReport, clusterReport, scoredReport, portfolioRegistry }) {
  const clustersByCandidate = clusterReport.clusters_by_candidate ?? {};
  return (scoredReport.ranked_opportunities ?? []).map((score) => {
    const candidate = (candidateReport.candidates ?? []).find((item) => item.candidate_id === score.candidate_id) ?? {};
    const topPainClusters = (clustersByCandidate[score.candidate_id] ?? []).slice(0, 3).map((cluster) => cluster.title);
    const similarExistingItems = (score.similar_existing_items ?? []).map((item) => item.item_id);
    return {
      opportunity_id: score.candidate_id,
      discovered_at: nowIso(),
      source_run_id: sourceRunId,
      candidate_id: score.candidate_id,
      candidate_name: score.name,
      source_url: candidate.store_url ?? null,
      category: candidate.category ?? null,
      users_estimate: candidate.users ?? null,
      rating: candidate.rating ?? null,
      review_count: candidate.reviews ?? null,
      latest_update: candidate.updated ?? null,
      pain_summary: topPainClusters.join("; "),
      top_pain_clusters: topPainClusters,
      evidence_quality_score: score.evidence_quality_score,
      testability_score: score.testability_score,
      wedge_clarity_score: score.wedge_clarity_score,
      portfolio_overlap_score: score.portfolio_overlap_score,
      compliance_risk: round(clamp(100 - score.compliance_score)),
      build_recommendation: score.build_recommendation,
      decision_reason: score.overlap_reason ?? score.decision_rationale,
      status: score.build_recommendation === "build"
        ? "build_ready"
        : score.build_recommendation === "research_more"
          ? "research_more"
          : "skipped",
      linked_run_ids: [sourceRunId],
      linked_portfolio_items: unique([
        ...similarExistingItems,
        ...((portfolioRegistry.items ?? [])
          .filter((item) => item.family === candidate.wedge_family)
          .map((item) => item.item_id))
      ]),
      next_step: score.build_recommendation === "build"
        ? "human_review_candidate_or_auto_build_if_task_allows"
        : score.build_recommendation === "research_more"
          ? "run_targeted_research"
          : "continue_live_discovery_for_lower_overlap_candidates",
      selected_wedge: deriveSelectedWedge(candidate)
    };
  });
}

async function ensureSkippedBacklogEntryForSourceRun(projectRoot, sourceRunId) {
  const sourceRunDir = path.join(projectRoot, "runs", sourceRunId);
  if (!(await fileExists(sourceRunDir))) {
    return null;
  }

  const selectedPath = path.join(sourceRunDir, "31_selected_candidate.json");
  const updatedScorePath = path.join(projectRoot, "state", "run_events", sourceRunId, "38_updated_opportunity_score.json");
  const gatePath = path.join(projectRoot, "state", "run_events", sourceRunId, "39_research_resolution_gate.json");
  if (!(await fileExists(selectedPath)) || !(await fileExists(updatedScorePath)) || !(await fileExists(gatePath))) {
    return null;
  }

  const selectedReport = await readJson(selectedPath);
  const updatedScore = await readJson(updatedScorePath);
  const gate = await readJson(gatePath);
  if (normalizeState(gate.final_recommendation) !== "skip") {
    return null;
  }

  const portfolioRegistry = await loadPortfolioRegistry(projectRoot);
  await upsertOpportunityEntries(projectRoot, [{
    opportunity_id: selectedReport.selected_candidate_id ?? updatedScore.candidate_id,
    discovered_at: nowIso(),
    source_run_id: sourceRunId,
    candidate_id: selectedReport.selected_candidate_id ?? updatedScore.candidate_id,
    candidate_name: selectedReport.candidate?.name ?? null,
    source_url: selectedReport.candidate?.store_url ?? null,
    category: selectedReport.candidate?.category ?? null,
    users_estimate: selectedReport.candidate?.users ?? null,
    rating: selectedReport.candidate?.rating ?? null,
    review_count: selectedReport.candidate?.reviews ?? null,
    latest_update: selectedReport.candidate?.updated ?? null,
    pain_summary: `${updatedScore.selected_wedge_hypothesis ?? ""}`.trim(),
    top_pain_clusters: ["portfolio overlap"],
    evidence_quality_score: updatedScore.evidence_quality_score,
    testability_score: updatedScore.testability_score,
    wedge_clarity_score: updatedScore.wedge_clarity_score,
    portfolio_overlap_score: updatedScore.portfolio_overlap_penalty,
    compliance_risk: round(clamp(100 - updatedScore.compliance_score)),
    build_recommendation: "skip",
    decision_reason: `portfolio_overlap_score=${updatedScore.portfolio_overlap_penalty}; ${gate.decision_rationale?.join("; ") ?? "too similar to existing portfolio"}`,
    status: "skipped",
    linked_run_ids: [sourceRunId],
    linked_portfolio_items: (portfolioRegistry.items ?? [])
      .filter((item) => item.family === selectedReport.candidate?.wedge_family)
      .map((item) => item.item_id),
    next_step: "continue_live_discovery_for_lower_overlap_candidates",
    selected_wedge: updatedScore.selected_wedge_hypothesis ?? null
  }]);
  return true;
}

async function writeStandardDiscoveryArtifacts({
  projectRoot,
  runDir,
  candidateReport,
  shortlistQuality,
  evidenceReport,
  clusterReport,
  standardScoresReport,
  selectedReport,
  buildGate
}) {
  await validateArtifact(projectRoot, "candidate_report.schema.json", "10_candidate_report.json", candidateReport);
  await validateArtifact(projectRoot, "candidate_shortlist_quality.schema.json", "12_candidate_shortlist_quality.json", shortlistQuality);
  await validateArtifact(projectRoot, "feedback_evidence.schema.json", "20_feedback_evidence.json", evidenceReport);
  await validateArtifact(projectRoot, "feedback_clusters.schema.json", "21_feedback_clusters.json", clusterReport);
  await validateArtifact(projectRoot, "opportunity_scores.schema.json", "30_opportunity_scores.json", standardScoresReport);
  await validateArtifact(projectRoot, "selected_candidate.schema.json", "31_selected_candidate.json", selectedReport);
  await validateArtifact(projectRoot, "build_gate.schema.json", "32_build_gate_decision.json", buildGate);

  await writePlainJson(path.join(runDir, "10_candidate_report.json"), candidateReport);
  await writePlainJson(path.join(runDir, "12_candidate_shortlist_quality.json"), shortlistQuality);
  await writePlainJson(path.join(runDir, "20_feedback_evidence.json"), evidenceReport);
  await writePlainJson(path.join(runDir, "21_feedback_clusters.json"), clusterReport);
  await writePlainJson(path.join(runDir, "30_opportunity_scores.json"), standardScoresReport);
  await writePlainJson(path.join(runDir, "31_selected_candidate.json"), selectedReport);
  await writePlainJson(path.join(runDir, "32_build_gate_decision.json"), buildGate);
}

export async function runDiscoveryLiveQueue({
  runDir,
  runContext,
  queryConfigs,
  sourceRunId,
  maxCandidates
}) {
  const occurredAt = nowIso();
  const portfolioRegistry = await loadPortfolioRegistry(runContext.project_root);
  const queryResults = [];
  const rawCandidates = [];

  for (const queryConfig of queryConfigs ?? []) {
    const remaining = Math.max(0, maxCandidates - rawCandidates.length);
    const result = await executeQuery(queryConfig, runContext, remaining);
    queryResults.push(result.queryResult);
    rawCandidates.push(...result.candidates);
    if (rawCandidates.length >= maxCandidates) {
      break;
    }
  }

  const liveUnavailable = rawCandidates.length === 0 && queryResults.some((item) => item.live_unavailable === true);
  const { candidates: dedupedCandidates, duplicateCandidates } = dedupeCandidates(rawCandidates);
  const { evidenceByCandidate, evidenceProvenance } = await collectEvidenceForCandidates(dedupedCandidates, runContext);
  const { candidateReport, shortlistQuality } = buildCandidateDiscoveryArtifacts({
    rawCandidates: dedupedCandidates,
    runContext,
    portfolioRegistry,
    sourceModeOverride: "live"
  });
  const evidenceReport = buildEvidenceReport({
    candidateReport,
    liveEvidenceByCandidate: evidenceByCandidate,
    fixtureEvidenceByCandidate: {},
    sourceMode: "live"
  });
  const clusterReport = buildClusterReport({
    candidateReport,
    evidenceReport
  });
  const queryReport = buildSafeReport({
    stage: "LIVE_DISCOVERY_QUEUE",
    status: liveUnavailable ? "skipped" : "passed",
    run_id: runContext.run_id,
    source_run_id: sourceRunId,
    checked_at: occurredAt,
    total_queries: queryConfigs.length,
    query_results: queryResults,
    live_unavailable: liveUnavailable,
    next_step: candidateReport.candidate_count > 0
      ? "score_live_candidate_queue"
      : liveUnavailable
        ? "retry_live_queue_when_network_is_available"
        : "refine_queries_for_lower_overlap_candidates"
  });
  const candidateQueue = buildSafeReport({
    stage: "LIVE_CANDIDATE_QUEUE",
    status: liveUnavailable ? "skipped" : "passed",
    run_id: runContext.run_id,
    source_run_id: sourceRunId,
    total_queries: queryConfigs.length,
    total_candidates_found: rawCandidates.length,
    deduped_candidates: dedupedCandidates.length,
    candidate_queue: candidateReport.candidates ?? [],
    rejected_candidates: [
      ...duplicateCandidates,
      ...(candidateReport.discarded ?? [])
    ],
    queue_quality_score: queueQualityScore({
      queryResults,
      candidateReport,
      evidenceReport
    }),
    next_step: candidateReport.candidate_count > 0
      ? "score_live_candidate_queue"
      : liveUnavailable
        ? "retry_live_queue_when_network_is_available"
        : "refine_queries_for_lower_overlap_candidates",
    candidate_report_snapshot: candidateReport,
    shortlist_quality_snapshot: shortlistQuality,
    discovered_candidates: dedupedCandidates,
    evidence_by_candidate: evidenceByCandidate,
    evidence_provenance: evidenceProvenance,
    live_unavailable: liveUnavailable
  });

  await validateArtifact(runContext.project_root, "live_query_results.schema.json", LIVE_QUERY_RESULTS_ARTIFACT, queryReport);
  await validateArtifact(runContext.project_root, "live_candidate_queue.schema.json", LIVE_CANDIDATE_QUEUE_ARTIFACT, candidateQueue);
  await writeManagedJsonArtifact({
    runDir,
    runContext,
    artifactName: LIVE_QUERY_RESULTS_ARTIFACT,
    data: queryReport,
    occurredAt
  });
  const queueWrite = await writeManagedJsonArtifact({
    runDir,
    runContext,
    artifactName: LIVE_CANDIDATE_QUEUE_ARTIFACT,
    data: candidateQueue,
    occurredAt
  });

  await writeStandardDiscoveryArtifacts({
    projectRoot: runContext.project_root,
    runDir,
    candidateReport,
    shortlistQuality,
    evidenceReport,
    clusterReport,
    standardScoresReport: {
      stage: "SCORE_OPPORTUNITIES",
      status: "passed",
      generated_at: nowIso(),
      shortlist_confidence: shortlistQuality.shortlist_confidence,
      scores: []
    },
    selectedReport: {
      stage: "SCORE_OPPORTUNITIES",
      status: "no_go",
      generated_at: nowIso(),
      selected_candidate_id: null,
      selected_reason: ["Queue created. Run scoring before selecting a candidate."],
      build_recommendation: "skip",
      candidate: null,
      score: null
    },
    buildGate: {
      stage: "BUILD_GATE",
      status: "failed",
      decision: "no_go",
      go_no_go: "no_go",
      generated_at: nowIso(),
      selected_candidate_id: null,
      gate_results: {},
      blockers: ["score_queue_not_run_yet"],
      warnings: [],
      required_followup_research: [],
      recommended_archetype: null,
      expected_test_matrix: [],
      product_acceptance_risks: [],
      cluster_count: 0,
      decision_rationale: ["Run discovery:score-queue before using this live queue run as a build input."]
    }
  });

  return {
    queryReport,
    candidateQueue,
    candidateReport,
    shortlistQuality,
    evidenceReport,
    clusterReport,
    queueArtifact: queueWrite.artifactRelativePath
  };
}

async function loadQueueState(queueArtifactPath) {
  const absoluteQueuePath = path.resolve(queueArtifactPath);
  const runDir = absoluteQueuePath.includes(`${path.sep}state${path.sep}run_events${path.sep}`)
    ? path.join(process.cwd(), "runs", absoluteQueuePath.split(`${path.sep}state${path.sep}run_events${path.sep}`)[1].split(path.sep)[0])
    : path.dirname(absoluteQueuePath);
  const runContext = await readJson(path.join(runDir, "00_run_context.json"));
  return {
    runDir,
    runContext,
    candidateQueue: await readJson(absoluteQueuePath),
    candidateReport: await readJson(path.join(runDir, "10_candidate_report.json")),
    shortlistQuality: await readJson(path.join(runDir, "12_candidate_shortlist_quality.json")),
    evidenceReport: await readJson(path.join(runDir, "20_feedback_evidence.json")),
    clusterReport: await readJson(path.join(runDir, "21_feedback_clusters.json")),
    portfolioRegistry: await loadPortfolioRegistry(runContext.project_root)
  };
}

function buildRelaxedScoringRunContext(runContext) {
  const thresholds = normalizeDiscoveryThresholds(runContext.thresholds ?? {});
  return {
    ...runContext,
    thresholds: {
      ...thresholds,
      min_users: 0,
      min_reviews: 0,
      rating_min: 0,
      rating_max: 5,
      max_candidate_permission_risk: 100,
      min_candidate_testability_hint: 0,
      min_candidate_single_purpose_fit: 0,
      max_shortlist_portfolio_overlap: 100
    }
  };
}

function buildScoringPoolArtifacts({
  runContext,
  candidateQueue,
  candidateReport,
  shortlistQuality,
  evidenceReport,
  clusterReport,
  portfolioRegistry
}) {
  const discoveredCandidates = candidateQueue.discovered_candidates ?? [];
  if ((discoveredCandidates?.length ?? 0) === 0) {
    return {
      candidateReport,
      shortlistQuality,
      evidenceReport,
      clusterReport
    };
  }

  const relaxedRunContext = buildRelaxedScoringRunContext(runContext);
  const scoringDiscovery = buildCandidateDiscoveryArtifacts({
    rawCandidates: discoveredCandidates,
    runContext: relaxedRunContext,
    portfolioRegistry,
    sourceModeOverride: "live"
  });
  const scoringCandidateReport = {
    ...scoringDiscovery.candidateReport,
    note: "live_queue_scoring_pool_relaxed_thresholds",
    scoring_pool_mode: "relaxed_thresholds_from_live_queue"
  };
  const scoringShortlistQuality = {
    ...scoringDiscovery.shortlistQuality,
    scoring_pool_mode: "relaxed_thresholds_from_live_queue"
  };
  const scoringEvidenceReport = buildEvidenceReport({
    candidateReport: scoringCandidateReport,
    liveEvidenceByCandidate: candidateQueue.evidence_by_candidate ?? {},
    fixtureEvidenceByCandidate: {},
    sourceMode: "live"
  });
  const scoringClusterReport = buildClusterReport({
    candidateReport: scoringCandidateReport,
    evidenceReport: scoringEvidenceReport
  });

  return {
    candidateReport: scoringCandidateReport,
    shortlistQuality: scoringShortlistQuality,
    evidenceReport: scoringEvidenceReport,
    clusterReport: scoringClusterReport
  };
}

export async function scoreDiscoveryQueue({ queueArtifactPath }) {
  const state = await loadQueueState(queueArtifactPath);
  const occurredAt = nowIso();
  const scoringPool = buildScoringPoolArtifacts({
    runContext: state.runContext,
    candidateQueue: state.candidateQueue,
    candidateReport: state.candidateReport,
    shortlistQuality: state.shortlistQuality,
    evidenceReport: state.evidenceReport,
    clusterReport: state.clusterReport,
    portfolioRegistry: state.portfolioRegistry
  });
  const lowOverlapReport = buildLowOverlapFilterReport({
    runContext: state.runContext,
    candidateReport: scoringPool.candidateReport,
    portfolioRegistry: state.portfolioRegistry
  });
  const scoredReport = buildBatchOpportunityScores({
    runContext: state.runContext,
    candidateReport: scoringPool.candidateReport,
    clusterReport: scoringPool.clusterReport,
    evidenceReport: scoringPool.evidenceReport,
    portfolioRegistry: state.portfolioRegistry,
    shortlistQuality: scoringPool.shortlistQuality,
    lowOverlapReport,
    originalCandidateReport: state.candidateReport
  });
  const selectedReport = buildStandardSelectedReport(scoredReport, scoringPool.candidateReport);
  const standardScoresReport = {
    stage: "SCORE_OPPORTUNITIES",
    status: "passed",
    generated_at: nowIso(),
    shortlist_confidence: scoringPool.shortlistQuality.shortlist_confidence,
    scores: scoredReport.ranked_opportunities ?? []
  };
  const buildGate = buildDiscoveryGate({
    runContext: state.runContext,
    selectedReport,
    clusterReport: scoringPool.clusterReport,
    evidenceReport: scoringPool.evidenceReport
  });
  const selectedCandidate = buildSelectedCandidateArtifact({
    runContext: state.runContext,
    scoredReport
  });
  const opsReport = buildDiscoveryOpsReport({
    runContext: state.runContext,
    queryReport: await readJson(path.join(state.runDir, LIVE_QUERY_RESULTS_ARTIFACT)),
    candidateQueue: state.candidateQueue,
    scoredReport,
    selectedCandidate
  });

  await validateArtifact(state.runContext.project_root, "low_overlap_filter_report.schema.json", LOW_OVERLAP_FILTER_ARTIFACT, lowOverlapReport);
  await validateArtifact(state.runContext.project_root, "batch_opportunity_scores.schema.json", BATCH_OPPORTUNITY_SCORES_ARTIFACT, scoredReport);
  await validateArtifact(state.runContext.project_root, "next_build_candidate.schema.json", NEXT_BUILD_CANDIDATE_ARTIFACT, selectedCandidate);
  await validateArtifact(state.runContext.project_root, "discovery_ops_report.schema.json", DISCOVERY_OPS_REPORT_ARTIFACT, opsReport);

  await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: LOW_OVERLAP_FILTER_ARTIFACT,
    data: lowOverlapReport,
    occurredAt
  });
  const scoreWrite = await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: BATCH_OPPORTUNITY_SCORES_ARTIFACT,
    data: scoredReport,
    occurredAt
  });
  await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: NEXT_BUILD_CANDIDATE_ARTIFACT,
    data: selectedCandidate,
    occurredAt
  });
  await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: DISCOVERY_OPS_REPORT_ARTIFACT,
    data: opsReport,
    occurredAt
  });
  await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "45_discovery_ops_report.md",
    category: "discovery_ops",
    prefix: "45_discovery_ops_report",
    content: discoveryOpsMarkdown(opsReport),
    occurredAt
  });

  await writeStandardDiscoveryArtifacts({
    projectRoot: state.runContext.project_root,
    runDir: state.runDir,
    candidateReport: scoringPool.candidateReport,
    shortlistQuality: scoringPool.shortlistQuality,
    evidenceReport: scoringPool.evidenceReport,
    clusterReport: scoringPool.clusterReport,
    standardScoresReport,
    selectedReport,
    buildGate
  });

  await upsertOpportunityEntries(state.runContext.project_root, mapBacklogEntries({
    sourceRunId: state.runContext.run_id,
    candidateReport: scoringPool.candidateReport,
    clusterReport: scoringPool.clusterReport,
    scoredReport,
    portfolioRegistry: state.portfolioRegistry
  }));

  return {
    lowOverlapReport,
    scoredReport,
    selectedCandidate,
    opsReport,
    scoreArtifact: scoreWrite.artifactRelativePath
  };
}

async function loadScoredState(scoreArtifactPath) {
  const absoluteScorePath = path.resolve(scoreArtifactPath);
  const runDir = absoluteScorePath.includes(`${path.sep}state${path.sep}run_events${path.sep}`)
    ? path.join(process.cwd(), "runs", absoluteScorePath.split(`${path.sep}state${path.sep}run_events${path.sep}`)[1].split(path.sep)[0])
    : path.dirname(absoluteScorePath);
  return {
    runDir,
    runContext: await readJson(path.join(runDir, "00_run_context.json")),
    scoredReport: await readJson(absoluteScorePath)
  };
}

export async function selectNextBuildCandidate({ scoreArtifactPath }) {
  const state = await loadScoredState(scoreArtifactPath);
  const occurredAt = nowIso();
  const selectedCandidate = buildSelectedCandidateArtifact({
    runContext: state.runContext,
    scoredReport: state.scoredReport
  });
  await validateArtifact(state.runContext.project_root, "next_build_candidate.schema.json", NEXT_BUILD_CANDIDATE_ARTIFACT, selectedCandidate);
  const writeResult = await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: NEXT_BUILD_CANDIDATE_ARTIFACT,
    data: selectedCandidate,
    occurredAt
  });
  return {
    selectedCandidate,
    artifact: writeResult.artifactRelativePath
  };
}

export async function recordHumanCandidateDecision({
  projectRoot,
  candidateId,
  decision,
  note
}) {
  const backlog = await loadOpportunityBacklog(projectRoot);
  const existing = (backlog.opportunities ?? []).find((item) => item.candidate_id === candidateId);
  if (!existing) {
    throw new Error(`Candidate ${candidateId} was not found in state/opportunity_backlog.json.`);
  }

  const normalizedDecision = normalizeState(decision);
  const nextStatus = normalizedDecision === "approve_build"
    ? "build_ready"
    : normalizedDecision === "research_more"
      ? "research_more"
      : "skipped";
  const nextRecommendation = normalizedDecision === "approve_build"
    ? "build"
    : normalizedDecision === "research_more"
      ? "research_more"
      : "skip";
  const review = await recordHumanCandidateReview(projectRoot, {
    candidate_id: candidateId,
    reviewer: "human",
    decision: normalizedDecision,
    note,
    reviewed_at: nowIso(),
    next_step: normalizedDecision === "approve_build"
      ? "candidate_ready_for_manual_build_gate_review"
      : normalizedDecision === "research_more"
        ? "append_targeted_research_questions"
        : "do_not_build_this_candidate"
  });

  await upsertOpportunityEntries(projectRoot, [{
    ...existing,
    build_recommendation: nextRecommendation,
    status: nextStatus,
    decision_reason: `${existing.decision_reason}; human_review=${normalizedDecision}: ${note}`,
    next_step: review.review.next_step
  }]);

  return review;
}

export async function bootstrapLiveQueueFromQueriesArtifact({
  projectRoot,
  queriesFrom,
  runSlug = "live-queue",
  limit = 10,
  maxCandidates = 50
}) {
  const { artifactPath: queriesArtifactPath, data: plan } = await loadQueriesArtifact(projectRoot, queriesFrom);
  const sourceRunId = plan.run_id ?? plan.source_run_id;
  if (!sourceRunId) {
    throw new Error(`Could not infer source run id from ${queriesArtifactPath}.`);
  }
  const { sourceRunContext } = await loadSourceRunContext(projectRoot, sourceRunId);
  const queryConfigs = (plan.next_10_search_queries ?? []).slice(0, Number(limit) || 10);
  const { runDir, runContext } = await createDiscoveryLiveQueueRun({
    projectRoot,
    queriesArtifactPath,
    plan,
    sourceRunContext,
    runSlug,
    queryLimit: queryConfigs.length,
    maxCandidates: Number(maxCandidates) || 50
  });

  await ensureSkippedBacklogEntryForSourceRun(projectRoot, sourceRunId);
  const result = await runDiscoveryLiveQueue({
    runDir,
    runContext,
    queryConfigs,
    sourceRunId,
    maxCandidates: Number(maxCandidates) || 50
  });

  return {
    runDir,
    runContext,
    sourceRunId,
    ...result
  };
}

export async function inspectBacklogPath(projectRoot) {
  return absoluteOpportunityBacklogPath(projectRoot);
}
