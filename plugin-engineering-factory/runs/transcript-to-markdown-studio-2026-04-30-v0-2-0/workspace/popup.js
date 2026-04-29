import { applyI18n, getLanguage, t } from "./src/i18n.js";
import { getAccessStatus } from "./src/quotaStore.js";
import { buildUpgradeUrl } from "./src/upgradeUrl.js";

async function openUrl(url) {
  if (typeof chrome !== "undefined" && chrome.tabs?.create) {
    await chrome.tabs.create({ url });
    return;
  }
  window.open(url, "_blank", "noopener");
}

async function main() {
  const language = await getLanguage();
  applyI18n(language);

  const access = await getAccessStatus();
  document.getElementById("quotaValue").textContent = access.pro ? "∞" : `${access.remaining}`;
  document.getElementById("planStatus").textContent = access.pro ? t(language, "proActive") : "Free";

  document.getElementById("openConverter").addEventListener("click", () => {
    openUrl(chrome.runtime.getURL("converter.html"));
  });

  document.getElementById("upgrade").addEventListener("click", async () => {
    openUrl(await buildUpgradeUrl());
  });
}

main().catch((error) => {
  console.error(error);
});
