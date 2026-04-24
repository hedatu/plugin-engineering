import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { updatePortfolioRegistryForRun } from "../portfolio/registry.mjs";
import { listLedgerEntryIdsForRun } from "../publish/releaseLedger.mjs";
import { assertMatchesSchema } from "../utils/schema.mjs";
import {
  fileExists,
  listFiles,
  nowIso,
  writeJson
} from "../utils/io.mjs";
import { IMMUTABLE_MARKER, immutableMarkerPath } from "./runLock.mjs";

export const CLOSE_RUN_ARTIFACT = "99_close_run.json";

function artifactPath(runDir, fileName) {
  return path.join(runDir, fileName);
}

async function hashFile(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function collectArtifactManifest(runDir) {
  const allFiles = await listFiles(runDir);
  const files = allFiles
    .map((entry) => entry.relativePath)
    .filter((relativePath) => relativePath !== CLOSE_RUN_ARTIFACT && relativePath !== IMMUTABLE_MARKER);
  const hashes = {};
  for (const relativePath of files) {
    hashes[relativePath] = await hashFile(path.join(runDir, relativePath));
  }
  return {
    artifactManifest: files,
    artifactHashes: hashes
  };
}

function finalStatusForClose({ publishExecution, reviewStatus, monitoringSnapshot }) {
  const statuses = [
    publishExecution?.status,
    reviewStatus?.status,
    monitoringSnapshot?.status
  ].filter(Boolean);

  if (statuses.includes("failed")) {
    return "completed_with_failures";
  }
  return "passed";
}

async function validateCloseRunArtifact(projectRoot, data) {
  await assertMatchesSchema({
    data,
    schemaPath: path.join(projectRoot, "schemas", "close_run.schema.json"),
    label: CLOSE_RUN_ARTIFACT
  });
}

export async function runCloseRunStage({
  runDir,
  runContext,
  selectedReport = null,
  brief = null,
  plan = null,
  screenshotManifest = null,
  publishPlan = null,
  publishExecution = null,
  reviewStatus = null,
  monitoringSnapshot = null,
  learningUpdate = null,
  policyGate = null
}) {
  const registry = await updatePortfolioRegistryForRun({
    projectRoot: runContext.project_root,
    runContext,
    selectedReport,
    brief,
    plan,
    screenshotManifest,
    publishPlan,
    publishExecution,
    reviewStatus,
    monitoringSnapshot,
    learningUpdate,
    policyGate
  });
  const registryItem = (registry.items ?? []).find((item) => item.run_id === runContext.run_id)
    ?? (registry.items ?? []).find((item) => item.item_id === (publishExecution?.item_id ?? `draft:${runContext.run_id}`))
    ?? null;
  const ledgerEntryIds = await listLedgerEntryIdsForRun(runContext.project_root, {
    runId: runContext.run_id,
    itemId: registryItem?.item_id ?? publishExecution?.item_id ?? null
  });
  const { artifactManifest, artifactHashes } = await collectArtifactManifest(runDir);
  const publishExecutionPath = artifactPath(runDir, "90_publish_execution.json");
  const reviewStatusPath = artifactPath(runDir, "91_review_status.json");
  const report = {
    stage: "CLOSE_RUN",
    run_id: runContext.run_id,
    closed_at: nowIso(),
    final_status: finalStatusForClose({
      publishExecution,
      reviewStatus,
      monitoringSnapshot
    }),
    artifact_manifest: artifactManifest,
    artifact_hashes: artifactHashes,
    package_sha256: publishExecution?.package_sha256 ?? "",
    publish_execution_sha256: await fileExists(publishExecutionPath)
      ? await hashFile(publishExecutionPath)
      : null,
    review_status_sha256: await fileExists(reviewStatusPath)
      ? await hashFile(reviewStatusPath)
      : null,
    registry_entry_id: registryItem?.registry_entry_id ?? null,
    ledger_entry_ids: ledgerEntryIds,
    immutable: true
  };

  await validateCloseRunArtifact(runContext.project_root, report);
  await writeJson(artifactPath(runDir, CLOSE_RUN_ARTIFACT), report);
  await fs.writeFile(immutableMarkerPath(runDir), `${JSON.stringify({
    run_id: runContext.run_id,
    closed_at: report.closed_at,
    close_run_artifact: CLOSE_RUN_ARTIFACT,
    immutable: true
  }, null, 2)}\n`, "utf8");
  await writeJson(artifactPath(runDir, "run_status.json"), {
    stage: "CLOSE_RUN",
    status: "passed",
    generated_at: report.closed_at,
    run_id: runContext.run_id,
    run_id_strategy: runContext.run_id_strategy ?? "unknown",
    allow_overwrite: runContext.allow_overwrite === true,
    overwrite_blocked: false,
    created_at: runContext.created_at ?? runContext.generated_at ?? report.closed_at,
    final_status: report.final_status,
    immutable: true,
    failure_reason: null
  });
  return report;
}
