import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadPortfolioRegistry, summarizePortfolioRegistry } from "../portfolio/registry.mjs";
import { appendReleaseLedgerEntry } from "../publish/releaseLedger.mjs";
import { hasSecretLikeContent, inspectSecretLikeContent, redactSecretLikeValue } from "../utils/redaction.mjs";
import { assertMatchesSchema } from "../utils/schema.mjs";
import {
  copyDir,
  ensureDir,
  fileExists,
  listFiles,
  nowIso,
  readJson,
  writeJson,
  writeText
} from "../utils/io.mjs";
import { runCloseRunStage } from "./closeRun.mjs";
import { prepareRunIdentity } from "./runId.mjs";

export const SANDBOX_VALIDATION_PLAN_ARTIFACT = "83_sandbox_validation_plan.json";

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
  "80_publish_plan.json",
  "81_listing_package",
  "81_listing_package.zip",
  "81_listing_package_report.json"
];

function artifactPath(runDir, fileName) {
  return path.join(runDir, fileName);
}

function normalizeRelativePath(basePath, absolutePath) {
  return path.relative(basePath, absolutePath).replaceAll("\\", "/");
}

function sidecarSafeReport(reportWithoutChecks) {
  const initialChecks = inspectSecretLikeContent(reportWithoutChecks);
  const redactionGuardTriggered = hasSecretLikeContent(initialChecks);
  const safeReport = redactSecretLikeValue(reportWithoutChecks);

  if (redactionGuardTriggered) {
    safeReport.status = "failed";
    safeReport.required_next_action = "remove secret-like content from promotion inputs and retry";
  }

  return {
    ...safeReport,
    redaction_checks: {
      ...inspectSecretLikeContent(safeReport),
      redaction_guard_triggered: redactionGuardTriggered
    }
  };
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function hashFile(filePath) {
  return sha256Buffer(await fs.readFile(filePath));
}

async function readOptionalJson(filePath) {
  if (!(await fileExists(filePath))) {
    return null;
  }
  return readJson(filePath);
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

async function readManifestVersionFromZip(zipPath) {
  const entries = await readStoredZipEntries(zipPath);
  const manifestEntry = entries.find((entry) => entry.name === "manifest.json");
  if (!manifestEntry || manifestEntry.compression_method !== 0) {
    return null;
  }
  const manifest = JSON.parse(manifestEntry.data.toString("utf8"));
  return `${manifest.version ?? ""}` || null;
}

function pseudoPublishExecution({
  publisherId,
  itemId,
  packageSha256,
  manifestVersion,
  candidateId
}) {
  return {
    stage: "EXECUTE_PUBLISH_PLAN",
    status: "passed",
    execution_mode: "sandbox_validate",
    publish_validation_phase: "fetch_status_only",
    publisher_id: publisherId,
    item_id: itemId,
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

async function validateSourceRunForPromotion(sourceRunDir) {
  const blockers = [];
  const selectedCandidate = await readOptionalJson(artifactPath(sourceRunDir, "31_selected_candidate.json"));
  const brief = await readOptionalJson(artifactPath(sourceRunDir, "41_product_brief.json"));
  const plan = await readOptionalJson(artifactPath(sourceRunDir, "42_implementation_plan.json"));
  const buildReport = await readOptionalJson(artifactPath(sourceRunDir, "50_build_report.json"));
  const qaReport = await readOptionalJson(artifactPath(sourceRunDir, "60_qa_report.json"));
  const browserSmokeReport = await readOptionalJson(artifactPath(sourceRunDir, "61_browser_smoke.json"));
  const screenshotManifest = await readOptionalJson(artifactPath(sourceRunDir, "70_screenshot_manifest.json"));
  const policyGate = await readOptionalJson(artifactPath(sourceRunDir, "72_policy_gate.json"));
  const publishPlan = await readOptionalJson(artifactPath(sourceRunDir, "80_publish_plan.json"));
  const listingPackageReport = await readOptionalJson(artifactPath(sourceRunDir, "81_listing_package_report.json"));
  const premiumPackagingBrief = await readOptionalJson(artifactPath(sourceRunDir, "111_premium_packaging_brief.json"));
  const listingQualityGate = await readOptionalJson(artifactPath(sourceRunDir, "115_listing_quality_gate.json"));
  const assetQualityReport = await readOptionalJson(artifactPath(sourceRunDir, "118_asset_quality_report.json"));
  const storeReleasePackageReport = await readOptionalJson(artifactPath(sourceRunDir, "120_store_listing_release_package_report.json"));
  const humanVisualReview = await readOptionalJson(artifactPath(sourceRunDir, "121_human_visual_review.json"));
  const closeRunReport = await readOptionalJson(artifactPath(sourceRunDir, "99_close_run.json"));

  if (buildReport?.status !== "passed") {
    blockers.push("BUILD_EXTENSION must pass before sandbox promotion.");
  }
  if (qaReport?.overall_status !== "passed") {
    blockers.push("RUN_QA must pass before sandbox promotion.");
  }
  if (browserSmokeReport?.status !== "passed") {
    blockers.push("BROWSER_SMOKE_AND_CAPTURE must pass before sandbox promotion.");
  }
  if (!["passed", "conditional_pass"].includes(`${policyGate?.status ?? ""}`)) {
    blockers.push("RUN_POLICY_GATE must be passed or conditional_pass before sandbox promotion.");
  }
  if (listingPackageReport?.status !== "passed") {
    blockers.push("PREPARE_LISTING_PACKAGE must pass before sandbox promotion.");
  }
  if (premiumPackagingBrief && !listingQualityGate) {
    blockers.push("PREMIUM_PRODUCT_PACKAGING produced artifacts, but 115_listing_quality_gate.json is missing.");
  }
  if (listingQualityGate && listingQualityGate.passed !== true) {
    blockers.push("LISTING_QUALITY_GATE must pass before sandbox promotion when premium packaging artifacts exist.");
  }
  if (assetQualityReport && assetQualityReport.status !== "passed") {
    blockers.push("ASSET_QA must pass before sandbox promotion when premium assets exist.");
  }
  if (storeReleasePackageReport && storeReleasePackageReport.package_status !== "passed") {
    blockers.push("STORE_LISTING_RELEASE_PACKAGE_V2 must pass before sandbox promotion when a release package exists.");
  }
  if (
    storeReleasePackageReport?.human_visual_review_required === true
    && humanVisualReview
    && humanVisualReview.decision !== "passed"
  ) {
    blockers.push("Human visual review is present but not passed.");
  }
  if (!publishPlan) {
    blockers.push("Missing 80_publish_plan.json.");
  }

  for (const relativePath of REQUIRED_COPY_TARGETS) {
    if (!(await fileExists(artifactPath(sourceRunDir, relativePath)))) {
      blockers.push(`Missing required source artifact: ${relativePath}`);
    }
  }

  return {
    blockers,
    selectedCandidate,
    brief,
    plan,
    buildReport,
    qaReport,
    browserSmokeReport,
    screenshotManifest,
    policyGate,
    publishPlan,
    listingPackageReport,
    premiumPackagingBrief,
    listingQualityGate,
    assetQualityReport,
    storeReleasePackageReport,
    humanVisualReview,
    closeRunReport
  };
}

async function ensureSourceRunClosedIfNeeded({
  sourceRunDir,
  sourceRunContext,
  validation
}) {
  const immutablePath = artifactPath(sourceRunDir, ".immutable");
  if ((await fileExists(immutablePath)) && validation.closeRunReport) {
    return validation.closeRunReport;
  }

  return runCloseRunStage({
    runDir: sourceRunDir,
    runContext: sourceRunContext,
    selectedReport: validation.selectedCandidate,
    brief: validation.brief,
    plan: validation.plan,
    screenshotManifest: validation.screenshotManifest,
    publishPlan: validation.publishPlan,
    publishExecution: await readOptionalJson(artifactPath(sourceRunDir, "90_publish_execution.json")),
    reviewStatus: await readOptionalJson(artifactPath(sourceRunDir, "91_review_status.json")),
    monitoringSnapshot: await readOptionalJson(artifactPath(sourceRunDir, "95_monitoring_snapshot.json")),
    learningUpdate: await readOptionalJson(artifactPath(sourceRunDir, "96_learning_update.json")),
    policyGate: validation.policyGate
  });
}

async function copyPromotionArtifacts(sourceRunDir, targetRunDir) {
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

async function validateSandboxValidationPlan(projectRoot, data) {
  await assertMatchesSchema({
    data,
    schemaPath: path.join(projectRoot, "schemas", "sandbox_validation_plan.schema.json"),
    label: SANDBOX_VALIDATION_PLAN_ARTIFACT
  });
}

function buildPromotionRunContext({
  sourceRunContext,
  sourceRunDir,
  runIdentity,
  publisherId,
  itemId,
  promotedAt,
  promotedBy,
  promotionNote,
  registrySummary,
  immutableSource
}) {
  return {
    ...sourceRunContext,
    stage: "PROMOTE_TO_SANDBOX_VALIDATION",
    status: "passed",
    generated_at: promotedAt,
    task_mode: "sandbox_validation",
    run_type: "sandbox_validation",
    run_id: runIdentity.runId,
    run_id_strategy: runIdentity.runIdStrategy,
    allow_overwrite: false,
    overwrite_blocked: false,
    created_at: runIdentity.createdAt ?? promotedAt,
    source_run_id: sourceRunContext.run_id,
    source_run_path: sourceRunDir,
    publisher_id: publisherId,
    item_id: itemId,
    promoted_at: promotedAt,
    promoted_by: promotedBy,
    promotion_note: promotionNote,
    immutable_source: immutableSource,
    publish: {
      ...sourceRunContext.publish,
      publisher_id: publisherId,
      existing_item_id: itemId,
      sandbox_item_id: itemId,
      execution_mode: "sandbox_validate",
      publish_validation_phase: "fetch_status_only",
      execution_lane: "existing_item_update_dry_run",
      allow_public_release: false
    },
    portfolio_registry: {
      path: sourceRunContext.portfolio_registry?.path ?? path.join(sourceRunContext.project_root, "state", "portfolio_registry.json"),
      active_wedge_families: registrySummary.active_wedge_families,
      blocked_candidate_ids: registrySummary.blocked_candidate_ids,
      archetype_priors: registrySummary.archetype_priors,
      item_count: registrySummary.item_count
    }
  };
}

export async function promoteToSandboxValidation({
  projectRoot,
  sourceRunDir,
  publisherId,
  itemId,
  promotionNote,
  promotedBy = os.userInfo().username
}) {
  const absoluteSourceRunDir = path.resolve(sourceRunDir);
  const sourceRunContext = await readJson(artifactPath(absoluteSourceRunDir, "00_run_context.json"));
  if (sourceRunContext.run_type === "sandbox_validation" || sourceRunContext.task_mode === "sandbox_validation") {
    throw new Error("Promotion source must be a completed daily run, not an existing sandbox_validation run.");
  }

  const validation = await validateSourceRunForPromotion(absoluteSourceRunDir);
  if (validation.blockers.length > 0) {
    throw new Error(`Sandbox promotion blocked: ${validation.blockers.join(" ")}`);
  }

  await ensureSourceRunClosedIfNeeded({
    sourceRunDir: absoluteSourceRunDir,
    sourceRunContext,
    validation
  });

  const registrySummary = summarizePortfolioRegistry(await loadPortfolioRegistry(projectRoot));
  const runIdentity = await prepareRunIdentity({
    task: {
      ...sourceRunContext,
      mode: "sandbox_validation",
      publish: {
        ...sourceRunContext.publish,
        sandbox_item_id: itemId
      }
    },
    taskPath: sourceRunContext.task_path,
    runsRoot: path.dirname(absoluteSourceRunDir)
  });

  const promotedAt = nowIso();
  const targetRunDir = runIdentity.runDir;
  await ensureDir(targetRunDir);

  const promotionRunContext = buildPromotionRunContext({
    sourceRunContext,
    sourceRunDir: absoluteSourceRunDir,
    runIdentity,
    publisherId,
    itemId,
    promotedAt,
    promotedBy,
    promotionNote: promotionNote ?? "",
    registrySummary,
    immutableSource: await fileExists(artifactPath(absoluteSourceRunDir, ".immutable"))
  });

  await writeJson(artifactPath(targetRunDir, "00_run_context.json"), promotionRunContext);
  const copiedArtifacts = await copyPromotionArtifacts(absoluteSourceRunDir, targetRunDir);

  const extensionPackagePath = artifactPath(targetRunDir, "81_listing_package/extension_package.zip");
  const packageSha256 = await hashFile(extensionPackagePath);
  const manifestVersion = await readManifestVersionFromZip(extensionPackagePath);
  const sourceArtifacts = REQUIRED_COPY_TARGETS.map((relativePath) => relativePath.replaceAll("\\", "/"));
  const promotionPlan = sidecarSafeReport({
    stage: "PROMOTE_TO_SANDBOX_VALIDATION",
    status: "passed",
    run_id: promotionRunContext.run_id,
    run_type: "sandbox_validation",
    source_run_id: sourceRunContext.run_id,
    publisher_id: publisherId,
    item_id: itemId,
    item_name: validation.selectedCandidate?.candidate?.name ?? validation.brief?.product_name_working ?? null,
    promoted_at: promotedAt,
    promoted_by: promotedBy,
    promotion_note: promotionNote ?? "",
    source_artifacts: sourceArtifacts,
    copied_artifacts: copiedArtifacts,
    package_sha256: packageSha256,
    manifest_version: manifestVersion,
    extension_name: validation.browserSmokeReport?.extension_name ?? validation.brief?.product_name_working ?? null,
    archetype: validation.buildReport?.archetype ?? validation.selectedCandidate?.candidate?.wedge_family ?? null,
    wedge: validation.selectedCandidate?.candidate?.name ?? validation.brief?.product_name_working ?? null,
    policy_status: validation.policyGate?.status ?? null,
    qa_status: validation.qaReport?.overall_status ?? null,
    browser_smoke_status: validation.browserSmokeReport?.status ?? null,
    screenshot_manifest_status: validation.screenshotManifest?.status ?? "passed",
    listing_package_status: validation.listingPackageReport?.status ?? null,
    publish_allowed: false,
    upload_allowed: false,
    production_write: false,
    required_next_action: "human_approval_required_for_sandbox_upload",
    safety_checks: {
      source_run_closed: true,
      source_run_immutable: promotionRunContext.immutable_source,
      copied_required_artifacts: true,
      excluded_artifacts: [
        "82_human_approval.json",
        "90_publish_execution.json",
        "91_review_status.json",
        "95_monitoring_snapshot.json",
        "96_learning_update.json"
      ],
      publish_execution_mode: promotionRunContext.publish.execution_mode,
      publish_validation_phase: promotionRunContext.publish.publish_validation_phase
    }
  });
  await validateSandboxValidationPlan(projectRoot, promotionPlan);
  await writeJson(artifactPath(targetRunDir, SANDBOX_VALIDATION_PLAN_ARTIFACT), promotionPlan);
  await writeJson(artifactPath(targetRunDir, "run_status.json"), {
    stage: "PROMOTE_TO_SANDBOX_VALIDATION",
    status: "passed",
    generated_at: promotedAt,
    run_id: promotionRunContext.run_id,
    run_id_strategy: promotionRunContext.run_id_strategy,
    allow_overwrite: false,
    overwrite_blocked: false,
    created_at: promotionRunContext.created_at,
    failure_reason: null
  });

  const promotionArtifactPath = normalizeRelativePath(projectRoot, artifactPath(targetRunDir, SANDBOX_VALIDATION_PLAN_ARTIFACT));
  const promotionArtifactHash = await hashFile(artifactPath(targetRunDir, SANDBOX_VALIDATION_PLAN_ARTIFACT));
  const ledgerEntry = await appendReleaseLedgerEntry(projectRoot, {
    run_id: promotionRunContext.run_id,
    source_run_id: sourceRunContext.run_id,
    sandbox_run_id: promotionRunContext.run_id,
    item_id: itemId,
    publisher_id: publisherId,
    item_name: promotionPlan.item_name,
    package_sha256: packageSha256,
    manifest_version: manifestVersion,
    action_type: "promote_to_sandbox_validation",
    action_source: "cli",
    action_status: "passed",
    occurred_at: promotedAt,
    evidence_artifacts: [promotionArtifactPath],
    evidence_hashes: {
      [promotionArtifactPath]: promotionArtifactHash
    },
    chrome_webstore_response_summary: null,
    approval_artifact: null,
    production_write: false,
    sandbox_only: true
  });

  const closeRunReport = await runCloseRunStage({
    runDir: targetRunDir,
    runContext: promotionRunContext,
    selectedReport: validation.selectedCandidate,
    brief: validation.brief,
    plan: validation.plan,
    screenshotManifest: validation.screenshotManifest,
    publishPlan: validation.publishPlan,
    publishExecution: pseudoPublishExecution({
      publisherId,
      itemId,
      packageSha256,
      manifestVersion,
      candidateId: validation.selectedCandidate?.selected_candidate_id ?? null
    }),
    reviewStatus: null,
    monitoringSnapshot: null,
    learningUpdate: null,
    policyGate: validation.policyGate
  });

  return {
    runDir: targetRunDir,
    runId: promotionRunContext.run_id,
    promotionPlan,
    closeRunReport,
    ledgerEntry
  };
}

export async function inspectSandboxValidationRun({
  runDir,
  eventArtifacts,
  latestApproval = null,
  latestPublishExecution = null,
  latestReviewStatus = null,
  ledgerEntries = []
}) {
  const runContext = await readJson(artifactPath(runDir, "00_run_context.json"));
  const plan = await readJson(artifactPath(runDir, SANDBOX_VALIDATION_PLAN_ARTIFACT));
  const latestPublishStatus = latestPublishExecution?.publish_response?.body?.state
    ?? latestPublishExecution?.status
    ?? "not_started";
  const latestReviewState = latestReviewStatus?.current_dashboard_state
    ?? latestReviewStatus?.status
    ?? "not_started";
  const latestApprovalStatus = latestApproval?.approval_status ?? "not_requested";

  return {
    run_id: runContext.run_id,
    run_type: runContext.run_type ?? runContext.task_mode,
    source_run_id: runContext.source_run_id ?? null,
    item_id: runContext.item_id ?? runContext.publish?.sandbox_item_id ?? null,
    publisher_id: runContext.publisher_id ?? runContext.publish?.publisher_id ?? null,
    package_sha256: plan.package_sha256,
    manifest_version: plan.manifest_version,
    latest_approval_status: latestApprovalStatus,
    latest_publish_status: latestPublishStatus,
    latest_review_status: latestReviewState,
    ledger_entries_count: ledgerEntries.length,
    next_step: latestReviewStatus?.next_step
      ?? latestPublishExecution?.next_step
      ?? latestApproval?.next_step
      ?? plan.required_next_action,
    event_artifacts: eventArtifacts
  };
}

export async function validateSandboxValidationRun({
  projectRoot,
  runDir,
  runContext,
  plan
}) {
  const blockers = [];
  if ((runContext.run_type ?? runContext.task_mode) !== "sandbox_validation") {
    blockers.push("run_type must be sandbox_validation.");
  }
  for (const relativePath of REQUIRED_COPY_TARGETS) {
    if (!(await fileExists(artifactPath(runDir, relativePath)))) {
      blockers.push(`missing copied artifact ${relativePath}`);
    }
  }
  for (const forbidden of [
    "82_human_approval.json",
    "90_publish_execution.json",
    "91_review_status.json",
    "95_monitoring_snapshot.json",
    "96_learning_update.json"
  ]) {
    if (await fileExists(artifactPath(runDir, forbidden))) {
      blockers.push(`immutable sandbox_validation run must not contain ${forbidden} inside run directory`);
    }
  }
  if (!(await fileExists(artifactPath(runDir, ".immutable")))) {
    blockers.push("sandbox_validation run must be frozen with .immutable.");
  }
  if (!(await fileExists(artifactPath(runDir, "99_close_run.json")))) {
    blockers.push("sandbox_validation run must contain 99_close_run.json.");
  }
  if (runContext.revision_kind === "sandbox_upload_revision" && !(await fileExists(artifactPath(runDir, "86_sandbox_upload_revision.json")))) {
    blockers.push("sandbox upload revision runs must contain 86_sandbox_upload_revision.json.");
  }

  await validateSandboxValidationPlan(projectRoot, plan);
  return {
    status: blockers.length === 0 ? "passed" : "failed",
    blockers
  };
}
