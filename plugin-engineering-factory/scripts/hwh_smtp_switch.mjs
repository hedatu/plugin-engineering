import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { assertMatchesSchema } from "../src/utils/schema.mjs";
import {
  fileExists,
  nowIso,
  parseArgs,
  writeJson
} from "../src/utils/io.mjs";
import {
  collectServerInventory,
  DEFAULT_SERVER_INVENTORY_ROOT
} from "../src/server/inventory.mjs";

const execFileAsync = promisify(execFile);
const REQUIRED_SMTP_KEYS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "SMTP_SENDER"
];
const OLD_RELAY_HOSTS = new Set([
  "45.62.105.166",
  "45.62.xxx.xxx"
]);

function parseEnvLine(line) {
  const trimmed = `${line ?? ""}`.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const separatorIndex = trimmed.indexOf("=");
  if (separatorIndex <= 0) {
    return null;
  }

  const key = trimmed.slice(0, separatorIndex).trim();
  let value = trimmed.slice(separatorIndex + 1).trim();
  if (
    (value.startsWith("\"") && value.endsWith("\""))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return {
    key,
    value: value.replace(/\\n/g, "\n").trim()
  };
}

async function readEnvFile(filePath) {
  const fs = await import("node:fs/promises");
  const raw = await fs.readFile(filePath, "utf8");
  const values = {};
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) {
      continue;
    }
    values[parsed.key] = parsed.value;
  }
  return values;
}

function bashQuote(value) {
  return `'${`${value}`.replace(/'/g, `'\"'\"'`)}'`;
}

function redactHost(value) {
  const host = `${value ?? ""}`.trim();
  if (!host) {
    return null;
  }

  const ipv4 = host.split(".");
  if (ipv4.length === 4 && ipv4.every((part) => /^\d+$/.test(part))) {
    return `${ipv4[0]}.${ipv4[1]}.xxx.xxx`;
  }

  const labels = host.split(".");
  if (labels.length >= 3) {
    const head = labels[0];
    const tail = labels.slice(-2).join(".");
    return `${head.slice(0, 3)}***.${tail}`;
  }

  return `${host.slice(0, 3)}***`;
}

function buildReport({
  provider = null,
  smtpHost = null,
  smtpSender = null,
  sendOtpStatus = "pending_user_smtp_provider_config",
  emailDelivered = false,
  verifyOtpStatus = "pending_user_smtp_provider_config",
  sessionCreated = false,
  dependencyRemoved = false,
  blocker = "pending_user_smtp_provider_config",
  nextStep = "Provide an independent SMTP provider secure env file before rerunning hwh:smtp-switch."
} = {}) {
  return {
    generated_at: nowIso(),
    provider,
    smtp_host_redacted: redactHost(smtpHost),
    smtp_sender: smtpSender,
    send_otp_status: sendOtpStatus,
    email_delivered: emailDelivered,
    verify_otp_status: verifyOtpStatus,
    session_created: sessionCreated,
    old_server_relay_dependency_removed: dependencyRemoved,
    blocker,
    next_step: nextStep
  };
}

function validateProviderConfig(envValues) {
  const missingKeys = REQUIRED_SMTP_KEYS.filter((key) => !`${envValues[key] ?? ""}`.trim());
  return {
    missingKeys,
    isComplete: missingKeys.length === 0
  };
}

async function runSshCommand(target, remoteCommand, { timeoutMs = 60_000 } = {}) {
  const sshArgs = [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "IdentitiesOnly=yes"
  ];

  const remoteTarget = target.currentLocalAliasPresent
    ? target.sshAlias
    : `${target.sshUser}@${target.ipAddress}`;

  if (!target.currentLocalAliasPresent) {
    sshArgs.push("-i", target.keyPath);
  }

  sshArgs.push(remoteTarget, `bash -lc ${bashQuote(remoteCommand)}`);

  return execFileAsync("ssh", sshArgs, {
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024
  });
}

async function readRemoteSmtpHost(target) {
  const result = await runSshCommand(
    target,
    "cd /opt/supabase-core && awk -F= '/^SMTP_HOST=/{print $2}' .env | tail -n 1",
    { timeoutMs: 20_000 }
  );
  return `${result.stdout ?? ""}`.trim() || null;
}

async function updateRemoteSmtpEnv(target, envValues) {
  const backupStamp = nowIso().replace(/[:.]/g, "-");
  const serialized = JSON.stringify({
    SMTP_HOST: envValues.SMTP_HOST,
    SMTP_PORT: envValues.SMTP_PORT,
    SMTP_USER: envValues.SMTP_USER,
    SMTP_PASS: envValues.SMTP_PASSWORD,
    SMTP_ADMIN_EMAIL: envValues.SMTP_SENDER,
    SMTP_SENDER_NAME: envValues.SMTP_SENDER_NAME || "HWH"
  });

  const remoteCommand = [
    "set -euo pipefail",
    "cd /opt/supabase-core",
    `cp .env .env.smtp-backup-${backupStamp}`,
    `python3 - <<'PY'\nfrom pathlib import Path\nimport json\npayload = json.loads(${JSON.stringify(serialized)})\nenv_path = Path('.env')\nlines = env_path.read_text(encoding='utf-8').splitlines()\nreplaced = set()\nout = []\nfor line in lines:\n    if '=' not in line or line.lstrip().startswith('#'):\n        out.append(line)\n        continue\n    key, _ = line.split('=', 1)\n    if key in payload:\n        out.append(f\"{key}={payload[key]}\")\n        replaced.add(key)\n    else:\n        out.append(line)\nfor key, value in payload.items():\n    if key not in replaced:\n        out.append(f\"{key}={value}\")\nenv_path.write_text('\\n'.join(out) + '\\n', encoding='utf-8')\nPY`,
    "docker compose up -d auth"
  ].join("\n");

  await runSshCommand(target, remoteCommand, { timeoutMs: 90_000 });
}

async function writeReport(projectRoot, report) {
  const schemaPath = path.join(projectRoot, "schemas", "smtp_independent_e2e_report.schema.json");
  await assertMatchesSchema({
    data: report,
    schemaPath,
    label: "migration/smtp_independent_e2e_report.california.json"
  });
  await writeJson(path.join(projectRoot, "migration", "smtp_independent_e2e_report.california.json"), report);
}

async function main() {
  const args = parseArgs(process.argv);
  const projectRoot = process.cwd();
  const provider = args["smtp-provider"] ? `${args["smtp-provider"]}` : null;
  const envFile = args["env-file"] ? path.resolve(`${args["env-file"]}`) : null;
  const requestedServer = `${args.server ?? "california"}`;

  if (requestedServer !== "california") {
    throw new Error("hwh:smtp-switch currently supports only --server california.");
  }

  if (!envFile || !(await fileExists(envFile))) {
    const report = buildReport({ provider });
    await writeReport(projectRoot, report);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const envValues = await readEnvFile(envFile);
  const configCheck = validateProviderConfig(envValues);
  if (!configCheck.isComplete) {
    const report = buildReport({
      provider,
      smtpHost: envValues.SMTP_HOST,
      smtpSender: envValues.SMTP_SENDER,
      blocker: "pending_user_smtp_provider_config",
      nextStep: `Secure env file is missing required keys: ${configCheck.missingKeys.join(", ")}`
    });
    await writeReport(projectRoot, report);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const { actualServers } = await collectServerInventory({
    inventoryRoot: args["inventory-root"] || DEFAULT_SERVER_INVENTORY_ROOT,
    projectRoot
  });
  const target = actualServers.california;
  if (!target?.ipAddress || !target?.keyPath) {
    throw new Error("California SSH target could not be resolved from server inventory.");
  }

  const previousHost = await readRemoteSmtpHost(target);
  await updateRemoteSmtpEnv(target, envValues);
  const remoteHost = await readRemoteSmtpHost(target);
  const dependencyRemoved = Boolean(remoteHost)
    && remoteHost !== previousHost
    && !OLD_RELAY_HOSTS.has(remoteHost);

  const report = buildReport({
    provider,
    smtpHost: remoteHost || envValues.SMTP_HOST,
    smtpSender: envValues.SMTP_SENDER,
    sendOtpStatus: "pending_manual_otp_e2e",
    emailDelivered: false,
    verifyOtpStatus: "pending_manual_otp_e2e",
    sessionCreated: false,
    dependencyRemoved,
    blocker: dependencyRemoved ? "pending_manual_otp_e2e" : "smtp_relay_dependency_still_present",
    nextStep: dependencyRemoved
      ? "Run SEND_OTP and VERIFY_OTP against California staging with a real mailbox to finish the SMTP cutover."
      : "Remote SMTP host did not move away from the old relay. Inspect /opt/supabase-core/.env and auth restart state before retrying."
  });

  await writeReport(projectRoot, report);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
