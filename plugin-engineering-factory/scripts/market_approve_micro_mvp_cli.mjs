import { parseArgs } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import { approveMicroMvp } from "../src/market/marketTestMode.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.candidate || !args.note) {
    throw new Error("Usage: node scripts/market_approve_micro_mvp_cli.mjs --candidate <candidate_name> --note <note>");
  }

  const result = await approveMicroMvp({
    projectRoot: process.cwd(),
    candidate: `${args.candidate}`,
    note: `${args.note}`
  });

  console.log(JSON.stringify({
    approval_file: result.filePath,
    candidate_name: result.approval.candidate_name,
    wedge_name: result.approval.wedge_name,
    approval_status: result.approval.approval_status
  }, null, 2));
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
