import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileExists } from "../utils/io.mjs";

export const REVIEW_WATCH_ENV_KEYS = [
  "CHROME_WEB_STORE_PUBLISHER_ID",
  "CHROME_WEB_STORE_SANDBOX_ITEM_ID",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "CHROME_WEB_STORE_SERVICE_ACCOUNT_JSON",
  "CHROME_WEB_STORE_SERVICE_ACCOUNT_FILE",
  "CHROME_WEB_STORE_CLIENT_ID",
  "CHROME_WEB_STORE_CLIENT_SECRET",
  "CHROME_WEB_STORE_REFRESH_TOKEN",
  "CWS_HTTPS_PROXY",
  "CWS_HTTP_PROXY",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY"
];

function hasNonEmptyValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeEnvValue(value) {
  return hasNonEmptyValue(value) ? value.trim() : "";
}

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
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  value = value.replace(/\\n/g, "\n").trim();
  return { key, value };
}

async function readEnvLocal(projectRoot) {
  const envLocalPath = path.join(projectRoot, ".env.local");
  const exists = await fileExists(envLocalPath);
  if (!exists) {
    return {
      path: envLocalPath,
      exists: false,
      values: {},
      present_keys: []
    };
  }

  const fs = await import("node:fs/promises");
  const content = await fs.readFile(envLocalPath, "utf8");
  const values = {};
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed || !REVIEW_WATCH_ENV_KEYS.includes(parsed.key) || !hasNonEmptyValue(parsed.value)) {
      continue;
    }
    values[parsed.key] = parsed.value;
  }

  return {
    path: envLocalPath,
    exists: true,
    values,
    present_keys: Object.keys(values).sort()
  };
}

function redactFilesystemPath(value) {
  if (!hasNonEmptyValue(value)) {
    return null;
  }
  const normalized = `${value}`.trim();
  const parsed = path.parse(normalized);
  if (!parsed.base) {
    return "...";
  }
  if (parsed.root) {
    const root = parsed.root.replace(/[\\/]+$/, "");
    const separator = normalized.includes("/") ? "/" : "\\";
    return `${root}${separator}...${separator}${parsed.base}`;
  }
  return `.../${parsed.base}`;
}

function normalizeProxyUrl(rawProxyUrl) {
  if (!hasNonEmptyValue(rawProxyUrl)) {
    return null;
  }
  const trimmed = `${rawProxyUrl}`.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `http://${trimmed}`;
}

export function redactProxyUrl(rawProxyUrl) {
  const normalized = normalizeProxyUrl(rawProxyUrl);
  if (!normalized) {
    return null;
  }

  try {
    const parsed = new URL(normalized);
    parsed.username = "";
    parsed.password = "";
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "[redacted-proxy]";
  }
}

function resolveProxySummary() {
  const orderedSources = [
    ["CWS_HTTPS_PROXY", process.env.CWS_HTTPS_PROXY],
    ["CWS_HTTP_PROXY", process.env.CWS_HTTP_PROXY],
    ["HTTPS_PROXY", process.env.HTTPS_PROXY],
    ["HTTP_PROXY", process.env.HTTP_PROXY]
  ];

  for (const [source, value] of orderedSources) {
    if (hasNonEmptyValue(value)) {
      return {
        proxy_configured: true,
        proxy_source: source,
        proxy_url_redacted: redactProxyUrl(value)
      };
    }
  }

  return {
    proxy_configured: false,
    proxy_source: null,
    proxy_url_redacted: null
  };
}

function getProcessEnvPresence() {
  return Object.fromEntries(
    REVIEW_WATCH_ENV_KEYS.map((key) => [key, hasNonEmptyValue(process.env[key])])
  );
}

function runWindowsPersistedEnvProbe() {
  if (process.platform !== "win32") {
    return {
      checked: false,
      values: {},
      user_present_keys: [],
      machine_present_keys: [],
      error: null
    };
  }

  const keysLiteral = REVIEW_WATCH_ENV_KEYS.map((key) => `'${key.replaceAll("'", "''")}'`).join(",");
  const script = [
    `$keys = @(${keysLiteral})`,
    "$result = @()",
    "foreach ($key in $keys) {",
    "  $userValue = [Environment]::GetEnvironmentVariable($key, 'User')",
    "  $machineValue = [Environment]::GetEnvironmentVariable($key, 'Machine')",
    "  $value = $null",
    "  $scope = $null",
    "  if ($userValue) {",
    "    $value = $userValue",
    "    $scope = 'User'",
    "  } elseif ($machineValue) {",
    "    $value = $machineValue",
    "    $scope = 'Machine'",
    "  }",
    "  $result += [pscustomobject]@{",
    "    name = $key",
    "    user_present = [bool]$userValue",
    "    machine_present = [bool]$machineValue",
    "    scope = $scope",
    "    value = $value",
    "  }",
    "}",
    "$result | ConvertTo-Json -Depth 3 -Compress"
  ].join("\n");

  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true
  });

  if (result.error || result.status !== 0) {
    return {
      checked: true,
      values: {},
      user_present_keys: [],
      machine_present_keys: [],
      error: result.error?.message ?? result.stderr?.trim() ?? "unknown_powershell_probe_failure"
    };
  }

  const parsed = JSON.parse(result.stdout || "[]");
  const values = {};
  const userPresentKeys = [];
  const machinePresentKeys = [];
  for (const entry of parsed) {
    if (entry?.user_present === true) {
      userPresentKeys.push(entry.name);
    }
    if (entry?.machine_present === true) {
      machinePresentKeys.push(entry.name);
    }
    if (hasNonEmptyValue(entry?.value) && REVIEW_WATCH_ENV_KEYS.includes(entry.name)) {
      values[entry.name] = entry.value;
    }
  }

  return {
    checked: true,
    values,
    user_present_keys: userPresentKeys.sort(),
    machine_present_keys: machinePresentKeys.sort(),
    error: null
  };
}

function resolveCredentialMode() {
  const serviceAccountJsonPresent = hasNonEmptyValue(process.env.CHROME_WEB_STORE_SERVICE_ACCOUNT_JSON);
  const serviceAccountFileValue = process.env.CHROME_WEB_STORE_SERVICE_ACCOUNT_FILE
    ?? process.env.GOOGLE_APPLICATION_CREDENTIALS
    ?? "";
  const serviceAccountFilePresent = hasNonEmptyValue(serviceAccountFileValue);
  const oauthClientIdPresent = hasNonEmptyValue(process.env.CHROME_WEB_STORE_CLIENT_ID);
  const oauthClientSecretPresent = hasNonEmptyValue(process.env.CHROME_WEB_STORE_CLIENT_SECRET);
  const oauthRefreshTokenPresent = hasNonEmptyValue(process.env.CHROME_WEB_STORE_REFRESH_TOKEN);

  if (serviceAccountJsonPresent) {
    return {
      credential_mode: "service_account_json",
      access_token_mode: "service_account",
      credential_present: true,
      token_source: "service_account_inline_json"
    };
  }

  if (serviceAccountFilePresent) {
    return {
      credential_mode: "service_account_file",
      access_token_mode: "service_account",
      credential_present: true,
      token_source: hasNonEmptyValue(process.env.CHROME_WEB_STORE_SERVICE_ACCOUNT_FILE)
        ? "service_account_file"
        : "google_application_credentials"
    };
  }

  if (oauthClientIdPresent && oauthClientSecretPresent && oauthRefreshTokenPresent) {
    return {
      credential_mode: "oauth_refresh_token",
      access_token_mode: "oauth_refresh_token",
      credential_present: true,
      token_source: "oauth_refresh_exchange"
    };
  }

  return {
    credential_mode: "missing",
    access_token_mode: "missing",
    credential_present: false,
    token_source: "none"
  };
}

async function summarizeEffectiveEnvironment({
  projectRoot,
  envLocal,
  processPresenceBefore,
  loadedFromEnvLocal,
  windowsPersisted,
  loadedFromWindowsPersisted
}) {
  const credentialMode = resolveCredentialMode();
  const googleApplicationCredentialsValue = process.env.GOOGLE_APPLICATION_CREDENTIALS
    ?? process.env.CHROME_WEB_STORE_SERVICE_ACCOUNT_FILE
    ?? null;
  const googleApplicationCredentialsPresent = hasNonEmptyValue(googleApplicationCredentialsValue);
  const googleApplicationCredentialsFileExists = googleApplicationCredentialsPresent
    ? await fileExists(googleApplicationCredentialsValue)
    : false;
  const proxySummary = resolveProxySummary();

  return {
    env_local_path_redacted: redactFilesystemPath(envLocal.path),
    env_local_exists: envLocal.exists,
    process_env_present_keys_before: Object.entries(processPresenceBefore)
      .filter(([, present]) => present)
      .map(([key]) => key)
      .sort(),
    process_env_present_keys_after: Object.entries(getProcessEnvPresence())
      .filter(([, present]) => present)
      .map(([key]) => key)
      .sort(),
    env_local_present_keys: envLocal.present_keys,
    loaded_from_env_local: loadedFromEnvLocal.sort(),
    windows_persisted_checked: windowsPersisted.checked,
    windows_persisted_user_present_keys: windowsPersisted.user_present_keys ?? [],
    windows_persisted_machine_present_keys: windowsPersisted.machine_present_keys ?? [],
    loaded_from_windows_persisted: loadedFromWindowsPersisted.sort(),
    windows_persisted_probe_error: windowsPersisted.error ?? null,
    current_process_inheritance_issue_detected: loadedFromWindowsPersisted.length > 0,
    publisher_id_present: hasNonEmptyValue(process.env.CHROME_WEB_STORE_PUBLISHER_ID),
    item_id_present: hasNonEmptyValue(process.env.CHROME_WEB_STORE_SANDBOX_ITEM_ID),
    google_application_credentials_present: googleApplicationCredentialsPresent,
    google_application_credentials_file_exists: googleApplicationCredentialsFileExists,
    google_application_credentials_path_redacted: redactFilesystemPath(googleApplicationCredentialsValue),
    service_account_json_present: hasNonEmptyValue(process.env.CHROME_WEB_STORE_SERVICE_ACCOUNT_JSON),
    oauth_client_id_present: hasNonEmptyValue(process.env.CHROME_WEB_STORE_CLIENT_ID),
    oauth_client_secret_present: hasNonEmptyValue(process.env.CHROME_WEB_STORE_CLIENT_SECRET),
    oauth_refresh_token_present: hasNonEmptyValue(process.env.CHROME_WEB_STORE_REFRESH_TOKEN),
    ...credentialMode,
    ...proxySummary,
    github_actions_detected: process.env.GITHUB_ACTIONS === "true",
    project_root: projectRoot
  };
}

export async function bootstrapReviewWatchEnv({ projectRoot = process.cwd() } = {}) {
  const processPresenceBefore = getProcessEnvPresence();
  const envLocal = await readEnvLocal(projectRoot);
  const loadedFromEnvLocal = [];
  for (const [key, value] of Object.entries(envLocal.values)) {
    if (!hasNonEmptyValue(process.env[key])) {
      process.env[key] = value;
      loadedFromEnvLocal.push(key);
    }
  }

  const windowsPersisted = runWindowsPersistedEnvProbe();
  const loadedFromWindowsPersisted = [];
  for (const [key, value] of Object.entries(windowsPersisted.values ?? {})) {
    if (!hasNonEmptyValue(process.env[key])) {
      process.env[key] = value;
      loadedFromWindowsPersisted.push(key);
    }
  }

  return summarizeEffectiveEnvironment({
    projectRoot,
    envLocal,
    processPresenceBefore,
    loadedFromEnvLocal,
    windowsPersisted,
    loadedFromWindowsPersisted
  });
}

export async function getReviewWatchCredentialContext({ projectRoot = process.cwd() } = {}) {
  return bootstrapReviewWatchEnv({ projectRoot });
}
