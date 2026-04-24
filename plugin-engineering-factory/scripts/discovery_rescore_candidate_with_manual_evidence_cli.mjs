import path from "node:path";
import { parseArgs } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import { rescoreCandidateWithManualEvidence } from "../src/discovery/demandValidationLoop.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.candidate) {
    throw new Error("Usage: node scripts/discovery_rescore_candidate_with_manual_evidence_cli.mjs --candidate <candidate_id_or_name>");
  }

  const result = await rescoreCandidateWithManualEvidence({
    projectRoot: process.cwd(),
    run: args.run ? `${args.run}` : null,
    candidate: `${args.candidate}`
  });

  console.log(JSON.stringify({
    run_dir: result.runDir,
    run_id: path.basename(result.runDir),
    candidate_name: result.report.candidate_name,
    final_decision: result.report.final_decision,
    manual_evidence_count: result.report.manual_evidence_count,
    strong_manual_evidence_count: result.report.strong_manual_evidence_count,
    next_step: result.report.next_step
  }, null, 2));
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
