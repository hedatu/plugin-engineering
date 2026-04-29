import test from "node:test";
import assert from "node:assert/strict";
import { storageGet, storageRemove, storageSet } from "../src/storage.js";
import { buildUpgradeUrl } from "../src/upgradeUrl.js";

test("uses chrome.storage.local and chrome.runtime.id inside extension context", async () => {
  const backing = new Map();

  globalThis.chrome = {
    runtime: { id: "abcdefghijklmnopabcdefghijklmnop" },
    storage: {
      local: {
        async get(keys) {
          const result = {};
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            result[key] = backing.get(key);
          }
          return result;
        },
        async set(values) {
          for (const [key, value] of Object.entries(values)) {
            backing.set(key, value);
          }
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            backing.delete(key);
          }
        }
      }
    }
  };

  try {
    await storageSet({ example: { ok: true } });
    assert.deepEqual(await storageGet(["example"]), { example: { ok: true } });
    await storageRemove(["example"]);
    assert.deepEqual(await storageGet(["example"]), { example: undefined });

    const upgradeUrl = new URL(await buildUpgradeUrl());
    assert.equal(upgradeUrl.searchParams.get("extensionId"), "abcdefghijklmnopabcdefghijklmnop");
    assert.equal(upgradeUrl.searchParams.get("source"), "chrome_extension");
    assert.equal(upgradeUrl.pathname, "/products/srt-to-markdown-article/pricing");
  } finally {
    delete globalThis.chrome;
  }
});
