import path from "node:path";
import { parseArgs } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import {
  acquireWorkflowRunLock,
  ImmutableRunError,
  RunLockError
} from "../src/workflow/runLock.mjs";
import { runSupportQaEvidenceSprint } from "../src/discovery/supportQaEvidenceSprint.mjs";

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
          command: "discovery_support_qa_evidence_sprint_cli"
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
    const result = await runSupportQaEvidenceSprint({
      projectRoot,
      run: args.run ? `${args.run}` : null,
      candidate: args.candidate ? `${args.candidate}` : null
    });
    console.log(JSON.stringify({
      run_dir: result.runDir,
      run_id: path.basename(result.runDir),
      candidate_id: result.report.candidate_id,
      candidate_name: result.report.candidate_name,
      final_decision: result.report.final_decision,
      next_step: result.report.next_step,
      updated_evidence_quality_score: result.report.updated_evidence_quality_score
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
