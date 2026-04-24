import path from "node:path";
import { normalizeUploadArtifact } from "../src/publish/normalizeUploadArtifact.mjs";
import { parseArgs } from "../src/utils/io.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";

async function main() {
  const args = parseArgs(process.argv);
  if (!args.run) {
    throw new Error("Usage: node scripts/normalize_upload_artifact_cli.mjs --run runs/<sandbox_validation_run_id>");
  }

  const result = await normalizeUploadArtifact({
    runDir: path.resolve(args.run)
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
