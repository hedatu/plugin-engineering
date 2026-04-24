import path from "node:path";
import { appendReleaseLedgerEntry, loadReleaseLedger } from "./releaseLedger.mjs";
import {
  appendRunEventLog,
  loadManagedRunArtifact,
  runEventLatestArtifactPath
} from "../workflow/runEventArtifacts.mjs";
import { assertMatchesSchema } from "../utils/schema.mjs";
import { fileExists, listFiles, nowIso, readJson, writeJson } from "../utils/io.mjs";

function normalizeRelativePath(projectRoot, absolutePath) {
  return path.relative(projectRoot, absolutePath).replaceAll("\\", "/");
}

function artifactPath(runDir, fileName) {
  return path.join(runDir, fileName);
}

function extractUploadResponseCrxVersion(report) {
  return report?.upload_response_crx_version
    ?? report?.upload_response_summary?.crxVersion
    ?? report?.upload_response_summary?.crx_version
    ?? report?.upload_response?.body?.crxVersion
    ?? report?.upload_response?.body?.crx_version
    ?? null;
}

async function validatePublishExecutionArtifact(projectRoot, data) {
  await assertMatchesSchema({
    data,
    schemaPath: path.join(projectRoot, "schemas", "publish_execution.schema.json"),
    label: "90_publish_execution.json"
  });
}

async function findLatestUploadExecutionSidecar(projectRoot, runId) {
  const historyDir = path.join(projectRoot, "state", "run_events", runId, "publish_execution");
  if (!(await fileExists(historyDir))) {
    return null;
  }

  const files = (await listFiles(historyDir))
    .map((entry) => entry.absolutePath)
    .filter((absolutePath) => absolutePath.endsWith(".json"))
    .sort()
    .reverse();

  for (const absolutePath of files) {
    const data = await readJson(absolutePath);
    if (data.publish_validation_phase !== "upload_only") {
      continue;
    }
    if (data.upload_request_attempted !== true && data.sandbox_upload_verified !== true) {
      continue;
    }
    return {
      absolutePath,
      relativePath: normalizeRelativePath(projectRoot, absolutePath),
      data
    };
  }

  return null;
}

function buildVersionConsistencyCheck({ uploadState, manifestVersion, uploadResponseCrxVersion }) {
  const mismatch = uploadState === "SUCCEEDED"
    && uploadResponseCrxVersion
    && manifestVersion
    && uploadResponseCrxVersion !== manifestVersion;
  return {
    performed: uploadState === "SUCCEEDED" || Boolean(uploadResponseCrxVersion),
    upload_state: uploadState,
    manifest_version: manifestVersion,
    upload_response_crx_version: uploadResponseCrxVersion,
    passed: !mismatch,
    failure_reason: mismatch ? "upload_response_crx_version_mismatch" : null
  };
}

function normalizeUploadExecutionReport({
  sourceReport,
  manifestVersion,
  uploadResponseCrxVersion
}) {
  const uploadState = sourceReport.upload_state ?? sourceReport.latest_upload_status ?? "not_reported";
  const currentSandboxItemVersion = sourceReport.current_sandbox_item_version
    ?? sourceReport.pre_upload_checks?.remote_crx_version
    ?? null;
  const versionConsistencyCheck = buildVersionConsistencyCheck({
    uploadState,
    manifestVersion,
    uploadResponseCrxVersion
  });

  const normalized = {
    ...sourceReport,
    current_sandbox_item_version: currentSandboxItemVersion,
    manifest_version: manifestVersion,
    upload_response_crx_version: uploadResponseCrxVersion,
    uploaded_crx_version: uploadState === "SUCCEEDED"
      ? uploadResponseCrxVersion
      : (sourceReport.uploaded_crx_version ?? uploadResponseCrxVersion ?? null),
    published_crx_version: sourceReport.published_crx_version ?? null,
    upload_state: uploadState,
    crx_version: uploadState === "SUCCEEDED"
      ? uploadResponseCrxVersion
      : (sourceReport.crx_version ?? sourceReport.uploaded_crx_version ?? uploadResponseCrxVersion ?? null),
    version_consistency_check: versionConsistencyCheck,
    upload_response_summary: {
      ...(sourceReport.upload_response_summary ?? {}),
      crxVersion: uploadResponseCrxVersion,
      crx_version: uploadResponseCrxVersion
    }
  };

  if (versionConsistencyCheck.passed) {
    normalized.status = "passed";
    normalized.failure_phase = null;
    normalized.failure_reason = null;
    normalized.next_step = uploadState === "UPLOAD_IN_PROGRESS" && !uploadResponseCrxVersion
      ? "poll_fetch_status_for_upload_completion"
      : "manual_approval_required_before_sandbox_publish";
  } else {
    normalized.status = "failed";
    normalized.failure_phase = "post_upload_consistency_check";
    normalized.failure_reason = versionConsistencyCheck.failure_reason;
  }

  return normalized;
}

export async function normalizeUploadArtifact({ runDir }) {
  const absoluteRunDir = path.resolve(runDir);
  const runContext = await readJson(artifactPath(absoluteRunDir, "00_run_context.json"));
  if ((runContext.run_type ?? runContext.task_mode) !== "sandbox_validation") {
    throw new Error(`Run ${runContext.run_id} is not a sandbox_validation run.`);
  }

  const projectRoot = runContext.project_root;
  const plan = await readJson(artifactPath(absoluteRunDir, "83_sandbox_validation_plan.json"));
  const latestPointer = await loadManagedRunArtifact({
    runDir: absoluteRunDir,
    artifactName: "90_publish_execution.json",
    runContext
  });
  const uploadExecution = await findLatestUploadExecutionSidecar(projectRoot, runContext.run_id);
  if (!uploadExecution) {
    throw new Error("Could not find a versioned upload_only publish execution sidecar to normalize.");
  }

  const sourceReport = uploadExecution.data;
  if (sourceReport.upload_state !== "SUCCEEDED") {
    throw new Error(`publish:normalize-upload-artifact requires upload_state=SUCCEEDED. Current upload_state=${sourceReport.upload_state ?? "unknown"}.`);
  }

  const manifestVersion = plan.manifest_version ?? sourceReport.manifest_version ?? null;
  if (!manifestVersion) {
    throw new Error("Could not determine manifest_version from 83_sandbox_validation_plan.json or upload sidecar.");
  }
  if (sourceReport.manifest_version && sourceReport.manifest_version !== manifestVersion) {
    throw new Error(`Upload sidecar manifest_version=${sourceReport.manifest_version} does not match sandbox plan manifest_version=${manifestVersion}.`);
  }

  const uploadResponseCrxVersion = extractUploadResponseCrxVersion(sourceReport);
  if (!uploadResponseCrxVersion) {
    throw new Error("Upload sidecar is missing upload_response_summary.crxVersion.");
  }
  if (uploadResponseCrxVersion !== manifestVersion) {
    throw new Error(`upload_response_summary.crxVersion=${uploadResponseCrxVersion} does not match manifest_version=${manifestVersion}.`);
  }

  const normalizedReport = normalizeUploadExecutionReport({
    sourceReport,
    manifestVersion,
    uploadResponseCrxVersion
  });
  await validatePublishExecutionArtifact(projectRoot, normalizedReport);

  const latestPointerPath = runEventLatestArtifactPath(projectRoot, runContext.run_id, "90_publish_execution.json");
  await writeJson(latestPointerPath, normalizedReport);

  const correctionArtifact = {
    stage: "PUBLISH_EXECUTION_ARTIFACT_CORRECTION",
    correction_reason: "crx_version_field_normalization",
    corrected_at: nowIso(),
    run_id: runContext.run_id,
    publish_validation_phase: sourceReport.publish_validation_phase ?? null,
    original_crx_version: sourceReport.crx_version ?? null,
    corrected_crx_version: normalizedReport.crx_version ?? null,
    upload_response_crx_version: normalizedReport.upload_response_crx_version ?? null,
    uploaded_crx_version: normalizedReport.uploaded_crx_version ?? null,
    current_sandbox_item_version: normalizedReport.current_sandbox_item_version ?? null,
    manifest_version: normalizedReport.manifest_version ?? null,
    upload_state: normalizedReport.upload_state ?? null,
    version_consistency_check: normalizedReport.version_consistency_check ?? null,
    source_sidecar_path: uploadExecution.relativePath,
    latest_pointer_before_path: latestPointer?.artifactRelativePath ?? null,
    latest_pointer_before_publish_validation_phase: latestPointer?.data?.publish_validation_phase ?? null
  };
  const correctionWrite = await appendRunEventLog({
    projectRoot,
    runId: runContext.run_id,
    category: "publish_execution",
    prefix: "90_publish_execution-correction",
    data: correctionArtifact
  });

  const ledger = await loadReleaseLedger(projectRoot);
  const originalUploadLedger = [...ledger.entries]
    .reverse()
    .find((entry) => entry.run_id === runContext.run_id && entry.action_type === "sandbox_upload") ?? null;
  const latestPointerRelativePath = normalizeRelativePath(projectRoot, latestPointerPath);
  const correctionEntry = await appendReleaseLedgerEntry(projectRoot, {
    run_id: runContext.run_id,
    sandbox_run_id: runContext.run_id,
    item_id: normalizedReport.item_id ?? runContext.item_id ?? runContext.publish?.sandbox_item_id ?? null,
    publisher_id: normalizedReport.publisher_id ?? runContext.publisher_id ?? runContext.publish?.publisher_id ?? null,
    item_name: null,
    package_sha256: normalizedReport.package_sha256 ?? plan.package_sha256 ?? "",
    manifest_version: normalizedReport.manifest_version ?? null,
    current_sandbox_item_version: normalizedReport.current_sandbox_item_version ?? null,
    upload_response_crx_version: normalizedReport.upload_response_crx_version ?? null,
    uploaded_crx_version: normalizedReport.uploaded_crx_version ?? null,
    published_crx_version: normalizedReport.published_crx_version ?? null,
    upload_state: normalizedReport.upload_state ?? null,
    version_consistency_check: normalizedReport.version_consistency_check ?? null,
    action_type: "sandbox_upload_artifact_correction",
    action_source: "cli",
    action_status: "passed",
    evidence_artifacts: [
      latestPointerRelativePath,
      correctionWrite.logRelativePath,
      uploadExecution.relativePath
    ],
    chrome_webstore_response_summary: null,
    approval_artifact: normalizedReport.approval_id
      ? normalizeRelativePath(
          projectRoot,
          path.join(projectRoot, "state", "run_events", runContext.run_id, "82_human_approval.json")
        )
      : null,
    corrects_ledger_entry_id: originalUploadLedger?.ledger_entry_id ?? null,
    corrected_fields: [
      "crx_version",
      "uploaded_crx_version",
      "upload_response_crx_version"
    ],
    reason: "crx_version_field_normalization",
    production_write: false,
    sandbox_only: true
  });

  return {
    run_id: runContext.run_id,
    latest_pointer_path: latestPointerRelativePath,
    source_sidecar_path: uploadExecution.relativePath,
    correction_sidecar_path: correctionWrite.logRelativePath,
    corrected_crx_version: normalizedReport.crx_version,
    current_sandbox_item_version: normalizedReport.current_sandbox_item_version,
    upload_response_crx_version: normalizedReport.upload_response_crx_version,
    uploaded_crx_version: normalizedReport.uploaded_crx_version,
    version_consistency_check: normalizedReport.version_consistency_check,
    correction_ledger_entry_id: correctionEntry.ledger_entry_id
  };
}
