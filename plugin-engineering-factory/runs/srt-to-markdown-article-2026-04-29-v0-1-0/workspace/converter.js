import { applyI18n, getLanguage, setLanguage, t } from "./src/i18n.js";
import { parseSrt } from "./src/srtParser.js";
import { renderMarkdown } from "./src/markdownRenderer.js";
import { copyText, downloadTextFile } from "./src/download.js";
import { getAccessStatus, recordConversion } from "./src/quotaStore.js";
import { buildUpgradeUrl } from "./src/upgradeUrl.js";

let language = "en";
let srtText = "";
let srtFilename = "subtitle.srt";
let markdown = "";
let videoUrl = "";

const $ = (id) => document.getElementById(id);

function setStatus(message, tone = "muted") {
  const node = $("status");
  node.textContent = message;
  node.dataset.tone = tone;
}

async function updateQuota() {
  const access = await getAccessStatus();
  $("quotaValue").textContent = access.pro ? "∞" : `${access.remaining}`;
  $("paywall").hidden = access.canConvert;
  return access;
}

function markdownFilename() {
  return srtFilename.replace(/\.[^.]+$/, "") + ".md";
}

async function readTextFile(file) {
  return file.text();
}

async function handleSrtFile(file) {
  if (!file) return;
  srtFilename = file.name || "subtitle.srt";
  srtText = await readTextFile(file);
  $("srtFileName").textContent = srtFilename;
  setStatus(t(language, "ready"));
}

function handleVideoFile(file) {
  if (!file) return;
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = URL.createObjectURL(file);
  $("videoFileName").textContent = file.name;
  const video = $("videoPreview");
  video.src = videoUrl;
  video.hidden = false;
}

async function convert() {
  const access = await updateQuota();
  if (!access.canConvert) {
    setStatus(t(language, "paywallTitle"));
    return;
  }

  if (!srtText.trim()) {
    setStatus(t(language, "noSrt"), "error");
    return;
  }

  const parsed = parseSrt(srtText);
  if (!parsed.items.length) {
    setStatus(t(language, "malformedWarning"), "error");
    return;
  }

  markdown = renderMarkdown({
    items: parsed.items,
    sourceName: srtFilename,
    mode: $("outputType").value,
    paragraphDensity: $("paragraphDensity").value,
    keepTimestamps: $("keepTimestamps").checked,
    includeFrontmatter: $("includeFrontmatter").checked
  });
  $("markdownOutput").value = markdown;
  const nextAccess = await recordConversion();
  await updateQuota();
  const paragraphs = (markdown.match(/\n\n/g) ?? []).length;
  const baseMessage = t(language, "parsed", { count: parsed.items.length, paragraphs });
  const quotaMessage = nextAccess.pro ? "" : ` ${t(language, "quotaUsed", { left: nextAccess.remaining })}`;
  const warning = parsed.errors.length ? ` ${t(language, "malformedWarning")}` : "";
  setStatus(`${baseMessage}${quotaMessage}${warning}`);
}

async function openPricing() {
  window.open(await buildUpgradeUrl(), "_blank", "noopener");
}

async function main() {
  language = await getLanguage();
  $("languageSelect").value = language;
  applyI18n(language);
  $("markdownOutput").placeholder = t(language, "emptyPreview");
  await updateQuota();

  $("languageSelect").addEventListener("change", async (event) => {
    language = event.target.value === "zh" ? "zh" : "en";
    await setLanguage(language);
    applyI18n(language);
    $("markdownOutput").placeholder = t(language, "emptyPreview");
    setStatus(t(language, "ready"));
  });

  $("srtInput").addEventListener("change", (event) => handleSrtFile(event.target.files?.[0]));
  $("videoInput").addEventListener("change", (event) => handleVideoFile(event.target.files?.[0]));
  $("convertButton").addEventListener("click", convert);
  $("upgradeButton").addEventListener("click", openPricing);
  $("paywallUpgrade").addEventListener("click", openPricing);
  $("copyButton").addEventListener("click", async () => {
    if (!markdown) return;
    await copyText(markdown);
    setStatus(t(language, "copied"));
  });
  $("downloadButton").addEventListener("click", () => {
    if (!markdown) return;
    downloadTextFile(markdownFilename(), markdown);
    setStatus(t(language, "downloaded"));
  });
}

main().catch((error) => {
  console.error(error);
  setStatus(error.message || String(error), "error");
});
