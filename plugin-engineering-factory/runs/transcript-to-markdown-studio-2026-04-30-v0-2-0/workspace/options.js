import { applyI18n, getLanguage, setLanguage, t } from "./src/i18n.js";

async function main() {
  let language = await getLanguage();
  const select = document.getElementById("languageSelect");
  const status = document.getElementById("status");
  select.value = language;
  applyI18n(language);

  document.getElementById("saveButton").addEventListener("click", async () => {
    language = select.value === "zh" ? "zh" : "en";
    await setLanguage(language);
    applyI18n(language);
    status.textContent = t(language, "settingsSaved");
  });
}

main().catch(console.error);
