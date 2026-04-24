import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { nowIso, parseArgs, writeJson } from "../utils/io.mjs";
import { assertMatchesSchema } from "../utils/schema.mjs";
import { collectServerInventory, DEFAULT_SERVER_INVENTORY_ROOT } from "./inventory.mjs";

const execFileAsync = promisify(execFile);

const SAFE_CHECKS = [
  { key: "whoami", command: "whoami" },
  { key: "id", command: "id" },
  { key: "hostname", command: "hostname" },
  { key: "uname", command: "uname -a" },
  { key: "uptime", command: "uptime" },
  { key: "disk_usage", command: "df -h" },
  { key: "memory", command: "free -m" },
  { key: "node_version", command: "sh -lc 'if command -v node >/dev/null 2>&1; then node --version; else echo not_installed; fi'" },
  { key: "npm_version", command: "sh -lc 'if command -v npm >/dev/null 2>&1; then npm --version; else echo not_installed; fi'" },
  { key: "docker_version", command: "sh -lc 'if command -v docker >/dev/null 2>&1; then docker --version; else echo not_installed; fi'" },
  { key: "docker_compose_version", command: "sh -lc 'if command -v docker >/dev/null 2>&1; then docker compose version 2>/dev/null || echo not_installed; else echo not_installed; fi'" },
  { key: "nginx_version", command: "sh -lc 'if command -v nginx >/dev/null 2>&1; then nginx -v 2>&1; else echo not_installed; fi'" },
  { key: "caddy_version", command: "sh -lc 'if command -v caddy >/dev/null 2>&1; then caddy version; else echo not_installed; fi'" }
];

function redactIp(ipAddress) {
  if (!ipAddress) {
    return null;
  }
  const parts = ipAddress.split(".");
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.xxx.xxx`;
  }
  return `${ipAddress.slice(0, 6)}xxxx`;
}

function redactPathValue(filePath) {
  if (!filePath) {
    return null;
  }
  return filePath.replace(/^([A-Za-z]:\\Users\\)[^\\]+/i, "$1<redacted>");
}

function normalizeServerArg(serverArg) {
  if (!serverArg) {
    throw new Error("Missing required --server <california|singapore> argument.");
  }
  if (!["california", "singapore"].includes(serverArg)) {
    throw new Error(`Unsupported server '${serverArg}'. Use --server california or --server singapore.`);
  }
  return serverArg;
}

async function runSingleSshCommand(target, remoteCommand) {
  const baseArgs = [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "IdentitiesOnly=yes"
  ];

  if (target.currentLocalAliasPresent) {
    baseArgs.push(target.sshAlias, remoteCommand);
  } else {
    baseArgs.push("-i", target.keyPath, `${target.sshUser}@${target.ipAddress}`, remoteCommand);
  }

  const { stdout, stderr } = await execFileAsync("ssh", baseArgs, {
    timeout: 30_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });

  return {
    stdout: stdout.trim(),
    stderr: stderr.trim()
  };
}

export async function runServerSshDoctor({
  projectRoot = process.cwd(),
  inventoryRoot = DEFAULT_SERVER_INVENTORY_ROOT,
  server
} = {}) {
  const normalizedServer = normalizeServerArg(server);
  const { actualServers } = await collectServerInventory({ inventoryRoot, projectRoot });
  const target = actualServers[normalizedServer];
  if (!target) {
    throw new Error(`Server '${normalizedServer}' was not found in the inventory sources.`);
  }

  const report = {
    checked_at: nowIso(),
    server_id: normalizedServer,
    region: target.region,
    role: target.role,
    ip_redacted: redactIp(target.ipAddress),
    ssh_user: target.sshUser,
    ssh_key_path_redacted: redactPathValue(target.keyPath),
    ssh_alias: target.sshAlias,
    current_local_alias_present: target.currentLocalAliasPresent,
    login_method: target.currentLocalAliasPresent ? "ssh_alias_with_private_key" : "direct_ip_with_private_key",
    command_mode: "read_only",
    commands_run: SAFE_CHECKS.map((check) => check.key),
    connected: false,
    whoami: null,
    id: null,
    hostname: null,
    uname: null,
    uptime: null,
    disk_usage: null,
    memory: null,
    node_version: null,
    npm_version: null,
    docker_version: null,
    docker_compose_version: null,
    nginx_version: null,
    caddy_version: null,
    blockers: []
  };

  if (!target.ipAddress) {
    report.blockers.push("No public IP address was resolved from the local inventory sources.");
  }
  if (!target.keyPath) {
    report.blockers.push("No usable private key path was detected for this server.");
  }

  if (report.blockers.length === 0) {
    try {
      for (const check of SAFE_CHECKS) {
        const { stdout, stderr } = await runSingleSshCommand(target, check.command);
        const value = stdout || stderr || null;
        if (check.key === "hostname" && value) {
          report.connected = true;
        }
        report[check.key] = value;
      }
    } catch (error) {
      report.blockers.push(`SSH doctor failed: ${error.message}`);
    }
  }

  const schemaPath = path.join(projectRoot, "schemas", "server_ssh_doctor.schema.json");
  await assertMatchesSchema({
    data: report,
    schemaPath,
    label: `state/server_ssh_doctor.${normalizedServer}.json`
  });

  await writeJson(path.join(projectRoot, "state", `server_ssh_doctor.${normalizedServer}.json`), report);

  if (!report.connected) {
    throw new Error(report.blockers.join(" | ") || "SSH doctor did not establish a connection.");
  }

  return report;
}

export function parseServerSshDoctorArgs(argv) {
  const args = parseArgs(argv);
  return {
    server: args.server,
    inventoryRoot: args["inventory-root"] || DEFAULT_SERVER_INVENTORY_ROOT
  };
}
