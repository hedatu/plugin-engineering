import { applyI18n, getLanguage, setLanguage, t } from "./src/i18n.js";
import { detectTranscriptFormat, parseTranscriptFiles } from "./src/srtParser.js";
import { renderMarkdown } from "./src/markdownRenderer.js";
import { copyText, downloadTextFile } from "./src/download.js";
import { getAccessStatus, recordConversion } from "./src/quotaStore.js";
import { buildUpgradeUrl } from "./src/upgradeUrl.js";

let language = "en";
let transcriptFiles = [];
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
  if (transcriptFiles.length === 1) {
    return transcriptFiles[0].name.replace(/\.[^.]+$/, "") + ".md";
  }
  return "merged-transcript-notes.md";
}

async function readTranscriptFile(file) {
  return {
    name: file.name || "transcript.txt",
    type: file.type || "",
    text: await file.text()
  };
}

function fileListLabel(files) {
  if (!files.length) return t(language, "transcriptHelp");
  if (files.length === 1) return files[0].name;
  return files.map((file) => file.name).join(", ");
}

async function handleTranscriptFiles(fileList) {
  const selected = Array.from(fileList ?? []);
  if (!selected.length) return;

  const unsupported = selected.filter((file) => detectTranscriptFormat(file.name, file.type) === "unknown");
  if (unsupported.length) {
    transcriptFiles = [];
    $("transcriptFileName").textContent = t(language, "transcriptHelp");
    setStatus(t(language, "unsupportedFile"), "error");
    return;
  }

  transcriptFiles = await Promise.all(selected.map(readTranscriptFile));
  $("transcriptFileName").textContent = fileListLabel(transcriptFiles);
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

  if (!transcriptFiles.length) {
    setStatus(t(language, "noTranscript"), "error");
    return;
  }

  const parsed = parseTranscriptFiles(transcriptFiles);
  if (!parsed.items.length) {
    setStatus(t(language, parsed.errors.some((error) => error.reason === "unsupported_format") ? "unsupportedFile" : "malformedWarning"), "error");
    return;
  }

  markdown = renderMarkdown({
    items: parsed.items,
    sources: parsed.sources,
    mode: $("outputType").value,
    paragraphDensity: $("paragraphDensity").value,
    keepTimestamps: $("keepTimestamps").checked,
    includeFrontmatter: $("includeFrontmatter").checked
  });
  $("markdownOutput").value = markdown;

  const nextAccess = await recordConversion();
  await updateQuota();
  const paragraphs = (markdown.match(/\n\n/g) ?? []).length;
  const baseMessage = t(language, "parsed", {
    files: parsed.sources.length,
    count: parsed.items.length,
    paragraphs
  });
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
    $("transcriptFileName").textContent = fileListLabel(transcriptFiles);
    setStatus(t(language, "ready"));
  });

  $("transcriptInput").addEventListener("change", (event) => handleTranscriptFiles(event.target.files));
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
