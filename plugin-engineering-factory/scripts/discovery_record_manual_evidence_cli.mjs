import { parseArgs } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";
import { recordManualEvidence } from "../src/discovery/demandValidationLoop.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.candidate || !args.source || !args.note || !args["supports-wedge"]) {
    throw new Error("Usage: node scripts/discovery_record_manual_evidence_cli.mjs --candidate <candidate_id> --source \"<source>\" --note \"<note>\" --supports-wedge \"<wedge_id>\"");
  }

  const result = await recordManualEvidence({
    projectRoot: process.cwd(),
    candidate: `${args.candidate}`,
    source: `${args.source}`,
    sourceType: args["source-type"] ? `${args["source-type"]}` : null,
    note: `${args.note}`,
    exactUserWords: args["exact-user-words"] ? `${args["exact-user-words"]}` : "",
    supportsWedge: `${args["supports-wedge"]}`,
    reliabilityWeight: args["reliability-weight"] ? Number(args["reliability-weight"]) : null,
    limitations: args.limitations ? `${args.limitations}` : null,
    reviewer: args.reviewer ? `${args.reviewer}` : "human"
  });

  console.log(JSON.stringify({
    record_path: result.recordPath,
    candidate_id: result.record.candidate_id,
    candidate_name: result.record.candidate_name,
    source_type: result.record.source_type,
    supports_wedge: result.record.supports_wedge
  }, null, 2));
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
