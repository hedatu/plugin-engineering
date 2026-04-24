import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();

const skipDirNames = new Set([
  ".git",
  "node_modules",
  "dist",
  ".next",
  ".turbo",
  "coverage",
  ".vite",
]);

const skipFileNames = new Set([
  ".DS_Store",
  "secret_scan_output.json",
]);

const skipRelativePaths = new Set([
  "scripts/secret_scan.mjs",
]);

const secretNamePatterns = [
  /WAFFO_PRIVATE_KEY/i,
  /\.pem$/i,
  /\.key$/i,
  /^\.env$/i,
  /^\.env\.local$/i,
  /^\.env\.production$/i,
  /^service-account.*\.json$/i,
  /^google.*\.json$/i,
];

const contentDetectors = [
  { id: "service_role_key", regex: /SUPABASE_SERVICE_ROLE_KEY/i, severity: "review" },
  { id: "waffo_private_key_ref", regex: /WAFFO_PRIVATE_KEY/i, severity: "review" },
  { id: "webhook_secret_ref", regex: /WEBHOOK_SECRET|webhook secret/i, severity: "review" },
  { id: "smtp_password_ref", regex: /SMTP_PASSWORD/i, severity: "review" },
  { id: "resend_api_key_ref", regex: /RESEND_API_KEY/i, severity: "review" },
  { id: "cloudflare_api_token_ref", regex: /CF_API_TOKEN|CLOUDFLARE_API_TOKEN/i, severity: "review" },
  { id: "private_key_block", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, severity: "high" },
  { id: "google_service_account_json", regex: /"type"\s*:\s*"service_account"|"private_key"\s*:\s*"-----BEGIN PRIVATE KEY-----/i, severity: "high" },
  { id: "inline_secret_assignment", regex: /(SUPABASE_SERVICE_ROLE_KEY|WAFFO_PRIVATE_KEY|WEBHOOK_SECRET|SMTP_PASSWORD|RESEND_API_KEY|CF_API_TOKEN)\s*[:=]\s*["'][^"'<>]{12,}["']/i, severity: "high" },
];

function normalize(relPath) {
  return relPath.split(path.sep).join("/");
}

async function collectFiles(dir, root = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (skipDirNames.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath, root)));
      continue;
    }
    if (skipFileNames.has(entry.name)) {
      continue;
    }
    files.push({
      fullPath,
      relPath: normalize(path.relative(root, fullPath)),
      name: entry.name,
    });
  }
  return files;
}

function isSensitiveName(fileName) {
  return secretNamePatterns.some((pattern) => pattern.test(fileName));
}

function seemsBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }
  }
  return false;
}

async function scanFile(file) {
  if (skipRelativePaths.has(file.relPath)) {
    return [];
  }
  const findings = [];
  if (isSensitiveName(file.name)) {
    findings.push({
      type: "filename",
      detector: "sensitive_filename",
      severity: "high",
      path: file.relPath,
    });
  }

  const fileStat = await stat(file.fullPath);
  if (fileStat.size > 2 * 1024 * 1024) {
    return findings;
  }

  const buffer = await readFile(file.fullPath);
  if (seemsBinary(buffer)) {
    return findings;
  }

  const text = buffer.toString("utf8");
  for (const detector of contentDetectors) {
    const match = detector.regex.exec(text);
    if (!match) {
      continue;
    }
    findings.push({
      type: "content",
      detector: detector.id,
      severity: detector.severity,
      path: file.relPath,
    });
  }

  return findings;
}

const files = await collectFiles(repoRoot);
const findings = [];
for (const file of files) {
  findings.push(...(await scanFile(file)));
}

const grouped = findings.reduce(
  (acc, finding) => {
    acc.total += 1;
    if (finding.severity === "high") {
      acc.high += 1;
    } else {
      acc.review += 1;
    }
    return acc;
  },
  { total: 0, high: 0, review: 0 },
);

const output = {
  repoRoot,
  scannedFiles: files.length,
  summary: grouped,
  findings: findings.sort((a, b) => a.path.localeCompare(b.path) || a.detector.localeCompare(b.detector)),
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
process.exit(output.summary.high > 0 ? 1 : 0);
