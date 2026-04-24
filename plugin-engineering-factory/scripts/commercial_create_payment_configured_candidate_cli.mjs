import path from "node:path";
import { parseArgs, readJson } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import {
  acquireWorkflowRunLock,
  ImmutableRunError,
  RunLockError
} from "../src/workflow/runLock.mjs";
import { importHwhHandoff } from "../src/site/pluginPages.mjs";
import { createPaymentConfiguredCommercialCandidate } from "../src/workflow/commercialReleaseRevision.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args["from-run"] || !args.handoff || !args["target-version"] || !args.note) {
    throw new Error("Usage: node scripts/commercial_create_payment_configured_candidate_cli.mjs --from-run runs/<commercial_run_id> --handoff <leadfill_hwh_integration_handoff.json> --target-version 0.2.0 --note \"<note>\"");
  }

  const sourceRunDir = path.resolve(args["from-run"]);
  let lock = null;

  try {
    lock = await acquireWorkflowRunLock({
      runDir: sourceRunDir,
      owner: {
        command: "commercial_create_payment_configured_candidate_cli"
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
    const runContext = await readJson(path.join(sourceRunDir, "00_run_context.json"));
    if ((runContext.run_type ?? runContext.task_mode) !== "sandbox_validation") {
      throw new Error(`Run ${runContext.run_id} is not a sandbox_validation run.`);
    }

    const projectRoot = process.cwd();
    const handoffResult = await importHwhHandoff({
      projectRoot,
      filePath: path.resolve(args.handoff)
    });
    const result = await createPaymentConfiguredCommercialCandidate({
      projectRoot,
      sourceRunDir,
      paySiteConfigPath: handoffResult.localConfigPath,
      targetVersion: `${args["target-version"]}`,
      note: `${args.note}`
    });
    console.log(JSON.stringify({
      run_id: result.runId,
      manifest_version: result.manifestVersion,
      payment_mode: result.candidate.payment_mode,
      site_url: result.candidate.site_url,
      api_url: result.candidate.api_url,
      product_key: result.candidate.product_key,
      plan_key: result.candidate.plan_key,
      feature_key: result.candidate.feature_key,
      source_chrome_extension_status: result.candidate.source_chrome_extension_status,
      payment_e2e_status: result.candidate.payment_e2e_status,
      upload_allowed: false,
      publish_allowed: false
    }, null, 2));
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
