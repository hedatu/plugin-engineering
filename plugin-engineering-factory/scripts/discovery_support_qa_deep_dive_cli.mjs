import path from "node:path";
import { parseArgs } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import {
  acquireWorkflowRunLock,
  ImmutableRunError,
  RunLockError
} from "../src/workflow/runLock.mjs";
import { runSupportQaDeepDive } from "../src/discovery/supportQaDeepDive.mjs";

async function main() {
  const args = parseArgs(process.argv);
  const projectRoot = process.cwd();
  const runDir = args.run ? path.resolve(projectRoot, args.run) : null;
  let lock = null;

  try {
    if (runDir) {
      lock = await acquireWorkflowRunLock({
        runDir,
        owner: {
          command: "discovery_support_qa_deep_dive_cli"
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
    const result = await runSupportQaDeepDive({
      projectRoot,
      run: args.run ? `${args.run}` : null
    });
    console.log(JSON.stringify({
      run_dir: result.runDir,
      run_id: path.basename(result.runDir),
      build_ready_count: result.report.build_ready_count,
      research_more_count: result.report.research_more_count,
      skip_count: result.report.skip_count,
      backlog_waiting_count: result.report.backlog_waiting_count,
      next_step: result.report.next_step
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
