import path from "node:path";
import { copyDir, ensureDir, writeJson, writeText } from "../utils/io.mjs";
import { applyMonetizationToBuilder } from "../monetization/integration.mjs";
import { createDraftIcon } from "../utils/png.mjs";
import { createZipFromDirectory } from "../utils/zip.mjs";

function popupScript() {
  return `const statusNode = document.getElementById("status");
const snippetList = document.getElementById("snippet-list");
const snippetTitle = document.getElementById("snippet-title");
const snippetBody = document.getElementById("snippet-body");

const defaultSnippets = [
  {
    id: "follow-up",
    title: "Follow up",
    body: "Hi there,\\n\\nJust following up on this. Happy to help with any questions.\\n\\nBest,"
  },
  {
    id: "availability",
    title: "Availability",
    body: "Hi there,\\n\\nI have availability this week on Tuesday or Thursday afternoon. Does either work for you?\\n\\nBest,"
  }
];

async function loadSnippets() {
  const stored = await chrome.storage.local.get("snippets");
  return stored.snippets?.length ? stored.snippets : defaultSnippets;
}

async function saveSnippets(snippets) {
  await chrome.storage.local.set({ snippets });
}

function renderSnippets(snippets) {
  snippetList.innerHTML = "";
  for (const snippet of snippets) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "snippet";
    button.textContent = snippet.title;
    button.addEventListener("click", () => insertSnippet(snippet.body));
    snippetList.append(button);
  }
}

function insertIntoFocusedEditable(text) {
  const active = document.activeElement;
  if (!active) return { inserted: false, reason: "No focused editor." };

  const editable = active.closest('[contenteditable="true"], textarea, input');
  if (!editable) return { inserted: false, reason: "Focus the Gmail compose body first." };

  if (editable.isContentEditable) {
    editable.focus();
    document.execCommand("insertText", false, text);
    editable.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    return { inserted: true };
  }

  const start = editable.selectionStart ?? editable.value.length;
  const end = editable.selectionEnd ?? editable.value.length;
  editable.value = editable.value.slice(0, start) + text + editable.value.slice(end);
  editable.selectionStart = editable.selectionEnd = start + text.length;
  editable.dispatchEvent(new Event("input", { bubbles: true }));
  return { inserted: true };
}

async function insertSnippet(body) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    statusNode.textContent = "No active tab.";
    return;
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: insertIntoFocusedEditable,
    args: [body]
  });

  statusNode.textContent = result.inserted ? "Snippet inserted." : result.reason;
}

async function addSnippet() {
  const title = snippetTitle.value.trim();
  const body = snippetBody.value.trim();
  if (!title || !body) {
    statusNode.textContent = "Add a title and body first.";
    return;
  }
  const snippets = await loadSnippets();
  snippets.push({ id: crypto.randomUUID(), title, body });
  await saveSnippets(snippets);
  snippetTitle.value = "";
  snippetBody.value = "";
  renderSnippets(snippets);
  statusNode.textContent = "Snippet saved locally.";
}

document.getElementById("save-snippet").addEventListener("click", () => {
  addSnippet().catch((error) => {
    statusNode.textContent = "Save failed: " + error.message;
  });
});

loadSnippets().then(renderSnippets).catch((error) => {
  statusNode.textContent = "Load failed: " + error.message;
});
`;
}

export async function buildGmailSnippet({ runDir, brief, plan }) {
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
      <section aria-label="Saved snippets">
        <h2>Saved snippets</h2>
        <div id="snippet-list" class="snippet-list"></div>
      </section>
      <section aria-label="Add snippet">
        <h2>Add a snippet</h2>
        <label>Title <input id="snippet-title" type="text" placeholder="Follow up" /></label>
        <label>Body <textarea id="snippet-body" rows="5" placeholder="Write the reusable text here"></textarea></label>
        <button id="save-snippet" type="button">Save Snippet</button>
      </section>
      <p id="status" aria-live="polite">Focus a compose body, then insert.</p>
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
  background: #eef4fb;
  color: #162a3d;
}

.app {
  width: 360px;
  padding: 16px;
}

h1 {
  margin: 0 0 8px;
  font-size: 20px;
}

h2 {
  margin: 16px 0 8px;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.subhead {
  margin: 0 0 10px;
  font-size: 13px;
  line-height: 1.4;
}

.snippet-list {
  display: grid;
  gap: 8px;
}

.snippet,
#save-snippet {
  border: 0;
  border-radius: 10px;
  background: #255f93;
  color: #fff;
  padding: 10px 12px;
  text-align: left;
  cursor: pointer;
}

#save-snippet {
  width: 100%;
  text-align: center;
}

label {
  display: block;
  margin-bottom: 10px;
  font-size: 12px;
}

input,
textarea {
  width: 100%;
  box-sizing: border-box;
  margin-top: 4px;
  border: 1px solid #bdd0df;
  border-radius: 8px;
  padding: 9px 10px;
  font: inherit;
}

#status {
  min-height: 20px;
  margin: 12px 0 0;
  font-size: 12px;
  color: #416071;
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
      <p>The extension stores reusable snippets locally in Chrome storage.</p>
      <p>It does not read mailbox contents or send snippets to a server.</p>
      <p>A script is injected only into the active tab after the user clicks a snippet.</p>
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
- storage: save snippets locally
- activeTab: act only on the current tab after the user clicks
- scripting: insert selected text into the focused compose body

## Notes
- No mailbox reading
- No remote sync
- User-initiated insertion only
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
    coreActionFunctionName: "insertSnippet",
    coreFeatureId: "gmail_snippet.insert_snippet"
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
  await createDraftIcon(path.join(iconsDir, "icon16.png"), 16, "#255f93");
  await createDraftIcon(path.join(iconsDir, "icon48.png"), 48, "#255f93");
  await createDraftIcon(path.join(iconsDir, "icon128.png"), 128, "#255f93");

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
