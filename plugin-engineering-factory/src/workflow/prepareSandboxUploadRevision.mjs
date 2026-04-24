import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendReleaseLedgerEntry } from "../publish/releaseLedger.mjs";
import {
  compareChromeExtensionVersions,
  ensureChromeExtensionVersionGreaterThan,
  parseChromeExtensionVersion,
  resolveAutoChromeExtensionVersion
} from "../utils/chromeVersion.mjs";
import { createZipFromDirectory } from "../utils/zip.mjs";
import {
  copyDir,
  ensureDir,
  fileExists,
  listFiles,
  nowIso,
  readJson,
  writeBinary,
  writeJson
} from "../utils/io.mjs";
import {
  hasSecretLikeContent,
  inspectSecretLikeContent,
  redactSecretLikeValue
} from "../utils/redaction.mjs";
import { assertMatchesSchema } from "../utils/schema.mjs";
import { runSandboxPreflight } from "./sandboxValidationReadiness.mjs";
import { runCloseRunStage } from "./closeRun.mjs";
import { isRunImmutable } from "./runLock.mjs";

export const SANDBOX_UPLOAD_REVISION_ARTIFACT = "86_sandbox_upload_revision.json";

const REQUIRED_COPY_TARGETS = [
  "31_selected_candidate.json",
  "41_product_brief.json",
  "41_product_brief.md",
  "42_implementation_plan.json",
  "50_build_report.json",
  "60_qa_report.json",
  "61_browser_smoke.json",
  "70_screenshot_manifest.json",
  "70_listing_assets",
  "71_listing_copy.json",
  "72_policy_gate.json",
  "80_publish_plan.json"
];

function artifactPath(runDir, fileName) {
  return path.join(runDir, fileName);
}

function normalizeRelativePath(basePath, absolutePath) {
  return path.relative(basePath, absolutePath).replaceAll("\\", "/");
}

function shortRandom() {
  return crypto.randomBytes(3).toString("hex");
}

function pad(value) {
  return `${value}`.padStart(2, "0");
}

function makeSandboxRevisionRunId({ itemId, targetVersion, now = new Date() }) {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const itemSlug = `${itemId ?? "sandbox"}`.replace(/[^a-z0-9]/gi, "").slice(0, 12).toLowerCase() || "sandbox";
  const versionSlug = `${targetVersion}`.replace(/\./g, "-");
  return `sandbox-${date}-${time}-${itemSlug}-v${versionSlug}-${shortRandom()}`;
}

function buildSafeReport(reportWithoutChecks) {
  const initialChecks = inspectSecretLikeContent(reportWithoutChecks);
  const redactionGuardTriggered = hasSecretLikeContent(initialChecks);
  const safeReport = redactSecretLikeValue(reportWithoutChecks);

  if (redactionGuardTriggered) {
    safeReport.status = "failed";
    safeReport.next_step = "remove secret-like content from sandbox upload revision inputs and retry";
  }

  return {
    ...safeReport,
    redaction_checks: {
      ...inspectSecretLikeContent(safeReport),
      redaction_guard_triggered: redactionGuardTriggered
    }
  };
}

async function validateArtifact(projectRoot, schemaName, label, data) {
  await assertMatchesSchema({
    data,
    schemaPath: path.join(projectRoot, "schemas", schemaName),
    label
  });
}

async function hashFile(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function fileSize(filePath) {
  const stats = await fs.stat(filePath);
  return Number(stats.size);
}

async function readStoredZipEntries(zipPath) {
  const archive = await fs.readFile(zipPath);
  const entries = [];
  let offset = 0;

  while (offset + 30 <= archive.length) {
    const signature = archive.readUInt32LE(offset);
    if (signature !== 0x04034b50) {
      break;
    }
    const compressionMethod = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const fileNameLength = archive.readUInt16LE(offset + 26);
    const extraFieldLength = archive.readUInt16LE(offset + 28);
    const fileNameStart = offset + 30;
    const fileNameEnd = fileNameStart + fileNameLength;
    const fileName = archive.slice(fileNameStart, fileNameEnd).toString("utf8");
    const dataStart = fileNameEnd + extraFieldLength;
    const dataEnd = dataStart + compressedSize;
    entries.push({
      name: fileName,
      compression_method: compressionMethod,
      data: archive.slice(dataStart, dataEnd)
    });
    offset = dataEnd;
  }

  return entries;
}

async function extractStoredZipToDirectory(zipPath, targetDir) {
  const entries = await readStoredZipEntries(zipPath);
  for (const entry of entries) {
    if (entry.compression_method !== 0) {
      throw new Error(`Unsupported compressed zip entry ${entry.name}; only stored zip entries are supported.`);
    }
    const outputPath = path.join(targetDir, entry.name);
    await ensureDir(path.dirname(outputPath));
    await writeBinary(outputPath, entry.data);
  }
}

async function readManifestVersionFromDirectory(dirPath) {
  const manifest = await readJson(path.join(dirPath, "manifest.json"));
  return `${manifest.version ?? ""}` || null;
}

async function readManifestVersionFromZip(zipPath) {
  const entries = await readStoredZipEntries(zipPath);
  const manifestEntry = entries.find((entry) => entry.name === "manifest.json");
  if (!manifestEntry || manifestEntry.compression_method !== 0) {
    return null;
  }
  const manifest = JSON.parse(manifestEntry.data.toString("utf8"));
  return `${manifest.version ?? ""}` || null;
}

function findNestedFieldValue(value, candidateKeys) {
  if (!value || typeof value !== "object") {
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findNestedFieldValue(item, candidateKeys);
      if (nested !== null && nested !== undefined) {
        return nested;
      }
    }
    return null;
  }
  for (const [key, nestedValue] of Object.entries(value)) {
    if (candidateKeys.has(key) && nestedValue !== null && nestedValue !== undefined) {
      return nestedValue;
    }
  }
  for (const nestedValue of Object.values(value)) {
    const nested = findNestedFieldValue(nestedValue, candidateKeys);
    if (nested !== null && nested !== undefined) {
      return nested;
    }
  }
  return null;
}

function extractCurrentSandboxItemVersion(publishExecution, fallbackPlan = null) {
  const fromPreUpload = publishExecution?.pre_upload_checks?.remote_crx_version ?? null;
  if (fromPreUpload) {
    return `${fromPreUpload}`;
  }
  const fromFetchBody = findNestedFieldValue(
    publishExecution?.fetch_status_response?.body ?? null,
    new Set(["crxVersion", "crx_version"])
  );
  if (fromFetchBody !== null && fromFetchBody !== undefined) {
    return `${fromFetchBody}`;
  }
  return fallbackPlan?.current_sandbox_item_version ?? null;
}

async function readLatestManagedPublishExecution(projectRoot, runId) {
  const latestPath = path.join(projectRoot, "state", "run_events", runId, "90_publish_execution.json");
  if (!(await fileExists(latestPath))) {
    return null;
  }
  return readJson(latestPath);
}

async function findLatestSameVersionPreUploadFailure(projectRoot, runId) {
  const historyDir = path.join(projectRoot, "state", "run_events", runId, "publish_execution");
  if (!(await fileExists(historyDir))) {
    return null;
  }
  const files = (await listFiles(historyDir))
    .map((entry) => entry.absolutePath)
    .filter((absolutePath) => absolutePath.endsWith(".json"))
    .sort()
    .reverse();

  for (const filePath of files) {
    const report = await readJson(filePath);
    if (
      report.publish_validation_phase === "upload_only"
      && report.failure_phase === "pre_upload_check"
      && report.pre_upload_checks?.version_conflict_detected === true
    ) {
      return {
        filePath,
        report
      };
    }
  }
  return null;
}

async function validateSourceSandboxRun(sourceRunDir) {
  const sourceRunContext = await readJson(artifactPath(sourceRunDir, "00_run_context.json"));
  if ((sourceRunContext.run_type ?? sourceRunContext.task_mode) !== "sandbox_validation") {
    throw new Error(`Source run ${sourceRunContext.run_id} is not a sandbox_validation run.`);
  }
  if (!(await isRunImmutable(sourceRunDir))) {
    throw new Error(`Source sandbox run ${sourceRunContext.run_id} must already be immutable.`);
  }
  for (const relativePath of REQUIRED_COPY_TARGETS) {
    if (!(await fileExists(artifactPath(sourceRunDir, relativePath)))) {
      throw new Error(`Missing required source artifact: ${relativePath}`);
    }
  }
  if (!(await fileExists(artifactPath(sourceRunDir, "83_sandbox_validation_plan.json")))) {
    throw new Error("Source sandbox run is missing 83_sandbox_validation_plan.json.");
  }
  if (!(await fileExists(artifactPath(sourceRunDir, "81_listing_package/extension_package.zip")))) {
    throw new Error("Source sandbox run is missing 81_listing_package/extension_package.zip.");
  }
  return sourceRunContext;
}

async function reserveTargetRunDir(runsRoot, itemId, targetVersion) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const runId = makeSandboxRevisionRunId({
      itemId,
      targetVersion
    });
    const runDir = path.join(runsRoot, runId);
    if (!(await fileExists(runDir))) {
      await ensureDir(runDir);
      return { runId, runDir };
    }
  }
  throw new Error("Could not allocate a unique sandbox upload revision run id.");
}

async function copySourceArtifacts(sourceRunDir, targetRunDir) {
  const copiedArtifacts = [];
  for (const relativePath of REQUIRED_COPY_TARGETS) {
    const sourcePath = artifactPath(sourceRunDir, relativePath);
    const targetPath = artifactPath(targetRunDir, relativePath);
    const stats = await fs.stat(sourcePath);
    if (stats.isDirectory()) {
      await copyDir(sourcePath, targetPath);
    } else {
      await ensureDir(path.dirname(targetPath));
      await fs.copyFile(sourcePath, targetPath);
    }
    copiedArtifacts.push(relativePath.replaceAll("\\", "/"));
  }
  return copiedArtifacts;
}

async function rewriteManifestVersion(manifestPath, targetVersion) {
  const manifest = await readJson(manifestPath);
  manifest.version = targetVersion;
  await writeJson(manifestPath, manifest);
}

async function materializeWorkspaceFromSourceZip({
  sourceExtensionPackagePath,
  targetRunDir,
  targetManifestVersion
}) {
  const workspaceDistDir = artifactPath(targetRunDir, "workspace/dist");
  const workspaceRepoDir = artifactPath(targetRunDir, "workspace/repo");
  await ensureDir(workspaceDistDir);
  await ensureDir(workspaceRepoDir);
  await extractStoredZipToDirectory(sourceExtensionPackagePath, workspaceDistDir);
  await copyDir(workspaceDistDir, workspaceRepoDir);
  await rewriteManifestVersion(path.join(workspaceDistDir, "manifest.json"), targetManifestVersion);
  await rewriteManifestVersion(path.join(workspaceRepoDir, "manifest.json"), targetManifestVersion);

  const workspacePackageZip = artifactPath(targetRunDir, "workspace/package.zip");
  await createZipFromDirectory(workspaceDistDir, workspacePackageZip);

  return {
    workspaceDistDir,
    workspaceRepoDir,
    workspacePackageZip
  };
}

async function refreshBuildReport({
  targetRunDir,
  workspaceDistDir,
  workspaceRepoDir,
  workspacePackageZip,
  targetManifestVersion
}) {
  const buildReportPath = artifactPath(targetRunDir, "50_build_report.json");
  const buildReport = await readJson(buildReportPath);
  const generatedFiles = (await listFiles(workspaceDistDir)).map((entry) => entry.relativePath);
  const refreshed = {
    ...buildReport,
    generated_at: nowIso(),
    workspace_repo: workspaceRepoDir,
    workspace_dist: workspaceDistDir,
    package_zip: workspacePackageZip,
    package_zip_size: await fileSize(workspacePackageZip),
    manifest_version: targetManifestVersion,
    generated_files: generatedFiles
  };
  await writeJson(buildReportPath, refreshed);
  return refreshed;
}

async function regenerateListingPackage({
  sourceRunDir,
  targetRunDir,
  workspacePackageZip,
  targetManifestVersion,
  packageSha256,
  currentSandboxItemVersion
}) {
  const sourceListingPackageDir = artifactPath(sourceRunDir, "81_listing_package");
  const targetListingPackageDir = artifactPath(targetRunDir, "81_listing_package");
  await copyDir(sourceListingPackageDir, targetListingPackageDir);
  await fs.copyFile(workspacePackageZip, artifactPath(targetListingPackageDir, "extension_package.zip"));
  const targetListingPackageZip = artifactPath(targetRunDir, "81_listing_package.zip");
  const reportPath = artifactPath(targetRunDir, "81_listing_package_report.json");
  const sourceReportPath = artifactPath(sourceRunDir, "81_listing_package_report.json");
  const packageManifestPath = artifactPath(targetListingPackageDir, "package_manifest.json");

  const baseReport = await readJson(sourceReportPath);
  const refreshedReport = {
    ...baseReport,
    generated_at: nowIso(),
    package_dir: targetListingPackageDir,
    package_zip: targetListingPackageZip,
    extension_package: "extension_package.zip",
    extension_package_sha256: packageSha256,
    manifest_version: targetManifestVersion,
    current_sandbox_item_version: currentSandboxItemVersion
  };
  await writeJson(packageManifestPath, refreshedReport);
  await createZipFromDirectory(targetListingPackageDir, targetListingPackageZip);
  refreshedReport.package_zip_size = await fileSize(targetListingPackageZip);
  await writeJson(packageManifestPath, refreshedReport);
  await writeJson(reportPath, refreshedReport);
  return {
    report: refreshedReport,
    packageZipPath: targetListingPackageZip
  };
}

function buildRevisionRunContext({
  sourceRunContext,
  sourceRunDir,
  targetRunId,
  targetManifestVersion,
  currentSandboxItemVersion,
  previousManifestVersion,
  versionBumpStrategy,
  note,
  preparedBy
}) {
  const sourceDailyRunId = sourceRunContext.source_daily_run_id ?? sourceRunContext.source_run_id ?? null;
  const sourceDailyRunPath = sourceRunContext.source_daily_run_path ?? sourceRunContext.source_run_path ?? null;
  return {
    ...sourceRunContext,
    stage: "SANDBOX_UPLOAD_REVISION",
    status: "passed",
    generated_at: nowIso(),
    task_mode: "sandbox_validation",
    run_type: "sandbox_validation",
    run_id: targetRunId,
    run_id_strategy: "sandbox_upload_revision_unique",
    allow_overwrite: false,
    overwrite_blocked: false,
    created_at: nowIso(),
    source_run_id: sourceRunContext.run_id,
    source_run_path: sourceRunDir,
    source_sandbox_run_id: sourceRunContext.run_id,
    source_sandbox_run_path: sourceRunDir,
    source_daily_run_id: sourceDailyRunId,
    source_daily_run_path: sourceDailyRunPath,
    latest_revision_run_id: targetRunId,
    revision_kind: "sandbox_upload_revision",
    revision_note: note,
    prepared_by: preparedBy,
    previous_manifest_version: previousManifestVersion,
    current_sandbox_item_version: currentSandboxItemVersion,
    target_manifest_version: targetManifestVersion,
    version_bump_strategy: versionBumpStrategy,
    publish: {
      ...sourceRunContext.publish,
      execution_mode: "sandbox_validate",
      publish_validation_phase: "fetch_status_only",
      execution_lane: "existing_item_update_dry_run",
      allow_public_release: false
    }
  };
}

function pseudoPublishExecution({
  runContext,
  packageSha256,
  manifestVersion,
  candidateId
}) {
  return {
    stage: "EXECUTE_PUBLISH_PLAN",
    run_id: runContext.run_id,
    run_type: runContext.run_type ?? runContext.task_mode,
    source_run_id: runContext.source_run_id ?? null,
    status: "passed",
    execution_mode: "sandbox_validate",
    publish_validation_phase: "fetch_status_only",
    publisher_id: runContext.publisher_id ?? runContext.publish?.publisher_id ?? null,
    item_id: runContext.item_id ?? runContext.publish?.sandbox_item_id ?? null,
    package_sha256: packageSha256,
    manifest_version: manifestVersion,
    candidate_id: candidateId,
    sandbox_fetch_status_verified: false,
    sandbox_upload_verified: false,
    publish_response: {
      executed: false,
      ok: null,
      body: null
    }
  };
}

export async function prepareSandboxUploadRevision({
  projectRoot,
  sourceRunDir,
  targetVersion = "auto",
  note,
  preparedBy = os.userInfo().username
}) {
  const absoluteSourceRunDir = path.resolve(sourceRunDir);
  const sourceRunContext = await validateSourceSandboxRun(absoluteSourceRunDir);
  const sourcePlan = await readJson(artifactPath(absoluteSourceRunDir, "83_sandbox_validation_plan.json"));
  const latestPublishExecution = await readLatestManagedPublishExecution(projectRoot, sourceRunContext.run_id);
  const latestSameVersionFailure = await findLatestSameVersionPreUploadFailure(projectRoot, sourceRunContext.run_id);

  if (!latestSameVersionFailure) {
    throw new Error("sandbox:prepare-upload-revision requires a prior upload_only failure caused by same-version pre_upload_check.");
  }

  const previousManifestVersion = sourcePlan.manifest_version
    ?? latestSameVersionFailure.report.manifest_version
    ?? await readManifestVersionFromZip(artifactPath(absoluteSourceRunDir, "81_listing_package/extension_package.zip"));
  if (!previousManifestVersion) {
    throw new Error("Could not determine previous manifest.version from the source sandbox run.");
  }
  parseChromeExtensionVersion(previousManifestVersion);

  const currentSandboxItemVersion = extractCurrentSandboxItemVersion(latestPublishExecution, sourcePlan)
    ?? latestSameVersionFailure.report.pre_upload_checks?.remote_crx_version
    ?? null;
  if (!currentSandboxItemVersion) {
    throw new Error("Could not determine current sandbox item version from fetchStatus or the prior upload failure.");
  }
  parseChromeExtensionVersion(currentSandboxItemVersion);

  const resolvedVersion = `${targetVersion}` === "auto"
    ? resolveAutoChromeExtensionVersion({
        sourceVersion: previousManifestVersion,
        currentSandboxItemVersion,
        strategy: "patch"
      })
    : {
        targetVersion: ensureChromeExtensionVersionGreaterThan(`${targetVersion}`, currentSandboxItemVersion),
        strategyUsed: compareChromeExtensionVersions(`${targetVersion}`, previousManifestVersion) > 0
          ? "explicit"
          : "explicit_reuse_existing_uploadable_version"
      };

  const targetManifestVersion = resolvedVersion.targetVersion;
  const runsRoot = path.dirname(absoluteSourceRunDir);
  const { runId, runDir } = await reserveTargetRunDir(
    runsRoot,
    sourceRunContext.item_id ?? sourceRunContext.publish?.sandbox_item_id ?? "sandbox",
    targetManifestVersion
  );

  const copiedArtifacts = await copySourceArtifacts(absoluteSourceRunDir, runDir);
  const runContext = buildRevisionRunContext({
    sourceRunContext,
    sourceRunDir: absoluteSourceRunDir,
    targetRunId: runId,
    targetManifestVersion,
    currentSandboxItemVersion,
    previousManifestVersion,
    versionBumpStrategy: resolvedVersion.strategyUsed,
    note: `${note ?? ""}`,
    preparedBy
  });
  await writeJson(artifactPath(runDir, "00_run_context.json"), runContext);

  const workspace = await materializeWorkspaceFromSourceZip({
    sourceExtensionPackagePath: artifactPath(absoluteSourceRunDir, "81_listing_package/extension_package.zip"),
    targetRunDir: runDir,
    targetManifestVersion
  });
  const newPackageSha256 = await hashFile(workspace.workspacePackageZip);
  const refreshedBuildReport = await refreshBuildReport({
    targetRunDir: runDir,
    workspaceDistDir: workspace.workspaceDistDir,
    workspaceRepoDir: workspace.workspaceRepoDir,
    workspacePackageZip: workspace.workspacePackageZip,
    targetManifestVersion
  });

  const regeneratedListingPackage = await regenerateListingPackage({
    sourceRunDir: absoluteSourceRunDir,
    targetRunDir: runDir,
    workspacePackageZip: workspace.workspacePackageZip,
    targetManifestVersion,
    packageSha256: newPackageSha256,
    currentSandboxItemVersion
  });

  const selectedCandidate = await readJson(artifactPath(runDir, "31_selected_candidate.json"));
  const brief = await readJson(artifactPath(runDir, "41_product_brief.json"));
  const implementationPlan = await readJson(artifactPath(runDir, "42_implementation_plan.json"));
  const screenshotManifest = await readJson(artifactPath(runDir, "70_screenshot_manifest.json"));
  const policyGate = await readJson(artifactPath(runDir, "72_policy_gate.json"));
  const publishPlan = await readJson(artifactPath(runDir, "80_publish_plan.json"));
  const qaReport = await readJson(artifactPath(runDir, "60_qa_report.json"));
  const browserSmoke = await readJson(artifactPath(runDir, "61_browser_smoke.json"));

  const sandboxValidationPlan = buildSafeReport({
    stage: "SANDBOX_UPLOAD_REVISION",
    status: "passed",
    run_id: runId,
    run_type: "sandbox_validation",
    source_run_id: sourceRunContext.run_id,
    source_sandbox_run_id: sourceRunContext.run_id,
    source_daily_run_id: sourceRunContext.source_daily_run_id ?? sourceRunContext.source_run_id ?? null,
    publisher_id: runContext.publisher_id ?? runContext.publish?.publisher_id ?? null,
    item_id: runContext.item_id ?? runContext.publish?.sandbox_item_id ?? null,
    item_name: selectedCandidate?.candidate?.name ?? brief?.product_name_working ?? null,
    promoted_at: nowIso(),
    promoted_by: preparedBy,
    promotion_note: `${note ?? ""}`,
    source_artifacts: REQUIRED_COPY_TARGETS.map((relativePath) => relativePath.replaceAll("\\", "/")),
    copied_artifacts: copiedArtifacts,
    regenerated_artifacts: [
      "00_run_context.json",
      "50_build_report.json",
      "81_listing_package",
      "81_listing_package.zip",
      "81_listing_package_report.json",
      "83_sandbox_validation_plan.json",
      SANDBOX_UPLOAD_REVISION_ARTIFACT,
      "workspace/dist",
      "workspace/package.zip",
      "workspace/repo"
    ],
    package_sha256: newPackageSha256,
    manifest_version: targetManifestVersion,
    current_sandbox_item_version: currentSandboxItemVersion,
    previous_manifest_version: previousManifestVersion,
    target_manifest_version: targetManifestVersion,
    version_bump_strategy: resolvedVersion.strategyUsed,
    extension_name: browserSmoke?.extension_name ?? brief?.product_name_working ?? null,
    archetype: refreshedBuildReport?.archetype ?? selectedCandidate?.candidate?.wedge_family ?? null,
    wedge: selectedCandidate?.candidate?.name ?? brief?.product_name_working ?? null,
    policy_status: policyGate?.status ?? null,
    qa_status: qaReport?.overall_status ?? null,
    browser_smoke_status: browserSmoke?.status ?? null,
    screenshot_manifest_status: screenshotManifest?.status ?? null,
    listing_package_status: regeneratedListingPackage.report?.status ?? null,
    publish_allowed: false,
    upload_allowed: false,
    production_write: false,
    required_next_action: "write_approval_required_for_bumped_package",
    safety_checks: {
      source_run_immutable: true,
      source_failure_phase: latestSameVersionFailure.report.failure_phase,
      source_failure_reason: latestSameVersionFailure.report.failure_reason,
      same_version_conflict_confirmed: true,
      approval_invalidated: true,
      version_uploadable: compareChromeExtensionVersions(targetManifestVersion, currentSandboxItemVersion) > 0
    }
  });
  await validateArtifact(projectRoot, "sandbox_validation_plan.schema.json", "83_sandbox_validation_plan.json", sandboxValidationPlan);
  await writeJson(artifactPath(runDir, "83_sandbox_validation_plan.json"), sandboxValidationPlan);

  const revisionArtifact = buildSafeReport({
    stage: "SANDBOX_UPLOAD_REVISION",
    status: "passed",
    run_id: runId,
    run_type: "sandbox_validation",
    source_sandbox_run_id: sourceRunContext.run_id,
    source_daily_run_id: sourceRunContext.source_daily_run_id ?? sourceRunContext.source_run_id ?? null,
    publisher_id: runContext.publisher_id ?? runContext.publish?.publisher_id ?? null,
    item_id: runContext.item_id ?? runContext.publish?.sandbox_item_id ?? null,
    previous_manifest_version: previousManifestVersion,
    current_sandbox_item_version: currentSandboxItemVersion,
    target_manifest_version: targetManifestVersion,
    version_bump_strategy: resolvedVersion.strategyUsed,
    old_package_sha256: sourcePlan.package_sha256 ?? "",
    new_package_sha256: newPackageSha256,
    copied_artifacts: copiedArtifacts,
    regenerated_artifacts: [
      "00_run_context.json",
      "50_build_report.json",
      "81_listing_package",
      "81_listing_package.zip",
      "81_listing_package_report.json",
      "83_sandbox_validation_plan.json",
      "84_sandbox_preflight.json",
      SANDBOX_UPLOAD_REVISION_ARTIFACT,
      "99_close_run.json",
      ".immutable",
      "workspace/dist",
      "workspace/package.zip",
      "workspace/repo"
    ],
    approval_invalidated: true,
    upload_allowed: false,
    publish_allowed: false,
    next_step: "write_approval_required_for_bumped_package",
    safety_checks: {
      source_run_immutable: true,
      same_version_failure_confirmed: true,
      old_approval_copied: false,
      old_publish_sidecars_copied: false,
      version_uploadable: compareChromeExtensionVersions(targetManifestVersion, currentSandboxItemVersion) > 0
    }
  });
  await validateArtifact(projectRoot, "sandbox_upload_revision.schema.json", SANDBOX_UPLOAD_REVISION_ARTIFACT, revisionArtifact);
  await writeJson(artifactPath(runDir, SANDBOX_UPLOAD_REVISION_ARTIFACT), revisionArtifact);

  const planRelativePath = normalizeRelativePath(projectRoot, artifactPath(runDir, "83_sandbox_validation_plan.json"));
  const revisionRelativePath = normalizeRelativePath(projectRoot, artifactPath(runDir, SANDBOX_UPLOAD_REVISION_ARTIFACT));
  const ledgerEntry = await appendReleaseLedgerEntry(projectRoot, {
    run_id: runId,
    source_run_id: sourceRunContext.source_daily_run_id ?? sourceRunContext.source_run_id ?? null,
    sandbox_run_id: runId,
    source_sandbox_run_id: sourceRunContext.run_id,
    new_sandbox_run_id: runId,
    item_id: runContext.item_id ?? runContext.publish?.sandbox_item_id ?? null,
    publisher_id: runContext.publisher_id ?? runContext.publish?.publisher_id ?? null,
    item_name: sandboxValidationPlan.item_name,
    package_sha256: newPackageSha256,
    manifest_version: targetManifestVersion,
    previous_manifest_version: previousManifestVersion,
    target_manifest_version: targetManifestVersion,
    old_package_sha256: sourcePlan.package_sha256 ?? "",
    new_package_sha256: newPackageSha256,
    action_type: "sandbox_prepare_upload_revision",
    action_source: "cli",
    action_status: "passed",
    occurred_at: nowIso(),
    evidence_artifacts: [planRelativePath, revisionRelativePath],
    evidence_hashes: {
      [planRelativePath]: await hashFile(artifactPath(runDir, "83_sandbox_validation_plan.json")),
      [revisionRelativePath]: await hashFile(artifactPath(runDir, SANDBOX_UPLOAD_REVISION_ARTIFACT))
    },
    chrome_webstore_response_summary: null,
    approval_artifact: null,
    production_write: false,
    sandbox_only: true
  });

  const closeRunReport = await runCloseRunStage({
    runDir,
    runContext,
    selectedReport: selectedCandidate,
    brief,
    plan: implementationPlan,
    screenshotManifest,
    publishPlan,
    publishExecution: pseudoPublishExecution({
      runContext,
      packageSha256: newPackageSha256,
      manifestVersion: targetManifestVersion,
      candidateId: selectedCandidate?.selected_candidate_id ?? null
    }),
    reviewStatus: null,
    monitoringSnapshot: null,
    learningUpdate: null,
    policyGate
  });

  const preflightReport = await runSandboxPreflight({ runDir });

  return {
    runDir,
    runId,
    revisionArtifact,
    sandboxValidationPlan,
    closeRunReport,
    preflightReport,
    ledgerEntry
  };
}
