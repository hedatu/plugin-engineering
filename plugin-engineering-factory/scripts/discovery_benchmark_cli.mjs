import fs from "node:fs/promises";
import path from "node:path";
import {
  buildCandidateDiscoveryArtifacts,
  buildClusterReport,
  buildDiscoveryGate,
  buildEvidenceReport,
  buildOpportunityArtifacts
} from "../src/discovery/engine.mjs";
import { defaultPortfolioRegistry } from "../src/portfolio/registry.mjs";
import { ensureDir, nowIso, readJson, writeJson } from "../src/utils/io.mjs";
import { assertMatchesSchema } from "../src/utils/schema.mjs";

function finalRecommendation(selectedReport, gate) {
  if (gate.go_no_go === "go") {
    return "build";
  }
  return selectedReport.score?.build_recommendation ?? "skip";
}

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function benchmarkRunContext(caseData) {
  return {
    run_id: `benchmark-${caseData.case_id}`,
    allowed_categories: ["Productivity", "Developer Tools", "Workflow & Planning"],
    blocked_categories: ["Shopping", "Crypto", "VPN", "Security", "Children"],
    thresholds: {
      min_users: 10000,
      min_reviews: 100,
      rating_min: 3.8,
      rating_max: 4.6,
      min_negative_clusters: 2,
      min_overall_score: 70,
      min_evidence_quality_score: 60,
      min_testability_score: 60,
      min_single_purpose_score: 60,
      min_confidence_score: 55,
      max_permission_risk_score: 55,
      max_portfolio_overlap_penalty: 45,
      ...(caseData.thresholds ?? {})
    },
    builder: {
      allow_families: [
        "tab_csv_window_export",
        "single_profile_form_fill",
        "gmail_snippet"
      ]
    },
    supported_builder_families: [
      "tab_csv_window_export",
      "single_profile_form_fill",
      "gmail_snippet"
    ],
    research: {
      mode: "fixture"
    },
    portfolio_registry: {
      blocked_candidate_ids: []
    }
  };
}

async function loadCases(benchmarkDir) {
  const entries = await fs.readdir(benchmarkDir);
  const caseFiles = entries.filter((entry) => entry.endsWith(".json")).sort();
  const results = [];
  for (const fileName of caseFiles) {
    results.push(await readJson(path.join(benchmarkDir, fileName)));
  }
  return results;
}

function evaluateCase(caseData) {
  const runContext = benchmarkRunContext(caseData);
  const portfolioRegistry = {
    ...defaultPortfolioRegistry(),
    items: caseData.portfolio_items ?? []
  };
  const { candidateReport, shortlistQuality } = buildCandidateDiscoveryArtifacts({
    rawCandidates: [caseData.candidate],
    runContext,
    portfolioRegistry,
    sourceModeOverride: "fixture"
  });
  const evidenceReport = buildEvidenceReport({
    candidateReport,
    fixtureEvidenceByCandidate: {
      [caseData.candidate.candidate_id]: caseData.evidence ?? []
    },
    sourceMode: "fixture"
  });
  const clusterReport = buildClusterReport({ candidateReport, evidenceReport });
  const { selectedReport } = buildOpportunityArtifacts({
    runContext,
    candidateReport,
    clusterReport,
    evidenceReport,
    portfolioRegistry,
    shortlistQuality
  });
  const gate = buildDiscoveryGate({
    runContext,
    selectedReport,
    clusterReport,
    evidenceReport
  });
  const actual = finalRecommendation(selectedReport, gate);
  return {
    case_id: caseData.case_id,
    expected_build_recommendation: caseData.expected_build_recommendation,
    actual_build_recommendation: actual,
    passed: actual === caseData.expected_build_recommendation,
    total_score: selectedReport.score?.total_score ?? 0,
    evidence_quality_score: selectedReport.score?.evidence_quality_score ?? 0,
    testability_score: selectedReport.score?.testability_score ?? 0,
    go_no_go: gate.go_no_go,
    blockers: gate.blockers,
    notes: caseData.notes ?? ""
  };
}

async function main() {
  const projectRoot = process.cwd();
  const benchmarkDir = path.join(projectRoot, "fixtures", "discovery_benchmark");
  const cases = await loadCases(benchmarkDir);
  const results = cases.map((caseData) => evaluateCase(caseData));
  const passedCases = results.filter((result) => result.passed);
  const failedCases = results.filter((result) => !result.passed);
  const predictedBuilds = results.filter((result) => result.actual_build_recommendation === "build");
  const truePositives = predictedBuilds.filter((result) => result.expected_build_recommendation === "build");
  const falsePositiveCases = results.filter((result) => result.actual_build_recommendation === "build" && result.expected_build_recommendation !== "build");
  const falseNegativeCases = results.filter((result) => result.actual_build_recommendation !== "build" && result.expected_build_recommendation === "build");

  const recommendedThresholdChanges = unique([
    falsePositiveCases.length > 0 ? "tighten evidence_quality_score or permission risk thresholds for false positives" : null,
    falseNegativeCases.length > 0 ? "lower total_score threshold or improve benchmark case coverage for false negatives" : null,
    results.some((result) => result.expected_build_recommendation === "research_more" && result.actual_build_recommendation === "skip")
      ? "rebalance research_more vs skip boundary for vague-pain candidates"
      : null
  ]);

  const report = {
    stage: "DISCOVERY_BENCHMARK",
    status: failedCases.length === 0 ? "passed" : "failed",
    generated_at: nowIso(),
    total_cases: results.length,
    passed_cases: passedCases.length,
    failed_cases: failedCases.length,
    precision_estimate: predictedBuilds.length === 0 ? 1 : truePositives.length / predictedBuilds.length,
    false_positive_cases: falsePositiveCases,
    false_negative_cases: falseNegativeCases,
    scoring_drift: results,
    recommended_threshold_changes: recommendedThresholdChanges
  };

  await assertMatchesSchema({
    data: report,
    schemaPath: path.join(projectRoot, "schemas", "discovery_benchmark_report.schema.json"),
    label: "35_discovery_benchmark_report.json"
  });

  await ensureDir(path.join(projectRoot, "state"));
  await writeJson(path.join(projectRoot, "state", "35_discovery_benchmark_report.json"), report);

  console.log(`Discovery benchmark ${report.status}: ${passedCases.length}/${results.length}`);
  console.log(`Report: ${path.join(projectRoot, "state", "35_discovery_benchmark_report.json")}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
