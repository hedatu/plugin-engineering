import path from "node:path";
import { parseArgs } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import {
  acquireWorkflowRunLock,
  ImmutableRunError,
  RunLockError
} from "../src/workflow/runLock.mjs";
import { generateQueryExpansionPlan } from "../src/discovery/queryExpansion.mjs";

async function main() {
  const args = parseArgs(process.argv);
  const projectRoot = process.cwd();
  const runDir = args["from-run"] ? path.resolve(projectRoot, args["from-run"]) : null;
  let lock = null;

  try {
    if (runDir) {
      lock = await acquireWorkflowRunLock({
        runDir,
        owner: {
          command: "discovery_expand_queries_cli"
        },
        requireMutable: false
      });
    }
  } catch (error) {
    if (error instanceof RunLockError) {
      throw new Error(`${error.message} Existing owner: ${JSON.stringify(error.details?.existing_owner ?? "unknown")}`);
    }
    throw error;
  }

  try {
    const result = await generateQueryExpansionPlan({
      projectRoot,
      fromRun: runDir
    });
    console.log(JSON.stringify({
      artifact: result.artifact,
      markdown: result.markdown,
      run_id: result.plan.run_id,
      query_count: result.plan.query_count
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
