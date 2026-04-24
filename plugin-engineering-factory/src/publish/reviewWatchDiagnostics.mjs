import path from "node:path";
import { assertMatchesSchema } from "../utils/schema.mjs";
import { fileExists, listFiles, nowIso, readJson, writeJson, writeText } from "../utils/io.mjs";
import { loadActiveReviewWatches, loadReviewWatchSummary } from "./activeReviewWatches.mjs";
import { bootstrapReviewWatchEnv } from "./reviewWatchCredentials.mjs";
const DIAGNOSTICS_JSON_PATH = path.join("state", "review_watch_diagnostics.json");
const DIAGNOSTICS_MD_PATH = path.join("state", "review_watch_diagnostics.md");
const STALE_THRESHOLD_HOURS = 8;

function hoursSince(isoString, reference = nowIso()) {
  if (!isoString) {
    return null;
  }
  const start = Date.parse(isoString);
  const end = Date.parse(reference);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return null;
  }
  return (end - start) / (1000 * 60 * 60);
}

function parseWorkflowSchedule(workflowText) {
  return [...workflowText.matchAll(/cron:\s*"([^"]+)"/g)].map((match) => match[1]);
}

function buildMarkdown(diagnostics) {
  const lines = [
    "# Review Watch Diagnostics",
    "",
    `- Checked at: ${diagnostics.checked_at}`,
    `- Active watch count: ${diagnostics.active_watch_count}`,
    `- Local credentials present: ${diagnostics.local_credentials_present}`,
    `- Proxy configured: ${diagnostics.proxy_configured}`,
    `- Can live fetch status: ${diagnostics.can_live_fetch_status}`,
    `- Last live fetch at: ${diagnostics.last_live_fetch_at ?? "none"}`,
    `- Last status source: ${diagnostics.last_status_source ?? "unknown"}`,
    `- Stale watch detected: ${diagnostics.stale_watch_detected}`,
    `- Expected next check UTC: ${diagnostics.expected_next_check_utc ?? "unknown"}`,
    `- Workflow file exists: ${diagnostics.github_workflow_file_exists}`,
    `- Workflow has schedule: ${diagnostics.github_workflow_has_schedule}`,
    `- Workflow schedule: ${diagnostics.github_workflow_schedule.join(", ") || "none"}`,
    "",
    "## Active Watches",
    ""
  ];

  if (diagnostics.active_watches.length === 0) {
    lines.push("- None");
  } else {
    for (const watch of diagnostics.active_watches) {
      lines.push(`- ${watch.run_id}: state=${watch.latest_review_state ?? "unknown"}, source=${watch.status_source ?? "unknown"}, checked_at=${watch.latest_checked_at ?? "unknown"}, next_check_after=${watch.next_check_after ?? "unknown"}, terminal=${watch.terminal === true}`);
    }
  }

  lines.push("", "## Latest Review Status Sidecars", "");
  if (diagnostics.latest_review_status_sidecars.length === 0) {
    lines.push("- None");
  } else {
    for (const sidecar of diagnostics.latest_review_status_sidecars) {
      lines.push(`- ${sidecar.run_id}: source=${sidecar.status_source ?? "unknown"}, checked_at=${sidecar.checked_at ?? "unknown"}, review_state=${sidecar.review_state ?? "unknown"}, path=${sidecar.path}`);
    }
  }

  lines.push("", "## Findings", "");
  if (diagnostics.diagnostic_findings.length === 0) {
    lines.push("- No findings");
  } else {
    for (const finding of diagnostics.diagnostic_findings) {
      lines.push(`- ${finding}`);
    }
  }

  lines.push("", "## Required Fixes", "");
  if (diagnostics.required_fixes.length === 0) {
    lines.push("- None");
  } else {
    for (const fix of diagnostics.required_fixes) {
      lines.push(`- ${fix}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function loadLatestReviewStatusForRun(projectRoot, runId) {
  const latestPath = path.join(projectRoot, "state", "run_events", runId, "91_review_status.json");
  if (!(await fileExists(latestPath))) {
    return null;
  }
  const report = await readJson(latestPath);
  return {
    run_id: runId,
    path: path.relative(projectRoot, latestPath).replaceAll("\\", "/"),
    checked_at: report.checked_at ?? null,
    status_source: report.status_source ?? null,
    review_state: report.review_state ?? report.current_dashboard_state ?? null,
    fetch_status_succeeded: report.fetch_status_succeeded === true
  };
}

async function loadLastLiveFetchAt(projectRoot, runId) {
  const historyDir = path.join(projectRoot, "state", "run_events", runId, "review_status");
  if (!(await fileExists(historyDir))) {
    return null;
  }

  const files = (await listFiles(historyDir))
    .map((entry) => entry.absolutePath)
    .filter((filePath) => filePath.endsWith(".json"))
    .sort()
    .reverse();

  for (const filePath of files) {
    const report = await readJson(filePath);
    if (report.status_source === "live_fetch_status" && report.fetch_status_succeeded === true) {
      return report.checked_at ?? null;
    }
  }

  return null;
}

async function validateDiagnostics(projectRoot, data) {
  await assertMatchesSchema({
    data,
    schemaPath: path.join(projectRoot, "schemas", "review_watch_diagnostics.schema.json"),
    label: "state/review_watch_diagnostics.json"
  });
}

export async function runReviewWatchDiagnostics({ projectRoot = process.cwd() } = {}) {
  const checkedAt = nowIso();
  const credentialBootstrap = await bootstrapReviewWatchEnv({ projectRoot });
  const registry = await loadActiveReviewWatches(projectRoot);
  const summary = await loadReviewWatchSummary(projectRoot);
  const activeWatches = registry.watches
    .filter((watch) => watch.enabled === true && watch.terminal !== true)
    .sort((left, right) => `${left.run_id}`.localeCompare(`${right.run_id}`));

  const latestReviewStatusSidecars = [];
  const liveFetchTimes = [];
  for (const watch of activeWatches) {
    const latestSidecar = await loadLatestReviewStatusForRun(projectRoot, watch.run_id);
    if (latestSidecar) {
      latestReviewStatusSidecars.push(latestSidecar);
    }
    const lastLiveFetchAt = await loadLastLiveFetchAt(projectRoot, watch.run_id);
    if (lastLiveFetchAt) {
      liveFetchTimes.push(lastLiveFetchAt);
    }
  }

  const workflowPath = path.join(projectRoot, ".github", "workflows", "review-watch.yml");
  const workflowFileExists = await fileExists(workflowPath);
  const workflowText = workflowFileExists ? await readJsonAsText(workflowPath) : "";
  const workflowSchedule = workflowFileExists ? parseWorkflowSchedule(workflowText) : [];
  const workflowHasSchedule = workflowSchedule.length > 0;
  const expectedNextCheckUtc = activeWatches
    .map((watch) => watch.next_check_after ?? null)
    .filter(Boolean)
    .sort()
    .at(0) ?? null;

  const lastLiveFetchAt = liveFetchTimes.sort().at(-1) ?? null;
  const latestObservedStatus = latestReviewStatusSidecars
    .filter((entry) => entry.checked_at)
    .sort((left, right) => `${left.checked_at}`.localeCompare(`${right.checked_at}`))
    .at(-1) ?? null;
  const lastStatusSource = latestObservedStatus?.status_source ?? null;
  const latestObservedRun = latestObservedStatus?.run_id ?? null;
  const lastLiveFetchAgeHours = hoursSince(lastLiveFetchAt, checkedAt);
  const staleWatchDetected = activeWatches.length > 0
    && (
      !lastLiveFetchAt
      || lastLiveFetchAgeHours === null
      || lastLiveFetchAgeHours > STALE_THRESHOLD_HOURS
    );
  const canLiveFetchStatus = credentialBootstrap.credential_present
    && activeWatches.every((watch) => Boolean(watch.item_id) && Boolean(watch.publisher_id));

  const diagnosticFindings = [];
  const requiredFixes = [];

  if (activeWatches.length === 0) {
    diagnosticFindings.push("No active review watches are currently registered.");
  }
  if (!summary) {
    diagnosticFindings.push("state/review_watch_summary.json does not exist yet.");
    requiredFixes.push("Run npm run review-watch:all to generate a fresh summary.");
  }
  if (!workflowFileExists) {
    diagnosticFindings.push("review-watch GitHub workflow file is missing.");
    requiredFixes.push("Create .github/workflows/review-watch.yml so scheduled polling can run.");
  } else if (!workflowHasSchedule) {
    diagnosticFindings.push("review-watch workflow exists but has no schedule.");
    requiredFixes.push("Add a cron schedule so review-watch runs automatically.");
  } else if (!workflowSchedule.includes("0 */6 * * *")) {
    diagnosticFindings.push(`review-watch workflow schedule is ${workflowSchedule.join(", ") || "unknown"}, not the required 0 */6 * * * cadence.`);
    requiredFixes.push("Update .github/workflows/review-watch.yml to run at least every 6 hours.");
  }
  if (!credentialBootstrap.credential_present) {
    diagnosticFindings.push("Local Chrome Web Store credentials are not configured, so live fetchStatus cannot run from this environment.");
    requiredFixes.push("Provide Chrome Web Store review-watch credentials or rely on GitHub Actions secrets for live polling.");
  }
  if (credentialBootstrap.current_process_inheritance_issue_detected) {
    diagnosticFindings.push("Bootstrap recovered review-watch credentials from persisted Windows environment values because the current Node process did not inherit them.");
  }
  if (latestObservedStatus && latestObservedStatus.status_source !== "live_fetch_status") {
    diagnosticFindings.push(`The latest observed review status for active watches came from ${latestObservedStatus.status_source}, not live_fetch_status.`);
  }
  if (staleWatchDetected) {
    diagnosticFindings.push(`No successful live fetchStatus was recorded within the last ${STALE_THRESHOLD_HOURS} hours.`);
    requiredFixes.push("Run review-watch with valid credentials and verify the scheduled workflow is executing.");
  }

  const diagnostics = {
    stage: "REVIEW_WATCH_DIAGNOSTICS",
    status: requiredFixes.length > 0 ? "warning" : "passed",
    checked_at: checkedAt,
    active_watch_count: activeWatches.length,
    active_watches: activeWatches.map((watch) => ({
      run_id: watch.run_id,
      latest_review_state: watch.latest_review_state ?? null,
      latest_checked_at: watch.latest_checked_at ?? null,
      next_check_after: watch.next_check_after ?? null,
      status_source: watch.status_source ?? null,
      terminal: watch.terminal === true
    })),
    latest_watch_summary_exists: Boolean(summary),
    latest_review_status_sidecars: latestReviewStatusSidecars,
    github_workflow_file_exists: workflowFileExists,
    github_workflow_has_schedule: workflowHasSchedule,
    github_workflow_schedule: workflowSchedule,
    expected_next_check_utc: expectedNextCheckUtc,
    local_credentials_present: credentialBootstrap.credential_present,
    proxy_configured: credentialBootstrap.proxy_configured,
    can_live_fetch_status: canLiveFetchStatus,
    last_live_fetch_at: lastLiveFetchAt,
    last_status_source: lastStatusSource,
    stale_watch_detected: staleWatchDetected,
    stale_threshold_hours: STALE_THRESHOLD_HOURS,
    diagnostic_findings: diagnosticFindings,
    required_fixes: requiredFixes
  };

  await validateDiagnostics(projectRoot, diagnostics);
  await writeJson(path.join(projectRoot, DIAGNOSTICS_JSON_PATH), diagnostics);
  await writeText(path.join(projectRoot, DIAGNOSTICS_MD_PATH), buildMarkdown(diagnostics));
  return diagnostics;
}

async function readJsonAsText(filePath) {
  const file = await import("node:fs/promises");
  return file.readFile(filePath, "utf8");
}
