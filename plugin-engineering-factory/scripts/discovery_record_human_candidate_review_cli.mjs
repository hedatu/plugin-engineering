import { parseArgs } from "../src/utils/io.mjs";
import { recordHumanCandidateDecision } from "../src/discovery/liveQueue.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.candidate || !args.decision || !args.note) {
    throw new Error("Usage: node scripts/discovery_record_human_candidate_review_cli.mjs --candidate <candidate_id> --decision approve_build|research_more|skip --note \"<note>\"");
  }

  const result = await recordHumanCandidateDecision({
    projectRoot: process.cwd(),
    candidateId: `${args.candidate}`,
    decision: `${args.decision}`,
    note: `${args.note}`
  });

  console.log(JSON.stringify({
    review_path: result.review_path,
    review: result.review
  }, null, 2));
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
