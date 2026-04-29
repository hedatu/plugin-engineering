import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const workspace = process.cwd();

async function readJson(file) {
  return JSON.parse(await readFile(path.join(workspace, file), "utf8"));
}

async function listFiles(dir) {
  const entries = await readdir(path.join(workspace, dir), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(child));
    } else {
      files.push(child);
    }
  }
  return files;
}

const manifest = await readJson("manifest.json");
const requiredFiles = [
  "popup.html",
  "converter.html",
  "options.html",
  "src/srtParser.js",
  "src/markdownRenderer.js",
  "src/quotaStore.js",
  "src/upgradeUrl.js"
];

const failures = [];

if (manifest.manifest_version !== 3) failures.push("manifest_not_mv3");
if (manifest.permissions.length !== 1 || manifest.permissions[0] !== "storage") failures.push("permissions_not_storage_only");
if (manifest.host_permissions) failures.push("host_permissions_present");
if (manifest.background) failures.push("background_not_needed_for_mvp");

for (const file of requiredFiles) {
  try {
    await readFile(path.join(workspace, file), "utf8");
  } catch {
    failures.push(`missing_${file}`);
  }
}

const forbiddenParts = [
  ["SUPABASE", "SERVICE", "ROLE", "KEY"],
  ["WAFFO", "PRIVATE", "KEY"],
  ["MERCHANT", "SECRET"],
  ["WEBHOOK", "SECRET"],
  ["RESEND", "API", "KEY"],
  ["OPENAI", "API", "KEY"]
];

for (const file of await listFiles(".")) {
  if (file.startsWith("icons")) continue;
  if (file.endsWith(".png")) continue;
  const text = await readFile(path.join(workspace, file), "utf8");
  for (const parts of forbiddenParts) {
    const token = parts.join("_");
    if (text.includes(token)) {
      failures.push(`forbidden_token_${token}_in_${file}`);
    }
  }
}

if (failures.length) {
  console.error(JSON.stringify({ qaPassed: false, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  qaPassed: true,
  manifestVersion: manifest.version,
  permissions: manifest.permissions,
  hostPermissions: manifest.host_permissions ?? [],
  requiredFilesChecked: requiredFiles.length
}, null, 2));
