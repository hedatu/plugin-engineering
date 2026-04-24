import path from "node:path";
import { parseArgs } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import {
  acquireWorkflowRunLock,
  ImmutableRunError,
  RunLockError
} from "../src/workflow/runLock.mjs";
import { preparePublicLaunchPrep } from "../src/commercial/publicLaunchPrep.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.run) {
    throw new Error("Usage: node scripts/commercial_public_launch_prep_cli.mjs --run runs/<run_id> [--product <product-key>]");
  }

  const runDir = path.resolve(args.run);
  let lock = null;
  try {
    lock = await acquireWorkflowRunLock({
      runDir,
      owner: {
        command: "commercial_public_launch_prep_cli"
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
    const result = await preparePublicLaunchPrep({
      projectRoot: process.cwd(),
      runDir,
      productKey: args.product ?? null
    });
    console.log(JSON.stringify(result, null, 2));
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
