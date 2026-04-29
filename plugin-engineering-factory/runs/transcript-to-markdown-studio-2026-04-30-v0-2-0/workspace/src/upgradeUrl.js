import { storageGet, storageSet } from "./storage.js";

const INSTALLATION_KEY = "transcript_md_installation_id";
const PRODUCT_KEY = "transcript-to-markdown-studio";
const BASE_PRICING_URL = "https://pay.915500.xyz/products/transcript-to-markdown-studio/pricing";

function randomId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `transcript-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function getInstallationId() {
  const stored = await storageGet([INSTALLATION_KEY]);
  if (stored[INSTALLATION_KEY]) {
    return stored[INSTALLATION_KEY];
  }
  const installationId = randomId();
  await storageSet({ [INSTALLATION_KEY]: installationId });
  return installationId;
}

export async function buildUpgradeUrl() {
  const installationId = await getInstallationId();
  const extensionId = typeof chrome !== "undefined" && chrome.runtime?.id
    ? chrome.runtime.id
    : "local-preview";
  const params = new URLSearchParams({
    productKey: PRODUCT_KEY,
    planKey: "lifetime",
    source: "chrome_extension",
    installationId,
    extensionId
  });
  return `${BASE_PRICING_URL}?${params.toString()}`;
}
