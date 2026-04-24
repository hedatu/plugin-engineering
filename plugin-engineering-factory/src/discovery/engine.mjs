import { computeRegistryCandidateAdjustments } from "../portfolio/registry.mjs";
import { nowIso } from "../utils/io.mjs";

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function average(values) {
  const filtered = (values ?? []).filter((value) => Number.isFinite(value));
  if (filtered.length === 0) {
    return 0;
  }
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function sum(values) {
  return (values ?? []).filter((value) => Number.isFinite(value)).reduce((total, value) => total + value, 0);
}

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function daysSince(timestamp) {
  const parsed = Date.parse(timestamp ?? "");
  if (!Number.isFinite(parsed)) {
    return 999;
  }
  return Math.max(0, (Date.now() - parsed) / (1000 * 60 * 60 * 24));
}

function stringify(value) {
  return `${value ?? ""}`.trim();
}

function lower(value) {
  return stringify(value).toLowerCase();
}

function bucketizeNumber(value, buckets) {
  for (const bucket of buckets) {
    if (value <= bucket.max) {
      return bucket.label;
    }
  }
  return buckets.at(-1)?.label ?? "unknown";
}

function distribution(values, bucketFn) {
  const counts = {};
  for (const value of values ?? []) {
    const bucket = bucketFn(value);
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return counts;
}

const SOURCE_TYPE_ALIASES = {
  support: "support_site",
  support_page: "support_site",
  support_site: "support_site",
  github: "github_issue",
  github_issue: "github_issue",
  store: "chrome_web_store_review",
  chrome_web_store_review: "chrome_web_store_review",
  chrome_web_store_listing: "chrome_web_store_listing",
  faq: "public_doc",
  docs: "public_doc",
  public_doc: "public_doc",
  reddit: "forum_post",
  forum: "forum_post",
  forum_post: "forum_post"
};

const SOURCE_RELIABILITY = {
  github_issue: 0.92,
  support_site: 0.88,
  chrome_web_store_review: 0.76,
  public_doc: 0.68,
  forum_post: 0.54,
  chrome_web_store_listing: 0.42
};

const PAIN_SIGNAL_LABELS = {
  field_coverage_gap: "field coverage gap",
  workflow_friction: "workflow friction",
  privacy: "privacy concern",
  reliability_break: "reliability break",
  overwrite_risk: "overwrite behavior risk",
  capability_gap: "capability gap",
  generic_bug: "generic bug report"
};

const PAIN_SIGNAL_FIXABILITY = {
  field_coverage_gap: 88,
  workflow_friction: 84,
  overwrite_risk: 83,
  capability_gap: 78,
  privacy: 72,
  reliability_break: 66,
  generic_bug: 42
};

const PAIN_SIGNAL_TESTABILITY = {
  field_coverage_gap: 90,
  workflow_friction: 82,
  overwrite_risk: 88,
  capability_gap: 74,
  privacy: 65,
  reliability_break: 62,
  generic_bug: 45
};

const PAIN_SIGNAL_SINGLE_PURPOSE = {
  field_coverage_gap: 88,
  workflow_friction: 82,
  overwrite_risk: 86,
  capability_gap: 74,
  privacy: 72,
  reliability_break: 66,
  generic_bug: 38
};

const PAIN_SIGNAL_SEVERITY = {
  privacy: 5,
  reliability_break: 4,
  overwrite_risk: 4,
  field_coverage_gap: 4,
  workflow_friction: 3,
  capability_gap: 3,
  generic_bug: 2
};

const EXPECTED_TEST_MATRIX = {
  single_profile_form_fill: [
    "empty form",
    "partially filled form",
    "readonly field",
    "select field",
    "no matching fields",
    "overwrite default=false",
    "popup feedback display"
  ],
  tab_csv_window_export: [
    "current window only",
    "download success state",
    "CSV column stability",
    "pinned tab filtering",
    "empty window handling"
  ],
  gmail_snippet: [
    "compose insert",
    "keyboard-first selection",
    "empty compose guard",
    "snippet search",
    "permission boundary"
  ]
};

const PRODUCT_ACCEPTANCE_FORECAST_RISKS = {
  single_profile_form_fill: [
    "Field coverage may still be too narrow if evidence only mentions generic missed fields.",
    "User feedback can feel weak if overwrite behavior and no-match messaging are not testable."
  ],
  tab_csv_window_export: [
    "Value proposition weakens if export scope is not obviously current-window only.",
    "Permission trust can fail if the wedge implies broader tab access than needed."
  ],
  gmail_snippet: [
    "Permission trust is fragile if the wedge implies full mailbox access.",
    "Acceptance risk rises if insertion flow depends on heavy UI rather than quick compose actions."
  ]
};

export function normalizeDiscoveryThresholds(rawThresholds = {}) {
  return {
    min_users: rawThresholds.min_users ?? 10000,
    min_reviews: rawThresholds.min_reviews ?? 100,
    rating_min: rawThresholds.rating_min ?? 3.8,
    rating_max: rawThresholds.rating_max ?? 4.6,
    min_negative_clusters: rawThresholds.min_negative_clusters ?? 3,
    min_overall_score: rawThresholds.min_overall_score ?? 70,
    min_evidence_quality_score: rawThresholds.min_evidence_quality_score ?? 60,
    min_testability_score: rawThresholds.min_testability_score ?? 60,
    min_single_purpose_score: rawThresholds.min_single_purpose_score ?? 60,
    min_confidence_score: rawThresholds.min_confidence_score ?? 55,
    max_permission_risk_score: rawThresholds.max_permission_risk_score ?? 55,
    max_portfolio_overlap_penalty: rawThresholds.max_portfolio_overlap_penalty ?? 45,
    max_shortlist_portfolio_overlap: rawThresholds.max_shortlist_portfolio_overlap ?? 55,
    max_candidate_permission_risk: rawThresholds.max_candidate_permission_risk ?? 75,
    min_candidate_testability_hint: rawThresholds.min_candidate_testability_hint ?? 50,
    min_candidate_single_purpose_fit: rawThresholds.min_candidate_single_purpose_fit ?? 45
  };
}

function normalizeSourceType(value) {
  const normalized = SOURCE_TYPE_ALIASES[lower(value)];
  return normalized ?? "public_doc";
}

function recencyWeightFromTimestamp(timestamp) {
  const days = daysSince(timestamp);
  if (days <= 30) return 1;
  if (days <= 90) return 0.88;
  if (days <= 180) return 0.72;
  if (days <= 365) return 0.56;
  return 0.4;
}

function sourceReliabilityWeight(sourceType) {
  return SOURCE_RELIABILITY[sourceType] ?? 0.55;
}

function inferPainSignalType(rawItem) {
  const issueType = lower(rawItem.issue_type);
  const topic = `${lower(rawItem.topic)} ${lower(rawItem.quote)} ${lower(rawItem.text_excerpt)}`;
  if (issueType === "privacy_concern" || /privacy|permission|access|sync|server|local-only|local only/.test(topic)) {
    return "privacy";
  }
  if (/readonly|disabled|overwrite/.test(topic)) {
    return "overwrite_risk";
  }
  if (/skip|miss|field|phone|company|select|textarea|dropdown/.test(topic)) {
    return "field_coverage_gap";
  }
  if (issueType === "stability" || /error|fail|broken|crash|nothing happens|doesn'?t work|does not work/.test(topic)) {
    return "reliability_break";
  }
  if (issueType === "ux_friction" || /dashboard|too many|manual|copy-paste|copy paste|one click|quick|shortcut/.test(topic)) {
    return "workflow_friction";
  }
  if (issueType === "missing_feature" || /missing|need|want|should support/.test(topic)) {
    return "capability_gap";
  }
  return "generic_bug";
}

function topicSpecificityScore(text) {
  const normalized = lower(text);
  if (!normalized) {
    return 20;
  }
  let score = 45;
  if (/select|textarea|readonly|disabled|current window|csv|compose|snippet|visible fields/.test(normalized)) score += 22;
  if (/phone|company|email|name|field|template|keyboard|overwrite|hidden/.test(normalized)) score += 14;
  if (/buggy|bad|doesn'?t work|does not work|broken/.test(normalized)) score -= 28;
  if (normalized.length >= 28) score += 10;
  if (normalized.length >= 60) score += 6;
  return clamp(score);
}

function inferFreshnessDays(updated) {
  const days = daysSince(updated);
  return Number.isFinite(days) ? days : 999;
}

function freshnessScoreFromDays(days) {
  if (days <= 30) return 100;
  if (days <= 90) return 85;
  if (days <= 180) return 68;
  if (days <= 365) return 48;
  return 25;
}

function freshnessBucketFromDays(days) {
  if (days <= 30) return "last_30_days";
  if (days <= 90) return "last_90_days";
  if (days <= 180) return "last_180_days";
  if (days <= 365) return "last_365_days";
  return "older_than_365_days";
}

function inferPermissionRiskScore(candidate) {
  if (Number.isFinite(candidate.permission_risk_score)) {
    return clamp(candidate.permission_risk_score);
  }

  let score = 38;
  const family = lower(candidate.wedge_family);
  const text = `${lower(candidate.name)} ${lower((candidate.signals ?? []).join(" "))} ${lower(candidate.live_summary)}`;

  if (family === "tab_csv_window_export") score = 26;
  if (family === "single_profile_form_fill") score = 42;
  if (family === "gmail_snippet") score = 52;
  if (family === "unsupported_research_only") score = 60;

  if (/mail|gmail|inbox|message/.test(text)) score += 8;
  if (/sync|cloud|account|login|server|upload/.test(text)) score += 12;
  if (/document|translate|security|vpn|crypto/.test(text)) score += 18;

  return clamp(score);
}

function inferSinglePurposeFitScore(candidate) {
  if (Number.isFinite(candidate.single_purpose_fit_score)) {
    return clamp(candidate.single_purpose_fit_score);
  }

  const family = lower(candidate.wedge_family);
  let score = family === "unsupported_research_only" ? 40 : 74;
  const signalCount = (candidate.signals ?? []).length;
  if (signalCount <= 4) score += 8;
  if (signalCount >= 7) score -= 10;
  if (/helper|suite|platform|dashboard|all-in-one|all in one/.test(lower(candidate.name))) score -= 14;
  if (/one|quick|current window|single|mini|lite/.test(lower(candidate.name))) score += 8;
  return clamp(score);
}

function inferTestabilityHint(candidate) {
  if (Number.isFinite(candidate.testability_score)) {
    return clamp(candidate.testability_score);
  }

  let score = 45;
  const family = lower(candidate.wedge_family);
  if (family === "tab_csv_window_export") score = 90;
  if (family === "single_profile_form_fill") score = 82;
  if (family === "gmail_snippet") score = 72;
  if (family === "unsupported_research_only") score = 42;
  if (!candidate.support_url && !candidate.website_url) score -= 8;
  if (/ai|translate|security|vpn/.test(lower(candidate.name))) score -= 12;
  return clamp(score);
}

function inferMaintenanceRiskScore(candidate) {
  if (Number.isFinite(candidate.maintenance_risk_score)) {
    return clamp(candidate.maintenance_risk_score);
  }

  const family = lower(candidate.wedge_family);
  let score = 34;
  if (family === "single_profile_form_fill") score = 48;
  if (family === "gmail_snippet") score = 44;
  if (family === "unsupported_research_only") score = 58;
  if (/support|sync|cloud|server|translate/.test(lower(candidate.name))) score += 8;
  return clamp(score);
}

function inferNegativeFeedbackDensityScore(candidate) {
  if (Number.isFinite(candidate.negative_feedback_density_score)) {
    return clamp(candidate.negative_feedback_density_score);
  }

  const reviews = Math.max(1, Number(candidate.reviews ?? 0));
  const rating = Number(candidate.rating ?? 4.2);
  const score = ((4.7 - rating) * 30) + Math.log10(reviews + 10) * 18;
  return clamp(score);
}

function normalizeCandidate(candidate, { sourceMode, registryAdjustments }) {
  const freshnessDays = inferFreshnessDays(candidate.updated);
  const freshnessScore = freshnessScoreFromDays(freshnessDays);
  const permissionRiskScore = inferPermissionRiskScore(candidate);
  const singlePurposeFitScore = inferSinglePurposeFitScore(candidate);
  const testabilityHint = inferTestabilityHint(candidate);
  const maintenanceRiskScore = inferMaintenanceRiskScore(candidate);
  const negativeFeedbackDensityScore = inferNegativeFeedbackDensityScore(candidate);
  const effectivePortfolioOverlap = clamp(
    Number(candidate.portfolio_overlap_score ?? 0)
    + Number(registryAdjustments.overlap_penalty ?? 0)
    + Number(registryAdjustments.blacklist_penalty ?? 0)
  );

  return {
    ...candidate,
    evidence_sources: unique([candidate.store_url, candidate.support_url, candidate.website_url]),
    discovered_at: nowIso(),
    source_mode: candidate.source_mode ?? sourceMode,
    has_support_site: Boolean(candidate.support_url || candidate.website_url),
    freshness_days: round(freshnessDays),
    freshness_score: freshnessScore,
    freshness_bucket: freshnessBucketFromDays(freshnessDays),
    permission_risk_score: permissionRiskScore,
    single_purpose_fit_score: singlePurposeFitScore,
    testability_hint: testabilityHint,
    maintenance_risk_score: maintenanceRiskScore,
    negative_feedback_density_score: negativeFeedbackDensityScore,
    registry_overlap_penalty: registryAdjustments.overlap_penalty,
    registry_blacklist_penalty: registryAdjustments.blacklist_penalty,
    archetype_prior_multiplier: registryAdjustments.archetype_prior_multiplier,
    effective_portfolio_overlap_score: effectivePortfolioOverlap,
    rating_bucket: bucketizeNumber(Number(candidate.rating ?? 0), [
      { label: "lt_3_8", max: 3.79 },
      { label: "3_8_to_4_0", max: 4.0 },
      { label: "4_0_to_4_3", max: 4.3 },
      { label: "4_3_to_4_6", max: 4.6 },
      { label: "gt_4_6", max: Number.POSITIVE_INFINITY }
    ]),
    user_count_bucket: bucketizeNumber(Number(candidate.users ?? 0), [
      { label: "lt_10k", max: 9999 },
      { label: "10k_to_25k", max: 25000 },
      { label: "25k_to_50k", max: 50000 },
      { label: "50k_to_100k", max: 100000 },
      { label: "gt_100k", max: Number.POSITIVE_INFINITY }
    ]),
    review_count_bucket: bucketizeNumber(Number(candidate.reviews ?? 0), [
      { label: "lt_100", max: 99 },
      { label: "100_to_250", max: 250 },
      { label: "250_to_500", max: 500 },
      { label: "500_to_1000", max: 1000 },
      { label: "gt_1000", max: Number.POSITIVE_INFINITY }
    ])
  };
}

function rejectionRecord(candidate, stage, reasons) {
  return {
    candidate_id: candidate.candidate_id,
    name: candidate.name,
    rejected_at_stage: stage,
    reasons
  };
}

function shortlistConfidenceScore({ shortlisted, rawCandidates }) {
  if ((rawCandidates ?? []).length === 0) {
    return 0;
  }
  const coverageScore = clamp(((shortlisted?.length ?? 0) / Math.max(1, rawCandidates.length)) * 100);
  const familyDiversity = clamp(unique((shortlisted ?? []).map((candidate) => candidate.wedge_family)).length * 28);
  const freshnessScore = average((shortlisted ?? []).map((candidate) => candidate.freshness_score));
  const supportCoverageScore = average((shortlisted ?? []).map((candidate) => candidate.has_support_site ? 100 : 0));
  return round((coverageScore * 0.2) + (familyDiversity * 0.2) + (freshnessScore * 0.3) + (supportCoverageScore * 0.3));
}

export function buildCandidateDiscoveryArtifacts({ rawCandidates, runContext, portfolioRegistry, sourceModeOverride = null }) {
  const thresholds = normalizeDiscoveryThresholds(runContext.thresholds);
  const sourceMode = sourceModeOverride ?? (runContext.research?.mode === "live"
    ? "live"
    : "fixture");

  const basicPassed = [];
  const policyPassed = [];
  const shortlisted = [];
  const discarded = [];
  const rejectedCandidatesSample = [];

  for (const rawCandidate of rawCandidates ?? []) {
    const registryAdjustments = computeRegistryCandidateAdjustments(rawCandidate, portfolioRegistry);
    const candidate = normalizeCandidate(rawCandidate, { sourceMode, registryAdjustments });
    const basicReasons = [];
    if (!runContext.allowed_categories.includes(candidate.category)) basicReasons.push("category_not_allowed");
    if (runContext.blocked_categories.includes(candidate.category)) basicReasons.push("category_blocked");
    if (Number(candidate.users ?? 0) < thresholds.min_users) basicReasons.push("users_below_threshold");
    if (Number(candidate.reviews ?? 0) < thresholds.min_reviews) basicReasons.push("reviews_below_threshold");
    if (Number(candidate.rating ?? 0) < thresholds.rating_min || Number(candidate.rating ?? 0) > thresholds.rating_max) basicReasons.push("rating_out_of_range");
    if (!runContext.builder.allow_families.includes(candidate.wedge_family)) basicReasons.push("builder_family_not_allowed");
    if ((runContext.portfolio_registry?.blocked_candidate_ids ?? []).includes(candidate.candidate_id)) basicReasons.push("portfolio_blocked");

    if (basicReasons.length > 0) {
      discarded.push(rejectionRecord(candidate, "basic_filters", basicReasons));
      continue;
    }

    basicPassed.push(candidate);

    const policyReasons = [];
    if (!candidate.has_support_site) policyReasons.push("missing_support_site");
    if (candidate.permission_risk_score > thresholds.max_candidate_permission_risk) policyReasons.push("high_permission_risk");
    if (candidate.single_purpose_fit_score < thresholds.min_candidate_single_purpose_fit) policyReasons.push("weak_single_purpose_fit");
    if (candidate.testability_hint < thresholds.min_candidate_testability_hint) policyReasons.push("low_testability");

    if (policyReasons.length > 0) {
      discarded.push(rejectionRecord(candidate, "policy_filters", policyReasons));
      continue;
    }

    policyPassed.push(candidate);

    const portfolioReasons = [];
    if (candidate.effective_portfolio_overlap_score > thresholds.max_shortlist_portfolio_overlap) {
      portfolioReasons.push("portfolio_overlap_too_high");
    }

    if (portfolioReasons.length > 0) {
      discarded.push(rejectionRecord(candidate, "portfolio_filters", portfolioReasons));
      continue;
    }

    shortlisted.push(candidate);
  }

  rejectedCandidatesSample.push(...discarded.slice(0, 6));

  const candidateReport = {
    stage: "DISCOVER_CANDIDATES",
    status: "passed",
    generated_at: nowIso(),
    total_candidates_seen: (rawCandidates ?? []).length,
    total_fixture_candidates: (rawCandidates ?? []).length,
    source_mode: sourceMode,
    candidate_count: shortlisted.length,
    note: shortlisted.length > 0 ? "ok" : "no_candidates_survived_shortlist_filters",
    failure_reason: shortlisted.length > 0 ? null : "no_candidates_survived_shortlist_filters",
    discarded,
    candidates: shortlisted
  };

  const shortlistQuality = {
    stage: "CANDIDATE_SHORTLIST_QUALITY",
    status: "passed",
    generated_at: nowIso(),
    run_id: runContext.run_id,
    total_candidates_seen: (rawCandidates ?? []).length,
    candidates_after_basic_filters: basicPassed.length,
    candidates_after_policy_filters: policyPassed.length,
    candidates_after_portfolio_overlap_filters: shortlisted.length,
    category_distribution: distribution(rawCandidates, (candidate) => candidate.category ?? "unknown"),
    rating_distribution: distribution(rawCandidates, (candidate) => normalizeCandidate(candidate, {
      sourceMode,
      registryAdjustments: computeRegistryCandidateAdjustments(candidate, portfolioRegistry)
    }).rating_bucket),
    user_count_distribution: distribution(rawCandidates, (candidate) => normalizeCandidate(candidate, {
      sourceMode,
      registryAdjustments: computeRegistryCandidateAdjustments(candidate, portfolioRegistry)
    }).user_count_bucket),
    review_count_distribution: distribution(rawCandidates, (candidate) => normalizeCandidate(candidate, {
      sourceMode,
      registryAdjustments: computeRegistryCandidateAdjustments(candidate, portfolioRegistry)
    }).review_count_bucket),
    freshness_distribution: distribution(rawCandidates, (candidate) => normalizeCandidate(candidate, {
      sourceMode,
      registryAdjustments: computeRegistryCandidateAdjustments(candidate, portfolioRegistry)
    }).freshness_bucket),
    rejected_candidates_sample: rejectedCandidatesSample,
    shortlist_confidence: shortlistConfidenceScore({ shortlisted, rawCandidates }),
    failure_reason: shortlisted.length > 0 ? null : "no_candidates_survived_shortlist_filters"
  };

  return { candidateReport, shortlistQuality, thresholds };
}

function normalizeEvidenceItem(rawItem, candidate, sourceMode) {
  const sourceType = normalizeSourceType(rawItem.source_type);
  const capturedAt = rawItem.captured_at ?? nowIso();
  const reliabilityWeight = Number.isFinite(rawItem.reliability_weight)
    ? clamp(rawItem.reliability_weight, 0, 1)
    : sourceReliabilityWeight(sourceType);
  const recencyWeight = Number.isFinite(rawItem.recency_weight)
    ? clamp(rawItem.recency_weight, 0, 1)
    : recencyWeightFromTimestamp(capturedAt);
  const textExcerpt = stringify(rawItem.text_excerpt || rawItem.quote || rawItem.topic).slice(0, 280);
  const painSignalType = rawItem.pain_signal_type ?? inferPainSignalType(rawItem);
  const evidenceWeight = round(clamp(reliabilityWeight * recencyWeight, 0, 1), 4);

  return {
    ...rawItem,
    candidate_id: candidate.candidate_id,
    source_type: sourceType,
    source_url: rawItem.source_url ?? rawItem.url ?? "",
    url: rawItem.url ?? rawItem.source_url ?? "",
    captured_at: capturedAt,
    text_excerpt: textExcerpt,
    quote: rawItem.quote ?? textExcerpt,
    topic: rawItem.topic ?? textExcerpt.slice(0, 120),
    reliability_weight: reliabilityWeight,
    recency_weight: recencyWeight,
    pain_signal_type: painSignalType,
    issue_type: rawItem.issue_type ?? painSignalType,
    evidence_weight: evidenceWeight,
    source_quality: evidenceWeight >= 0.75 ? "high" : evidenceWeight >= 0.55 ? "medium" : "low",
    evidence_mode: sourceMode
  };
}

export function buildEvidenceReport({ candidateReport, liveEvidenceByCandidate = null, fixtureEvidenceByCandidate = {}, sourceMode }) {
  const evidenceByCandidate = {};

  for (const candidate of candidateReport.candidates ?? []) {
    const rawEvidence = liveEvidenceByCandidate?.[candidate.candidate_id] ?? fixtureEvidenceByCandidate[candidate.candidate_id] ?? [];
    evidenceByCandidate[candidate.candidate_id] = rawEvidence.map((item) => normalizeEvidenceItem(item, candidate, sourceMode));
  }

  return {
    stage: "ENRICH_FEEDBACK",
    status: "passed",
    generated_at: nowIso(),
    source_mode: sourceMode,
    candidate_count: (candidateReport.candidates ?? []).length,
    total_evidence_count: sum(Object.values(evidenceByCandidate).map((items) => items.length)),
    evidence_by_candidate: evidenceByCandidate
  };
}

function representativeEvidence(items) {
  return items.slice(0, 2).map((item) => ({
    source_type: item.source_type,
    source_url: item.source_url,
    captured_at: item.captured_at,
    text_excerpt: item.text_excerpt
  }));
}

function weakClusterReason({ specificityScore, repeatedPainCount, sourceDiversityScore, sourceTypes }) {
  if (specificityScore < 55) return "pain description is too generic to map directly into a single-purpose wedge";
  if (repeatedPainCount < 2) return "cluster lacks repeated independent evidence";
  if (sourceDiversityScore < 35) return "cluster is supported by only one source family";
  if (sourceTypes.length === 1 && sourceTypes[0] === "chrome_web_store_review") return "cluster only has store review evidence";
  return null;
}

export function buildClusterReport({ candidateReport, evidenceReport }) {
  const clustersByCandidate = {};

  for (const candidate of candidateReport.candidates ?? []) {
    const evidence = evidenceReport.evidence_by_candidate[candidate.candidate_id] ?? [];
    const grouped = new Map();
    for (const item of evidence) {
      const clusterKey = item.pain_signal_type ?? "generic_bug";
      if (!grouped.has(clusterKey)) {
        grouped.set(clusterKey, []);
      }
      grouped.get(clusterKey).push(item);
    }

    const clusters = [...grouped.entries()].map(([clusterKey, items], index) => {
      const sourceTypes = unique(items.map((item) => item.source_type));
      const specificityScore = round(average(items.map((item) => topicSpecificityScore(item.topic || item.text_excerpt))));
      const repeatedPainCount = items.length;
      const sourceDiversityScore = round(clamp((sourceTypes.length / 4) * 100));
      const negativeSentimentStrength = round(average(items.map((item) => lower(item.sentiment) === "negative" ? 95 : 55)));
      const fixabilityScore = PAIN_SIGNAL_FIXABILITY[clusterKey] ?? 55;
      const singlePurposeFitScore = round(clamp((candidate.single_purpose_fit_score * 0.55) + ((PAIN_SIGNAL_SINGLE_PURPOSE[clusterKey] ?? 50) * 0.45)));
      const testabilityScore = round(clamp((candidate.testability_hint * 0.45) + ((PAIN_SIGNAL_TESTABILITY[clusterKey] ?? 50) * 0.55)));
      const weightedEvidenceScore = round(sum(items.map((item) => item.evidence_weight)));
      const weakReason = weakClusterReason({
        specificityScore,
        repeatedPainCount,
        sourceDiversityScore,
        sourceTypes
      });

      return {
        cluster_id: `${candidate.candidate_id}-${clusterKey}-${index + 1}`,
        title: PAIN_SIGNAL_LABELS[clusterKey] ?? clusterKey.replaceAll("_", " "),
        summary: unique(items.map((item) => item.topic)).join("; "),
        evidence_count: repeatedPainCount,
        weighted_evidence_score: weightedEvidenceScore,
        sources: sourceTypes,
        severity: PAIN_SIGNAL_SEVERITY[clusterKey] ?? 3,
        frequency: clamp(Math.ceil(weightedEvidenceScore * 2), 1, 5),
        fixability: clamp(Math.round(fixabilityScore / 20), 1, 5),
        fixability_score: fixabilityScore,
        cluster_specificity_score: specificityScore,
        repeated_pain_count: repeatedPainCount,
        source_diversity_score: sourceDiversityScore,
        negative_sentiment_strength: negativeSentimentStrength,
        single_purpose_fit_score: singlePurposeFitScore,
        testability_score: testabilityScore,
        representative_evidence: representativeEvidence(items),
        weak_cluster_reason: weakReason,
        example_quotes: items.slice(0, 2).map((item) => item.quote),
        suggested_wedges: [candidate.wedge_family]
      };
    }).sort((left, right) => (
      (right.repeated_pain_count - left.repeated_pain_count)
      || (right.cluster_specificity_score - left.cluster_specificity_score)
      || (right.weighted_evidence_score - left.weighted_evidence_score)
    ));

    clustersByCandidate[candidate.candidate_id] = clusters;
  }

  return {
    stage: "CLUSTER_PAIN_POINTS",
    status: "passed",
    generated_at: nowIso(),
    clusters_by_candidate: clustersByCandidate
  };
}

function evidenceQualityScore({ evidence, sourceMode }) {
  if ((evidence ?? []).length === 0) {
    return 0;
  }
  const reliability = average(evidence.map((item) => item.reliability_weight * 100));
  const recency = average(evidence.map((item) => item.recency_weight * 100));
  const diversity = clamp((unique(evidence.map((item) => item.source_type)).length / 4) * 100);
  const countScore = clamp((evidence.length / 6) * 100);
  const externalSourceBonus = evidence.some((item) => item.source_type !== "chrome_web_store_review" && item.source_type !== "chrome_web_store_listing") ? 8 : -8;
  const rawScore = (reliability * 0.34) + (recency * 0.2) + (diversity * 0.26) + (countScore * 0.2) + externalSourceBonus;
  const modeMultiplier = `${sourceMode}`.includes("fixture") ? 0.78 : 1;
  return round(clamp(rawScore * modeMultiplier));
}

function demandScore(candidate) {
  const usersScore = clamp(Math.log10(Math.max(1, Number(candidate.users ?? 0))) * 22);
  const reviewsScore = clamp(Math.log10(Math.max(1, Number(candidate.reviews ?? 0))) * 28);
  const dissatisfactionScore = clamp((4.7 - Number(candidate.rating ?? 4.2)) * 26);
  return round(clamp((usersScore * 0.4) + (reviewsScore * 0.35) + (dissatisfactionScore * 0.25)));
}

function painScore({ candidate, clusters, evidence }) {
  const repeatedPain = clamp(sum(clusters.map((cluster) => cluster.repeated_pain_count)) * 11);
  const specificity = average(clusters.map((cluster) => cluster.cluster_specificity_score));
  const density = candidate.negative_feedback_density_score;
  const weightedEvidence = clamp(sum(clusters.map((cluster) => cluster.weighted_evidence_score)) * 18);
  const sourceDiversity = clamp(unique(evidence.map((item) => item.source_type)).length * 22);
  return round(clamp((repeatedPain * 0.24) + (specificity * 0.18) + (density * 0.22) + (weightedEvidence * 0.18) + (sourceDiversity * 0.18)));
}

function wedgeClarityScore({ candidate, clusters }) {
  const clusterSpecificity = average(clusters.map((cluster) => cluster.cluster_specificity_score));
  const clusterFit = average(clusters.map((cluster) => cluster.single_purpose_fit_score));
  return round(clamp((candidate.single_purpose_fit_score * 0.42) + (clusterSpecificity * 0.34) + (clusterFit * 0.24)));
}

function feasibilityScore({ candidate, supportedBuilder }) {
  const builderBase = supportedBuilder ? 88 : 28;
  return round(clamp((builderBase * 0.5) + (candidate.testability_hint * 0.25) + ((100 - candidate.maintenance_risk_score) * 0.25)));
}

function testabilityScore({ candidate, clusters }) {
  return round(clamp((candidate.testability_hint * 0.5) + (average(clusters.map((cluster) => cluster.testability_score)) * 0.5)));
}

function complianceScore({ candidate, clusters }) {
  const privacyPenalty = average(clusters.map((cluster) => cluster.title === "privacy concern" ? 22 : 0));
  const raw = 100 - (candidate.permission_risk_score * 0.72) - privacyPenalty;
  return round(clamp(raw));
}

function differentiationScore({ candidate }) {
  const overlapPenalty = candidate.effective_portfolio_overlap_score;
  const supportBonus = candidate.has_support_site ? 8 : -8;
  return round(clamp(100 - overlapPenalty + supportBonus));
}

function confidenceScore({ evidenceQuality, testability, candidate, clusters }) {
  const sourceDiversity = clamp(unique(clusters.flatMap((cluster) => cluster.sources ?? [])).length * 22);
  const freshness = candidate.freshness_score;
  return round(clamp((evidenceQuality * 0.45) + (testability * 0.2) + (sourceDiversity * 0.2) + (freshness * 0.15)));
}

function buildRecommendation({ supportedBuilder, thresholds, evidenceQuality, testability, wedgeClarity, compliance, portfolioOverlapPenalty, confidence, totalScore }) {
  if (!supportedBuilder && totalScore < thresholds.min_overall_score) {
    return "skip";
  }
  if (compliance < 50) {
    return "skip";
  }
  if (portfolioOverlapPenalty > 65) {
    return "skip";
  }
  if (
    evidenceQuality < thresholds.min_evidence_quality_score
    || testability < thresholds.min_testability_score
    || wedgeClarity < thresholds.min_single_purpose_score
    || confidence < thresholds.min_confidence_score
  ) {
    return "research_more";
  }
  if (supportedBuilder && totalScore >= thresholds.min_overall_score) {
    return "build";
  }
  return supportedBuilder ? "research_more" : "skip";
}

export function buildOpportunityArtifacts({ runContext, candidateReport, clusterReport, evidenceReport, portfolioRegistry, shortlistQuality }) {
  const thresholds = normalizeDiscoveryThresholds(runContext.thresholds);
  const supportedFamilies = new Set(runContext.supported_builder_families ?? []);
  const scored = (candidateReport.candidates ?? []).map((candidate) => {
    const clusters = clusterReport.clusters_by_candidate[candidate.candidate_id] ?? [];
    const evidence = evidenceReport.evidence_by_candidate[candidate.candidate_id] ?? [];
    const registryAdjustments = computeRegistryCandidateAdjustments(candidate, portfolioRegistry);
    const supportedBuilder = supportedFamilies.has(candidate.wedge_family);
    const effectivePortfolioOverlap = clamp(
      Number(candidate.portfolio_overlap_score ?? 0)
      + Number(registryAdjustments.overlap_penalty ?? 0)
      + Number(registryAdjustments.blacklist_penalty ?? 0)
    );
    const demand = demandScore(candidate);
    const pain = painScore({ candidate, clusters, evidence });
    const evidenceQuality = evidenceQualityScore({ evidence, sourceMode: candidate.source_mode ?? candidateReport.source_mode });
    const wedgeClarity = wedgeClarityScore({ candidate, clusters });
    const feasibility = feasibilityScore({ candidate, supportedBuilder });
    const testability = testabilityScore({ candidate, clusters });
    const compliance = complianceScore({ candidate, clusters });
    const differentiation = differentiationScore({ candidate });
    const maintenanceRisk = round(clamp(candidate.maintenance_risk_score));
    const confidence = confidenceScore({ evidenceQuality, testability, candidate, clusters });
    const total = round(clamp(
      (demand * 0.16)
      + (pain * 0.18)
      + (evidenceQuality * 0.15)
      + (wedgeClarity * 0.12)
      + (feasibility * 0.1)
      + (testability * 0.11)
      + (compliance * 0.08)
      + (differentiation * 0.06)
      + (confidence * 0.1)
      - (effectivePortfolioOverlap * 0.05)
      - (maintenanceRisk * 0.03)
    ));
    const recommendation = buildRecommendation({
      supportedBuilder,
      thresholds,
      evidenceQuality,
      testability,
      wedgeClarity,
      compliance,
      portfolioOverlapPenalty: effectivePortfolioOverlap,
      confidence,
      totalScore: total
    });

    return {
      candidate_id: candidate.candidate_id,
      name: candidate.name,
      wedge_family: candidate.wedge_family,
      supported_builder: supportedBuilder,
      demand_score: demand,
      pain_score: pain,
      evidence_quality_score: evidenceQuality,
      wedge_clarity_score: wedgeClarity,
      feasibility_score: feasibility,
      testability_score: testability,
      compliance_score: compliance,
      differentiation_score: differentiation,
      portfolio_overlap_penalty: effectivePortfolioOverlap,
      maintenance_risk_score: maintenanceRisk,
      confidence_score: confidence,
      total_score: total,
      overall_score: total,
      build_recommendation: recommendation,
      portfolio_overlap_score: effectivePortfolioOverlap,
      registry_overlap_penalty: registryAdjustments.overlap_penalty,
      registry_blacklist_penalty: registryAdjustments.blacklist_penalty,
      archetype_prior_multiplier: registryAdjustments.archetype_prior_multiplier,
      decision_rationale: [
        `${clusters.length} clusters and ${evidence.length} evidence items support the wedge`,
        `evidence_quality=${evidenceQuality}, testability=${testability}, compliance=${compliance}`,
        `portfolio_overlap_penalty=${effectivePortfolioOverlap}, maintenance_risk=${maintenanceRisk}`,
        `shortlist_confidence=${shortlistQuality.shortlist_confidence}`
      ],
      score_breakdown: {
        demand_score: demand,
        pain_score: pain,
        evidence_quality_score: evidenceQuality,
        wedge_clarity_score: wedgeClarity,
        feasibility_score: feasibility,
        testability_score: testability,
        compliance_score: compliance,
        differentiation_score: differentiation,
        portfolio_overlap_penalty: effectivePortfolioOverlap,
        maintenance_risk_score: maintenanceRisk,
        confidence_score: confidence
      },
      rationale: [
        `${clusters.length} clusters, ${evidence.length} evidence items`,
        supportedBuilder ? "supported builder exists" : "supported builder missing",
        `build recommendation ${recommendation}`
      ]
    };
  }).sort((left, right) => (
    (right.total_score - left.total_score)
    || (right.confidence_score - left.confidence_score)
    || (right.testability_score - left.testability_score)
  ));

  const selectedScore = scored[0] ?? null;
  const selectedCandidate = selectedScore
    ? candidateReport.candidates.find((candidate) => candidate.candidate_id === selectedScore.candidate_id) ?? null
    : null;

  const scoresReport = {
    stage: "SCORE_OPPORTUNITIES",
    status: "passed",
    generated_at: nowIso(),
    shortlist_confidence: shortlistQuality.shortlist_confidence,
    scores: scored
  };

  const selectedReport = selectedCandidate
    ? {
        stage: "SCORE_OPPORTUNITIES",
        status: "passed",
        generated_at: nowIso(),
        selected_candidate_id: selectedCandidate.candidate_id,
        selected_reason: selectedScore.decision_rationale,
        selected_reason_summary: selectedScore.build_recommendation,
        build_recommendation: selectedScore.build_recommendation,
        candidate: selectedCandidate,
        score: selectedScore
      }
    : {
        stage: "SCORE_OPPORTUNITIES",
        status: "no_go",
        generated_at: nowIso(),
        selected_candidate_id: null,
        selected_reason: ["No candidate satisfied the upgraded discovery shortlist."],
        build_recommendation: "skip",
        candidate: null,
        score: null
      };

  return { scoresReport, selectedReport, thresholds };
}

function gateResult(passed, reason, severity = "blocker") {
  return {
    passed,
    reason,
    severity
  };
}

function requiredResearchFromGateResults(gateResults) {
  return Object.entries(gateResults)
    .filter(([, value]) => value.passed === false)
    .map(([key, value]) => `${key}: ${value.reason}`);
}

export function buildDiscoveryGate({ runContext, selectedReport, clusterReport, evidenceReport }) {
  const thresholds = normalizeDiscoveryThresholds(runContext.thresholds);
  if (!selectedReport.candidate || !selectedReport.score) {
    return {
      stage: "BUILD_GATE",
      status: "failed",
      decision: "no_go",
      go_no_go: "no_go",
      generated_at: nowIso(),
      selected_candidate_id: null,
      gate_results: {
        evidence_quality_gate: gateResult(false, "No selected candidate available."),
        single_purpose_gate: gateResult(false, "No selected candidate available."),
        testability_gate: gateResult(false, "No selected candidate available."),
        permissions_risk_gate: gateResult(false, "No selected candidate available."),
        portfolio_overlap_gate: gateResult(false, "No selected candidate available."),
        product_acceptance_forecast_gate: gateResult(false, "No selected candidate available.")
      },
      blockers: ["no_selected_candidate"],
      warnings: [],
      required_followup_research: ["collect stronger evidence and rerun discovery"],
      recommended_archetype: null,
      expected_test_matrix: [],
      product_acceptance_risks: [],
      cluster_count: 0,
      decision_rationale: ["Discovery did not select a viable candidate."]
    };
  }

  const candidateId = selectedReport.candidate.candidate_id;
  const clusters = clusterReport.clusters_by_candidate[candidateId] ?? [];
  const evidence = evidenceReport.evidence_by_candidate[candidateId] ?? [];
  const score = selectedReport.score;
  const genericWeakClusters = clusters.filter((cluster) => cluster.weak_cluster_reason);

  const gateResults = {
    evidence_quality_gate: gateResult(
      score.evidence_quality_score >= thresholds.min_evidence_quality_score,
      score.evidence_quality_score >= thresholds.min_evidence_quality_score
        ? `evidence_quality_score=${score.evidence_quality_score}`
        : `evidence_quality_score=${score.evidence_quality_score} is below threshold ${thresholds.min_evidence_quality_score}`
    ),
    single_purpose_gate: gateResult(
      score.wedge_clarity_score >= thresholds.min_single_purpose_score && genericWeakClusters.length < Math.max(2, clusters.length),
      score.wedge_clarity_score >= thresholds.min_single_purpose_score && genericWeakClusters.length < Math.max(2, clusters.length)
        ? `wedge_clarity_score=${score.wedge_clarity_score}`
        : "wedge remains too broad or supported by weak pain clusters"
    ),
    testability_gate: gateResult(
      score.testability_score >= thresholds.min_testability_score,
      score.testability_score >= thresholds.min_testability_score
        ? `testability_score=${score.testability_score}`
        : `testability_score=${score.testability_score} is below threshold ${thresholds.min_testability_score}`
    ),
    permissions_risk_gate: gateResult(
      score.compliance_score >= 50 && selectedReport.candidate.permission_risk_score <= thresholds.max_permission_risk_score,
      score.compliance_score >= 50 && selectedReport.candidate.permission_risk_score <= thresholds.max_permission_risk_score
        ? `compliance_score=${score.compliance_score}`
        : `permission risk ${selectedReport.candidate.permission_risk_score} or compliance score ${score.compliance_score} is too risky`
    ),
    portfolio_overlap_gate: gateResult(
      score.portfolio_overlap_penalty <= thresholds.max_portfolio_overlap_penalty,
      score.portfolio_overlap_penalty <= thresholds.max_portfolio_overlap_penalty
        ? `portfolio_overlap_penalty=${score.portfolio_overlap_penalty}`
        : `portfolio_overlap_penalty=${score.portfolio_overlap_penalty} exceeds ${thresholds.max_portfolio_overlap_penalty}`
    ),
    product_acceptance_forecast_gate: gateResult(
      genericWeakClusters.length === 0 && clusters.length >= thresholds.min_negative_clusters,
      genericWeakClusters.length === 0 && clusters.length >= thresholds.min_negative_clusters
        ? `cluster_count=${clusters.length}`
        : "product acceptance forecast is weak because pain coverage is thin or too generic"
    )
  };

  const blockers = Object.entries(gateResults)
    .filter(([, value]) => value.passed === false)
    .map(([key]) => key);
  const warnings = [];
  if (!evidence.some((item) => item.source_type !== "chrome_web_store_review" && item.source_type !== "chrome_web_store_listing")) {
    warnings.push("selected wedge lacks non-store corroboration");
  }
  if (score.confidence_score < thresholds.min_confidence_score + 10) {
    warnings.push("confidence score is only slightly above the minimum threshold");
  }

  const goNoGo = blockers.length === 0 && score.build_recommendation === "build" ? "go" : "no_go";
  return {
    stage: "BUILD_GATE",
    status: goNoGo === "go" ? "passed" : "failed",
    decision: goNoGo,
    go_no_go: goNoGo,
    generated_at: nowIso(),
    selected_candidate_id: candidateId,
    gate_results: gateResults,
    blockers,
    warnings,
    required_followup_research: requiredResearchFromGateResults(gateResults),
    recommended_archetype: selectedReport.candidate.wedge_family,
    expected_test_matrix: EXPECTED_TEST_MATRIX[selectedReport.candidate.wedge_family] ?? [],
    product_acceptance_risks: [
      ...(PRODUCT_ACCEPTANCE_FORECAST_RISKS[selectedReport.candidate.wedge_family] ?? []),
      ...genericWeakClusters.slice(0, 2).map((cluster) => cluster.weak_cluster_reason)
    ],
    cluster_count: clusters.length,
    decision_rationale: [
      `build_recommendation=${score.build_recommendation}`,
      `evidence_quality=${score.evidence_quality_score}, testability=${score.testability_score}, confidence=${score.confidence_score}`,
      `portfolio_overlap_penalty=${score.portfolio_overlap_penalty}, compliance=${score.compliance_score}`
    ]
  };
}

export function nextTenDiscoveryQueries() {
  return [
    {
      query: "site:chromewebstore.google.com form filler one profile visible fields review",
      target_category: "form automation",
      hypothesis: "Users still want a local-only one-profile form filler that avoids heavy dashboards.",
      expected_user_pain: "Missed fields, too many templates, overwrite anxiety.",
      preferred_archetype: "single_profile_form_fill",
      risk: "High portfolio overlap if the wedge is still generic.",
      why_now: "Recent acceptance work exposed a sharper quality bar for form-fill wedges.",
      exclude_if: "Evidence stays store-only or pain remains vague."
    },
    {
      query: "site:reddit.com recruiter intake form autofill local-only chrome extension",
      target_category: "form automation",
      hypothesis: "Recruiter intake forms are specific enough to justify a narrower form-fill wedge.",
      expected_user_pain: "Repeated contact entry across similar fields.",
      preferred_archetype: "single_profile_form_fill",
      risk: "Could still collapse into generic CRM autofill.",
      why_now: "The current form-fill archetype now has stronger test coverage.",
      exclude_if: "Support site and forum evidence disagree on the core flow."
    },
    {
      query: "site:chromewebstore.google.com current window tab export csv pinned tabs review",
      target_category: "tab/workflow export",
      hypothesis: "Current-window-only tab export remains a high-testability productivity wedge.",
      expected_user_pain: "All-session export is too broad and noisy.",
      preferred_archetype: "tab_csv_window_export",
      risk: "Low differentiation if the wedge is just minor UI polish.",
      why_now: "This family remains low-permission and highly testable.",
      exclude_if: "User pain is mostly about advanced enterprise features."
    },
    {
      query: "site:github.com browser tab export extension issue current window csv",
      target_category: "tab/workflow export",
      hypothesis: "GitHub issue evidence can confirm whether export complaints are reproducible and recent.",
      expected_user_pain: "Noisy export columns and weak success feedback.",
      preferred_archetype: "tab_csv_window_export",
      risk: "GitHub issues may reflect maintainer backlog instead of demand.",
      why_now: "Need stronger non-store corroboration before more same-family builds.",
      exclude_if: "Issue tracker is stale beyond 180 days."
    },
    {
      query: "site:chromewebstore.google.com gmail snippet quick insert compose review",
      target_category: "email snippet / template",
      hypothesis: "Users want a two-click snippet insert, not a heavy side panel.",
      expected_user_pain: "Slow search and too much UI for a simple compose action.",
      preferred_archetype: "gmail_snippet",
      risk: "Permission trust may dominate the complaints.",
      why_now: "Gmail snippets remain attractive only if the wedge stays lightweight.",
      exclude_if: "Required permissions imply mailbox-wide access."
    },
    {
      query: "site:reddit.com canned reply chrome extension keyboard shortcut pain",
      target_category: "email snippet / template",
      hypothesis: "Forum users may reveal a sharper keyboard-first compose wedge.",
      expected_user_pain: "Templates feel slow when they interrupt the compose flow.",
      preferred_archetype: "gmail_snippet",
      risk: "Forum anecdotes may be too thin without store corroboration.",
      why_now: "Need external evidence before greenlighting another compose helper.",
      exclude_if: "Pain cannot be converted into a deterministic happy path."
    },
    {
      query: "site:chromewebstore.google.com small saas browser extension copy paste workflow review",
      target_category: "small SaaS productivity gaps",
      hypothesis: "Operators still pay a tax on repetitive browser copy-paste flows.",
      expected_user_pain: "Manual cleanup, repeated entry, weak in-page feedback.",
      preferred_archetype: "single_profile_form_fill",
      risk: "May be too broad unless the target workflow narrows fast.",
      why_now: "The factory should widen beyond the current candidate families without raising permission risk.",
      exclude_if: "The wedge implies multi-page automation or background sync."
    },
    {
      query: "site:github.com browser extension one-click data cleanup issue",
      target_category: "data cleanup / copy-paste automation",
      hypothesis: "Developer and operator utilities can yield narrow, local-only wedges.",
      expected_user_pain: "Too many cleanup steps before data is shareable.",
      preferred_archetype: "tab_csv_window_export",
      risk: "Could drift into unsupported archetypes quickly.",
      why_now: "Need stronger low-permission alternatives to repeated form-fill work.",
      exclude_if: "The solution requires complex parsing across arbitrary sites."
    },
    {
      query: "site:chromewebstore.google.com browser workflow friction local-only productivity review",
      target_category: "browser workflow friction",
      hypothesis: "Some workflow wedges are attractive precisely because they stay local-only and shallow.",
      expected_user_pain: "Heavy dashboards for tasks that should be single-click.",
      preferred_archetype: "tab_csv_window_export",
      risk: "May overlap with existing lightweight utilities.",
      why_now: "Discovery should bias toward low-permission, auditable problems.",
      exclude_if: "The user need depends on cloud sync or collaboration."
    },
    {
      query: "site:chromewebstore.google.com developer utility chrome extension local-only review",
      target_category: "developer or operator utilities",
      hypothesis: "Small developer/operator tools can be differentiated by strict local-only behavior.",
      expected_user_pain: "Too much setup for a repeatable browser-side task.",
      preferred_archetype: "tab_csv_window_export",
      risk: "Could fail testability if the flow is tied to complex app state.",
      why_now: "Need discovery surface area beyond the current three archetypes while staying safe.",
      exclude_if: "The happy path cannot be validated in controlled fixtures."
    }
  ];
}
