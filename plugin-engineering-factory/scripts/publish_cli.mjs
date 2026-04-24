import path from "node:path";
import { fileExists, parseArgs, readJson } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import {
  acquireWorkflowRunLock,
  ImmutableRunError,
  RunLockError,
  isRunImmutable
} from "../src/workflow/runLock.mjs";
import {
  closeRunStage,
  executePublishPlanStage,
  reviewStatusStage,
  writeFailure
} from "../src/workflow/stages.mjs";

function publishOverridesForMode(mode) {
  if (mode === "preflight") {
    return {
      execution_mode: "planned",
      publish_validation_phase: "fetch_status_only"
    };
  }

  if (mode === "sandbox-fetch-status") {
    return {
      execution_mode: "sandbox_validate",
      execution_lane: "existing_item_update_dry_run",
      publish_validation_phase: "fetch_status_only"
    };
  }

  if (mode === "sandbox-upload") {
    return {
      execution_mode: "sandbox_validate",
      execution_lane: "existing_item_update_dry_run",
      publish_validation_phase: "upload_only"
    };
  }

  if (mode === "sandbox-publish") {
    return {
      execution_mode: "sandbox_validate",
      execution_lane: "existing_item_update_dry_run",
      publish_validation_phase: "publish_optional"
    };
  }

  throw new Error(`Unsupported publish mode: ${mode}`);
}

async function readOptionalJson(filePath) {
  if (!(await fileExists(filePath))) {
    return null;
  }
  return readJson(filePath);
}

function requiresSandboxValidationRun(mode) {
  return mode === "sandbox-fetch-status" || mode === "sandbox-upload" || mode === "sandbox-publish";
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.run) {
    throw new Error("Usage: node scripts/publish_cli.mjs --mode <preflight|sandbox-fetch-status|sandbox-upload|sandbox-publish> --run runs/<run_id>");
  }

  const mode = `${args.mode ?? "preflight"}`;
  const shouldCloseRun = args["close-run"] === true;
  const runDir = path.resolve(args.run);
  const overrides = publishOverridesForMode(mode);
  let lock = null;
  let loadedRunContext = null;

  try {
    lock = await acquireWorkflowRunLock({
      runDir,
      owner: {
        command: "publish_cli",
        mode
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
    loadedRunContext = runContext;
    const immutable = await isRunImmutable(runDir);
    const runType = runContext.run_type ?? runContext.task_mode;
    if (immutable && runType !== "sandbox_validation") {
      throw new ImmutableRunError(`Run ${runDir} is immutable. Sandbox publish commands require a sandbox_validation run; all other runs must use --repair-immutable-copy.`);
    }
    if (requiresSandboxValidationRun(mode) && runContext.task_mode !== "sandbox_validation") {
      throw new Error(`Mode ${mode} requires a sandbox_validation run. Current task_mode=${runContext.task_mode ?? "unknown"}.`);
    }

    const selectedReport = await readJson(path.join(runDir, "31_selected_candidate.json"));
    const publishPlan = await readJson(path.join(runDir, "80_publish_plan.json"));
    const buildReport = await readOptionalJson(path.join(runDir, "50_build_report.json"));
    const listingPackageReport = await readOptionalJson(path.join(runDir, "81_listing_package_report.json"));
    const brief = await readOptionalJson(path.join(runDir, "41_product_brief.json"));
    const plan = await readOptionalJson(path.join(runDir, "42_implementation_plan.json"));
    const screenshotManifest = await readOptionalJson(path.join(runDir, "70_screenshot_manifest.json"));
    const policyGate = await readOptionalJson(path.join(runDir, "72_policy_gate.json"));
    const effectiveRunContext = {
      ...runContext,
      publish_action_source: `${args["action-source"] ?? "cli"}`,
      publish: {
        ...runContext.publish,
        ...overrides
      }
    };

    const report = await executePublishPlanStage({
      runDir,
      runContext: effectiveRunContext,
      selectedReport,
      buildReport,
      publishPlan,
      listingPackageReport
    });

    if (shouldCloseRun && effectiveRunContext.task_mode === "sandbox_validation" && report.status === "passed" && !immutable) {
      const reviewStatus = await reviewStatusStage({ runDir });
      await closeRunStage({
        runDir,
        runContext: effectiveRunContext,
        selectedReport,
        brief,
        plan,
        screenshotManifest,
        publishPlan,
        publishExecution: report,
        reviewStatus,
        monitoringSnapshot: null,
        learningUpdate: null,
        policyGate
      });
    }

    console.log(`Publish execution completed: ${runDir}`);
    console.log(`Mode: ${mode}`);
    console.log(`Status: ${report.status}`);
    if (report.failure_reason) {
      console.log(`Failure reason: ${redactSecretLikeText(report.failure_reason)}`);
    }
  } catch (error) {
    if ((loadedRunContext?.run_type ?? loadedRunContext?.task_mode) !== "sandbox_validation") {
      await writeFailure(runDir, "EXECUTE_PUBLISH_PLAN", error);
    }
    throw error;
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
