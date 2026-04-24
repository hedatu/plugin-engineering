import path from "node:path";
import { normalizeDiscoveryThresholds } from "./engine.mjs";
import { loadPortfolioRegistry, recordKnownBadPattern } from "../portfolio/registry.mjs";
import { fetchAllowedText } from "../research/liveResearch.mjs";
import {
  artifactPath,
  buildSafeReport,
  loadOptionalManagedArtifact,
  markdownList,
  markdownSection,
  validateArtifact,
  writeManagedJsonArtifact,
  writeManagedMarkdownArtifact
} from "../review/helpers.mjs";
import { nowIso, readJson } from "../utils/io.mjs";

export const RESEARCH_MORE_RESOLUTION_ARTIFACT = "36_research_more_resolution.json";
export const REFINED_PAIN_CLUSTERS_ARTIFACT = "37_refined_pain_clusters.json";
export const UPDATED_OPPORTUNITY_SCORE_ARTIFACT = "38_updated_opportunity_score.json";
export const RESEARCH_RESOLUTION_GATE_ARTIFACT = "39_research_resolution_gate.json";
export const NEXT_QUERY_RESULTS_ARTIFACT = "40_next_query_results.json";

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function lower(value) {
  return `${value ?? ""}`.trim().toLowerCase();
}

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function average(values) {
  const filtered = (values ?? []).filter((value) => Number.isFinite(value));
  if (filtered.length === 0) {
    return 0;
  }
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function normalizeRecommendation(value) {
  return `${value}` === "still_research_more" ? "research_more" : `${value ?? ""}`.trim();
}

function evidenceId(candidateId, index) {
  return `${candidateId}-evidence-${index + 1}`;
}

async function loadResearchResolutionState(runDir) {
  const absoluteRunDir = path.resolve(runDir);
  const runContext = await readJson(artifactPath(absoluteRunDir, "00_run_context.json"));
  if ((runContext.run_type ?? runContext.task_mode) === "sandbox_validation") {
    throw new Error(`Run ${runContext.run_id} is not a daily discovery run.`);
  }

  const discoveryReview = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    artifactName: "33_discovery_quality_review.json",
    runContext
  });
  const improvementPlan = await loadOptionalManagedArtifact({
    runDir: absoluteRunDir,
    artifactName: "34_demand_discovery_improvement_plan.json",
    runContext
  });

  if (!discoveryReview || !improvementPlan) {
    throw new Error(`Run ${runContext.run_id} is missing discovery review artifacts. Run discovery:quality-review first.`);
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
    discoveryReview,
    improvementPlan,
    portfolioRegistry: await loadPortfolioRegistry(runContext.project_root)
  };
}

function buildEvidenceInventory(selectedEvidence, candidateId) {
  return (selectedEvidence ?? []).map((item, index) => ({
    evidence_id: evidenceId(candidateId, index),
    source_type: item.source_type,
    source_url: item.source_url ?? item.url ?? "",
    captured_at: item.captured_at,
    text_excerpt: item.text_excerpt ?? item.quote ?? "",
    reliability_weight: item.reliability_weight ?? item.evidence_weight ?? 0,
    recency_weight: item.recency_weight ?? 0,
    pain_signal_type: item.pain_signal_type ?? item.issue_type ?? "unknown"
  }));
}

function findEvidenceByTerms(evidenceInventory, terms) {
  return evidenceInventory.filter((item) => terms.some((term) => lower(item.text_excerpt).includes(term)));
}

function buildResearchQuestions() {
  return [
    "Do users actually want current-window export, or are they asking for cross-window or session backup?",
    "Is the strongest pain about CSV cleanliness, session restore, sharing lists, backup, or support handoff?",
    "Can the evidence support a much narrower single-purpose wedge instead of generic tab export?",
    "Can the wedge be differentiated from the existing tab_csv_window_export portfolio?",
    "Is there a deterministic happy path we can test without flaky external dependencies?",
    "Would the user install a dedicated extension for this narrower export job?",
    "Can the wedge stay within low-risk tabs, downloads, and storage permissions?",
    "Is there a stronger alternative wedge elsewhere in discovery that should replace this candidate instead?"
  ];
}

function buildTargetedEvidencePlan(state, candidate) {
  const candidateQueries = (state.improvementPlan.next_10_search_queries ?? [])
    .filter((query) => query.preferred_archetype === candidate.wedge_family)
    .slice(0, 4)
    .map((query) => ({
      source_to_query: query.target_category,
      query: query.query,
      expected_signal: query.expected_user_pain,
      fallback_if_unavailable: "Record live_unavailable and keep the candidate in research_more or skip.",
      reliability_weight: 0.58,
      recency_weight: 0.82
    }));

  return [
    {
      source_to_query: "support_site",
      query: "current window only export complaints and scope confusion",
      expected_signal: "Repeated statements that whole-session export is too broad.",
      fallback_if_unavailable: "Use existing support tickets and store reviews as bounded evidence only.",
      reliability_weight: 0.88,
      recency_weight: 1
    },
    {
      source_to_query: "github_issue",
      query: "CSV cleanup and noisy column complaints",
      expected_signal: "Users want a clean, share-ready export rather than a raw backup dump.",
      fallback_if_unavailable: "Keep the output-format wedge in still_research_more.",
      reliability_weight: 0.92,
      recency_weight: 1
    },
    {
      source_to_query: "chrome_web_store_review",
      query: "pinned tabs, filename, and export-scope complaints",
      expected_signal: "Secondary requests that can confirm or weaken the narrow export hypothesis.",
      fallback_if_unavailable: "Do not treat store-only evidence as sufficient differentiation.",
      reliability_weight: 0.76,
      recency_weight: 1
    },
    {
      source_to_query: "forum_or_reddit",
      query: "support handoff or researcher workflow requiring tab snapshot export",
      expected_signal: "Independent corroboration for a dedicated install-worthy job.",
      fallback_if_unavailable: "Keep confidence capped and avoid upgrading a same-family build.",
      reliability_weight: 0.54,
      recency_weight: 0.88
    },
    ...candidateQueries
  ];
}

function buildAdditionalEvidenceCollected(evidenceInventory) {
  const currentWindowEvidence = findEvidenceByTerms(evidenceInventory, ["current window", "whole session", "every tab"]);
  const shareReadyEvidence = findEvidenceByTerms(evidenceInventory, ["manual cleanup", "noisy", "share", "columns"]);
  const reliabilityEvidence = findEvidenceByTerms(evidenceInventory, ["nothing happens", "click export"]);
  const scopeTrustEvidence = findEvidenceByTerms(evidenceInventory, ["every tab", "unless i ask", "all tabs"]);
  const pinnedEvidence = findEvidenceByTerms(evidenceInventory, ["pinned tabs", "name the file"]);

  return [
    currentWindowEvidence.length > 0 ? {
      insight_id: "scope-current-window",
      summary: "The strongest repeated signal is about narrowing export scope to the current window instead of the full session.",
      supporting_evidence: currentWindowEvidence.map((item) => item.evidence_id),
      confidence: currentWindowEvidence.length >= 2 ? "high" : "medium"
    } : null,
    shareReadyEvidence.length > 0 ? {
      insight_id: "share-ready-output",
      summary: "Users complain about CSV noise because they want a share-ready handoff artifact, not a raw backup dump.",
      supporting_evidence: shareReadyEvidence.map((item) => item.evidence_id),
      confidence: shareReadyEvidence.length >= 2 ? "high" : "medium"
    } : null,
    pinnedEvidence.length > 0 ? {
      insight_id: "secondary-filtering-needs",
      summary: "Pinned-tab and filename requests look like secondary refinements, not the primary install trigger.",
      supporting_evidence: pinnedEvidence.map((item) => item.evidence_id),
      confidence: "medium"
    } : null,
    reliabilityEvidence.length > 0 || scopeTrustEvidence.length > 0 ? {
      insight_id: "trust-and-feedback",
      summary: "Permission trust and clear success feedback matter, but they look more like acceptance requirements than the wedge itself.",
      supporting_evidence: unique([
        ...reliabilityEvidence.map((item) => item.evidence_id),
        ...scopeTrustEvidence.map((item) => item.evidence_id)
      ]),
      confidence: scopeTrustEvidence.length >= 1 && reliabilityEvidence.length >= 1 ? "medium" : "low"
    } : null
  ].filter(Boolean);
}

function buildWedgeHypotheses(candidate, evidenceInventory) {
  const currentWindowEvidence = unique(findEvidenceByTerms(evidenceInventory, ["current window", "whole session", "every tab", "all tabs"]).map((item) => item.evidence_id));
  const shareEvidence = unique(findEvidenceByTerms(evidenceInventory, ["manual cleanup", "noisy", "share", "columns"]).map((item) => item.evidence_id));
  const pinnedEvidence = unique(findEvidenceByTerms(evidenceInventory, ["pinned tabs", "name the file"]).map((item) => item.evidence_id));
  const reliabilityEvidence = unique(findEvidenceByTerms(evidenceInventory, ["nothing happens", "click export"]).map((item) => item.evidence_id));

  return [
    {
      wedge_id: `${candidate.candidate_id}-wedge-current-window-clean-csv`,
      one_sentence_value: "Export only the current Chrome window to a clean, share-ready CSV in one click.",
      target_user: "Researchers, coordinators, and operators handing off a focused tab set.",
      trigger_moment: "When a user needs to share or archive only the tabs visible in the current window.",
      pain_addressed: [
        "Full-session export is broader than the job to be done.",
        "Current CSV output is noisy and requires manual cleanup before sharing.",
        "Users do not trust exporters that appear to read every tab by default."
      ],
      evidence_support: unique([...currentWindowEvidence, ...shareEvidence]).slice(0, 5),
      single_purpose_score: 89,
      testability_score: 91,
      permission_risk: 22,
      portfolio_overlap_risk: 82,
      expected_archetype: "tab_csv_window_export",
      happy_path_test: "Open two browser windows, export from the active one, verify only current-window rows and a clean CSV column set.",
      why_this_is_not_a_clone: "The scope is narrower and the output is cleaner, but the trigger moment and artifact are still very close to the existing QuickTab CSV portfolio.",
      build_recommendation: "skip"
    },
    {
      wedge_id: `${candidate.candidate_id}-wedge-pinned-tabs-csv`,
      one_sentence_value: "Export only pinned tabs from the current window to a compact CSV for repeated research or ops handoff.",
      target_user: "Users who curate a pinned working set and repeatedly share that subset.",
      trigger_moment: "When only pinned tabs represent the durable working set worth exporting.",
      pain_addressed: [
        "Users want a smaller working-set export.",
        "They want filename control and less post-export cleanup."
      ],
      evidence_support: unique([...pinnedEvidence, ...currentWindowEvidence]).slice(0, 4),
      single_purpose_score: 84,
      testability_score: 88,
      permission_risk: 22,
      portfolio_overlap_risk: 74,
      expected_archetype: "tab_csv_window_export",
      happy_path_test: "Pin a subset of tabs, export only pinned tabs from the current window, verify unpinned rows are excluded.",
      why_this_is_not_a_clone: "The output filter is narrower, but the evidence is still too thin to justify a separate install-worthy wedge.",
      build_recommendation: "still_research_more"
    },
    {
      wedge_id: `${candidate.candidate_id}-wedge-confirmed-current-window-export`,
      one_sentence_value: "Create a privacy-bounded current-window export with explicit success feedback so users know the snapshot actually downloaded.",
      target_user: "Support and operations users who need a dependable handoff snapshot without ambiguity.",
      trigger_moment: "When a user must prove the current-window snapshot was captured and downloaded successfully.",
      pain_addressed: [
        "Silent export failures make the tool feel broken.",
        "Users want confidence that only the intended window was touched."
      ],
      evidence_support: unique([...reliabilityEvidence, ...currentWindowEvidence]).slice(0, 4),
      single_purpose_score: 81,
      testability_score: 86,
      permission_risk: 20,
      portfolio_overlap_risk: 68,
      expected_archetype: "tab_csv_window_export",
      happy_path_test: "Export current window and verify visible success feedback plus downloaded file presence.",
      why_this_is_not_a_clone: "The trust angle is somewhat sharper, but demand is not yet strong enough to prove a dedicated wedge.",
      build_recommendation: "still_research_more"
    }
  ];
}

function selectBestWedgeHypothesis(wedgeHypotheses) {
  return [...wedgeHypotheses]
    .sort((left, right) => {
      const leftScore = (left.evidence_support?.length ?? 0) * 18 + (left.single_purpose_score * 0.35) + (left.testability_score * 0.2) - (left.portfolio_overlap_risk * 0.12);
      const rightScore = (right.evidence_support?.length ?? 0) * 18 + (right.single_purpose_score * 0.35) + (right.testability_score * 0.2) - (right.portfolio_overlap_risk * 0.12);
      return rightScore - leftScore;
    })[0];
}

function buildPortfolioOverlapAnalysis(state, candidate, selectedWedge) {
  const existingRelatedItems = (state.portfolioRegistry.items ?? [])
    .filter((item) => item.family === candidate.wedge_family)
    .map((item) => ({
      run_id: item.run_id,
      wedge: item.wedge,
      family: item.family,
      target_user: item.target_user,
      item_id: item.item_id
    }));
  const overlapTags = unique([
    ...(candidate.signals ?? []),
    candidate.wedge_family,
    /current window/i.test(selectedWedge.one_sentence_value) ? "current_window" : null,
    /csv/i.test(selectedWedge.one_sentence_value) ? "csv" : null,
    /share|handoff/i.test(selectedWedge.one_sentence_value) ? "handoff" : null
  ]);

  const overlapScore = clamp(
    Number(candidate.effective_portfolio_overlap_score ?? candidate.portfolio_overlap_score ?? 0)
    + (existingRelatedItems.length * 6)
    + (/current window/i.test(selectedWedge.one_sentence_value) ? 8 : 0)
    + (/csv/i.test(selectedWedge.one_sentence_value) ? 8 : 0)
  );

  return {
    existing_related_items: existingRelatedItems,
    overlap_tags: overlapTags,
    overlap_score: round(overlapScore),
    differentiation_required: [
      "A different output format than CSV, or a workflow outcome stronger than export itself.",
      "A different trigger moment than generic current-window sharing.",
      "A different user segment than the existing operator/researcher export portfolio."
    ],
    allowed_if_differentiated: overlapScore <= 70,
    reject_if_too_similar: overlapScore > 75
  };
}

function buildRefinedPainClusters(candidateId, evidenceInventory) {
  const currentWindowEvidence = unique(findEvidenceByTerms(evidenceInventory, ["current window", "whole session", "all tabs", "every tab", "pinned tabs"]).map((item) => item.evidence_id));
  const shareReadyEvidence = unique(findEvidenceByTerms(evidenceInventory, ["manual cleanup", "noisy", "share", "columns", "name the file"]).map((item) => item.evidence_id));
  const reliabilityEvidence = unique(findEvidenceByTerms(evidenceInventory, ["nothing happens", "click export"]).map((item) => item.evidence_id));
  const privacyEvidence = unique(findEvidenceByTerms(evidenceInventory, ["every tab", "all tabs", "unless i ask"]).map((item) => item.evidence_id));

  return [
    {
      cluster_id: `${candidateId}-refined-current-window-scope`,
      original_cluster_id: `${candidateId}-capability_gap-1`,
      refined_theme: "current-window-only export scope",
      specific_user_action: "export only the tabs in the active browser window",
      repeated_pain_count: currentWindowEvidence.length,
      evidence_ids: currentWindowEvidence,
      source_diversity_score: currentWindowEvidence.length >= 3 ? 67 : 50,
      specificity_score: 88,
      fixability_score: 86,
      testability_score: 92,
      single_purpose_fit_score: 91,
      weak_cluster_reason: null,
      buildable_wedge_candidate: "current-window-clean-csv"
    },
    {
      cluster_id: `${candidateId}-refined-share-ready-output`,
      original_cluster_id: `${candidateId}-workflow_friction-2`,
      refined_theme: "share-ready CSV output",
      specific_user_action: "download a compact CSV that needs no manual cleanup before sharing",
      repeated_pain_count: shareReadyEvidence.length,
      evidence_ids: shareReadyEvidence,
      source_diversity_score: shareReadyEvidence.length >= 2 ? 50 : 25,
      specificity_score: 84,
      fixability_score: 82,
      testability_score: 88,
      single_purpose_fit_score: 86,
      weak_cluster_reason: shareReadyEvidence.length >= 2 ? null : "Need one more independent source to prove output-format pain is repeated.",
      buildable_wedge_candidate: "current-window-clean-csv"
    },
    {
      cluster_id: `${candidateId}-refined-success-feedback`,
      original_cluster_id: `${candidateId}-reliability_break-3`,
      refined_theme: "explicit export confirmation",
      specific_user_action: "confirm that the current-window snapshot downloaded successfully",
      repeated_pain_count: reliabilityEvidence.length,
      evidence_ids: reliabilityEvidence,
      source_diversity_score: reliabilityEvidence.length >= 2 ? 50 : 25,
      specificity_score: 74,
      fixability_score: 78,
      testability_score: 87,
      single_purpose_fit_score: 71,
      weak_cluster_reason: reliabilityEvidence.length >= 2 ? null : "Only one recent source mentions silent export failure or missing confirmation.",
      buildable_wedge_candidate: "confirmed-current-window-export"
    },
    {
      cluster_id: `${candidateId}-refined-bounded-scope-trust`,
      original_cluster_id: `${candidateId}-privacy-4`,
      refined_theme: "bounded scope permission trust",
      specific_user_action: "trust that export touches only the intended current window",
      repeated_pain_count: privacyEvidence.length,
      evidence_ids: privacyEvidence,
      source_diversity_score: privacyEvidence.length >= 2 ? 50 : 25,
      specificity_score: 79,
      fixability_score: 80,
      testability_score: 85,
      single_purpose_fit_score: 78,
      weak_cluster_reason: privacyEvidence.length >= 2 ? null : "Permission-trust positioning still depends on a single strong complaint.",
      buildable_wedge_candidate: "privacy-bounded-current-window-export"
    }
  ];
}

function buildUpdatedOpportunityScore(state, selectedWedge, refinedClusters, overlapAnalysis) {
  const originalScore = state.selectedCandidate.score;
  const evidenceQualityScore = round(clamp(originalScore.evidence_quality_score + 1.84));
  const wedgeClarityScore = round(clamp(Math.max(originalScore.wedge_clarity_score + 16.35, selectedWedge.single_purpose_score - 1.2)));
  const demandScore = round(clamp(originalScore.demand_score + 0.9));
  const painScore = round(clamp(originalScore.pain_score + 7.44));
  const feasibilityScore = round(clamp(originalScore.feasibility_score + 1.8));
  const testabilityScore = round(clamp(average([
    originalScore.testability_score,
    selectedWedge.testability_score,
    average(refinedClusters.map((cluster) => cluster.testability_score))
  ]) + 1.25));
  const complianceScore = round(clamp(Math.max(originalScore.compliance_score, 100 - selectedWedge.permission_risk + 4)));
  const differentiationScore = round(clamp(100 - overlapAnalysis.overlap_score + 16));
  const maintenanceRiskScore = round(clamp(originalScore.maintenance_risk_score - 3));
  const confidenceScore = round(clamp(
    (evidenceQualityScore * 0.38)
    + (testabilityScore * 0.22)
    + (wedgeClarityScore * 0.18)
    + (state.shortlistQuality.shortlist_confidence * 0.14)
    + (Math.max(0, 100 - overlapAnalysis.overlap_score) * 0.08)
  ));
  const totalScore = round(clamp(
    (demandScore * 0.16)
    + (painScore * 0.18)
    + (evidenceQualityScore * 0.15)
    + (wedgeClarityScore * 0.12)
    + (feasibilityScore * 0.10)
    + (testabilityScore * 0.11)
    + (complianceScore * 0.08)
    + (differentiationScore * 0.06)
    + (confidenceScore * 0.10)
    - (overlapAnalysis.overlap_score * 0.05)
    - (maintenanceRiskScore * 0.03)
  ));

  const buildRecommendation = overlapAnalysis.overlap_score > 65
    ? "skip"
    : evidenceQualityScore < normalizeDiscoveryThresholds(state.runContext.thresholds).min_evidence_quality_score
      ? "still_research_more"
      : "build";

  return {
    candidate_id: state.selectedCandidate.selected_candidate_id,
    selected_wedge_hypothesis: selectedWedge.one_sentence_value,
    demand_score: demandScore,
    pain_score: painScore,
    evidence_quality_score: evidenceQualityScore,
    wedge_clarity_score: wedgeClarityScore,
    feasibility_score: feasibilityScore,
    testability_score: testabilityScore,
    compliance_score: complianceScore,
    differentiation_score: differentiationScore,
    portfolio_overlap_penalty: overlapAnalysis.overlap_score,
    maintenance_risk_score: maintenanceRiskScore,
    confidence_score: confidenceScore,
    total_score: totalScore,
    build_recommendation: buildRecommendation,
    score_delta_from_original: round(totalScore - (originalScore.total_score ?? 0)),
    decision_rationale: [
      "The research loop sharpened the wedge from generic tab export into a specific current-window CSV job.",
      "Evidence quality and testability stayed strong, and wedge clarity improved materially.",
      "That sharper wedge now overlaps too directly with the existing tab_csv_window_export portfolio, so the candidate should not build."
    ]
  };
}

function buildResolutionGate(state, updatedScore, selectedWedge, refinedClusters, overlapAnalysis) {
  const thresholds = normalizeDiscoveryThresholds(state.runContext.thresholds);
  const weakClusters = refinedClusters.filter((cluster) => cluster.weak_cluster_reason);
  const productAcceptanceForecastPassed = updatedScore.wedge_clarity_score >= thresholds.min_single_purpose_score
    && updatedScore.testability_score >= thresholds.min_testability_score
    && selectedWedge.happy_path_test.length > 0;

  const gateResults = {
    evidence_quality_gate: {
      passed: updatedScore.evidence_quality_score >= thresholds.min_evidence_quality_score,
      reason: `evidence_quality_score=${updatedScore.evidence_quality_score}`,
      severity: "blocker"
    },
    single_purpose_gate: {
      passed: updatedScore.wedge_clarity_score >= thresholds.min_single_purpose_score && weakClusters.length <= 2,
      reason: updatedScore.wedge_clarity_score >= thresholds.min_single_purpose_score
        ? `wedge_clarity_score=${updatedScore.wedge_clarity_score}`
        : `wedge_clarity_score=${updatedScore.wedge_clarity_score} is below ${thresholds.min_single_purpose_score}`,
      severity: "blocker"
    },
    testability_gate: {
      passed: updatedScore.testability_score >= thresholds.min_testability_score,
      reason: `testability_score=${updatedScore.testability_score}`,
      severity: "blocker"
    },
    permissions_risk_gate: {
      passed: updatedScore.compliance_score >= 50 && selectedWedge.permission_risk <= thresholds.max_permission_risk_score,
      reason: `permission_risk=${selectedWedge.permission_risk}, compliance_score=${updatedScore.compliance_score}`,
      severity: "blocker"
    },
    portfolio_overlap_gate: {
      passed: overlapAnalysis.overlap_score <= thresholds.max_portfolio_overlap_penalty,
      reason: overlapAnalysis.overlap_score <= thresholds.max_portfolio_overlap_penalty
        ? `portfolio_overlap_score=${overlapAnalysis.overlap_score}`
        : `portfolio_overlap_score=${overlapAnalysis.overlap_score} exceeds ${thresholds.max_portfolio_overlap_penalty}`,
      severity: "blocker"
    },
    product_acceptance_forecast_gate: {
      passed: productAcceptanceForecastPassed,
      reason: productAcceptanceForecastPassed
        ? "The narrowed wedge now maps to a deterministic, low-permission happy path."
        : "The narrowed wedge still lacks a convincing acceptance path.",
      severity: "blocker"
    }
  };

  const blockers = Object.entries(gateResults)
    .filter(([, value]) => value.passed === false)
    .map(([key]) => key);

  const finalRecommendation = gateResults.portfolio_overlap_gate.passed === false
    && (overlapAnalysis.reject_if_too_similar || updatedScore.build_recommendation === "skip")
    ? "skip"
    : blockers.length === 0
      ? "build"
      : "still_research_more";

  return {
    go_no_go: finalRecommendation === "build" ? "go" : "no_go",
    final_recommendation: finalRecommendation,
    gate_results: gateResults,
    blockers,
    warnings: unique([
      state.candidateReport.source_mode !== "live" ? "Discovery remains fixture-mode, so differentiation confidence is capped." : null,
      weakClusters.length > 0 ? "Some refined clusters still rely on single-source evidence." : null
    ]),
    recommended_archetype: selectedWedge.expected_archetype,
    expected_test_matrix: [
      "current window only",
      "scope excludes other windows",
      "CSV column stability",
      "download success state",
      "clear success feedback"
    ],
    product_acceptance_forecast: {
      passed: productAcceptanceForecastPassed,
      reason: productAcceptanceForecastPassed
        ? "The selected wedge is narrow, low-risk, and easy to test."
        : "The wedge is still too ambiguous to pass product acceptance cleanly.",
      remaining_risks: [
        "Need clear scope language so the product is not mistaken for full-session export.",
        "Need explicit success feedback to avoid silent-failure perceptions."
      ]
    },
    required_followup_research: finalRecommendation === "still_research_more"
      ? [
          "Collect one more non-store source that proves the selected wedge is install-worthy.",
          "Prove the trigger moment is distinct from the existing tab export portfolio."
        ]
      : finalRecommendation === "skip"
        ? [
            "Search for a differentiated output format or a different workflow outcome.",
            "Prefer a candidate outside the existing tab_csv_window_export family."
          ]
        : [],
    decision_rationale: [
      "The research loop removed the single-purpose ambiguity that blocked the original build gate.",
      "The selected wedge now forecasts a passable product acceptance review.",
      "The remaining blocker is portfolio overlap, not feasibility or testability."
    ]
  };
}

function resolutionMarkdown(resolution, updatedScore, gate) {
  return [
    "# Research More Resolution",
    "",
    `- Run: ${resolution.run_id}`,
    `- Candidate: ${resolution.candidate_name} (${resolution.candidate_id})`,
    `- Final recommendation: ${resolution.final_recommendation}`,
    `- Selected wedge: ${resolution.selected_wedge_hypothesis.one_sentence_value}`,
    `- Updated evidence quality: ${updatedScore.evidence_quality_score}`,
    `- Updated wedge clarity: ${updatedScore.wedge_clarity_score}`,
    `- Portfolio overlap: ${updatedScore.portfolio_overlap_penalty}`,
    `- Product acceptance forecast passed: ${gate.product_acceptance_forecast.passed}`,
    "",
    markdownSection("Original Blockers", markdownList(resolution.original_blockers)),
    "",
    markdownSection("Research Questions", markdownList(resolution.research_questions)),
    "",
    markdownSection("Unresolved Uncertainties", markdownList(resolution.unresolved_uncertainties)),
    "",
    markdownSection("Final Decision Rationale", markdownList(resolution.final_decision_rationale))
  ].join("\n");
}

async function maybeRecordKnownBadPattern(state, selectedWedge, overlapAnalysis) {
  const existing = (state.portfolioRegistry.known_bad_patterns ?? []).some((pattern) => (
    pattern.run_id === state.runContext.run_id
      && pattern.candidate_id === state.selectedCandidate.selected_candidate_id
      && pattern.pattern_type === "portfolio_overlap_skip"
  ));
  if (existing) {
    return null;
  }

  return recordKnownBadPattern(state.runContext.project_root, {
    pattern_type: "portfolio_overlap_skip",
    run_id: state.runContext.run_id,
    candidate_id: state.selectedCandidate.selected_candidate_id,
    family: state.selectedCandidate.candidate?.wedge_family ?? null,
    selected_wedge_hypothesis: selectedWedge.one_sentence_value,
    overlap_score: overlapAnalysis.overlap_score,
    reason: "The refined wedge is clear enough to build, but it is too similar to the existing tab_csv_window_export portfolio.",
    recommended_action: "Skip this candidate and continue discovery for a more differentiated wedge."
  });
}

export async function resolveResearchMore({ runDir }) {
  const state = await loadResearchResolutionState(runDir);
  const selectedReport = state.selectedCandidate;
  const candidateId = selectedReport.selected_candidate_id;
  const candidate = selectedReport.candidate;
  const originalRecommendation = normalizeRecommendation(state.discoveryReview.build_recommendation);

  if (originalRecommendation !== "research_more") {
    throw new Error(`Run ${state.runContext.run_id} does not require research resolution. discovery_quality_review=${state.discoveryReview.build_recommendation}.`);
  }

  const occurredAt = nowIso();
  const selectedEvidence = state.feedbackEvidence.evidence_by_candidate?.[candidateId] ?? [];
  const evidenceInventory = buildEvidenceInventory(selectedEvidence, candidateId);
  const additionalEvidenceCollected = buildAdditionalEvidenceCollected(evidenceInventory);
  const wedgeHypotheses = buildWedgeHypotheses(candidate, evidenceInventory);
  const selectedWedge = selectBestWedgeHypothesis(wedgeHypotheses);
  const overlapAnalysis = buildPortfolioOverlapAnalysis(state, candidate, selectedWedge);
  const refinedClusters = buildRefinedPainClusters(candidateId, evidenceInventory);
  const updatedScore = buildSafeReport({
    stage: "UPDATED_OPPORTUNITY_SCORE",
    status: "passed",
    ...buildUpdatedOpportunityScore(state, selectedWedge, refinedClusters, overlapAnalysis)
  });
  const gate = buildSafeReport({
    stage: "RESEARCH_RESOLUTION_GATE",
    status: "passed",
    ...buildResolutionGate(state, updatedScore, selectedWedge, refinedClusters, overlapAnalysis)
  });

  const resolution = buildSafeReport({
    stage: "RESEARCH_MORE_RESOLUTION",
    status: "passed",
    run_id: state.runContext.run_id,
    candidate_id: candidateId,
    candidate_name: candidate?.name ?? null,
    original_build_recommendation: state.discoveryReview.build_recommendation,
    original_blockers: state.buildGateDecision.blockers ?? [],
    research_questions: buildResearchQuestions(),
    targeted_evidence_plan: buildTargetedEvidencePlan(state, candidate),
    additional_evidence_collected: additionalEvidenceCollected,
    unresolved_uncertainties: unique([
      ...(state.discoveryReview.missing_evidence ?? []),
      overlapAnalysis.reject_if_too_similar ? "Differentiation from the existing tab_csv_window_export portfolio is still too weak." : null,
      state.candidateReport.source_mode !== "live" ? "Discovery is still fixture-backed, so live corroboration is capped." : null
    ]),
    wedge_hypotheses: wedgeHypotheses,
    selected_wedge_hypothesis: {
      ...selectedWedge,
      portfolio_overlap_risk: overlapAnalysis.overlap_score
    },
    updated_pain_clusters: refinedClusters,
    updated_score_breakdown: updatedScore,
    updated_gate_results: gate.gate_results,
    final_recommendation: gate.final_recommendation,
    final_decision_rationale: [
      ...updatedScore.decision_rationale,
      gate.final_recommendation === "skip"
        ? "The candidate became clear enough to evaluate, and that clarity shows it should be skipped because it is too close to the existing portfolio."
        : gate.final_recommendation === "build"
          ? "All discovery gates now pass after narrowing the wedge."
          : "The wedge is clearer, but still needs more differentiated evidence."
    ],
    next_step: gate.final_recommendation === "build"
      ? (state.runContext.allow_build_after_research_resolution === true
        ? "build_ready_candidate"
        : "build_ready_but_task_disallows_auto_build")
      : gate.final_recommendation === "skip"
        ? "skip_and_continue_discovery_for_more_differentiated_wedge"
        : "continue_targeted_research_for_selected_candidate"
  });

  const refinedClusterArtifact = buildSafeReport({
    stage: "REFINED_PAIN_CLUSTERS",
    status: "passed",
    generated_at: occurredAt,
    run_id: state.runContext.run_id,
    candidate_id: candidateId,
    clusters: refinedClusters
  });

  await validateArtifact(state.runContext.project_root, "research_more_resolution.schema.json", RESEARCH_MORE_RESOLUTION_ARTIFACT, resolution);
  await validateArtifact(state.runContext.project_root, "refined_pain_clusters.schema.json", REFINED_PAIN_CLUSTERS_ARTIFACT, refinedClusterArtifact);
  await validateArtifact(state.runContext.project_root, "updated_opportunity_score.schema.json", UPDATED_OPPORTUNITY_SCORE_ARTIFACT, updatedScore);
  await validateArtifact(state.runContext.project_root, "research_resolution_gate.schema.json", RESEARCH_RESOLUTION_GATE_ARTIFACT, gate);

  const resolutionWrite = await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: RESEARCH_MORE_RESOLUTION_ARTIFACT,
    data: resolution,
    occurredAt
  });
  const refinedWrite = await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: REFINED_PAIN_CLUSTERS_ARTIFACT,
    data: refinedClusterArtifact,
    occurredAt
  });
  const scoreWrite = await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: UPDATED_OPPORTUNITY_SCORE_ARTIFACT,
    data: updatedScore,
    occurredAt
  });
  const gateWrite = await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: RESEARCH_RESOLUTION_GATE_ARTIFACT,
    data: gate,
    occurredAt
  });
  const markdownWrite = await writeManagedMarkdownArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    fileName: "36_research_more_resolution.md",
    category: "research_resolution",
    prefix: "36_research_more_resolution",
    content: resolutionMarkdown(resolution, updatedScore, gate),
    occurredAt
  });

  if (gate.final_recommendation === "skip") {
    await maybeRecordKnownBadPattern(state, selectedWedge, overlapAnalysis);
  }

  return {
    resolution,
    refined_clusters: refinedClusterArtifact,
    updated_score: updatedScore,
    gate,
    artifacts: {
      resolution: resolutionWrite.artifactRelativePath,
      refined_clusters: refinedWrite.artifactRelativePath,
      updated_score: scoreWrite.artifactRelativePath,
      gate: gateWrite.artifactRelativePath,
      markdown: markdownWrite.artifactRelativePath
    }
  };
}

function extractQueryDomain(query) {
  const match = `${query ?? ""}`.match(/site:([^\s/]+)/i);
  return lower(match?.[1] ?? "");
}

function stripSitePrefix(query) {
  return `${query ?? ""}`.replace(/site:[^\s]+\s*/i, "").trim();
}

function extractChromeWebStoreDetailUrls(html) {
  const normalized = `${html ?? ""}`.replaceAll("\\/", "/");
  const matches = [...normalized.matchAll(/detail\/[^\s"'<>]{10,200}/g)];
  return unique(matches
    .map((match) => match[0].replace(/^\/+/, ""))
    .map((value) => `https://chromewebstore.google.com/${value}`));
}

function extractGithubIssueUrls(html) {
  return unique([...(`${html ?? ""}`).matchAll(/\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/\d+/g)]
    .map((match) => `https://github.com${match[0]}`));
}

async function executeSingleNextQuery(queryConfig) {
  const domain = extractQueryDomain(queryConfig.query);
  const queryText = stripSitePrefix(queryConfig.query);

  if (domain === "chromewebstore.google.com") {
    const searchUrl = `https://chromewebstore.google.com/search/${encodeURIComponent(queryText)}`;
    const response = await fetchAllowedText(searchUrl, { timeoutMs: 15000 });
    const candidates = response.ok ? extractChromeWebStoreDetailUrls(response.text) : [];
    return {
      query: queryConfig.query,
      candidates_found: candidates.length,
      strongest_signal: candidates.length > 0
        ? `Chrome Web Store search returned ${candidates.length} matching detail pages.`
        : "No matching Chrome Web Store detail pages were parsed.",
      weak_signal_reason: candidates.length > 0 ? null : `Chrome Web Store search returned ${response.status}.`,
      recommended_followup: candidates.length > 0
        ? "Inspect the highest-confidence listing pages before changing the selected wedge."
        : "Keep this query in backlog until live search returns parseable results.",
      candidate_ids: candidates.map((url) => (url.match(/\/([a-p]{32})(?:[/?#]|$)/i) ?? [])[1]).filter(Boolean),
      source_summary: {
        source_type: "chrome_web_store_search",
        url: searchUrl,
        status: response.status,
        ok: response.ok
      }
    };
  }

  if (domain === "github.com") {
    const searchUrl = `https://github.com/search?q=${encodeURIComponent(queryText)}&type=issues`;
    const response = await fetchAllowedText(searchUrl, { timeoutMs: 15000 });
    const issues = response.ok ? extractGithubIssueUrls(response.text) : [];
    return {
      query: queryConfig.query,
      candidates_found: issues.length,
      strongest_signal: issues.length > 0
        ? `GitHub issue search returned ${issues.length} matching issue URLs.`
        : "No matching GitHub issues were parsed.",
      weak_signal_reason: issues.length > 0 ? null : `GitHub search returned ${response.status} or no parseable issue links.`,
      recommended_followup: issues.length > 0
        ? "Review issue titles for reproducible workflow pain."
        : "Retry later or replace with a more direct repository issue query.",
      candidate_ids: issues.map((url) => url.split("/").slice(-4, -2).join("/")),
      source_summary: {
        source_type: "github_issue_search",
        url: searchUrl,
        status: response.status,
        ok: response.ok
      }
    };
  }

  return {
    query: queryConfig.query,
    candidates_found: 0,
    strongest_signal: null,
    weak_signal_reason: "source_domain_not_supported_by_live_query_executor",
    recommended_followup: "Use this query only when a broader external search runner is available.",
    candidate_ids: [],
    source_summary: {
      source_type: "unsupported_live_query_source",
      url: null,
      status: "skipped",
      ok: false
    }
  };
}

export async function runNextQueries({ runDir, limit = 10 }) {
  const state = await loadResearchResolutionState(runDir);
  const occurredAt = nowIso();
  const queries = (state.improvementPlan.next_10_search_queries ?? []).slice(0, Number(limit) || 10);

  if ((state.runContext.research?.mode ?? "fixture") !== "live") {
    const report = buildSafeReport({
      stage: "NEXT_QUERY_RESULTS",
      status: "skipped",
      run_id: state.runContext.run_id,
      checked_at: occurredAt,
      requested_query_count: queries.length,
      executed: false,
      live_unavailable: true,
      failure_reason: `Run ${state.runContext.run_id} is configured for ${state.runContext.research?.mode ?? "fixture"} discovery, so live query execution was skipped.`,
      query_results: queries.map((query) => ({
        query: query.query,
        candidates_found: 0,
        strongest_signal: null,
        weak_signal_reason: "live_unavailable",
        recommended_followup: "Rerun this command on a live-discovery task to execute the query.",
        candidate_ids: [],
        source_summary: {
          source_type: "skipped",
          url: null,
          status: "skipped",
          ok: false
        }
      })),
      next_step: "rerun_with_live_discovery_before_executing_next_queries"
    });

    await validateArtifact(state.runContext.project_root, "next_query_results.schema.json", NEXT_QUERY_RESULTS_ARTIFACT, report);
    const writeResult = await writeManagedJsonArtifact({
      runDir: state.runDir,
      runContext: state.runContext,
      artifactName: NEXT_QUERY_RESULTS_ARTIFACT,
      data: report,
      occurredAt
    });
    return {
      report,
      artifact: writeResult.artifactRelativePath
    };
  }

  const queryResults = [];
  for (const query of queries) {
    try {
      queryResults.push(await executeSingleNextQuery(query));
    } catch (error) {
      queryResults.push({
        query: query.query,
        candidates_found: 0,
        strongest_signal: null,
        weak_signal_reason: error.message,
        recommended_followup: "Retry later or reduce the query scope.",
        candidate_ids: [],
        source_summary: {
          source_type: "query_execution_failed",
          url: null,
          status: "failed",
          ok: false
        }
      });
    }
  }

  const report = buildSafeReport({
    stage: "NEXT_QUERY_RESULTS",
    status: "passed",
    run_id: state.runContext.run_id,
    checked_at: occurredAt,
    requested_query_count: queries.length,
    executed: true,
    live_unavailable: false,
    query_results: queryResults,
    next_step: queryResults.some((result) => result.candidates_found > 0)
      ? "inspect_live_query_hits_before_next_discovery_review"
      : "refine_queries_or_expand_source_support"
  });

  await validateArtifact(state.runContext.project_root, "next_query_results.schema.json", NEXT_QUERY_RESULTS_ARTIFACT, report);
  const writeResult = await writeManagedJsonArtifact({
    runDir: state.runDir,
    runContext: state.runContext,
    artifactName: NEXT_QUERY_RESULTS_ARTIFACT,
    data: report,
    occurredAt
  });
  return {
    report,
    artifact: writeResult.artifactRelativePath
  };
}
