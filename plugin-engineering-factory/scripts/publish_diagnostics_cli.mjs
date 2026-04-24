import path from "node:path";
import { ensureDir, nowIso, parseArgs, readJson, writeJson } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import {
  acquireWorkflowRunLock,
  ImmutableRunError,
  RunLockError
} from "../src/workflow/runLock.mjs";
import { runPublishDiagnosticsStage, writeFailure } from "../src/workflow/stages.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.run) {
    throw new Error("Usage: node scripts/publish_diagnostics_cli.mjs --run runs/<run_id>");
  }

  const runDir = path.resolve(args.run);
  let lock = null;

  try {
    lock = await acquireWorkflowRunLock({
      runDir,
      owner: {
        command: "publish_diagnostics_cli"
      }
    });
  } catch (error) {
    if (error instanceof RunLockError) {
      await ensureDir(runDir);
      await writeJson(path.join(runDir, "run_status.json"), {
        stage: "PUBLISH_DIAGNOSTICS",
        status: "failed",
        generated_at: nowIso(),
        run_id: path.basename(runDir),
        run_id_strategy: "unknown",
        allow_overwrite: false,
        overwrite_blocked: false,
        created_at: nowIso(),
        failure_reason: `${error.message} Existing owner: ${error.details.existing_owner ?? "unknown"}.`
      });
    }
    throw error;
  }

  try {
    const runContext = await readJson(path.join(runDir, "00_run_context.json"));
    const report = await runPublishDiagnosticsStage({
      runDir,
      runContext
    });

    console.log(`Publish diagnostics completed: ${runDir}`);
    console.log(`Status: ${report.status}`);
    if (report.failure_phase) {
      console.log(`Failure phase: ${report.failure_phase}`);
    }
    if (report.failure_reason) {
      console.log(`Failure reason: ${redactSecretLikeText(report.failure_reason)}`);
    }
  } catch (error) {
    await writeFailure(runDir, "PUBLISH_DIAGNOSTICS", error);
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
