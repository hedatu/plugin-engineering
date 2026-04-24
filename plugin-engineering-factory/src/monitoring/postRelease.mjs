import path from "node:path";
import fs from "node:fs/promises";
import { assertMatchesSchema } from "../utils/schema.mjs";
import { fileExists, nowIso, readJson, writeJson } from "../utils/io.mjs";
import { loadManagedRunArtifact, writeManagedRunArtifact } from "../workflow/runEventArtifacts.mjs";

export const MONITORING_SNAPSHOT_ARTIFACT = "95_monitoring_snapshot.json";
export const LEARNING_UPDATE_ARTIFACT = "96_learning_update.json";

function artifactPath(runDir, fileName) {
  return path.join(runDir, fileName);
}

async function readOptionalJson(filePath) {
  if (!(await fileExists(filePath))) {
    return null;
  }
  return readJson(filePath);
}

function parseCsv(text) {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(",").map((value) => value.trim());
  return lines
    .filter(Boolean)
    .map((line) => {
      const values = line.split(",").map((value) => value.trim());
      return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    });
}

async function readMetricsCsv(filePath) {
  if (!(await fileExists(filePath))) {
    return null;
  }
  const raw = await fs.readFile(filePath, "utf8");
  return parseCsv(raw);
}

function sumInteger(records, key) {
  return (records ?? []).reduce((sum, item) => sum + Number.parseInt(item?.[key] ?? "0", 10), 0);
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}

function topTopics(records, key) {
  const counts = new Map();
  for (const item of records ?? []) {
    const values = Array.isArray(item?.[key]) ? item[key] : item?.[key] ? [item[key]] : [];
    for (const value of values) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 5);
}

function buildSkippedArtifacts({ runContext, publishExecution, reason, nextStep, metricsSource, required }) {
  const snapshot = {
    stage: "MONITOR_POST_RELEASE",
    status: required ? "failed" : "skipped",
    run_id: runContext.run_id,
    item_id: publishExecution?.item_id ?? null,
    source_type: metricsSource,
    metrics_window: "unconfigured",
    installs: null,
    uninstalls: null,
    impressions: null,
    conversion_rate: null,
    uninstall_rate: null,
    reviews_summary: {
      total_reviews: 0,
      negative_reviews: 0,
      top_topics: []
    },
    support_summary: {
      total_tickets: 0,
      open_tickets: 0,
      top_topics: []
    },
    health_status: reason === "monitoring_disabled" ? "monitoring_disabled" : "no_input",
    failure_reason: required ? reason : null,
    next_step: nextStep,
    generated_at: nowIso(),
    publisher_id: publishExecution?.publisher_id ?? null,
    publish_execution_path: publishExecution ? "90_publish_execution.json" : "",
    portfolio_registry_path: runContext.portfolio_registry?.path ?? ""
  };

  const learning = {
    stage: "MONITOR_POST_RELEASE",
    status: required ? "failed" : "skipped",
    run_id: runContext.run_id,
    item_id: publishExecution?.item_id ?? null,
    release_health_summary: snapshot.health_status,
    blacklist_updates: [],
    overlap_updates: [],
    archetype_priors: {},
    scoring_weight_suggestions: [],
    reviewer_notes: [nextStep],
    should_pause_similar_builds: false,
    should_prioritize_followup: false,
    generated_at: nowIso(),
    publisher_id: publishExecution?.publisher_id ?? null,
    portfolio_registry_path: runContext.portfolio_registry?.path ?? "",
    failure_reason: required ? reason : null
  };

  return { snapshot, learning };
}

async function validateArtifacts(projectRoot, snapshot, learning) {
  await assertMatchesSchema({
    data: snapshot,
    schemaPath: path.join(projectRoot, "schemas", "monitoring_snapshot.schema.json"),
    label: MONITORING_SNAPSHOT_ARTIFACT
  });
  await assertMatchesSchema({
    data: learning,
    schemaPath: path.join(projectRoot, "schemas", "learning_update.schema.json"),
    label: LEARNING_UPDATE_ARTIFACT
  });
}

export async function runMonitoringStage({
  runDir,
  runContext,
  publishExecution = null,
  reviewStatus = null
}) {
  const publishExecutionArtifact = await loadManagedRunArtifact({
    runDir,
    artifactName: "90_publish_execution.json",
    runContext
  });
  const effectivePublishExecution = publishExecution ?? publishExecutionArtifact?.data ?? null;
  const monitoringConfig = runContext.monitoring ?? {
    enabled: false,
    required: false,
    metrics_csv_path: path.join(runContext.project_root, "fixtures", "monitoring", "metrics.csv"),
    reviews_json_path: path.join(runContext.project_root, "fixtures", "monitoring", "reviews.json"),
    support_tickets_json_path: path.join(runContext.project_root, "fixtures", "monitoring", "support_tickets.json")
  };

  if (!monitoringConfig.enabled) {
    const skipped = buildSkippedArtifacts({
      runContext,
      publishExecution: effectivePublishExecution,
      reason: "monitoring_disabled",
      nextStep: "enable monitoring inputs before post-release health tracking",
      metricsSource: "disabled",
      required: monitoringConfig.required
    });
    await validateArtifacts(runContext.project_root, skipped.snapshot, skipped.learning);
    await writeManagedRunArtifact({
      runDir,
      artifactName: MONITORING_SNAPSHOT_ARTIFACT,
      data: skipped.snapshot,
      runContext
    });
    await writeManagedRunArtifact({
      runDir,
      artifactName: LEARNING_UPDATE_ARTIFACT,
      data: skipped.learning,
      runContext
    });
    return skipped;
  }

  const [metricsRows, reviews, supportTickets] = await Promise.all([
    readMetricsCsv(monitoringConfig.metrics_csv_path),
    readOptionalJson(monitoringConfig.reviews_json_path),
    readOptionalJson(monitoringConfig.support_tickets_json_path)
  ]);

  if (!metricsRows && !reviews && !supportTickets) {
    const skipped = buildSkippedArtifacts({
      runContext,
      publishExecution: effectivePublishExecution,
      reason: "no_input",
      nextStep: "provide metrics.csv or review/support fixtures before monitoring",
      metricsSource: "fixture",
      required: monitoringConfig.required
    });
    await validateArtifacts(runContext.project_root, skipped.snapshot, skipped.learning);
    await writeManagedRunArtifact({
      runDir,
      artifactName: MONITORING_SNAPSHOT_ARTIFACT,
      data: skipped.snapshot,
      runContext
    });
    await writeManagedRunArtifact({
      runDir,
      artifactName: LEARNING_UPDATE_ARTIFACT,
      data: skipped.learning,
      runContext
    });
    return skipped;
  }

  const installs = sumInteger(metricsRows, "installs");
  const uninstalls = sumInteger(metricsRows, "uninstalls");
  const impressions = sumInteger(metricsRows, "impressions");
  const conversionRate = impressions > 0 ? round(installs / impressions) : null;
  const uninstallRate = installs > 0 ? round(uninstalls / installs) : null;
  const reviewRecords = Array.isArray(reviews) ? reviews : reviews?.reviews ?? [];
  const supportRecords = Array.isArray(supportTickets) ? supportTickets : supportTickets?.tickets ?? [];
  const negativeReviews = reviewRecords.filter((item) => `${item.sentiment ?? ""}`.toLowerCase() === "negative").length;
  const openTickets = supportRecords.filter((item) => `${item.status ?? ""}`.toLowerCase() !== "closed").length;

  let healthStatus = "healthy";
  if ((uninstallRate ?? 0) >= 0.25 || negativeReviews >= 3 || openTickets >= 3) {
    healthStatus = "unhealthy";
  } else if ((uninstallRate ?? 0) >= 0.15 || negativeReviews >= 1 || openTickets >= 1) {
    healthStatus = "watch";
  }

  const snapshot = {
    stage: "MONITOR_POST_RELEASE",
    status: "passed",
    run_id: runContext.run_id,
    item_id: effectivePublishExecution?.item_id ?? null,
    source_type: "fixture",
    metrics_window: metricsRows?.length ? `${metricsRows[0].date ?? "unknown"}..${metricsRows.at(-1)?.date ?? "unknown"}` : "no_metrics_rows",
    installs,
    uninstalls,
    impressions,
    conversion_rate: conversionRate,
    uninstall_rate: uninstallRate,
    reviews_summary: {
      total_reviews: reviewRecords.length,
      negative_reviews: negativeReviews,
      top_topics: topTopics(reviewRecords, "topic")
    },
    support_summary: {
      total_tickets: supportRecords.length,
      open_tickets: openTickets,
      top_topics: topTopics(supportRecords, "topic")
    },
    health_status: healthStatus,
    failure_reason: null,
    next_step: healthStatus === "healthy"
      ? "continue monitoring on the next reporting window"
      : healthStatus === "watch"
        ? "review incoming feedback before resubmission"
        : "pause similar builds and inspect failure signals",
    generated_at: nowIso(),
    publisher_id: effectivePublishExecution?.publisher_id ?? null,
    publish_execution_path: publishExecutionArtifact?.artifactRelativePath ?? (effectivePublishExecution ? "90_publish_execution.json" : ""),
    portfolio_registry_path: runContext.portfolio_registry?.path ?? ""
  };

  const learning = {
    stage: "MONITOR_POST_RELEASE",
    status: "passed",
    run_id: runContext.run_id,
    item_id: effectivePublishExecution?.item_id ?? null,
    release_health_summary: `${healthStatus}:${snapshot.next_step}`,
    blacklist_updates: healthStatus === "unhealthy"
      ? [{
          wedge_family: effectivePublishExecution?.candidate_id ?? null,
          reason: "low_health_status",
          penalty: 10,
          active: true
        }]
      : [],
    overlap_updates: [],
    archetype_priors: healthStatus === "unhealthy"
      ? {
          [effectivePublishExecution?.candidate_id ?? "unknown"]: {
            score_multiplier: 0.85,
            reason: "recent post-release health degraded"
          }
        }
      : {},
    scoring_weight_suggestions: healthStatus !== "healthy"
      ? [{
          weight: "portfolio_overlap_penalty",
          suggestion: "increase",
          reason: "post-release health indicates narrower opportunity selection is safer"
        }]
      : [],
    reviewer_notes: reviewStatus?.review_cancelled_manually
      ? ["sandbox review was manually cancelled after verification"]
      : [],
    should_pause_similar_builds: healthStatus === "unhealthy",
    should_prioritize_followup: healthStatus !== "healthy",
    generated_at: nowIso(),
    publisher_id: effectivePublishExecution?.publisher_id ?? null,
    portfolio_registry_path: runContext.portfolio_registry?.path ?? "",
    failure_reason: null
  };

  await validateArtifacts(runContext.project_root, snapshot, learning);
  await writeManagedRunArtifact({
    runDir,
    artifactName: MONITORING_SNAPSHOT_ARTIFACT,
    data: snapshot,
    runContext
  });
  await writeManagedRunArtifact({
    runDir,
    artifactName: LEARNING_UPDATE_ARTIFACT,
    data: learning,
    runContext
  });
  return { snapshot, learning };
}
