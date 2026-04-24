import path from "node:path";
import { loadPortfolioRegistry } from "../portfolio/registry.mjs";
import { nextTenDiscoveryQueries } from "../discovery/engine.mjs";
import {
  artifactPath,
  buildSafeReport,
  loadOptionalManagedArtifact,
  markdownList,
  markdownSection,
  validateArtifact,
  writeManagedJsonArtifact,
  writeManagedMarkdownArtifact
} from "./helpers.mjs";
import { nowIso, readJson } from "../utils/io.mjs";

export const DISCOVERY_QUALITY_REVIEW_ARTIFACT = "33_discovery_quality_review.json";
export const DEMAND_DISCOVERY_IMPROVEMENT_PLAN_ARTIFACT = "34_demand_discovery_improvement_plan.json";

function round(value) {
  return Math.round(value * 100) / 100;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function uniqueStrings(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

async function loadDiscoveryReviewState(runDir) {
  const absoluteRunDir = path.resolve(runDir);
  const runContext = await readJson(artifactPath(absoluteRunDir, "00_run_context.json"));
  if ((runContext.run_type ?? runContext.task_mode) === "sandbox_validation") {
    throw new Error(`Run ${runContext.run_id} is not a daily discovery run.`);
  }

  return {
    runDir: absoluteRunDir,
    runContext,
    candidateReport: await readJson(artifactPath(absoluteRunDir, "10_candidate_report.json")),
    shortlistQuality: await readJson(artifactPath(absoluteRunDir, "12_candidate_shortlist_quality.json")),
    feedbackEvidence: await readJson(artifactPath(absoluteRunDir, "20_feedback_evidence.json")),
    feedbackClusters: await readJson(artifactPath(absoluteRunDir, "21_feedback_clusters.json")),
    opportunityScores: await readJson(artifactPath(absoluteRunDir, "30_opportunity_scores.json")),
    selectedCandidate: await readJson(artifactPath(absoluteRunDir, "31_selected_candidate.json")),
    buildGateDecision: await readJson(artifactPath(absoluteRunDir, "32_build_gate_decision.json")),
    researchResolution: await loadOptionalManagedArtifact({
      runDir: absoluteRunDir,
      artifactName: "36_research_more_resolution.json",
      runContext
    }),
    updatedOpportunityScore: await loadOptionalManagedArtifact({
      runDir: absoluteRunDir,
      artifactName: "38_updated_opportunity_score.json",
      runContext
    }),
    researchResolutionGate: await loadOptionalManagedArtifact({
      runDir: absoluteRunDir,
      artifactName: "39_research_resolution_gate.json",
      runContext
    }),
    portfolioRegistry: await loadPortfolioRegistry(runContext.project_root)
  };
}

function queryMarkdown(queries) {
  if (!Array.isArray(queries) || queries.length === 0) {
    return "- none";
  }
  return queries.map((query) => (
    `- ${query.query} | ${query.target_category} | ${query.preferred_archetype} | exclude if: ${query.exclude_if}`
  )).join("\n");
}

function reviewMarkdown(review, improvementPlan) {
  return [
    "# Discovery Quality Review",
    "",
    `- Run: ${review.run_id}`,
    `- Selected candidate: ${review.selected_candidate?.candidate_id ?? "unknown"}`,
    `- Build recommendation: ${review.build_recommendation}`,
    `- Evidence quality score: ${review.evidence_quality_score}`,
    `- Opportunity score confidence: ${review.opportunity_score_confidence}`,
    "",
    markdownSection("Decision Rationale", markdownList(review.decision_rationale)),
    "",
    markdownSection("Biggest Uncertainties", markdownList(review.biggest_uncertainties)),
    "",
    markdownSection("Missing Evidence", markdownList(review.missing_evidence)),
    "",
    markdownSection("Recommended Next Queries", markdownList(review.recommended_next_queries)),
    "",
    "## Demand Discovery Improvement Plan",
    "",
    markdownSection("Better Sources", markdownList(improvementPlan.better_sources)),
    "",
    markdownSection("Minimum Thresholds", markdownList(improvementPlan.minimum_thresholds)),
    "",
    markdownSection("Next 10 Search Queries", queryMarkdown(improvementPlan.next_10_search_queries))
  ].join("\n");
}

function improvementPlanMarkdown(plan) {
  return [
    "# Demand Discovery Improvement Plan",
    "",
    `- Run: ${plan.run_id}`,
    `- Selected candidate: ${plan.selected_candidate_id}`,
    `- Next step: ${plan.next_step}`,
    "",
    markdownSection("Better Sources", markdownList(plan.better_sources)),
    "",
    markdownSection("Category Strategy", markdownList(plan.category_strategy)),
    "",
    markdownSection("Keyword Strategy", markdownList(plan.keyword_strategy)),
    "",
    markdownSection("Minimum Thresholds", markdownList(plan.minimum_thresholds)),
    "",
    markdownSection("Negative Review Mining Strategy", markdownList(plan.negative_review_mining_strategy)),
    "",
    markdownSection("Support Site Strategy", markdownList(plan.support_site_strategy)),
    "",
    markdownSection("GitHub Issue Strategy", markdownList(plan.github_issue_strategy)),
    "",
    markdownSection("Reddit Or Forum Strategy", markdownList(plan.reddit_or_forum_strategy)),
    "",
    markdownSection("Recency Strategy", markdownList(plan.recency_strategy)),
    "",
    markdownSection("Anti-Copycat Policy", markdownList(plan.anti_copycat_policy)),
    "",
    markdownSection("Portfolio Differentiation Strategy", markdownList(plan.portfolio_differentiation_strategy)),
    "",
    markdownSection("Next 10 Search Queries", queryMarkdown(plan.next_10_search_queries))
  ].join("\n");
}

function buildMissingEvidence(selectedEvidence, selectedClusters, sourceMode) {
  const missing = [];
  const sourceTypes = uniqueStrings(selectedEvidence.map((item) => item.source_type));
  if (!sourceTypes.some((value) => value !== "chrome_web_store_review" && value !== "chrome_web_store_listing")) {
    missing.push("No non-store corroboration yet for the selected wedge.");
  }
  if (!sourceTypes.includes("forum_post")) {
    missing.push("No Reddit or practitioner forum evidence yet.");
  }
  if (`${sourceMode}`.includes("fixture")) {
    missing.push("Discovery still depends on fixture-mode evidence, so freshness is capped.");
  }
  if (selectedClusters.some((cluster) => cluster.weak_cluster_reason)) {
    missing.push("At least one top pain cluster is still weak or overly generic.");
  }
  return missing;
}

function buildUncertainties(state, selectedScore, selectedClusters) {
  const uncertainties = [...(state.buildGateDecision.required_followup_research ?? [])];
  if (state.shortlistQuality.shortlist_confidence < 60) {
    uncertainties.push(`shortlist_confidence=${state.shortlistQuality.shortlist_confidence} suggests the candidate pool was not strong enough`);
  }
  for (const cluster of selectedClusters) {
    if (cluster.weak_cluster_reason) {
      uncertainties.push(`${cluster.title}: ${cluster.weak_cluster_reason}`);
    }
  }
  if ((state.portfolioRegistry.items ?? []).filter((item) => item.family === (selectedScore?.wedge_family ?? state.selectedCandidate.candidate?.wedge_family)).length > 1) {
    uncertainties.push("Portfolio overlap remains meaningful for this wedge family.");
  }
  return uniqueStrings(uncertainties);
}

function overallBuildRecommendation(state, selectedScore) {
  if (state.researchResolutionGate?.final_recommendation) {
    return `${state.researchResolutionGate.final_recommendation}` === "still_research_more"
      ? "research_more"
      : state.researchResolutionGate.final_recommendation;
  }
  if (state.researchResolution?.final_recommendation) {
    return `${state.researchResolution.final_recommendation}` === "still_research_more"
      ? "research_more"
      : state.researchResolution.final_recommendation;
  }
  if (state.buildGateDecision.go_no_go === "go") {
    return "build";
  }
  const blockers = new Set(state.buildGateDecision.blockers ?? []);
  if (
    blockers.has("permissions_risk_gate")
    || blockers.has("portfolio_overlap_gate")
    || (selectedScore?.compliance_score ?? 100) < 50
  ) {
    return "skip";
  }
  return "research_more";
}

function effectiveSelectedScore(state, selectedScore) {
  return state.updatedOpportunityScore ?? selectedScore;
}

export async function generateDiscoveryQualityReview({ runDir }) {
  const state = await loadDiscoveryReviewState(runDir);
  const occurredAt = nowIso();
  const selectedCandidateId = state.selectedCandidate.selected_candidate_id;
  const selectedEvidence = state.feedbackEvidence.evidence_by_candidate?.[selectedCandidateId] ?? [];
  const selectedClusters = state.feedbackClusters.clusters_by_candidate?.[selectedCandidateId] ?? [];
  const baseSelectedScore = (state.opportunityScores.scores ?? []).find((score) => score.candidate_id === selectedCandidateId) ?? null;
  const selectedScore = effectiveSelectedScore(state, baseSelectedScore);
  const scoreRanking = [...(state.opportunityScores.scores ?? [])].sort((left, right) => (right.total_score ?? 0) - (left.total_score ?? 0));
  const runnerUp = scoreRanking.find((score) => score.candidate_id !== selectedCandidateId) ?? null;
  const sourceMode = state.candidateReport.source_mode ?? state.runContext.research?.mode ?? "unknown";
  const structuredQueries = nextTenDiscoveryQueries();
  const biggestUncertainties = uniqueStrings([
    ...buildUncertainties(state, selectedScore, selectedClusters),
    ...(state.researchResolution?.unresolved_uncertainties ?? []),
    ...(state.researchResolutionGate?.blockers ?? [])
  ]);
  const missingEvidence = uniqueStrings([
    ...buildMissingEvidence(selectedEvidence, selectedClusters, sourceMode),
    state.researchResolutionGate?.final_recommendation === "skip"
      ? "The clearest wedge is still too close to the existing portfolio."
      : null
  ]);
  const buildRecommendation = overallBuildRecommendation(state, selectedScore);

  const review = buildSafeReport({
    stage: "DISCOVERY_QUALITY_REVIEW",
    status: "passed",
    run_id: state.runContext.run_id,
    candidate_count: state.candidateReport.candidate_count ?? 0,
    selected_candidate: {
      candidate_id: selectedCandidateId,
      name: state.selectedCandidate.candidate?.name ?? null,
      wedge_family: state.selectedCandidate.candidate?.wedge_family ?? null,
      source_mode: sourceMode,
      total_score: selectedScore?.total_score ?? null,
      confidence_score: selectedScore?.confidence_score ?? null
    },
    evidence_quality_score: selectedScore?.evidence_quality_score ?? 0,
    pain_cluster_quality_score: round(clamp(
      (selectedClusters.reduce((sum, cluster) => sum + (cluster.cluster_specificity_score ?? 0), 0) / Math.max(1, selectedClusters.length)) * 0.4
      + (selectedClusters.reduce((sum, cluster) => sum + (cluster.source_diversity_score ?? 0), 0) / Math.max(1, selectedClusters.length)) * 0.2
      + (selectedClusters.reduce((sum, cluster) => sum + (cluster.repeated_pain_count ?? 0), 0) * 12)
      + (selectedClusters.reduce((sum, cluster) => sum + (cluster.testability_score ?? 0), 0) / Math.max(1, selectedClusters.length)) * 0.2
    )),
    opportunity_score_confidence: selectedScore?.confidence_score ?? 0,
    portfolio_overlap_risk: selectedScore?.portfolio_overlap_penalty ?? 0,
    compliance_risk: round(clamp(100 - (selectedScore?.compliance_score ?? 0))),
    feasibility_confidence: selectedScore?.feasibility_score ?? 0,
    user_need_clarity: selectedScore?.wedge_clarity_score ?? 0,
    build_recommendation: buildRecommendation,
    biggest_uncertainties: biggestUncertainties,
    missing_evidence: missingEvidence,
    recommended_next_queries: structuredQueries.map((query) => query.query),
    decision_rationale: [
      ...(selectedScore?.decision_rationale ?? []),
      runnerUp ? `Score gap to runner-up is ${round((selectedScore?.total_score ?? 0) - (runnerUp.total_score ?? 0))}.` : "No runner-up candidate was recorded.",
      `build_gate=${state.buildGateDecision.go_no_go ?? state.buildGateDecision.decision}`,
      state.researchResolutionGate?.final_recommendation
        ? `research_resolution=${state.researchResolutionGate.final_recommendation}`
        : null
    ].filter(Boolean)
  });

  const improvementPlan = buildSafeReport({
    stage: "DEMAND_DISCOVERY_IMPROVEMENT_PLAN",
    status: "passed",
    run_id: state.runContext.run_id,
    selected_candidate_id: selectedCandidateId ?? "",
    better_sources: [
      "Chrome Web Store review samples across recent time windows.",
      "Support sites or help centers with reproducible complaint text.",
      "GitHub issues only when the project is active and user-facing.",
      "Reddit or forum corroboration for practitioner workflow pain."
    ],
    category_strategy: [
      "Bias toward low-permission, local-only productivity wedges.",
      "Do not build same-family variants unless differentiation is explicit and testable.",
      "Allow no-go days when evidence stays weak."
    ],
    keyword_strategy: [
      "Start from the user job, then add failure words such as skip, miss, overwrite, noisy, manual.",
      "Prefer keywords that imply a narrow, testable happy path over broad category terms."
    ],
    minimum_thresholds: [
      "evidence_quality_score >= 60 before build",
      "testability_score >= 60 before build",
      "At least one non-store source before repeated same-family builds",
      "At least three meaningful pain clusters before build"
    ],
    negative_review_mining_strategy: [
      "Mine 1-star to 3-star reviews for repeated verbs such as skip, overwrite, fail, noisy, manual.",
      "Separate workflow friction from field coverage and privacy complaints."
    ],
    support_site_strategy: [
      "Prefer support pages with exact field or workflow failures.",
      "Capture dated excerpts and URLs instead of paraphrasing."
    ],
    github_issue_strategy: [
      "Use GitHub issues as corroboration when they include reproducible steps.",
      "Down-rank stale trackers older than 180 days."
    ],
    reddit_or_forum_strategy: [
      "Treat Reddit/forum evidence as corroboration, not the primary decision source.",
      "Look for operator and recruiter communities where repetitive browser tasks are discussed."
    ],
    recency_strategy: [
      "Bias toward evidence from the last 90 days.",
      "Require newer corroboration when all evidence is older than 180 days."
    ],
    anti_copycat_policy: [
      "Do not build just because a category is large.",
      "Require a narrower user story or a lower-permission posture than existing tools."
    ],
    portfolio_differentiation_strategy: [
      "Treat portfolio overlap as a real penalty, not just a warning.",
      "When overlap is high, research more or skip instead of forcing a build."
    ],
    next_10_search_queries: structuredQueries,
    next_step: buildRecommendation === "build"
      ? "strengthen_live_evidence_before_more_same_family_builds"
      : "improve_discovery_inputs_before_next_build_attempt"
  });

  await validateArtifact(
    state.runContext.project_root,
    "discovery_quality_review.schema.json",
    DISCOVERY_QUALITY_REVIEW_ARTIFACT,
    review
  );
  await validateArtifact(
    state.runContext.project_root,
    "demand_discovery_improvement_plan.schema.json",
    DEMAND_DISCOVERY_IMPROVEMENT_PLAN_ARTIFACT,
    improvementPlan
  );

  const reviewWrite = await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: DISCOVERY_QUALITY_REVIEW_ARTIFACT,
    data: review,
    occurredAt
  });
  const planWrite = await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: DEMAND_DISCOVERY_IMPROVEMENT_PLAN_ARTIFACT,
    data: improvementPlan,
    occurredAt
  });

  await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "33_discovery_quality_review.md",
    category: "discovery_review",
    prefix: "33_discovery_quality_review",
    content: reviewMarkdown(review, improvementPlan),
    occurredAt
  });
  await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "34_demand_discovery_improvement_plan.md",
    category: "discovery_review",
    prefix: "34_demand_discovery_improvement_plan",
    content: improvementPlanMarkdown(improvementPlan),
    occurredAt
  });

  return {
    review,
    improvement_plan: improvementPlan,
    artifacts: {
      review: reviewWrite.artifactRelativePath,
      improvement_plan: planWrite.artifactRelativePath
    }
  };
}
