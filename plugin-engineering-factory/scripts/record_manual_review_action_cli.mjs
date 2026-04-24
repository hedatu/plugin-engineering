import path from "node:path";
import {
  appendReleaseLedgerEvent,
  findLatestLedgerEntryForItem
} from "../src/publish/releaseLedger.mjs";
import {
  REVIEW_STATUS_ARTIFACT,
  runReviewStatusStage,
  validateReviewStatusArtifact
} from "../src/publish/reviewStatus.mjs";
import { syncActiveReviewWatchForRun } from "../src/publish/activeReviewWatches.mjs";
import {
  appendRunEventLog,
  runEventLatestArtifactPath
} from "../src/workflow/runEventArtifacts.mjs";
import {
  acquireWorkflowRunLock,
  ImmutableRunError,
  RunLockError
} from "../src/workflow/runLock.mjs";
import {
  ensureDir,
  nowIso,
  parseArgs,
  readJson,
  slugify,
  writeJson
} from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";

function fallbackRecoveredRunId({ action, itemId }) {
  const date = nowIso().slice(0, 10);
  return `recovered-${date}-${slugify(action) || "manual-review"}-${slugify(itemId).slice(0, 6) || "item"}`;
}

function normalizeRelativePath(projectRoot, absolutePath) {
  return path.relative(projectRoot, absolutePath).replaceAll("\\", "/");
}

async function recordLegacyManualLedgerAction(args, projectRoot) {
  if (!args.item || !args.publisher || !args.action || !args.note) {
    throw new Error("Usage: node scripts/record_manual_review_action_cli.mjs --run runs/<run_id> --action manual_cancel_review --note \"...\" OR --item <item_id> --publisher <publisher_id> --action <manual_cancel_review|review_approved|review_rejected> --note \"...\"");
  }

  const latest = await findLatestLedgerEntryForItem(projectRoot, {
    itemId: `${args.item}`,
    publisherId: `${args.publisher}`
  });
  const recoveredHistory = latest?.evidence_quality === "manual_reconstructed"
    || `${latest?.run_id ?? ""}`.startsWith("recovered-");
  const runId = args.run ?? latest?.run_id ?? fallbackRecoveredRunId({
    action: `${args.action}`,
    itemId: `${args.item}`
  });

  const entry = await appendReleaseLedgerEvent(projectRoot, {
    runId,
    itemId: `${args.item}`,
    publisherId: `${args.publisher}`,
    actionType: `${args.action}`,
    actionSource: "dashboard_manual",
    actionStatus: "observed",
    dashboardManualNote: `${args.note}`,
    productionWrite: false,
    sandboxOnly: true,
    evidenceQuality: recoveredHistory || !latest ? "manual_reconstructed" : "manual_record",
    originalArtifactAvailable: !(recoveredHistory || !latest),
    recoveryReason: recoveredHistory || !latest
      ? "fixed_run_id_overwrite"
      : null
  });

  console.log(JSON.stringify(entry, null, 2));
}

async function recordManualCancelForRun({ runDir, note }) {
  let lock = null;

  try {
    lock = await acquireWorkflowRunLock({
      runDir,
      owner: {
        command: "record_manual_review_action_cli",
        action: "manual_cancel_review"
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
    const runContext = await readJson(path.join(runDir, "00_run_context.json"));
    if ((runContext.run_type ?? runContext.task_mode) !== "sandbox_validation") {
      throw new Error(`Run ${runContext.run_id} is not a sandbox_validation run.`);
    }

    const sandboxPlan = await readJson(path.join(runDir, "83_sandbox_validation_plan.json"));
    const watcherReport = await runReviewStatusStage({ runDir });
    const checkedAt = nowIso();
    const dashboardStateConfirmed = watcherReport.is_cancelled === true
      || `${watcherReport.submitted_revision_status ?? ""}`.trim().toUpperCase() === "CANCELLED"
      || `${watcherReport.current_dashboard_state ?? ""}`.trim().toUpperCase() === "DRAFT";
    const dashboardStateUnconfirmed = !dashboardStateConfirmed;
    const manualReport = {
      ...watcherReport,
      checked_at: checkedAt,
      review_action: "manual_cancel_review_recorded",
      review_cancelled_manually: true,
      manual_action_recorded: true,
      dashboard_state_confirmed: dashboardStateConfirmed,
      dashboard_state_unconfirmed: dashboardStateUnconfirmed,
      dashboard_manual_note: `${note}`,
      is_cancelled: dashboardStateConfirmed || watcherReport.is_cancelled === true,
      review_state: dashboardStateConfirmed
        ? "CANCELLED"
        : watcherReport.review_state,
      review_result: dashboardStateConfirmed
        ? "cancelled"
        : watcherReport.review_result,
      dashboard_action_required: true,
      next_step: dashboardStateConfirmed
        ? "prepare_new_revision_or_close_sandbox_validation"
        : "verify_cancel_review_in_dashboard_or_fetch_status"
    };

    await validateReviewStatusArtifact(runContext.project_root, manualReport);

    const latestPath = runEventLatestArtifactPath(
      runContext.project_root,
      runContext.run_id,
      REVIEW_STATUS_ARTIFACT
    );
    await ensureDir(path.dirname(latestPath));
    await writeJson(latestPath, manualReport);

    const manualLog = await appendRunEventLog({
      projectRoot: runContext.project_root,
      runId: runContext.run_id,
      category: "review_status",
      prefix: "91_review_status-manual-cancel",
      data: manualReport,
      occurredAt: checkedAt
    });

    const latestRelativePath = normalizeRelativePath(runContext.project_root, latestPath);
    await appendReleaseLedgerEvent(runContext.project_root, {
      runId: runContext.run_id,
      itemId: runContext.item_id ?? runContext.publish?.sandbox_item_id ?? null,
      publisherId: runContext.publisher_id ?? runContext.publish?.publisher_id ?? null,
      packageSha256: sandboxPlan.package_sha256,
      manifestVersion: manualReport.manifest_version ?? sandboxPlan.manifest_version ?? null,
      uploadedCrxVersion: manualReport.uploaded_crx_version ?? null,
      actionType: "manual_cancel_review",
      actionSource: "dashboard_manual",
      actionStatus: dashboardStateConfirmed ? "confirmed" : "recorded_unconfirmed",
      evidenceArtifacts: [latestRelativePath, manualLog.logRelativePath],
      responseSummary: manualReport.raw_response_summary,
      dashboardManualNote: `${note}`,
      productionWrite: false,
      sandboxOnly: true
    });
    await syncActiveReviewWatchForRun({
      runDir,
      runContext,
      reviewStatus: manualReport
    });

    console.log(`Manual review action recorded: ${runDir}`);
    console.log(`Action: manual_cancel_review`);
    console.log(`Dashboard state confirmed: ${dashboardStateConfirmed}`);
    console.log(`Next step: ${redactSecretLikeText(manualReport.next_step)}`);
  } finally {
    await lock?.release?.().catch(() => {});
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const projectRoot = process.cwd();

  if (args.run) {
    if (`${args.action ?? ""}` !== "manual_cancel_review" || !args.note) {
      throw new Error("Usage: node scripts/record_manual_review_action_cli.mjs --run runs/<run_id> --action manual_cancel_review --note \"<note>\"");
    }
    await recordManualCancelForRun({
      runDir: path.resolve(args.run),
      note: `${args.note}`
    });
    return;
  }

  await recordLegacyManualLedgerAction(args, projectRoot);
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
