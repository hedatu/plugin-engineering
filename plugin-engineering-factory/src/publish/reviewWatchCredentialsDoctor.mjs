import path from "node:path";
import { assertMatchesSchema } from "../utils/schema.mjs";
import { nowIso, writeJson, writeText } from "../utils/io.mjs";
import {
  CHROME_WEB_STORE_READONLY_SCOPE,
  GOOGLE_TOKEN_ENDPOINT,
  fetchChromeWebStoreStatus,
  getChromeWebStoreAccessToken,
  normalizeChromeWebStoreError,
  probeChromeWebStoreEndpoint
} from "./chromeWebStoreApi.mjs";
import { bootstrapReviewWatchEnv } from "./reviewWatchCredentials.mjs";

const JSON_PATH = path.join("state", "review_watch_credentials_doctor.json");
const MD_PATH = path.join("state", "review_watch_credentials_doctor.md");

function pickRevisionState(responseBody, keys) {
  if (!responseBody || typeof responseBody !== "object") {
    return null;
  }

  for (const key of keys) {
    const value = responseBody[key];
    if (value === null || value === undefined) {
      continue;
    }
    if (typeof value === "object" && !Array.isArray(value)) {
      const nestedState = value.state ?? value.status ?? value.reviewState ?? value.review_state ?? null;
      if (nestedState !== null && nestedState !== undefined) {
        return `${nestedState}`;
      }
    }
    return `${value}`;
  }
  return null;
}

function deriveReviewStateFromFetchStatus(responseBody) {
  const submitted = pickRevisionState(responseBody, [
    "submittedItemRevisionStatus",
    "submittedRevisionStatus",
    "submitted_revision_status"
  ]);
  const published = pickRevisionState(responseBody, [
    "publishedItemRevisionStatus",
    "publishedRevisionStatus",
    "published_revision_status"
  ]);
  return published ?? submitted ?? null;
}

function buildMarkdown(report) {
  const lines = [
    "# Review Watch Credentials Doctor",
    "",
    `- Checked at: ${report.checked_at}`,
    `- Credential mode: ${report.credential_mode}`,
    `- Publisher id present: ${report.publisher_id_present}`,
    `- Item id present: ${report.item_id_present}`,
    `- Proxy configured: ${report.proxy_configured}`,
    `- Proxy source: ${report.proxy_source ?? "none"}`,
    `- Proxy url: ${report.proxy_url_redacted ?? "none"}`,
    `- Node can probe oauth2: ${report.node_can_probe_oauth2}`,
    `- Node can probe CWS: ${report.node_can_probe_cws}`,
    `- Token self test attempted: ${report.token_self_test_attempted}`,
    `- Token self test status: ${report.token_self_test_status}`,
    `- Fetch status attempted: ${report.fetch_status_attempted}`,
    `- Fetch status status: ${report.fetch_status_status}`,
    `- Current review state: ${report.current_review_state ?? "unknown"}`,
    "",
    "## Findings",
    ""
  ];

  if (report.findings.length === 0) {
    lines.push("- No findings");
  } else {
    for (const finding of report.findings) {
      lines.push(`- ${finding}`);
    }
  }

  lines.push("", "## Required Fixes", "");
  if (report.required_fixes.length === 0) {
    lines.push("- None");
  } else {
    for (const fix of report.required_fixes) {
      lines.push(`- ${fix}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function validateReport(projectRoot, report) {
  await assertMatchesSchema({
    data: report,
    schemaPath: path.join(projectRoot, "schemas", "review_watch_credentials_doctor.schema.json"),
    label: "state/review_watch_credentials_doctor.json"
  });
}

async function readWorkflowSecretHints(projectRoot) {
  const fs = await import("node:fs/promises");
  const workflowPath = path.join(projectRoot, ".github", "workflows", "review-watch.yml");
  try {
    const workflowText = await fs.readFile(workflowPath, "utf8");
    return {
      checked: true,
      workflow_file_exists: true,
      mapped_secret_names: [
        "CHROME_WEB_STORE_PUBLISHER_ID",
        "CHROME_WEB_STORE_SANDBOX_ITEM_ID",
        "CHROME_WEB_STORE_SERVICE_ACCOUNT_JSON",
        "GOOGLE_APPLICATION_CREDENTIALS_PATH",
        "CWS_HTTPS_PROXY",
        "CWS_HTTP_PROXY"
      ].filter((name) => workflowText.includes(name))
    };
  } catch {
    return {
      checked: true,
      workflow_file_exists: false,
      mapped_secret_names: []
    };
  }
}

export async function runReviewWatchCredentialsDoctor({ projectRoot = process.cwd() } = {}) {
  const checkedAt = nowIso();
  const bootstrap = await bootstrapReviewWatchEnv({ projectRoot });
  const workflowHints = await readWorkflowSecretHints(projectRoot);
  const findings = [];
  const requiredFixes = [];

  const oauthProbe = await probeChromeWebStoreEndpoint({
    url: GOOGLE_TOKEN_ENDPOINT,
    label: "oauth2"
  });
  const cwsProbe = await probeChromeWebStoreEndpoint({
    url: "https://chromewebstore.googleapis.com/",
    label: "chrome_web_store_api"
  });

  let tokenSelfTestAttempted = false;
  let tokenSelfTestStatus = "skipped";
  let tokenSelfTestFailurePhase = null;
  let tokenSelfTestFailureReason = null;
  let fetchStatusAttempted = false;
  let fetchStatusStatus = "skipped";
  let fetchStatusFailurePhase = null;
  let fetchStatusFailureReason = null;
  let fetchStatusHttpStatus = null;
  let currentReviewState = null;
  let liveFetchStatusSource = "not_attempted";

  let accessToken = null;

  if (bootstrap.credential_mode === "missing") {
    findings.push("No Chrome Web Store API credentials are available to the current Node process after bootstrap.");
    requiredFixes.push("Set credentials in process env, .env.local, or GitHub Actions secrets.");
  } else {
    tokenSelfTestAttempted = true;
    try {
      const tokenResult = await getChromeWebStoreAccessToken(bootstrap.credential_mode, {
        scope: CHROME_WEB_STORE_READONLY_SCOPE
      });
      accessToken = tokenResult.accessToken;
      tokenSelfTestStatus = accessToken ? "passed" : "failed";
      if (accessToken) {
        findings.push(`Token self-test passed via ${bootstrap.credential_mode}.`);
      }
    } catch (error) {
      const normalized = normalizeChromeWebStoreError(error, "token_exchange");
      tokenSelfTestStatus = "failed";
      tokenSelfTestFailurePhase = normalized.failure_phase;
      tokenSelfTestFailureReason = normalized.message;
      findings.push(`Token self-test failed during ${normalized.failure_phase}.`);
      requiredFixes.push("Fix the configured Chrome Web Store credential before relying on automatic review polling.");
      if (normalized.proxy_configured && normalized.retryable) {
        requiredFixes.push("Verify the configured proxy can reach Google OAuth endpoints from Node.");
      }
    }
  }

  if (!bootstrap.publisher_id_present || !bootstrap.item_id_present) {
    findings.push("Publisher id or sandbox item id is missing, so fetchStatus cannot run.");
    requiredFixes.push("Set CHROME_WEB_STORE_PUBLISHER_ID and CHROME_WEB_STORE_SANDBOX_ITEM_ID.");
  } else if (tokenSelfTestStatus === "passed" && accessToken) {
    fetchStatusAttempted = true;
    try {
      const response = await fetchChromeWebStoreStatus({
        publisherId: process.env.CHROME_WEB_STORE_PUBLISHER_ID,
        itemId: process.env.CHROME_WEB_STORE_SANDBOX_ITEM_ID,
        accessToken
      });
      fetchStatusHttpStatus = response.http_status ?? response.status_code ?? null;
      if (response.ok) {
        fetchStatusStatus = "passed";
        currentReviewState = deriveReviewStateFromFetchStatus(response.body);
        liveFetchStatusSource = "live_fetch_status";
        findings.push(`fetchStatus live check succeeded with review state ${currentReviewState ?? "unknown"}.`);
      } else {
        fetchStatusStatus = "failed";
        fetchStatusFailurePhase = "chrome_webstore_fetch_status";
        fetchStatusFailureReason = `fetchStatus failed with HTTP ${fetchStatusHttpStatus}.`;
        requiredFixes.push("Verify publisher membership and sandbox item ownership for the configured credentials.");
      }
    } catch (error) {
      const normalized = normalizeChromeWebStoreError(error, "chrome_webstore_fetch_status");
      fetchStatusStatus = "failed";
      fetchStatusFailurePhase = normalized.failure_phase;
      fetchStatusFailureReason = normalized.message;
      fetchStatusHttpStatus = normalized.http_status;
      if (normalized.http_status === 403) {
        findings.push("fetchStatus returned 403. Credentials can talk to Chrome Web Store, but access to this publisher or item is denied.");
        requiredFixes.push("Confirm the service account or OAuth user has access to the configured publisher and item.");
      } else if (normalized.http_status === 404) {
        findings.push("fetchStatus returned 404. Publisher id or sandbox item id is likely wrong for the configured credentials.");
        requiredFixes.push("Verify CHROME_WEB_STORE_PUBLISHER_ID and CHROME_WEB_STORE_SANDBOX_ITEM_ID.");
      } else {
        findings.push(`fetchStatus failed during ${normalized.failure_phase}.`);
        requiredFixes.push("Fix the fetchStatus failure before relying on automatic review polling.");
      }
      if (normalized.proxy_configured && normalized.retryable) {
        requiredFixes.push("Verify the configured proxy can reach the Chrome Web Store API from Node.");
      }
    }
  }

  if (bootstrap.google_application_credentials_present && !bootstrap.google_application_credentials_file_exists && bootstrap.credential_mode === "service_account_file") {
    findings.push("GOOGLE_APPLICATION_CREDENTIALS or CHROME_WEB_STORE_SERVICE_ACCOUNT_FILE is set, but the file does not exist.");
    requiredFixes.push("Point GOOGLE_APPLICATION_CREDENTIALS at a valid local service-account JSON file.");
  }
  if (bootstrap.current_process_inheritance_issue_detected) {
    findings.push("The current Node process did not inherit all persisted Windows environment variables. Bootstrap recovered them as a fallback.");
    requiredFixes.push("Prefer .env.local or restart the terminal after changing User or Machine environment variables.");
  }
  if (bootstrap.credential_mode === "oauth_refresh_token" && (!bootstrap.oauth_client_id_present || !bootstrap.oauth_client_secret_present || !bootstrap.oauth_refresh_token_present)) {
    findings.push("OAuth refresh-token mode is partially configured.");
    requiredFixes.push("Provide client id, client secret, and refresh token together for OAuth mode.");
  }
  if (!oauthProbe.reachable) {
    findings.push("Node could not reach oauth2.googleapis.com.");
    requiredFixes.push("Check direct network access or proxy configuration for Google OAuth.");
  }
  if (!cwsProbe.reachable) {
    findings.push("Node could not reach chromewebstore.googleapis.com.");
    requiredFixes.push("Check direct network access or proxy configuration for the Chrome Web Store API.");
  }

  const report = {
    stage: "REVIEW_WATCH_CREDENTIALS_DOCTOR",
    status: requiredFixes.length > 0 ? "warning" : "passed",
    checked_at: checkedAt,
    env_sources_checked: {
      process_env: {
        checked: true,
        present_keys: bootstrap.process_env_present_keys_before
      },
      env_local: {
        checked: true,
        file_exists: bootstrap.env_local_exists,
        present_keys: bootstrap.env_local_present_keys,
        loaded_keys: bootstrap.loaded_from_env_local
      },
      github_actions_env: {
        checked: true,
        detected: bootstrap.github_actions_detected,
        workflow_file_exists: workflowHints.workflow_file_exists,
        mapped_secret_names: workflowHints.mapped_secret_names
      },
      windows_user_machine_env: {
        checked: bootstrap.windows_persisted_checked,
        user_present_keys: bootstrap.windows_persisted_user_present_keys,
        machine_present_keys: bootstrap.windows_persisted_machine_present_keys,
        loaded_keys: bootstrap.loaded_from_windows_persisted,
        current_process_inheritance_issue_detected: bootstrap.current_process_inheritance_issue_detected
      }
    },
    publisher_id_present: bootstrap.publisher_id_present,
    item_id_present: bootstrap.item_id_present,
    google_application_credentials_present: bootstrap.google_application_credentials_present,
    google_application_credentials_file_exists: bootstrap.google_application_credentials_file_exists,
    service_account_json_present: bootstrap.service_account_json_present,
    oauth_refresh_token_present: bootstrap.oauth_refresh_token_present,
    credential_mode: bootstrap.credential_mode,
    proxy_configured: bootstrap.proxy_configured,
    proxy_source: bootstrap.proxy_source,
    proxy_url_redacted: bootstrap.proxy_url_redacted,
    node_can_probe_oauth2: oauthProbe.reachable === true,
    node_can_probe_cws: cwsProbe.reachable === true,
    token_self_test_attempted: tokenSelfTestAttempted,
    token_self_test_status: tokenSelfTestStatus,
    token_self_test_failure_phase: tokenSelfTestFailurePhase,
    token_self_test_failure_reason: tokenSelfTestFailureReason,
    fetch_status_attempted: fetchStatusAttempted,
    fetch_status_status: fetchStatusStatus,
    fetch_status_failure_phase: fetchStatusFailurePhase,
    fetch_status_failure_reason: fetchStatusFailureReason,
    fetch_status_http_status: fetchStatusHttpStatus,
    current_review_state: currentReviewState,
    live_fetch_status_source: liveFetchStatusSource,
    findings: [...new Set(findings)],
    required_fixes: [...new Set(requiredFixes)]
  };

  await validateReport(projectRoot, report);
  await writeJson(path.join(projectRoot, JSON_PATH), report);
  await writeText(path.join(projectRoot, MD_PATH), buildMarkdown(report));
  return report;
}
