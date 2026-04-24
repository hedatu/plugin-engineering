import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileExists, listFiles, nowIso, readJson, writeJson, writeText } from "../utils/io.mjs";
import { assertMatchesSchema } from "../utils/schema.mjs";

export const DEFAULT_SERVER_INVENTORY_ROOT = "D:\\code\\免密服务器\\数字海洋";

const SERVER_CATALOG = {
  "do-mini-sfo3-01": {
    server_id: "california",
    region: "california",
    role: "primary_factory_server",
    recommended_role: "primary_factory_server"
  },
  "do-mini-sgp1-01": {
    server_id: "singapore",
    region: "singapore",
    role: "backup_or_staging",
    recommended_role: "backup_or_staging"
  }
};

const SAFE_TEXT_EXTENSIONS = new Set([".json", ".md", ".ps1", ".sample", ".txt", ".yml", ".yaml"]);
const SENSITIVE_FILE_PATTERN = /(id_rsa|id_ed25519|private[-_. ]?key|私钥|敏感|\.pem$|\.ppk$|\.key$)/i;
const SERVER_IP_PATTERN = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactIp(ipAddress) {
  if (typeof ipAddress !== "string" || ipAddress.length === 0) {
    return null;
  }

  const ipv4Parts = ipAddress.split(".");
  if (ipv4Parts.length === 4) {
    return `${ipv4Parts[0]}.${ipv4Parts[1]}.xxx.xxx`;
  }

  return `${ipAddress.slice(0, 6)}xxxx`;
}

function redactPathValue(filePath) {
  if (!filePath) {
    return null;
  }

  let normalized = path.normalize(filePath);
  const homeDir = path.normalize(os.homedir());
  if (normalized.startsWith(homeDir)) {
    normalized = normalized.replace(new RegExp(`^${escapeRegExp(homeDir)}`, "i"), path.join(path.parse(homeDir).root, "Users", "<redacted>"));
  }

  normalized = normalized.replace(/^([A-Za-z]:\\Users\\)[^\\]+/i, "$1<redacted>");
  return normalized;
}

function expandIdentityFile(identityFile) {
  if (!identityFile) {
    return null;
  }

  let resolved = identityFile.trim();
  if (resolved.includes("$SshDir")) {
    resolved = resolved.replaceAll("$SshDir", path.join(os.homedir(), ".ssh"));
  }
  if (resolved.startsWith("~\\")) {
    resolved = path.join(os.homedir(), resolved.slice(2));
  } else if (resolved.startsWith("~/")) {
    resolved = path.join(os.homedir(), resolved.slice(2));
  }
  if (/C:\\Users\\[^\\]+\\\.ssh\\id_ed25519_do_auto/i.test(resolved) && resolved.includes("你的用户名")) {
    resolved = path.join(os.homedir(), ".ssh", "id_ed25519_do_auto");
  }
  return path.normalize(resolved);
}

function parseHostBlocks(text, sourcePath) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r/g, "");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const hostMatch = /^Host\s+(.+)$/i.exec(trimmed);
    if (hostMatch) {
      if (current?.host) {
        entries.push(current);
      }
      current = { host: hostMatch[1].trim(), sourcePath };
      continue;
    }

    if (!current) {
      continue;
    }

    const hostNameMatch = /^HostName\s+(.+)$/i.exec(trimmed);
    if (hostNameMatch) {
      current.hostName = hostNameMatch[1].trim();
      continue;
    }

    const userMatch = /^User\s+(.+)$/i.exec(trimmed);
    if (userMatch) {
      current.user = userMatch[1].trim();
      continue;
    }

    const identityMatch = /^IdentityFile\s+(.+)$/i.exec(trimmed);
    if (identityMatch) {
      current.identityFile = identityMatch[1].trim();
    }
  }

  if (current?.host) {
    entries.push(current);
  }

  return entries;
}

async function readOptionalText(filePath) {
  if (!(await fileExists(filePath))) {
    return null;
  }
  return fs.readFile(filePath, "utf8");
}

async function collectHostEntries(inventoryRoot) {
  const candidateFiles = [
    path.join(inventoryRoot, "新电脑迁移包", "05_新电脑迁移-导入DO配置.ps1"),
    path.join(inventoryRoot, "新电脑迁移包", "SSH-config-DO片段.txt"),
    path.join(os.homedir(), ".ssh", "config")
  ];

  const allEntries = [];
  for (const candidateFile of candidateFiles) {
    const text = await readOptionalText(candidateFile);
    if (!text) {
      continue;
    }
    allEntries.push(...parseHostBlocks(text, candidateFile));
  }
  return allEntries;
}

function selectHostEntry(hostEntries, serverName) {
  const exactMatches = hostEntries.filter((entry) => entry.host === serverName);
  return exactMatches[0] ?? null;
}

async function detectPreferredKeyPath(inventoryRoot, hostEntry) {
  const candidates = [];
  if (hostEntry?.identityFile) {
    candidates.push(expandIdentityFile(hostEntry.identityFile));
  }
  candidates.push(path.join(os.homedir(), ".ssh", "id_ed25519_do_auto"));
  candidates.push(path.join(inventoryRoot, "新电脑迁移包", "id_ed25519_do_auto"));

  for (const candidate of candidates.filter(Boolean)) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return candidates.find(Boolean) ?? null;
}

async function collectSafeNoteFiles(inventoryRoot, serverName) {
  const files = await listFiles(inventoryRoot);
  const matches = new Set();
  for (const file of files) {
    const extension = path.extname(file.absolutePath).toLowerCase();
    const baseName = path.basename(file.absolutePath);
    if (!SAFE_TEXT_EXTENSIONS.has(extension) || SENSITIVE_FILE_PATTERN.test(baseName)) {
      continue;
    }

    try {
      const content = await fs.readFile(file.absolutePath, "utf8");
      if (content.includes(serverName)) {
        matches.add(file.relativePath.replaceAll("\\", "/"));
      }
    } catch {
      // Ignore files that do not decode cleanly.
    }
  }

  return Array.from(matches).sort((left, right) => left.localeCompare(right));
}

async function collectSensitiveFileMetadata(inventoryRoot) {
  const files = await listFiles(inventoryRoot);
  const sensitiveFiles = files
    .filter((file) => SENSITIVE_FILE_PATTERN.test(path.basename(file.absolutePath)))
    .map((file) => file.relativePath.replaceAll("\\", "/"))
    .sort((left, right) => left.localeCompare(right));

  return {
    sensitiveFilesDetected: sensitiveFiles.length > 0,
    sensitiveFileCount: sensitiveFiles.length,
    sensitiveFileNames: sensitiveFiles
  };
}

function deriveBlockers({ currentLocalAliasPresent, ipAddress, keyPath }) {
  const blockers = [];
  if (!currentLocalAliasPresent) {
    blockers.push("Current ~/.ssh/config does not yet include the droplet alias. Import the SSH config fragment or use explicit -i login.");
  }
  if (!ipAddress) {
    blockers.push("No public IPv4 was found in the non-sensitive SSH config fragments.");
  }
  if (!keyPath) {
    blockers.push("No usable private key path was detected for this server.");
  }
  blockers.push("Inventory-only phase. SSH doctor requires explicit user approval before any connection attempt.");
  return blockers;
}

function renderInventoryMarkdown(report) {
  const lines = [
    "# Server Inventory (Redacted)",
    "",
    `- Checked at: \`${report.checked_at}\``,
    `- Inventory root: \`${report.inventory_root}\``,
    `- Servers detected: \`${report.server_count}\``,
    `- Sensitive files detected: \`${report.sensitive_files_detected}\``,
    `- Current local SSH config has DO aliases: \`${report.current_local_ssh_aliases_present}\``,
    "",
    "## Servers"
  ];

  for (const server of report.servers) {
    lines.push("");
    lines.push(`### ${server.server_id}`);
    lines.push(`- droplet_name: \`${server.droplet_name}\``);
    lines.push(`- region: \`${server.region}\``);
    lines.push(`- role: \`${server.role}\``);
    lines.push(`- ip_redacted: \`${server.ip_redacted}\``);
    lines.push(`- ssh_user: \`${server.ssh_user}\``);
    lines.push(`- ssh_key_path_redacted: \`${server.ssh_key_path_redacted ?? "not_detected"}\``);
    lines.push(`- ssh_config_detected: \`${server.ssh_config_detected}\``);
    lines.push(`- current_local_alias_present: \`${server.current_local_alias_present}\``);
    lines.push(`- login_method: \`${server.login_method}\``);
    lines.push(`- recommended_role: \`${server.recommended_role}\``);
    lines.push(`- should_connect_now: \`${server.should_connect_now}\``);
    lines.push(`- sensitive_files_detected: \`${server.sensitive_files_detected}\``);
    lines.push("- notes_files_detected:");
    if (server.notes_files_detected.length === 0) {
      lines.push("  - none");
    } else {
      for (const noteFile of server.notes_files_detected) {
        lines.push(`  - \`${noteFile}\``);
      }
    }
    lines.push("- blockers:");
    for (const blocker of server.blockers) {
      lines.push(`  - ${blocker}`);
    }
  }

  lines.push("");
  lines.push("## Sensitive Material Handling");
  lines.push("");
  lines.push("- Private key contents were not read.");
  lines.push("- Secret tokens were not printed.");
  lines.push("- Inventory output keeps IPs and key paths redacted.");
  return `${lines.join("\n")}\n`;
}

export async function collectServerInventory({ inventoryRoot = DEFAULT_SERVER_INVENTORY_ROOT, projectRoot = process.cwd() } = {}) {
  const dropletsConfig = await readJson(path.join(inventoryRoot, "droplets.current.json"));
  const hostEntries = await collectHostEntries(inventoryRoot);
  const localSshConfigPath = path.join(os.homedir(), ".ssh", "config");
  const currentLocalSshConfigText = await readOptionalText(localSshConfigPath);
  const sensitiveMetadata = await collectSensitiveFileMetadata(inventoryRoot);

  const servers = [];
  for (const droplet of dropletsConfig.droplets ?? []) {
    const serverDefinition = SERVER_CATALOG[droplet.name];
    if (!serverDefinition) {
      continue;
    }

    const hostEntry = selectHostEntry(hostEntries, droplet.name);
    const currentLocalAliasPresent = currentLocalSshConfigText ? currentLocalSshConfigText.includes(`Host ${droplet.name}`) : false;
    const keyPath = await detectPreferredKeyPath(inventoryRoot, hostEntry);
    const notesFiles = await collectSafeNoteFiles(inventoryRoot, droplet.name);
    const actualIp = hostEntry?.hostName && SERVER_IP_PATTERN.test(hostEntry.hostName) ? hostEntry.hostName : null;
    const actualUser = hostEntry?.user || dropletsConfig.defaultUser || "root";

    const actualServer = {
      dropletName: droplet.name,
      serverId: serverDefinition.server_id,
      region: serverDefinition.region,
      role: serverDefinition.role,
      recommendedRole: serverDefinition.recommended_role,
      ipAddress: actualIp,
      sshUser: actualUser,
      sshAlias: droplet.name,
      keyPath,
      currentLocalAliasPresent,
      sshConfigDetected: Boolean(hostEntry)
    };

    const redactedServer = {
      server_id: serverDefinition.server_id,
      droplet_name: droplet.name,
      region: serverDefinition.region,
      role: serverDefinition.role,
      ip_redacted: redactIp(actualIp),
      ssh_user: actualUser,
      ssh_key_path_redacted: redactPathValue(keyPath),
      ssh_config_detected: Boolean(hostEntry),
      current_local_alias_present: currentLocalAliasPresent,
      login_method: currentLocalAliasPresent && keyPath ? "ssh_alias_with_private_key" : keyPath && actualIp ? "direct_ip_with_private_key" : "inventory_only_unresolved",
      notes_files_detected: notesFiles,
      sensitive_files_detected: sensitiveMetadata.sensitiveFilesDetected,
      recommended_role: serverDefinition.recommended_role,
      should_connect_now: false,
      blockers: deriveBlockers({
        currentLocalAliasPresent,
        ipAddress: actualIp,
        keyPath
      })
    };

    servers.push({ actualServer, redactedServer });
  }

  servers.sort((left, right) => left.redactedServer.server_id.localeCompare(right.redactedServer.server_id));

  const redactedReport = {
    checked_at: nowIso(),
    inventory_root: inventoryRoot,
    current_local_ssh_config_path_redacted: redactPathValue(localSshConfigPath),
    current_local_ssh_aliases_present: servers.every((server) => server.redactedServer.current_local_alias_present),
    sensitive_files_detected: sensitiveMetadata.sensitiveFilesDetected,
    sensitive_file_count: sensitiveMetadata.sensitiveFileCount,
    server_count: servers.length,
    servers: servers.map((server) => server.redactedServer)
  };

  const actualServers = Object.fromEntries(servers.map((server) => [server.actualServer.serverId, server.actualServer]));
  const inventorySchemaPath = path.join(projectRoot, "schemas", "server_inventory.schema.json");

  return {
    redactedReport,
    actualServers,
    inventorySchemaPath,
    markdown: renderInventoryMarkdown(redactedReport)
  };
}

export async function runServerInventory({ inventoryRoot = DEFAULT_SERVER_INVENTORY_ROOT, projectRoot = process.cwd() } = {}) {
  const { redactedReport, inventorySchemaPath, markdown } = await collectServerInventory({ inventoryRoot, projectRoot });
  await assertMatchesSchema({
    data: redactedReport,
    schemaPath: inventorySchemaPath,
    label: "state/server_inventory.redacted.json"
  });

  await writeJson(path.join(projectRoot, "state", "server_inventory.redacted.json"), redactedReport);
  await writeText(path.join(projectRoot, "docs", "server_inventory.redacted.md"), markdown);
  return redactedReport;
}

