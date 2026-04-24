import path from "node:path";
import { copyDir, ensureDir, writeJson, writeText } from "../utils/io.mjs";
import { applyMonetizationToBuilder } from "../monetization/integration.mjs";
import { createDraftIcon } from "../utils/png.mjs";
import { createZipFromDirectory } from "../utils/zip.mjs";

function popupScript() {
  return `const statusNode = document.getElementById("status");
const exportButton = document.getElementById("export-tabs");
const automationDisableSaveAs = new URLSearchParams(location.search).get("automation_disable_save_as") === "1";

function escapeCsv(value) {
  const stringValue = String(value ?? "");
  if (/[",\\n]/.test(stringValue)) {
    return '"' + stringValue.replace(/"/g, '""') + '"';
  }
  return stringValue;
}

function tabsToCsv(tabs) {
  const header = ["index", "title", "url", "pinned", "audible", "groupId"];
  const rows = tabs.map((tab, index) => [
    index + 1,
    tab.title ?? "",
    tab.url ?? "",
    Boolean(tab.pinned),
    Boolean(tab.audible),
    tab.groupId ?? ""
  ]);
  return [header, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\\r\\n");
}

async function exportCurrentWindowTabs() {
  statusNode.textContent = "Collecting tabs...";
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const csv = tabsToCsv(tabs);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({
      url: objectUrl,
      filename: "quicktab-current-window.csv",
      saveAs: !automationDisableSaveAs
    });
    statusNode.textContent = "CSV exported for " + tabs.length + " tabs.";
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  }
}

exportButton.addEventListener("click", () => {
  exportCurrentWindowTabs().catch((error) => {
    statusNode.textContent = "Export failed: " + error.message;
  });
});
`;
}

export async function buildTabCsvWindowExport({ runDir, brief, plan }) {
  const workspaceDir = path.join(runDir, "workspace");
  const repoDir = path.join(workspaceDir, "repo");
  const distDir = path.join(workspaceDir, "dist");
  const iconsDir = path.join(repoDir, "icons");
  await ensureDir(iconsDir);

  let manifest = {
    manifest_version: 3,
    name: brief.product_name_working,
    version: "0.1.0",
    description: brief.listing_summary_seed,
    permissions: plan.permissions,
    action: {
      default_title: brief.product_name_working,
      default_popup: "popup.html"
    },
    icons: {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  };

  let popupHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${brief.product_name_working}</title>
    <link rel="stylesheet" href="popup.css" />
  </head>
  <body>
    <main class="app">
      <h1>${brief.product_name_working}</h1>
      <p class="subhead">${brief.single_purpose_statement}</p>
      <ul class="points">
        <li>Current window only</li>
        <li>Clean CSV columns</li>
        <li>No account or sync</li>
      </ul>
      <button id="export-tabs">Export Current Window</button>
      <p id="status" aria-live="polite">Ready.</p>
    </main>
    <script type="module" src="popup.js"></script>
  </body>
</html>
`;

  let popupCss = `:root {
  color-scheme: light;
  font-family: "Segoe UI", sans-serif;
}

body {
  margin: 0;
  background: #f3f7f4;
  color: #173522;
}

.app {
  width: 320px;
  padding: 18px;
}

h1 {
  margin: 0 0 8px;
  font-size: 20px;
}

.subhead {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.4;
}

.points {
  margin: 0 0 16px;
  padding-left: 18px;
  font-size: 13px;
}

button {
  width: 100%;
  border: 0;
  border-radius: 10px;
  background: #1d6f42;
  color: #fff;
  padding: 12px;
  font-size: 14px;
  cursor: pointer;
}

#status {
  min-height: 20px;
  margin: 12px 0 0;
  font-size: 12px;
  color: #355645;
}
`;

  let privacyHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${brief.product_name_working} Privacy</title>
  </head>
  <body>
    <main>
      <h1>${brief.product_name_working} Privacy</h1>
      <p>This extension only reads tab metadata from the current Chrome window when the user clicks export.</p>
      <p>No server calls, tracking, or account sync are used.</p>
      <p>Downloaded CSV files are generated locally in the browser.</p>
    </main>
  </body>
</html>
`;

  let readme = `# ${brief.product_name_working}

## Purpose
${brief.single_purpose_statement}

## Load Unpacked
1. Open Chrome extension management.
2. Enable Developer mode.
3. Choose Load unpacked and select the dist directory.

## Permissions
- tabs: read current window tab metadata
- downloads: save the generated CSV

## Notes
- No account
- No remote sync
- Current window only
`;
  let popupJs = popupScript();

  const monetization = await applyMonetizationToBuilder({
    runDir,
    repoDir,
    brief,
    plan,
    manifest,
    popupHtml,
    popupCss,
    popupJs,
    privacyHtml,
    readme,
    coreActionFunctionName: "exportCurrentWindowTabs",
    coreFeatureId: "tab_csv_window_export.export_current_window"
  });
  manifest = monetization.manifest;
  popupHtml = monetization.popupHtml;
  popupCss = monetization.popupCss;
  popupJs = monetization.popupJs;
  privacyHtml = monetization.privacyHtml;
  readme = monetization.readme;

  await writeJson(path.join(repoDir, "manifest.json"), manifest);
  await writeText(path.join(repoDir, "popup.html"), popupHtml);
  await writeText(path.join(repoDir, "popup.css"), popupCss);
  await writeText(path.join(repoDir, "popup.js"), popupJs);
  await writeText(path.join(repoDir, "privacy.html"), privacyHtml);
  await writeText(path.join(repoDir, "README.md"), readme);
  await createDraftIcon(path.join(iconsDir, "icon16.png"), 16, "#1d6f42");
  await createDraftIcon(path.join(iconsDir, "icon48.png"), 48, "#1d6f42");
  await createDraftIcon(path.join(iconsDir, "icon128.png"), 128, "#1d6f42");

  await copyDir(repoDir, distDir);
  const zipPath = path.join(workspaceDir, "package.zip");
  const zipSize = await createZipFromDirectory(distDir, zipPath);

  return {
    stage: "BUILD_EXTENSION",
    status: "passed",
    archetype: plan.archetype,
    workspace_repo: repoDir,
    workspace_dist: distDir,
    package_zip: zipPath,
    package_zip_size: zipSize,
    monetization: monetization.monetization,
    generated_files: [
      "manifest.json",
      "popup.html",
      "popup.css",
      "popup.js",
      "privacy.html",
      "README.md",
      ...monetization.monetization.generatedFiles,
      "icons/icon16.png",
      "icons/icon48.png",
      "icons/icon128.png"
    ]
  };
}
