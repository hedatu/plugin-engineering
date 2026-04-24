import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendProductRevisionHistory, loadPortfolioRegistry, summarizePortfolioRegistry, updateRegistryItemByRunId } from "../portfolio/registry.mjs";
import { appendReleaseLedgerEntry, loadReleaseLedger } from "../publish/releaseLedger.mjs";
import { generateFunctionalTestMatrix, generateProductAcceptanceReview } from "../review/productQuality.mjs";
import {
  buildExtensionStage,
  browserSmokeAndCaptureStage,
  decidePublishIntentStage,
  generateAssetsStage,
  prepareListingPackageStage,
  runPolicyGateStage,
  runQaStage
} from "./stages.mjs";
import { runCloseRunStage } from "./closeRun.mjs";
import { loadManagedRunArtifact, writeManagedRunArtifact } from "./runEventArtifacts.mjs";
import { isRunImmutable } from "./runLock.mjs";
import { validateSandboxValidationRun } from "./promoteToSandboxValidation.mjs";
import { bumpChromeExtensionVersion } from "../utils/chromeVersion.mjs";
import { hasSecretLikeContent, inspectSecretLikeContent, redactSecretLikeValue } from "../utils/redaction.mjs";
import { assertMatchesSchema } from "../utils/schema.mjs";
import {
  copyDir,
  ensureDir,
  fileExists,
  nowIso,
  readJson,
  writeJson
} from "../utils/io.mjs";

export const PRODUCT_REVISION_PLAN_ARTIFACT = "97_product_revision_plan.json";
export const PRODUCT_REVISION_LEDGER_ACTION = "sandbox_prepare_product_revision";

const COPIED_SOURCE_ARTIFACTS = [
  "31_selected_candidate.json",
  "41_product_brief.json",
  "41_product_brief.md"
];

const REGENERATED_RUN_ARTIFACTS = [
  "42_implementation_plan.json",
  "50_build_report.json",
  "60_qa_report.json",
  "61_browser_smoke.json",
  "70_listing_assets",
  "70_screenshot_manifest.json",
  "71_listing_copy.json",
  "72_policy_gate.json",
  "80_publish_plan.json",
  "81_listing_package",
  "81_listing_package.zip",
  "81_listing_package_report.json",
  "83_sandbox_validation_plan.json",
  "99_close_run.json"
];

function artifactPath(runDir, fileName) {
  return path.join(runDir, fileName);
}

function normalizeRelativePath(projectRoot, absolutePath) {
  return path.relative(projectRoot, absolutePath).replaceAll("\\", "/");
}

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function shortRandom() {
  return crypto.randomBytes(3).toString("hex");
}

function pad(value) {
  return `${value}`.padStart(2, "0");
}

function buildProductRevisionRunId({ itemId, targetVersion, now = new Date() }) {
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
    safeReport.next_step = "remove secret-like content from product revision inputs and retry";
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

async function readOptionalJson(filePath) {
  if (!(await fileExists(filePath))) {
    return null;
  }
  return readJson(filePath);
}

async function loadManagedArtifactData(runDir, artifactName, runContext) {
  return (await loadManagedRunArtifact({
    runDir,
    artifactName,
    runContext
  }))?.data ?? null;
}

async function loadManagedArtifactReference(runDir, artifactName, runContext) {
  return loadManagedRunArtifact({
    runDir,
    artifactName,
    runContext
  });
}

async function loadSourceSandboxState(sourceRunDir) {
  const absoluteRunDir = path.resolve(sourceRunDir);
  const runContext = await readJson(artifactPath(absoluteRunDir, "00_run_context.json"));
  if ((runContext.run_type ?? runContext.task_mode) !== "sandbox_validation") {
    throw new Error(`Run ${runContext.run_id} is not a sandbox_validation run.`);
  }
  if (!(await isRunImmutable(absoluteRunDir))) {
    throw new Error(`Source run ${runContext.run_id} must be immutable before product revision.`);
  }

  const selectedReport = await readJson(artifactPath(absoluteRunDir, "31_selected_candidate.json"));
  const brief = await readJson(artifactPath(absoluteRunDir, "41_product_brief.json"));
  const implementationPlan = await readJson(artifactPath(absoluteRunDir, "42_implementation_plan.json"));
  const buildReport = await readJson(artifactPath(absoluteRunDir, "50_build_report.json"));
  const sandboxPlan = await readJson(artifactPath(absoluteRunDir, "83_sandbox_validation_plan.json"));
  const latestFunctionalMatrix = await loadManagedArtifactData(absoluteRunDir, "62_functional_test_matrix.json", runContext);
  const latestAcceptanceReview = await loadManagedArtifactData(absoluteRunDir, "94_product_acceptance_review.json", runContext);

  return {
    runDir: absoluteRunDir,
    runContext,
    selectedReport,
    brief,
    implementationPlan,
    buildReport,
    sandboxPlan,
    latestFunctionalMatrix,
    latestAcceptanceReview
  };
}

async function copySeedArtifacts(sourceRunDir, targetRunDir) {
  const copiedArtifacts = [];
  for (const relativePath of COPIED_SOURCE_ARTIFACTS) {
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

async function reserveRevisionRunDir(runsRoot, itemId, targetVersion) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const runId = buildProductRevisionRunId({ itemId, targetVersion });
    const runDir = path.join(runsRoot, runId);
    if (!(await fileExists(runDir))) {
      await ensureDir(runDir);
      return { runId, runDir };
    }
  }
  throw new Error("Could not allocate a unique product revision sandbox run id.");
}

function pseudoPublishExecution({ runContext, packageSha256, manifestVersion, selectedReport }) {
  return {
    stage: "EXECUTE_PUBLISH_PLAN",
    status: "passed",
    execution_mode: "sandbox_validate",
    publish_validation_phase: "fetch_status_only",
    publisher_id: runContext.publisher_id ?? runContext.publish?.publisher_id ?? null,
    item_id: runContext.item_id ?? runContext.publish?.sandbox_item_id ?? null,
    package_sha256: packageSha256,
    manifest_version: manifestVersion,
    candidate_id: selectedReport?.selected_candidate_id ?? null,
    sandbox_fetch_status_verified: false,
    sandbox_upload_verified: false,
    publish_response: {
      executed: false,
      ok: null,
      body: null
    }
  };
}

export async function ensureProductRevisionLineageLedgerEntry({
  projectRoot,
  runDir,
  actionSource = "cli"
}) {
  const absoluteRunDir = path.resolve(runDir);
  const runContext = await readJson(artifactPath(absoluteRunDir, "00_run_context.json"));
  const plan = await readJson(artifactPath(absoluteRunDir, "83_sandbox_validation_plan.json"));

  if ((runContext.run_type ?? runContext.task_mode) !== "sandbox_validation") {
    throw new Error(`Run ${runContext.run_id} is not a sandbox_validation run.`);
  }
  if (
    runContext.revision_kind !== "product_revision"
    && plan.stage !== "PRODUCT_REVISION_SANDBOX_VALIDATION"
  ) {
    throw new Error(`Run ${runContext.run_id} is not a product revision sandbox_validation run.`);
  }

  const ledger = await loadReleaseLedger(projectRoot);
  const existingEntry = ledger.entries.find((entry) =>
    entry.action_type === PRODUCT_REVISION_LEDGER_ACTION
    && (
      entry.run_id === runContext.run_id
      || entry.sandbox_run_id === runContext.run_id
      || entry.new_sandbox_run_id === runContext.run_id
    )
  ) ?? null;
  if (existingEntry) {
    return {
      created: false,
      entry: existingEntry
    };
  }

  const sourcePlan = runContext.source_sandbox_run_path
    ? await readOptionalJson(path.join(runContext.source_sandbox_run_path, "83_sandbox_validation_plan.json"))
    : null;
  const functionalMatrixArtifact = await loadManagedArtifactReference(absoluteRunDir, "62_functional_test_matrix.json", runContext);
  const acceptanceReviewArtifact = await loadManagedArtifactReference(absoluteRunDir, "94_product_acceptance_review.json", runContext);
  const evidenceArtifacts = unique([
    normalizeRelativePath(projectRoot, artifactPath(absoluteRunDir, "83_sandbox_validation_plan.json")),
    functionalMatrixArtifact?.artifactRelativePath ?? null,
    acceptanceReviewArtifact?.artifactRelativePath ?? null
  ]);

  const entry = await appendReleaseLedgerEntry(projectRoot, {
    run_id: runContext.run_id,
    source_run_id: runContext.source_daily_run_id ?? runContext.source_run_id ?? null,
    sandbox_run_id: runContext.run_id,
    source_sandbox_run_id: runContext.source_sandbox_run_id ?? runContext.source_run_id ?? null,
    new_sandbox_run_id: runContext.run_id,
    item_id: runContext.item_id ?? runContext.publish?.sandbox_item_id ?? null,
    publisher_id: runContext.publisher_id ?? runContext.publish?.publisher_id ?? null,
    item_name: plan.item_name ?? null,
    package_sha256: plan.package_sha256 ?? "",
    manifest_version: plan.manifest_version ?? null,
    current_sandbox_item_version: plan.current_sandbox_item_version ?? null,
    previous_manifest_version: plan.previous_manifest_version ?? sourcePlan?.manifest_version ?? null,
    target_manifest_version: plan.target_manifest_version ?? plan.manifest_version ?? null,
    old_package_sha256: sourcePlan?.package_sha256 ?? "",
    new_package_sha256: plan.package_sha256 ?? "",
    action_type: PRODUCT_REVISION_LEDGER_ACTION,
    action_source: actionSource,
    action_status: "passed",
    occurred_at: plan.promoted_at ?? nowIso(),
    evidence_artifacts: evidenceArtifacts,
    chrome_webstore_response_summary: null,
    approval_artifact: null,
    production_write: false,
    sandbox_only: true
  });

  return {
    created: true,
    entry
  };
}

export async function createProductRevisionPlan({ runDir, reason }) {
  const state = await loadSourceSandboxState(runDir);
  const functionalMatrix = state.latestFunctionalMatrix ?? (await generateFunctionalTestMatrix({ runDir: state.runDir })).report;
  const acceptanceReview = state.latestAcceptanceReview ?? (await generateProductAcceptanceReview({ runDir: state.runDir })).report;
  const report = buildSafeReport({
    stage: "PRODUCT_CREATE_REVISION_PLAN",
    status: "passed",
    run_id: state.runContext.run_id,
    source_acceptance_status: acceptanceReview.acceptance_status,
    revision_reason: `${reason ?? ""}`.trim() || "Product acceptance returned revise",
    product_risks: acceptanceReview.biggest_risks ?? [],
    required_functionality_fixes: [
      "support select field matching and filling",
      "handle readonly fields safely",
      "handle partially filled forms with explicit overwrite policy",
      "handle no matching fields with clear user feedback",
      "add profile save/edit/delete behavior or explicitly scope MVP to save-only",
      "improve popup status messaging",
      "document local-only storage behavior"
    ],
    required_test_fixes: [
      "add empty form browser smoke coverage",
      "add partially filled form browser smoke coverage",
      "add readonly field browser smoke coverage",
      "add select field browser smoke coverage",
      "add no matching fields browser smoke coverage",
      "add overwrite-default-false browser smoke coverage",
      "update functional matrix with the new smoke evidence"
    ],
    required_ux_fixes: [
      "make overwrite-default-false behavior explicit in the popup",
      "show filled and skipped counts after a successful fill",
      "show a clear no matching fields status instead of silent success"
    ],
    required_listing_fixes: [
      "remove any universal form-fill claim",
      "state that storage is local-only with no cloud sync",
      "state that existing values are preserved by default",
      "align screenshots with supported field types and feedback states"
    ],
    affected_archetype: state.buildReport.archetype ?? state.brief.wedge_family ?? null,
    affected_builder: "singleProfileFormFill",
    source_package_sha256: state.sandboxPlan.package_sha256,
    requires_new_build: true,
    requires_new_version_bump: true,
    requires_new_browser_smoke: true,
    requires_new_product_acceptance_review: true,
    requires_new_upload_approval: true,
    requires_new_publish_approval: true,
    next_step: "create_product_revision_run_and_rerun_build_qa_smoke"
  });

  await validateArtifact(state.runContext.project_root, "product_revision_plan.schema.json", PRODUCT_REVISION_PLAN_ARTIFACT, report);
  const writeResult = await writeManagedRunArtifact({
    runDir: state.runDir,
    artifactName: PRODUCT_REVISION_PLAN_ARTIFACT,
    data: report,
    runContext: state.runContext
  });

  await updateRegistryItemByRunId(state.runContext.project_root, state.runContext.run_id, (item) => ({
    ...item,
    known_product_risks: report.product_risks,
    known_issues: [...new Set([...(item.known_issues ?? []), ...(report.required_functionality_fixes ?? [])])],
    product_acceptance_status: report.source_acceptance_status,
    revision_required: true,
    blocked_from_publish_until_acceptance_passed: true,
    revision_resolved: false,
    next_product_step: report.next_step
  })).catch(() => null);

  await appendProductRevisionHistory(state.runContext.project_root, {
    event_type: "product_revision_plan_created",
    source_run_id: state.runContext.run_id,
    source_daily_run_id: state.runContext.source_daily_run_id ?? null,
    source_acceptance_status: report.source_acceptance_status,
    source_package_sha256: report.source_package_sha256,
    artifact_path: writeResult.artifactRelativePath
  }).catch(() => null);

  return {
    report,
    artifactRelativePath: writeResult.artifactRelativePath
  };
}

export async function createProductRevisionRun({
  projectRoot,
  sourceRunDir,
  note,
  preparedBy = os.userInfo().username
}) {
  const state = await loadSourceSandboxState(sourceRunDir);
  const runsRoot = path.dirname(state.runDir);
  const sourceManifestVersion = `${state.buildReport.manifest_version ?? state.sandboxPlan.manifest_version ?? "0.1.0"}`;
  const targetManifestVersion = bumpChromeExtensionVersion(sourceManifestVersion, "patch");
  const registrySummary = summarizePortfolioRegistry(await loadPortfolioRegistry(projectRoot));
  const reserved = await reserveRevisionRunDir(
    runsRoot,
    state.runContext.item_id ?? state.runContext.publish?.sandbox_item_id ?? "sandbox",
    targetManifestVersion
  );
  const occurredAt = nowIso();

  const nextRunContext = {
    ...state.runContext,
    stage: "PRODUCT_CREATE_REVISION_RUN",
    status: "passed",
    generated_at: occurredAt,
    run_id: reserved.runId,
    run_id_strategy: "sandbox_product_revision_unique",
    allow_overwrite: false,
    overwrite_blocked: false,
    created_at: occurredAt,
    source_run_id: state.runContext.run_id,
    source_run_path: state.runDir,
    source_sandbox_run_id: state.runContext.run_id,
    source_sandbox_run_path: state.runDir,
    source_daily_run_id: state.runContext.source_daily_run_id ?? state.runContext.source_run_id ?? null,
    source_daily_run_path: state.runContext.source_daily_run_path ?? null,
    latest_revision_run_id: reserved.runId,
    revision_kind: "product_revision",
    revision_note: `${note ?? ""}`.trim(),
    previous_manifest_version: sourceManifestVersion,
    target_manifest_version: targetManifestVersion,
    publish: {
      ...state.runContext.publish,
      execution_mode: "sandbox_validate",
      publish_validation_phase: "fetch_status_only",
      allow_public_release: false
    },
    portfolio_registry: {
      path: state.runContext.portfolio_registry?.path ?? path.join(projectRoot, "state", "portfolio_registry.json"),
      active_wedge_families: registrySummary.active_wedge_families,
      blocked_candidate_ids: registrySummary.blocked_candidate_ids,
      archetype_priors: registrySummary.archetype_priors,
      item_count: registrySummary.item_count
    }
  };

  await writeJson(artifactPath(reserved.runDir, "00_run_context.json"), nextRunContext);
  const copiedArtifacts = await copySeedArtifacts(state.runDir, reserved.runDir);

  const revisionPlan = {
    ...state.implementationPlan,
    generated_at: occurredAt,
    build_version: targetManifestVersion
  };
  await writeJson(artifactPath(reserved.runDir, "42_implementation_plan.json"), revisionPlan);

  const buildReport = await buildExtensionStage({
    runDir: reserved.runDir,
    brief: state.brief,
    plan: revisionPlan
  });
  const qaReport = await runQaStage({
    runDir: reserved.runDir,
    brief: state.brief,
    plan: revisionPlan,
    buildReport
  });
  const { browserSmokeReport, screenshotManifest } = await browserSmokeAndCaptureStage({
    runDir: reserved.runDir,
    runContext: nextRunContext,
    brief: state.brief,
    plan: revisionPlan,
    buildReport,
    qaReport
  });
  const listingCopy = await generateAssetsStage({
    runDir: reserved.runDir,
    runContext: nextRunContext,
    brief: state.brief,
    buildReport,
    qaReport,
    screenshotManifest
  });
  const policyGate = await runPolicyGateStage({
    runDir: reserved.runDir,
    runContext: nextRunContext,
    brief: state.brief,
    plan: revisionPlan,
    buildReport,
    qaReport,
    listingCopy,
    browserSmokeReport,
    screenshotManifest
  });
  const publishPlan = await decidePublishIntentStage({
    runDir: reserved.runDir,
    runContext: nextRunContext,
    selectedReport: state.selectedReport,
    qaReport,
    policyGate,
    buildGateReport: null
  });
  const listingPackageReport = await prepareListingPackageStage({
    runDir: reserved.runDir,
    selectedReport: state.selectedReport,
    brief: state.brief,
    plan: revisionPlan,
    buildReport,
    qaReport,
    browserSmokeReport,
    screenshotManifest,
    listingCopy,
    policyGate,
    publishPlan
  });

  const extensionPackagePath = artifactPath(reserved.runDir, "81_listing_package/extension_package.zip");
  if (listingPackageReport.status !== "passed" || !(await fileExists(extensionPackagePath))) {
    const blockers = [];
    if (buildReport.status !== "passed") {
      blockers.push(`build_status=${buildReport.status}`);
    }
    if (qaReport.overall_status !== "passed") {
      blockers.push(`qa_status=${qaReport.overall_status}`);
    }
    if (browserSmokeReport.status !== "passed") {
      blockers.push(`browser_smoke_status=${browserSmokeReport.status}`);
    }
    if (screenshotManifest.status !== "passed") {
      blockers.push(`screenshot_manifest_status=${screenshotManifest.status}`);
    }
    if (policyGate.status !== "pass") {
      blockers.push(`policy_gate_status=${policyGate.status}`);
      for (const issue of policyGate.issues ?? []) {
        blockers.push(`policy_issue=${issue}`);
      }
    }
    if (listingPackageReport.status !== "passed") {
      blockers.push(`listing_package_status=${listingPackageReport.status}`);
    }
    if (listingPackageReport.reason) {
      blockers.push(`listing_package_reason=${listingPackageReport.reason}`);
    }
    if (!(await fileExists(extensionPackagePath))) {
      blockers.push("extension_package_zip_missing");
    }
    throw new Error(`Product revision run blocked before sandbox freeze: ${blockers.join("; ")}`);
  }
  const packageSha256 = await hashFile(extensionPackagePath);
  const sandboxValidationPlan = buildSafeReport({
    stage: "PRODUCT_REVISION_SANDBOX_VALIDATION",
    status: "passed",
    run_id: reserved.runId,
    run_type: "sandbox_validation",
    source_run_id: state.runContext.run_id,
    source_sandbox_run_id: state.runContext.run_id,
    source_daily_run_id: nextRunContext.source_daily_run_id,
    publisher_id: nextRunContext.publisher_id ?? nextRunContext.publish?.publisher_id ?? null,
    item_id: nextRunContext.item_id ?? nextRunContext.publish?.sandbox_item_id ?? null,
    item_name: state.selectedReport?.candidate?.name ?? state.brief.product_name_working ?? null,
    promoted_at: occurredAt,
    promoted_by: preparedBy,
    promotion_note: `${note ?? ""}`.trim(),
    source_artifacts: COPIED_SOURCE_ARTIFACTS,
    copied_artifacts: copiedArtifacts,
    regenerated_artifacts: REGENERATED_RUN_ARTIFACTS,
    package_sha256: packageSha256,
    manifest_version: targetManifestVersion,
    current_sandbox_item_version: state.sandboxPlan.current_sandbox_item_version ?? null,
    previous_manifest_version: sourceManifestVersion,
    target_manifest_version: targetManifestVersion,
    version_bump_strategy: "patch",
    revision_reason: `${note ?? ""}`.trim() || "Product acceptance returned revise",
    extension_name: state.brief.product_name_working,
    archetype: revisionPlan.archetype,
    wedge: state.brief.product_name_working,
    policy_status: policyGate.status,
    qa_status: qaReport.overall_status,
    browser_smoke_status: browserSmokeReport.status,
    screenshot_manifest_status: screenshotManifest.status,
    listing_package_status: listingPackageReport.status,
    publish_allowed: false,
    upload_allowed: false,
    production_write: false,
    required_next_action: "sidecar_product_acceptance_review_required_before_any_new_write_flow",
    safety_checks: {
      source_run_immutable: true,
      new_build_generated: buildReport.status === "passed",
      new_browser_smoke_generated: browserSmokeReport.status === "passed",
      new_listing_package_generated: listingPackageReport.status === "passed",
      upload_not_attempted: true,
      publish_not_attempted: true
    }
  });

  await validateArtifact(projectRoot, "sandbox_validation_plan.schema.json", "83_sandbox_validation_plan.json", sandboxValidationPlan);
  await writeJson(artifactPath(reserved.runDir, "83_sandbox_validation_plan.json"), sandboxValidationPlan);
  await writeJson(artifactPath(reserved.runDir, "run_status.json"), {
    stage: "PRODUCT_CREATE_REVISION_RUN",
    status: "passed",
    generated_at: occurredAt,
    run_id: reserved.runId,
    run_id_strategy: nextRunContext.run_id_strategy,
    allow_overwrite: false,
    overwrite_blocked: false,
    created_at: occurredAt,
    failure_reason: null
  });

  const pseudoExecution = pseudoPublishExecution({
    runContext: nextRunContext,
    packageSha256,
    manifestVersion: targetManifestVersion,
    selectedReport: state.selectedReport
  });
  await runCloseRunStage({
    runDir: reserved.runDir,
    runContext: nextRunContext,
    selectedReport: state.selectedReport,
    brief: state.brief,
    plan: revisionPlan,
    screenshotManifest,
    publishPlan,
    publishExecution: pseudoExecution,
    reviewStatus: null,
    monitoringSnapshot: null,
    learningUpdate: null,
    policyGate
  });

  const validation = await validateSandboxValidationRun({
    projectRoot,
    runDir: reserved.runDir,
    runContext: nextRunContext,
    plan: sandboxValidationPlan
  });
  if (validation.status !== "passed") {
    throw new Error(`Product revision run validation failed: ${validation.blockers.join("; ")}`);
  }

  const functionalMatrix = await generateFunctionalTestMatrix({ runDir: reserved.runDir });
  const acceptanceReview = await generateProductAcceptanceReview({ runDir: reserved.runDir });
  const lineageLedger = await ensureProductRevisionLineageLedgerEntry({
    projectRoot,
    runDir: reserved.runDir,
    actionSource: "cli"
  });

  await appendProductRevisionHistory(projectRoot, {
    event_type: "product_revision_run_created",
    source_run_id: state.runContext.run_id,
    new_run_id: reserved.runId,
    source_package_sha256: state.sandboxPlan.package_sha256,
    new_package_sha256: packageSha256,
    previous_manifest_version: sourceManifestVersion,
    target_manifest_version: targetManifestVersion,
    acceptance_status: acceptanceReview.report.acceptance_status
  }).catch(() => null);

  return {
    runDir: reserved.runDir,
    runId: reserved.runId,
    manifestVersion: targetManifestVersion,
    packageSha256,
    ledgerEntry: lineageLedger.entry,
    functionalMatrix: functionalMatrix.report,
    acceptanceReview: acceptanceReview.report
  };
}
