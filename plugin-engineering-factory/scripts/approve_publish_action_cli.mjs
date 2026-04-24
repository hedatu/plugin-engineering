import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { approveHumanAction } from "../src/publish/humanApproval.mjs";
import { appendReleaseLedgerEvent } from "../src/publish/releaseLedger.mjs";
import { loadManagedRunArtifact } from "../src/workflow/runEventArtifacts.mjs";
import { fileExists, parseArgs, readJson } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import {
  acquireWorkflowRunLock,
  ImmutableRunError,
  RunLockError
} from "../src/workflow/runLock.mjs";

function artifactPath(runDir, fileName) {
  return path.join(runDir, fileName);
}

async function readOptionalJson(filePath) {
  if (!(await fileExists(filePath))) {
    return null;
  }
  return readJson(filePath);
}

async function resolvePackageSha(runDir, publishExecution) {
  const promotionPlanPath = artifactPath(runDir, "83_sandbox_validation_plan.json");
  if (await fileExists(promotionPlanPath)) {
    const plan = await readJson(promotionPlanPath);
    if (plan.package_sha256) {
      return plan.package_sha256;
    }
  }
  if (publishExecution?.package_sha256) {
    return publishExecution.package_sha256;
  }
  const promotedPackagePath = artifactPath(runDir, "81_listing_package/extension_package.zip");
  if (await fileExists(promotedPackagePath)) {
    const buffer = await fs.readFile(promotedPackagePath);
    return crypto.createHash("sha256").update(buffer).digest("hex");
  }
  const packagePath = artifactPath(runDir, "workspace/package.zip");
  const buffer = await fs.readFile(packagePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function resolveManifestVersion(runDir, publishExecution) {
  const promotionPlanPath = artifactPath(runDir, "83_sandbox_validation_plan.json");
  if (await fileExists(promotionPlanPath)) {
    const plan = await readJson(promotionPlanPath);
    if (plan.manifest_version) {
      return plan.manifest_version;
    }
  }
  if (publishExecution?.manifest_version) {
    return publishExecution.manifest_version;
  }
  const manifest = await readJson(artifactPath(runDir, "workspace/dist/manifest.json"));
  return `${manifest.version ?? ""}` || null;
}

function requestedActionForMode(mode) {
  if (mode === "sandbox-upload") {
    return "sandbox_upload";
  }
  if (mode === "sandbox-publish") {
    return "sandbox_publish";
  }
  throw new Error(`Unsupported approval mode: ${mode}`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.run || !args.mode) {
    throw new Error("Usage: node scripts/approve_publish_action_cli.mjs --mode <sandbox-upload|sandbox-publish> --run runs/<run_id> --note \"...\" [--allow-write]");
  }

  const runDir = path.resolve(args.run);
  const requestedAction = requestedActionForMode(`${args.mode}`);
  let lock = null;

  try {
    lock = await acquireWorkflowRunLock({
      runDir,
      owner: {
        command: "approve_publish_action_cli",
        mode: requestedAction
      },
      requireMutable: false
    });
  } catch (error) {
    if (error instanceof RunLockError) {
      throw new Error(`${error.message} Existing owner: ${JSON.stringify(error.details?.existing_owner ?? "unknown")}`);
    }
    throw error;
  }

  try {
    const runContext = await readJson(artifactPath(runDir, "00_run_context.json"));
    if (runContext.task_mode !== "sandbox_validation") {
      throw new Error(`Approval mode ${requestedAction} requires a sandbox_validation run. Current task_mode=${runContext.task_mode ?? "unknown"}.`);
    }
    if (runContext.revision_kind === "commercial_release_revision") {
      const commercialGate = await readOptionalJson(path.join(runContext.project_root, "state", "run_events", runContext.run_id, "129_commercial_release_gate.json"));
      if (!commercialGate) {
        throw new Error("Commercial release approval is blocked until 129_commercial_release_gate.json exists.");
      }
      if (commercialGate.status !== "passed") {
        throw new Error(`Commercial release approval is blocked until 129_commercial_release_gate.json passes. Recommended next step: ${commercialGate.recommended_next_step ?? "resolve commercial release blockers"}`);
      }
    }
    const publishExecution = (await loadManagedRunArtifact({
      runDir,
      artifactName: "90_publish_execution.json",
      runContext
    }))?.data ?? null;
    const packageSha256 = await resolvePackageSha(runDir, publishExecution);
    const manifestVersion = await resolveManifestVersion(runDir, publishExecution);
    const itemId = process.env.CHROME_WEB_STORE_SANDBOX_ITEM_ID ?? publishExecution?.item_id ?? runContext.publish?.sandbox_item_id ?? null;
    const publisherId = process.env.CHROME_WEB_STORE_PUBLISHER_ID ?? publishExecution?.publisher_id ?? runContext.publish?.publisher_id ?? null;

    const report = await approveHumanAction({
      runDir,
      requestedAction,
      itemId,
      publisherId,
      packageSha256,
      manifestVersion,
      note: `${args.note ?? ""}`,
      allowWrite: args["allow-write"] === true,
      safetySummary: {
        production_write_disabled: true,
        sandbox_item_only: true,
        requested_action: requestedAction,
        approval_mode: args["allow-write"] === true ? "write_allowed" : "test_artifact_only"
      }
    });
    const approvalArtifact = await loadManagedRunArtifact({
      runDir,
      artifactName: "82_human_approval.json",
      runContext
    });
    await appendReleaseLedgerEvent(runContext.project_root, {
      runId: runContext.run_id,
      sourceRunId: runContext.source_run_id ?? null,
      sandboxRunId: runContext.run_id,
      itemId,
      publisherId,
      packageSha256,
      manifestVersion,
      actionType: requestedAction === "sandbox_upload"
        ? "sandbox_upload_approval"
        : "sandbox_publish_approval",
      actionSource: "cli",
      actionStatus: report.write_authorized ? "approved_write_allowed" : "approved_test_artifact_only",
      evidenceArtifacts: approvalArtifact?.artifactRelativePath ? [approvalArtifact.artifactRelativePath] : [],
      approvedBy: report.approved_by,
      approvalArtifact: approvalArtifact?.artifactRelativePath ?? null,
      productionWrite: false,
      sandboxOnly: true
    });

    console.log(`Approval recorded: ${runDir}`);
    console.log(`Requested action: ${report.requested_action}`);
    console.log(`Approval status: ${report.approval_status}`);
    console.log(`Approval mode: ${report.approval_mode}`);
    console.log(`Write authorized: ${report.write_authorized}`);
  } finally {
    await lock?.release?.().catch(() => {});
  }
}

main().catch((error) => {
  if (error instanceof ImmutableRunError) {
    console.error(redactSecretLikeText(error.message));
    process.exitCode = 1;
    return;
  }
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
