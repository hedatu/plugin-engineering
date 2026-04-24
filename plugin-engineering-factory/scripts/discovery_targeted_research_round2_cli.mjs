import path from "node:path";
import { parseArgs } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import {
  acquireWorkflowRunLock,
  ImmutableRunError,
  RunLockError
} from "../src/workflow/runLock.mjs";
import { runTargetedResearchRound2 } from "../src/discovery/targetedResearchRound2.mjs";

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
          command: "discovery_targeted_research_round2_cli"
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
    const result = await runTargetedResearchRound2({
      run: runDir,
      top: Number(args.top ?? 5) || 5,
      projectRoot
    });
    console.log(`Targeted research round 2 completed: ${redactSecretLikeText(result.round2Report.run_id)}`);
    console.log(`Build ready: ${result.round2Report.build_ready_count}`);
    console.log(`Skip: ${result.round2Report.skip_count}`);
    console.log(`Backlog waiting: ${result.round2Report.backlog_waiting_count}`);
    console.log(`Research more residual: ${result.round2Report.research_more_count}`);
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
