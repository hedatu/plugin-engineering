import test from "node:test";
import assert from "node:assert/strict";
import { buildUpgradeUrl } from "../src/upgradeUrl.js";

test("builds website pricing upgrade URL without a fixed Waffo checkout link", async () => {
  const upgradeUrl = new URL(await buildUpgradeUrl());

  assert.equal(upgradeUrl.origin, "https://pay.915500.xyz");
  assert.equal(upgradeUrl.pathname, "/products/transcript-to-markdown-studio/pricing");
  assert.equal(upgradeUrl.searchParams.get("productKey"), "transcript-to-markdown-studio");
  assert.equal(upgradeUrl.searchParams.get("planKey"), "lifetime");
  assert.equal(upgradeUrl.searchParams.get("source"), "chrome_extension");
  assert.equal(upgradeUrl.searchParams.get("extensionId"), "local-preview");
  assert.match(upgradeUrl.searchParams.get("installationId") ?? "", /^[-a-zA-Z0-9]+/);
  assert.doesNotMatch(upgradeUrl.href, /waffo/i);
});
