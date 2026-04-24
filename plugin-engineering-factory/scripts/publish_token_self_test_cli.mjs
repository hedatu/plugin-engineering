import {
  CHROME_WEB_STORE_READONLY_SCOPE,
  runChromeWebStoreTokenSelfTest
} from "../src/publish/chromeWebStoreApi.mjs";
import { bootstrapReviewWatchEnv } from "../src/publish/reviewWatchCredentials.mjs";
import { redactSecretLikeText } from "../src/utils/redaction.mjs";

async function main() {
  await bootstrapReviewWatchEnv({ projectRoot: process.cwd() });
  const result = await runChromeWebStoreTokenSelfTest({
    scope: CHROME_WEB_STORE_READONLY_SCOPE
  });

  console.log(JSON.stringify(result, null, 2));
  if (result.token_exchange_status !== "passed") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(redactSecretLikeText(error.stack || error.message));
  process.exitCode = 1;
});
