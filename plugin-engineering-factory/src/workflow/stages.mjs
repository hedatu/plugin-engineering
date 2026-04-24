import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { runBrowserSmokeAndCapture } from "../browser/smoke.mjs";
import { getBuilder, supportedFamilies } from "../builders/index.mjs";
import {
  augmentImplementationPlanWithMonetization,
  loadRunContextForMonetization,
  writeMonetizationTestMatrix
} from "../monetization/integration.mjs";
import {
  buildCandidateDiscoveryArtifacts,
  buildClusterReport,
  buildDiscoveryGate,
  buildEvidenceReport,
  buildOpportunityArtifacts
} from "../discovery/engine.mjs";
import {
  GOOGLE_TOKEN_ENDPOINT,
  CHROME_WEB_STORE_READONLY_SCOPE,
  fetchChromeWebStoreStatus,
  getChromeWebStoreAccessToken,
  getChromeWebStoreNetworkSummary,
  normalizeChromeWebStoreError,
  probeChromeWebStoreEndpoint,
  publishChromeWebStoreItem,
  readChromeWebStoreServiceAccountSummary,
  uploadChromeWebStorePackage
} from "../publish/chromeWebStoreApi.mjs";
import { syncActiveReviewWatchForRun } from "../publish/activeReviewWatches.mjs";
import {
  ensureDefaultHumanApprovalArtifact,
  evaluateApprovalForAction,
  loadHumanApprovalArtifact,
  writeAuthorizationForApprovalArtifact
} from "../publish/humanApproval.mjs";
import { appendReleaseLedgerEvent } from "../publish/releaseLedger.mjs";
import { readReviewStatusArtifact, runReviewStatusStage } from "../publish/reviewStatus.mjs";
import {
  PORTFOLIO_REGISTRY_PATH,
  computeRegistryCandidateAdjustments,
  loadPortfolioRegistry,
  summarizePortfolioRegistry
} from "../portfolio/registry.mjs";
import { collectLiveCandidates, enrichLiveEvidence } from "../research/liveResearch.mjs";
import { runMonitoringStage } from "../monitoring/postRelease.mjs";
import {
  evaluatePrePublishAssetGate,
  recordHumanVisualReview,
  runStoreReleasePackage
} from "../packaging/storeReleasePackage.mjs";
import { createDraftPanelPng } from "../utils/png.mjs";
import {
  hasSecretLikeContent,
  inspectSecretLikeContent,
  redactSecretLikeText,
  redactSecretLikeValue
} from "../utils/redaction.mjs";
import { createZipFromDirectory } from "../utils/zip.mjs";
import {
  copyDir,
  ensureDir,
  fileExists,
  listFiles,
  nowIso,
  readJson,
  resetDir,
  writeJson,
  writeText
} from "../utils/io.mjs";
import { assertMatchesSchema } from "../utils/schema.mjs";
import { runCloseRunStage } from "./closeRun.mjs";
import { loadManagedRunArtifact, writeManagedRunArtifact } from "./runEventArtifacts.mjs";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function unique(values) {
  return [...new Set(values)];
}

function humanizeToken(value) {
  return `${value ?? ""}`.replaceAll("_", " ").trim();
}

function trimSentence(value) {
  return `${value ?? ""}`.trim().replace(/\.+$/g, "");
}

function summarizeBuildGateBlockers({ runContext, selectedReport, buildGateReport }) {
  if (!buildGateReport?.blockers?.length) {
    return [];
  }

  return buildGateReport.blockers.map((blocker) => {
    if (blocker === "not_enough_negative_clusters") {
      return `negative clusters ${buildGateReport.cluster_count ?? 0}/${runContext.thresholds.min_negative_clusters}`;
    }
    if (blocker === "overall_score_below_threshold") {
      return `overall score ${selectedReport?.score?.overall_score ?? "unknown"}/${runContext.thresholds.min_overall_score}`;
    }
    if (blocker === "missing_supported_builder") {
      return "selected wedge has no supported builder";
    }
    if (blocker === "portfolio_overlap_too_high") {
      return `portfolio overlap ${selectedReport?.candidate?.portfolio_overlap_score ?? "unknown"} exceeds limit`;
    }
    return humanizeToken(blocker);
  });
}

function summarizeQaFailures(qaReport) {
  if (!Array.isArray(qaReport?.checks_failed) || qaReport.checks_failed.length === 0) {
    return ["qa failed"];
  }

  return qaReport.checks_failed
    .slice(0, 4)
    .map((item) => trimSentence(item.message || item.id || "qa failed"));
}

function summarizePolicyFailures(policyGate) {
  if (Array.isArray(policyGate?.issues) && policyGate.issues.length > 0) {
    return policyGate.issues.map((issue) => humanizeToken(issue));
  }
  return ["policy gate failed"];
}

function markdownList(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return "- none";
  }
  return values.map((value) => `- ${value}`).join("\n");
}

function buildListingSubmissionMarkdown({ brief, plan, listingCopy, policyGate, publishPlan }) {
  return `# Listing Submission Draft

## Publish Intent
${publishPlan.publish_intent}

## Store Copy
- Name: ${brief.product_name_working}
- Summary: ${listingCopy.store_summary}

## Description
${listingCopy.store_description}

## Privacy Disclosure
${listingCopy.privacy_disclosure}

## Permissions
${markdownList(plan.permissions)}

## Manual Review Items
${markdownList(policyGate.manual_review_items)}

## Test Instructions
${markdownList(listingCopy.test_instructions)}

## Package Status
- Asset status: ${listingCopy.asset_status}
- Policy status: ${policyGate.status}
- Publish reason: ${publishPlan.reason}
`;
}

function evidenceBaseWeight(item) {
  const sourceWeights = {
    github_issue: 1,
    support_page: 0.9,
    support: 0.85,
    faq: 0.75,
    chrome_web_store_listing: 0.45,
    store: 0.4
  };
  const sentimentAdjustments = {
    negative: 0.2,
    weak_signal: -0.1
  };
  const issueAdjustments = {
    stability: 0.1,
    privacy_concern: 0.05,
    missing_feature: 0,
    ux_friction: 0
  };

  const sourceWeight = sourceWeights[item.source_type] ?? 0.5;
  const sentimentAdjustment = sentimentAdjustments[item.sentiment] ?? 0;
  const issueAdjustment = issueAdjustments[item.issue_type] ?? 0;
  return round(clamp(sourceWeight + sentimentAdjustment + issueAdjustment, 0.15, 1.2));
}

function evidenceQualityLabel(weight) {
  if (weight >= 0.95) return "high";
  if (weight >= 0.7) return "medium";
  return "low";
}

function artifactPath(runDir, fileName) {
  return path.join(runDir, fileName);
}

function requireStageInput(value, label) {
  if (value) {
    return value;
  }
  throw new Error(`PREPARE_LISTING_PACKAGE requires ${label}.`);
}

async function resolveExtensionPackagePath(runDir, buildReport) {
  const candidatePaths = unique([
    buildReport?.package_zip,
    artifactPath(runDir, "workspace/package.zip"),
    artifactPath(runDir, "81_listing_package/extension_package.zip")
  ].filter(Boolean));

  for (const candidatePath of candidatePaths) {
    if (await fileExists(candidatePath)) {
      return candidatePath;
    }
  }

  throw new Error("PREPARE_LISTING_PACKAGE could not find workspace/package.zip.");
}

async function buildPackageHash(runDir, buildReport = null) {
  if (!buildReport) {
    return {
      algorithm: "sha256",
      value: "",
      package_path: "",
      package_size_bytes: 0
    };
  }

  const packagePath = await resolveExtensionPackagePath(runDir, buildReport);
  const buffer = await fs.readFile(packagePath);
  const stats = await fs.stat(packagePath);
  return {
    algorithm: "sha256",
    value: crypto.createHash("sha256").update(buffer).digest("hex"),
    package_path: packagePath,
    package_size_bytes: Number(stats.size)
  };
}

async function readManifestVersionForRun(runDir, buildReport = null) {
  if (!buildReport) {
    return null;
  }
  const packagePath = await resolveExtensionPackagePath(runDir, buildReport);
  const zipManifest = await readStoredZipManifest(packagePath);
  return zipManifest.manifest?.version ?? null;
}

async function readStoredZipEntries(zipPath) {
  const archive = await fs.readFile(zipPath);
  const entries = [];
  let offset = 0;

  while (offset + 30 <= archive.length) {
    const signature = archive.readUInt32LE(offset);
    if (signature !== 0x04034b50) {
      break;
    }

    const compressionMethod = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const uncompressedSize = archive.readUInt32LE(offset + 22);
    const fileNameLength = archive.readUInt16LE(offset + 26);
    const extraFieldLength = archive.readUInt16LE(offset + 28);
    const fileNameStart = offset + 30;
    const fileNameEnd = fileNameStart + fileNameLength;
    const fileName = archive.slice(fileNameStart, fileNameEnd).toString("utf8");
    const dataStart = fileNameEnd + extraFieldLength;
    const dataEnd = dataStart + compressedSize;

    if (dataEnd > archive.length) {
      throw new Error(`Zip entry ${fileName || "<unknown>"} exceeds archive bounds.`);
    }

    entries.push({
      name: fileName,
      compression_method: compressionMethod,
      compressed_size: compressedSize,
      uncompressed_size: uncompressedSize,
      data: archive.slice(dataStart, dataEnd)
    });

    offset = dataEnd;
  }

  return entries;
}

async function readStoredZipManifest(zipPath) {
  const entries = await readStoredZipEntries(zipPath);
  const manifestEntry = entries.find((entry) => entry.name === "manifest.json");
  if (!manifestEntry) {
    return {
      manifest_present: false,
      manifest: null,
      entry_names: entries.map((entry) => entry.name).sort()
    };
  }
  if (manifestEntry.compression_method !== 0) {
    throw new Error("manifest.json is compressed with an unsupported zip method.");
  }

  return {
    manifest_present: true,
    manifest: JSON.parse(manifestEntry.data.toString("utf8")),
    entry_names: entries.map((entry) => entry.name).sort()
  };
}

function findNestedFieldValue(value, candidateKeys) {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findNestedFieldValue(item, candidateKeys);
      if (nested !== null && nested !== undefined) {
        return nested;
      }
    }
    return null;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (candidateKeys.has(key) && nestedValue !== null && nestedValue !== undefined) {
      return nestedValue;
    }
  }

  for (const nestedValue of Object.values(value)) {
    const nested = findNestedFieldValue(nestedValue, candidateKeys);
    if (nested !== null && nested !== undefined) {
      return nested;
    }
  }

  return null;
}

function extractFetchStatusUploadState(response) {
  return findNestedFieldValue(response?.body ?? null, new Set(["uploadState", "upload_state"])) ?? null;
}

function extractFetchStatusCrxVersion(response) {
  const value = findNestedFieldValue(response?.body ?? null, new Set(["crxVersion", "crx_version", "version"]));
  return value === null || value === undefined ? null : `${value}`;
}

function extractFetchStatusRevisionCrxVersion(responseBody, keys) {
  const revision = findNestedFieldValue(responseBody ?? null, new Set(keys));
  const value = findNestedFieldValue(revision, new Set(["crxVersion", "crx_version", "version"]));
  return value === null || value === undefined ? null : `${value}`;
}

function extractFetchStatusRevisionState(responseBody, keys) {
  const revision = findNestedFieldValue(responseBody ?? null, new Set(keys));
  if (revision && typeof revision === "object" && !Array.isArray(revision)) {
    const state = findNestedFieldValue(revision, new Set(["state", "status", "reviewState", "review_state"]));
    return state === null || state === undefined ? null : `${state}`;
  }
  return revision === null || revision === undefined ? null : `${revision}`;
}

function deriveFetchStatusCurrentDashboardState({ submittedRevisionStatus, publishedRevisionStatus }) {
  const published = `${publishedRevisionStatus ?? ""}`.trim().toUpperCase();
  const submitted = `${submittedRevisionStatus ?? ""}`.trim().toUpperCase();

  if (published) {
    return published;
  }
  if (submitted === "PENDING_REVIEW") {
    return "PENDING_REVIEW";
  }
  if (submitted === "CANCELLED") {
    return "DRAFT";
  }
  if (submitted) {
    return submitted;
  }
  return null;
}

async function buildPreUploadChecks({ runDir, packageHash, preUploadFetchStatusResponse }) {
  const listingPackageZipPath = artifactPath(runDir, "81_listing_package.zip");
  const listingExtensionPackagePath = artifactPath(runDir, "81_listing_package/extension_package.zip");
  const packagePath = packageHash.package_path;
  const packageExists = packagePath ? await fileExists(packagePath) : false;
  const listingPackageZipExists = await fileExists(listingPackageZipPath);
  const extensionPackageZipExists = await fileExists(listingExtensionPackagePath);

  const checks = {
    status: "passed",
    package_path: packagePath,
    package_sha256: packageHash.value,
    workspace_package_exists: packageExists,
    listing_package_zip_exists: listingPackageZipExists,
    extension_package_zip_exists: extensionPackageZipExists,
    zip_manifest_present: false,
    zip_entry_names: [],
    manifest_version: null,
    remote_crx_version: extractFetchStatusCrxVersion(preUploadFetchStatusResponse),
    remote_version_check_status: "pending",
    version_conflict_checked: false,
    version_conflict_detected: false,
    failure_reason: null
  };

  if (!packageExists) {
    checks.status = "failed";
    checks.failure_reason = "Upload requires a package zip at workspace/package.zip.";
    return checks;
  }
  if (!listingPackageZipExists && !extensionPackageZipExists) {
    checks.status = "failed";
    checks.failure_reason = "Upload requires 81_listing_package.zip or 81_listing_package/extension_package.zip to exist.";
    return checks;
  }

  let zipManifest;
  try {
    zipManifest = await readStoredZipManifest(packagePath);
  } catch (error) {
    checks.status = "failed";
    checks.failure_reason = `Could not inspect package zip manifest: ${error.message}`;
    return checks;
  }

  checks.zip_manifest_present = zipManifest.manifest_present;
  checks.zip_entry_names = zipManifest.entry_names;
  checks.manifest_version = zipManifest.manifest?.version ?? null;

  if (!zipManifest.manifest_present) {
    checks.status = "failed";
    checks.failure_reason = "Package zip does not contain manifest.json.";
    return checks;
  }
  if (!checks.manifest_version) {
    checks.status = "failed";
    checks.failure_reason = "manifest.json does not contain a version field.";
    return checks;
  }

  if (checks.remote_crx_version) {
    checks.version_conflict_checked = true;
    checks.remote_version_check_status = "remote_crx_version_reported";
    if (checks.remote_crx_version === checks.manifest_version) {
      checks.status = "failed";
      checks.version_conflict_detected = true;
      checks.failure_reason = `manifest.version ${checks.manifest_version} matches the currently reported sandbox item version.`;
      return checks;
    }
  } else {
    checks.remote_version_check_status = "remote_crx_version_not_reported";
  }

  return checks;
}

function summarizeFetchStatusArtifact(response) {
  const summary = summarizeApiResponse(response);
  const crxVersion = extractFetchStatusCrxVersion(response);
  return {
    ...summary,
    upload_state: extractFetchStatusUploadState(response) ?? "not_reported",
    crxVersion,
    crx_version: crxVersion
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveBrowserSmokeRuntime(taskBrowserSmoke = {}) {
  const requested = taskBrowserSmoke?.runtime ?? "auto";
  return ["auto", "dedicated_chromium", "ixbrowser"].includes(requested)
    ? requested
    : "auto";
}

function resolvePublishLane(runContext, publishPlan) {
  if (publishPlan?.publish_intent === "archive_no_publish") {
    return "manual_new_item_handoff";
  }

  const configuredLane = runContext?.publish?.execution_lane ?? "auto";
  if (configuredLane === "manual_new_item_handoff" || configuredLane === "existing_item_update_dry_run") {
    return configuredLane;
  }

  const hasExistingItem = Boolean(
    runContext?.publish?.existing_item_id
    || runContext?.publish?.sandbox_item_id
    || process.env.CHROME_WEB_STORE_EXISTING_ITEM_ID
    || process.env.CHROME_WEB_STORE_SANDBOX_ITEM_ID
  );
  return hasExistingItem ? "existing_item_update_dry_run" : "manual_new_item_handoff";
}

function resolvePublishExecutionMode(runContext) {
  const requested = process.env.CHROME_WEB_STORE_EXECUTION_MODE ?? runContext?.publish?.execution_mode ?? "planned";
  return ["planned", "sandbox_validate"].includes(requested) ? requested : "planned";
}

function resolvePublishValidationPhase(runContext) {
  const requested = process.env.CWS_PUBLISH_VALIDATION_PHASE ?? runContext?.publish?.publish_validation_phase ?? "fetch_status_only";
  return ["fetch_status_only", "upload_only", "publish_optional"].includes(requested)
    ? requested
    : "fetch_status_only";
}

function envFlagEnabled(name) {
  return `${process.env[name] ?? ""}`.trim().toLowerCase() === "true";
}

function resolveConfiguredSandboxItemId(runContext) {
  return runContext?.publish?.sandbox_item_id
    ?? process.env.CHROME_WEB_STORE_SANDBOX_ITEM_ID
    ?? null;
}

function sandboxPublishEnabled(runContext) {
  const configured = runContext?.publish?.sandbox_publish_enabled;
  if (typeof configured === "boolean") {
    return configured;
  }
  return ["1", "true", "yes"].includes(`${process.env.CHROME_WEB_STORE_SANDBOX_PUBLISH ?? ""}`.toLowerCase());
}

function resolveExistingItemConfig(runContext, executionMode = "planned") {
  const taskPublish = runContext?.publish ?? {};
  if (executionMode === "sandbox_validate" && taskPublish.sandbox_item_id) {
    return {
      item_id: taskPublish.sandbox_item_id,
      source: "task.publish.sandbox_item_id",
      sandbox: true
    };
  }
  if (executionMode === "sandbox_validate" && process.env.CHROME_WEB_STORE_SANDBOX_ITEM_ID) {
    return {
      item_id: process.env.CHROME_WEB_STORE_SANDBOX_ITEM_ID,
      source: "env.CHROME_WEB_STORE_SANDBOX_ITEM_ID",
      sandbox: true
    };
  }
  if (executionMode === "sandbox_validate") {
    return {
      item_id: null,
      source: "sandbox_unconfigured",
      sandbox: false
    };
  }
  if (taskPublish.existing_item_id) {
    return {
      item_id: taskPublish.existing_item_id,
      source: "task.publish.existing_item_id",
      sandbox: false
    };
  }
  if (taskPublish.sandbox_item_id) {
    return {
      item_id: taskPublish.sandbox_item_id,
      source: "task.publish.sandbox_item_id",
      sandbox: true
    };
  }
  if (process.env.CHROME_WEB_STORE_EXISTING_ITEM_ID) {
    return {
      item_id: process.env.CHROME_WEB_STORE_EXISTING_ITEM_ID,
      source: "env.CHROME_WEB_STORE_EXISTING_ITEM_ID",
      sandbox: false
    };
  }
  if (process.env.CHROME_WEB_STORE_SANDBOX_ITEM_ID) {
    return {
      item_id: process.env.CHROME_WEB_STORE_SANDBOX_ITEM_ID,
      source: "env.CHROME_WEB_STORE_SANDBOX_ITEM_ID",
      sandbox: true
    };
  }
  return {
    item_id: null,
    source: "unconfigured",
    sandbox: false
  };
}

function resolvePublisherId(runContext) {
  return runContext?.publish?.publisher_id
    ?? process.env.CHROME_WEB_STORE_PUBLISHER_ID
    ?? null;
}

function resolveCredentialPreflight() {
  const oauthFields = [
    { env: "CHROME_WEB_STORE_CLIENT_ID", artifact: "oauth_client_id" },
    { env: "CHROME_WEB_STORE_CLIENT_SECRET", artifact: "oauth_secret" },
    { env: "CHROME_WEB_STORE_REFRESH_TOKEN", artifact: "oauth_refresh" }
  ];
  const serviceAccountFields = [
    { env: "GOOGLE_APPLICATION_CREDENTIALS", artifact: "google_application_credentials" },
    { env: "CHROME_WEB_STORE_SERVICE_ACCOUNT_JSON", artifact: "service_account_inline_json" },
    { env: "CHROME_WEB_STORE_SERVICE_ACCOUNT_FILE", artifact: "service_account_file" }
  ];

  const availableOauth = oauthFields
    .filter((field) => Boolean(process.env[field.env]))
    .map((field) => field.artifact);
  const availableServiceAccount = serviceAccountFields
    .filter((field) => Boolean(process.env[field.env]))
    .map((field) => field.artifact);

  if (availableServiceAccount.length > 0) {
    return {
      status: "passed",
      mode: "service_account",
      available: availableServiceAccount,
      missing: [],
      validated: false
    };
  }

  const oauthMissing = oauthFields
    .filter((field) => !process.env[field.env])
    .map((field) => field.artifact);
  if (oauthMissing.length === 0) {
    return {
      status: "passed",
      mode: "oauth_refresh",
      available: oauthFields.map((field) => field.artifact),
      missing: [],
      validated: false
    };
  }

  return {
    status: "failed",
    mode: "unconfigured",
    available: availableOauth,
    missing: [...oauthMissing, "google_application_credentials_or_service_account"],
    validated: false
  };
}

function resolveCredentialSummary(credentialsPreflight) {
  const credentialType = credentialsPreflight.mode ?? "unconfigured";
  if (credentialType === "service_account") {
    return {
      credential_type: credentialType,
      credential_present: credentialsPreflight.status === "passed",
      token_source: process.env.CHROME_WEB_STORE_SERVICE_ACCOUNT_JSON
        ? "service_account_inline_json"
        : process.env.CHROME_WEB_STORE_SERVICE_ACCOUNT_FILE
          ? "service_account_file"
          : process.env.GOOGLE_APPLICATION_CREDENTIALS
            ? "google_application_credentials"
            : "unconfigured"
    };
  }

  if (credentialType === "oauth_refresh") {
    return {
      credential_type: credentialType,
      credential_present: credentialsPreflight.status === "passed",
      token_source: "oauth_refresh_exchange"
    };
  }

  return {
    credential_type: "unconfigured",
    credential_present: false,
    token_source: "none"
  };
}

function buildChromeWebStoreResourcePath({ publisherId, itemId }) {
  const safePublisherId = publisherId ?? "{publisher_id}";
  const safeItemId = itemId ?? "{item_id}";
  return `publishers/${safePublisherId}/items/${safeItemId}`;
}

function resolvePortfolioRegistryPath(projectRoot) {
  return path.join(projectRoot, PORTFOLIO_REGISTRY_PATH);
}

function decidePublishType({ publishPlan, runContext }) {
  if (publishPlan?.publish_intent === "publish_ready" && runContext?.publish?.allow_public_release) {
    return {
      publish_type: "DEFAULT_PUBLISH",
      reason: "Publish intent is publish_ready and task configuration allows public release."
    };
  }

  return {
    publish_type: "STAGED_PUBLISH",
    reason: "First sandbox validation defaults to staged publish semantics; public exposure remains human-gated."
  };
}

function summarizeApiResponse(response) {
  const body = response?.body;
  return {
    executed: response?.executed === true,
    ok: response?.ok ?? null,
    status_code: response?.status_code ?? 0,
    http_status: response?.http_status ?? response?.status_code ?? 0,
    skipped: response?.skipped === true,
    body_keys: body && typeof body === "object" && !Array.isArray(body)
      ? Object.keys(body).sort()
      : [],
    response_body_summary: response?.response_body_summary ?? null,
    response_headers_summary: response?.response_headers_summary ?? null,
    error_details: response?.error_details ?? null
  };
}

function buildRedactionChecks(reportWithoutChecks) {
  return inspectSecretLikeContent(reportWithoutChecks);
}

function buildEmptyNetworkProbeSummary() {
  return {
    oauth2_googleapis: {
      label: "oauth2_googleapis",
      url: "https://oauth2.googleapis.com",
      attempted: false,
      reachable: null,
      ok: null,
      http_status: null,
      diagnostic_hint: null,
      retryable: false,
      error_details: null,
      response_body_summary: null,
      response_headers_summary: null,
      network_mode: "direct",
      proxy_configured: false,
      proxy_source: null,
      proxy_url_redacted: null,
      via_proxy: false
    },
    chromewebstore_googleapis: {
      label: "chromewebstore_googleapis",
      url: "https://chromewebstore.googleapis.com",
      attempted: false,
      reachable: null,
      ok: null,
      http_status: null,
      diagnostic_hint: null,
      retryable: false,
      error_details: null,
      response_body_summary: null,
      response_headers_summary: null,
      network_mode: "direct",
      proxy_configured: false,
      proxy_source: null,
      proxy_url_redacted: null,
      via_proxy: false
    }
  };
}

async function collectPublishNetworkProbeSummary() {
  const [oauth2Probe, chromeWebStoreProbe] = await Promise.all([
    probeChromeWebStoreEndpoint({
      label: "oauth2_googleapis",
      url: "https://oauth2.googleapis.com"
    }),
    probeChromeWebStoreEndpoint({
      label: "chromewebstore_googleapis",
      url: "https://chromewebstore.googleapis.com"
    })
  ]);

  return {
    oauth2_googleapis: oauth2Probe,
    chromewebstore_googleapis: chromeWebStoreProbe
  };
}

function retryableHttpStatus(statusCode) {
  return [408, 425, 429, 500, 502, 503, 504].includes(statusCode);
}

function diagnosticHintForFetchStatus(response) {
  const statusCode = response?.status_code ?? 0;
  if (statusCode === 401) {
    return "Chrome Web Store rejected the bearer credential or readonly scope.";
  }
  if (statusCode === 403) {
    return "Chrome Web Store denied access; verify service account publisher membership and sandbox item ownership.";
  }
  if (statusCode === 404) {
    return "Publisher id or sandbox item id may not match an accessible Chrome Web Store item.";
  }
  if (statusCode === 429) {
    return "Chrome Web Store rate-limited the fetchStatus request; retry after backoff.";
  }
  if (statusCode >= 500) {
    return "Chrome Web Store returned a server-side error; retry later.";
  }
  return "Chrome Web Store fetchStatus returned a non-success HTTP response.";
}

function failureMetaFromError(error, fallbackPhase) {
  const normalized = normalizeChromeWebStoreError(error, fallbackPhase);
  return {
    failure_phase: normalized.failure_phase,
    diagnostic_hint: normalized.diagnostic_hint,
    retryable: normalized.retryable,
    diagnostic_error: normalized.error_details,
    http_status: normalized.http_status,
    response_body_summary: normalized.response_body_summary,
    response_headers_summary: normalized.response_headers_summary,
    network_mode: normalized.network_mode,
    proxy_configured: normalized.proxy_configured,
    proxy_source: normalized.proxy_source,
    proxy_url_redacted: normalized.proxy_url_redacted,
    via_proxy: normalized.via_proxy,
    failure_reason: normalized.message
  };
}

function buildProxyMetadata(networkProbeSummary, preferredSummary = null) {
  const primary = preferredSummary ?? networkProbeSummary?.oauth2_googleapis ?? {
    network_mode: "direct",
    proxy_configured: false,
    proxy_source: null,
    proxy_url_redacted: null
  };

  return {
    network_mode: primary.network_mode ?? "direct",
    proxy_configured: Boolean(primary.proxy_configured),
    proxy_source: primary.proxy_source ?? null,
    proxy_url_redacted: primary.proxy_url_redacted ?? null,
    oauth2_probe_via_proxy: Boolean(networkProbeSummary?.oauth2_googleapis?.via_proxy),
    cws_probe_via_proxy: Boolean(networkProbeSummary?.chromewebstore_googleapis?.via_proxy)
  };
}

function buildClockCheck() {
  const localTimeIso = new Date().toISOString();
  const currentYear = new Date(localTimeIso).getUTCFullYear();
  const clockSane = currentYear >= 2024 && currentYear <= 2035;
  return {
    local_time_iso: localTimeIso,
    clock_check_performed: true,
    clock_sane: clockSane,
    diagnostic_hint: clockSane
      ? null
      : "Local system clock looks abnormal; verify date, time, and timezone before retrying token exchange."
  };
}

function analyzeTokenExchangeFailure({ failurePhase, responseBodySummary = null, errorDetails = null }) {
  if (failurePhase !== "token_exchange") {
    return {
      likely_cause: null,
      actionable_hint: null
    };
  }

  const bodyPreview = `${responseBodySummary?.preview ?? ""}`.toLowerCase();
  const errorMessage = `${errorDetails?.message ?? ""}`.toLowerCase();
  const combined = `${bodyPreview} ${errorMessage}`;

  if (combined.includes("invalid jwt signature") || combined.includes("invalid_grant")) {
    return {
      likely_cause: "invalid_or_revoked_service_account_key",
      actionable_hint: "verify GOOGLE_APPLICATION_CREDENTIALS points to the newest key file; verify private_key_id exists in Google Cloud Service Account Keys; recreate key if needed; check local system clock"
    };
  }

  return {
    likely_cause: null,
    actionable_hint: null
  };
}

function buildSafePublishExecutionReport(reportWithoutChecks) {
  const originalRedactionChecks = buildRedactionChecks(reportWithoutChecks);
  const redactionGuardTriggered = hasSecretLikeContent(originalRedactionChecks);
  const safeReportWithoutChecks = redactSecretLikeValue(reportWithoutChecks);

  if (redactionGuardTriggered) {
    safeReportWithoutChecks.status = "failed";
    safeReportWithoutChecks.failure_reason = "Publish execution redaction guard blocked artifact write due to secret-like content.";
    safeReportWithoutChecks.api_calls_skipped = [
      ...(safeReportWithoutChecks.api_calls_skipped ?? []),
      "artifact_write_blocked: redaction_guard"
    ];
    if (safeReportWithoutChecks.existing_item_update_dry_run?.status === "passed") {
      safeReportWithoutChecks.existing_item_update_dry_run.status = "failed";
      safeReportWithoutChecks.existing_item_update_dry_run.failure_reason = safeReportWithoutChecks.failure_reason;
    }
  }

  return {
    ...safeReportWithoutChecks,
    redaction_checks: {
      ...buildRedactionChecks(safeReportWithoutChecks),
      redaction_guard_triggered: redactionGuardTriggered
    }
  };
}

async function readPriorPublishExecution(runDir) {
  const artifact = artifactPath(runDir, "90_publish_execution.json");
  if (!(await fileExists(artifact))) {
    return null;
  }

  try {
    return await readJson(artifact);
  } catch {
    return null;
  }
}

function normalizeSuccessfulUploadExecutionEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return entry;
  }
  const uploadResponseCrxVersion = entry.upload_response_crx_version
    ?? entry.upload_response_summary?.crxVersion
    ?? entry.upload_response_summary?.crx_version
    ?? entry.upload_response?.body?.crxVersion
    ?? entry.upload_response?.body?.crx_version
    ?? null;
  const currentSandboxItemVersion = entry.current_sandbox_item_version
    ?? entry.pre_upload_checks?.remote_crx_version
    ?? null;
  const uploadedCrxVersion = entry.upload_state === "SUCCEEDED" && uploadResponseCrxVersion
    ? uploadResponseCrxVersion
    : entry.uploaded_crx_version
      ?? entry.crx_version
      ?? uploadResponseCrxVersion;
  const versionConsistencyCheck = entry.version_consistency_check ?? {
    performed: Boolean(uploadResponseCrxVersion) || entry.upload_state === "SUCCEEDED",
    upload_state: entry.upload_state ?? null,
    manifest_version: entry.manifest_version ?? null,
    upload_response_crx_version: uploadResponseCrxVersion,
    passed: !(
      entry.upload_state === "SUCCEEDED"
      && uploadResponseCrxVersion
      && entry.manifest_version
      && uploadResponseCrxVersion !== entry.manifest_version
    ),
    failure_reason: entry.upload_state === "SUCCEEDED"
      && uploadResponseCrxVersion
      && entry.manifest_version
      && uploadResponseCrxVersion !== entry.manifest_version
      ? "upload_response_crx_version_mismatch"
      : null
  };
  return {
    ...entry,
    current_sandbox_item_version: currentSandboxItemVersion,
    upload_response_crx_version: uploadResponseCrxVersion,
    uploaded_crx_version: uploadedCrxVersion,
    crx_version: uploadedCrxVersion ?? entry.crx_version ?? null,
    version_consistency_check: versionConsistencyCheck
  };
}

async function readLatestSuccessfulUploadExecution({
  projectRoot,
  runId,
  packageSha256 = null
}) {
  const historyDir = path.join(projectRoot, "state", "run_events", runId, "publish_execution");
  if (!(await fileExists(historyDir))) {
    return null;
  }

  const files = (await listFiles(historyDir))
    .map((entry) => entry.absolutePath)
    .filter((absolutePath) => absolutePath.endsWith(".json"))
    .sort()
    .reverse();

  for (const filePath of files) {
    const entry = normalizeSuccessfulUploadExecutionEntry(await readJson(filePath));
    if (entry.publish_validation_phase !== "upload_only") {
      continue;
    }
    if (entry.sandbox_upload_verified !== true && entry.upload_request_attempted !== true) {
      continue;
    }
    if (packageSha256 && entry.package_sha256 && entry.package_sha256 !== packageSha256) {
      continue;
    }
    return entry;
  }

  return null;
}

async function executeSandboxValidation({
  runDir,
  projectRoot,
  runId,
  publisherId,
  existingItem,
  validationPhase,
  currentManifestVersion = null,
  packageHash,
  credentialsPreflight,
  publishTypeDecision,
  priorSuccessfulUploadExecution = null,
  allowUpload,
  allowPublish
}) {
  const defaultNetworkSummary = getChromeWebStoreNetworkSummary(GOOGLE_TOKEN_ENDPOINT);
  const result = {
    credentials_preflight: { ...credentialsPreflight },
    fetch_status_response: null,
    upload_response: null,
    publish_response: null,
    api_calls_attempted: [],
    api_calls_skipped: [],
    failure_phase: null,
    diagnostic_hint: null,
    retryable: false,
    diagnostic_error: null,
    network_probe_summary: buildEmptyNetworkProbeSummary(),
    network_mode: defaultNetworkSummary.network_mode,
    proxy_configured: defaultNetworkSummary.proxy_configured,
    proxy_source: defaultNetworkSummary.proxy_source,
    proxy_url_redacted: defaultNetworkSummary.proxy_url_redacted,
    likely_cause: null,
    actionable_hint: null,
    sandbox_fetch_status_verified: false,
    sandbox_upload_verified: false,
    package_path: packageHash.package_path,
    package_sha256: packageHash.value,
    current_sandbox_item_version: null,
    manifest_version: null,
    upload_response_crx_version: null,
    uploaded_crx_version: null,
    published_crx_version: null,
    upload_request_attempted: false,
    upload_state: "not_attempted",
    crx_version: null,
    version_consistency_check: {
      performed: false,
      upload_state: "not_attempted",
      manifest_version: null,
      upload_response_crx_version: null,
      passed: true,
      failure_reason: null
    },
    pre_upload_checks: null,
    post_upload_fetch_status_response: null,
    post_upload_fetch_status_summary: null,
    retry_count: 0,
    last_http_status: null,
    failure_reason: null
  };

  if (!existingItem?.sandbox) {
    result.failure_reason = "sandbox_validate requires task.publish.sandbox_item_id or CHROME_WEB_STORE_SANDBOX_ITEM_ID; production item ids are blocked.";
    result.failure_phase = "env_preflight";
    result.diagnostic_hint = "Configure only CHROME_WEB_STORE_SANDBOX_ITEM_ID or task.publish.sandbox_item_id for sandbox validation.";
    return result;
  }
  if (!publisherId) {
    result.failure_reason = "sandbox_validate requires a publisher id.";
    result.failure_phase = "env_preflight";
    result.diagnostic_hint = "Set CHROME_WEB_STORE_PUBLISHER_ID or task.publish.publisher_id.";
    return result;
  }
  if (!existingItem.item_id) {
    result.failure_reason = "sandbox_validate requires a sandbox item id.";
    result.failure_phase = "env_preflight";
    result.diagnostic_hint = "Set CHROME_WEB_STORE_SANDBOX_ITEM_ID or task.publish.sandbox_item_id.";
    return result;
  }
  if (credentialsPreflight.status !== "passed") {
    result.failure_reason = "sandbox_validate requires configured Chrome Web Store credentials.";
    result.failure_phase = "env_preflight";
    result.diagnostic_hint = "Set GOOGLE_APPLICATION_CREDENTIALS or another supported Chrome Web Store credential source.";
    return result;
  }
  if (!packageHash.package_path || !packageHash.value) {
    result.failure_reason = "sandbox_validate requires a package zip hash.";
    result.failure_phase = "env_preflight";
    result.diagnostic_hint = "Rebuild the run so workspace/package.zip exists before publish validation.";
    return result;
  }

  const priorPublishExecution = validationPhase === "publish_optional"
    ? priorSuccessfulUploadExecution ?? await readPriorPublishExecution(runDir)
    : priorSuccessfulUploadExecution;
  const priorSandboxUploadReusable = validationPhase === "publish_optional"
    && priorPublishExecution?.status === "passed"
    && priorPublishExecution?.execution_mode === "sandbox_validate"
    && priorPublishExecution?.item_id === existingItem.item_id
    && priorPublishExecution?.package_sha256 === packageHash.value
    && priorPublishExecution?.sandbox_upload_verified === true;

  try {
    const tokenResult = await getChromeWebStoreAccessToken(credentialsPreflight.mode);
    Object.assign(result, {
      network_mode: tokenResult.network_mode ?? result.network_mode,
      proxy_configured: tokenResult.proxy_configured ?? result.proxy_configured,
      proxy_source: tokenResult.proxy_source ?? result.proxy_source,
      proxy_url_redacted: tokenResult.proxy_url_redacted ?? result.proxy_url_redacted
    });
    result.credentials_preflight = {
      ...credentialsPreflight,
      validated: true,
      token_mode: tokenResult.tokenMode
    };

    result.api_calls_attempted.push("fetchStatus");
    result.fetch_status_response = {
      executed: true,
      ...await fetchChromeWebStoreStatus({
      publisherId,
      itemId: existingItem.item_id,
      accessToken: tokenResult.accessToken
      })
    };
    Object.assign(result, {
      network_mode: result.fetch_status_response.network_mode ?? result.network_mode,
      proxy_configured: result.fetch_status_response.proxy_configured ?? result.proxy_configured,
      proxy_source: result.fetch_status_response.proxy_source ?? result.proxy_source,
      proxy_url_redacted: result.fetch_status_response.proxy_url_redacted ?? result.proxy_url_redacted
    });
    if (!result.fetch_status_response.ok) {
      result.failure_reason = `fetchStatus failed with HTTP ${result.fetch_status_response.status_code}.`;
      result.failure_phase = "chrome_webstore_fetch_status";
      result.diagnostic_hint = diagnosticHintForFetchStatus(result.fetch_status_response);
      result.retryable = retryableHttpStatus(result.fetch_status_response.status_code);
      result.network_probe_summary = await collectPublishNetworkProbeSummary();
      Object.assign(result, buildProxyMetadata(result.network_probe_summary, result.fetch_status_response));
      return result;
    }
    result.sandbox_fetch_status_verified = true;
    result.last_http_status = result.fetch_status_response.http_status ?? result.fetch_status_response.status_code ?? null;
    result.current_sandbox_item_version = extractFetchStatusCrxVersion(result.fetch_status_response);
    const submittedRevisionStatus = extractFetchStatusRevisionState(result.fetch_status_response.body, [
      "submittedItemRevisionStatus",
      "submittedRevisionStatus",
      "submitted_revision_status"
    ]);
    const publishedRevisionStatus = extractFetchStatusRevisionState(result.fetch_status_response.body, [
      "publishedItemRevisionStatus",
      "publishedRevisionStatus",
      "published_revision_status"
    ]);
    const currentDashboardState = deriveFetchStatusCurrentDashboardState({
      submittedRevisionStatus,
      publishedRevisionStatus
    });
    const submittedRevisionCrxVersion = extractFetchStatusRevisionCrxVersion(result.fetch_status_response.body, [
      "submittedItemRevisionStatus",
      "submittedRevisionStatus",
      "submitted_revision_status"
    ]);
    result.published_crx_version = extractFetchStatusRevisionCrxVersion(result.fetch_status_response.body, [
      "publishedItemRevisionStatus",
      "publishedRevisionStatus",
      "published_revision_status"
    ]);

    if (
      (
        validationPhase === "publish_optional"
        && `${submittedRevisionStatus ?? currentDashboardState ?? ""}`.trim().toUpperCase() === "PENDING_REVIEW"
      )
      || (
        validationPhase === "fetch_status_only"
        && `${submittedRevisionStatus ?? currentDashboardState ?? ""}`.trim().toUpperCase() === "PENDING_REVIEW"
        && (
          !currentManifestVersion
          || !submittedRevisionCrxVersion
          || submittedRevisionCrxVersion !== currentManifestVersion
        )
      )
    ) {
      result.api_calls_skipped.push("publish: previous submission still pending review");
      if (validationPhase !== "fetch_status_only") {
        result.api_calls_skipped.push("media.upload: previous submission still pending review");
      }
      result.failure_reason = "previous_submission_still_pending";
      result.failure_phase = "pre_publish_state_check";
      result.diagnostic_hint = "Cancel the previous pending sandbox review in the dashboard, then rerun sandbox publish_optional.";
      return result;
    }

    if (validationPhase === "fetch_status_only") {
      if (
        priorSuccessfulUploadExecution
        && priorSuccessfulUploadExecution.package_sha256 === packageHash.value
        && priorSuccessfulUploadExecution.sandbox_upload_verified === true
      ) {
        result.sandbox_upload_verified = true;
        result.manifest_version = priorSuccessfulUploadExecution.manifest_version ?? null;
        result.upload_response_crx_version = priorSuccessfulUploadExecution.upload_response_crx_version
          ?? priorSuccessfulUploadExecution.upload_response_summary?.crxVersion
          ?? priorSuccessfulUploadExecution.upload_response_summary?.crx_version
          ?? null;
        result.uploaded_crx_version = priorSuccessfulUploadExecution.uploaded_crx_version
          ?? priorSuccessfulUploadExecution.crx_version
          ?? result.upload_response_crx_version;
        result.crx_version = result.uploaded_crx_version;
        result.upload_state = priorSuccessfulUploadExecution.upload_state ?? "not_attempted";
        result.post_upload_fetch_status_summary = priorSuccessfulUploadExecution.post_upload_fetch_status_summary ?? null;
        result.version_consistency_check = priorSuccessfulUploadExecution.version_consistency_check ?? result.version_consistency_check;
      }
      result.api_calls_skipped.push("media.upload: publish_validation_phase=fetch_status_only");
      result.api_calls_skipped.push("publish: publish_validation_phase=fetch_status_only");
      result.publish_response = {
        ok: true,
        status_code: 0,
        skipped: true,
        reason: "publish_validation_phase=fetch_status_only"
      };
      return result;
    }

    if (priorSandboxUploadReusable) {
      result.api_calls_skipped.push("media.upload: reused prior verified sandbox upload from 90_publish_execution.json");
      result.sandbox_upload_verified = true;
      result.pre_upload_checks = priorPublishExecution.pre_upload_checks ?? null;
      result.current_sandbox_item_version = priorPublishExecution.current_sandbox_item_version
        ?? priorPublishExecution.pre_upload_checks?.remote_crx_version
        ?? result.current_sandbox_item_version;
      result.manifest_version = priorPublishExecution.manifest_version ?? null;
      result.upload_state = priorPublishExecution.upload_state ?? "SUCCEEDED";
      result.upload_response_crx_version = priorPublishExecution.upload_response_crx_version
        ?? priorPublishExecution.upload_response_summary?.crxVersion
        ?? priorPublishExecution.upload_response_summary?.crx_version
        ?? null;
      result.uploaded_crx_version = priorPublishExecution.uploaded_crx_version
        ?? priorPublishExecution.crx_version
        ?? result.upload_response_crx_version;
      result.crx_version = result.uploaded_crx_version;
      result.published_crx_version = priorPublishExecution.published_crx_version ?? result.published_crx_version;
      result.version_consistency_check = priorPublishExecution.version_consistency_check ?? result.version_consistency_check;
      result.post_upload_fetch_status_summary = priorPublishExecution.post_upload_fetch_status_summary ?? null;
      result.last_http_status = result.fetch_status_response.http_status ?? result.fetch_status_response.status_code ?? null;
      result.upload_response = {
        executed: false,
        endpoint: `https://chromewebstore.googleapis.com/upload/v2/publishers/${publisherId}/items/${existingItem.item_id}:upload`,
        method: "POST",
        ok: true,
        status_code: 0,
        http_status: null,
        body: null,
        response_body_summary: null,
        response_headers_summary: null,
        error_details: null,
        skipped: true,
        reason: "reused prior verified sandbox upload from 90_publish_execution.json"
      };
    } else {
    result.pre_upload_checks = await buildPreUploadChecks({
      runDir,
      packageHash,
      preUploadFetchStatusResponse: result.fetch_status_response
    });
    result.current_sandbox_item_version = result.pre_upload_checks.remote_crx_version ?? result.current_sandbox_item_version;
    result.manifest_version = result.pre_upload_checks.manifest_version;
    if (result.pre_upload_checks.status !== "passed") {
      result.failure_reason = result.pre_upload_checks.failure_reason;
      result.failure_phase = "pre_upload_check";
      result.diagnostic_hint = "Fix pre-upload package checks before retrying sandbox upload.";
      result.api_calls_skipped.push(`media.upload: ${result.pre_upload_checks.failure_reason}`);
      result.api_calls_skipped.push("publish: pre-upload checks failed");
      return result;
    }

    if (!allowUpload) {
      result.api_calls_skipped.push("media.upload: CWS_ALLOW_SANDBOX_UPLOAD !== true");
      result.api_calls_skipped.push("publish: upload guard blocked");
      result.failure_reason = "upload_only requires CWS_ALLOW_SANDBOX_UPLOAD=true and a configured sandbox item.";
      return result;
    }

    result.api_calls_attempted.push("media.upload");
    result.upload_request_attempted = true;
    result.upload_response = {
      executed: true,
      ...await uploadChromeWebStorePackage({
      publisherId,
      itemId: existingItem.item_id,
      accessToken: tokenResult.accessToken,
      packagePath: packageHash.package_path
      })
    };
    if (!result.upload_response.ok) {
      result.failure_reason = `media.upload failed with HTTP ${result.upload_response.status_code}.`;
      result.failure_phase = "chrome_webstore_upload";
      result.diagnostic_hint = "Sandbox upload returned a non-success HTTP response.";
      result.retryable = retryableHttpStatus(result.upload_response.status_code);
      return result;
    }

    let postUploadFetchStatusResponse = null;
    let uploadState = extractFetchStatusUploadState(result.upload_response);
    const uploadResponseCrxVersion = extractFetchStatusCrxVersion(result.upload_response);
    for (let pollIndex = 0; pollIndex <= 3; pollIndex += 1) {
      if (pollIndex > 0) {
        await sleep(30_000);
        result.retry_count = pollIndex;
      }
      result.api_calls_attempted.push(pollIndex === 0
        ? "fetchStatus:post_upload"
        : `fetchStatus:post_upload_retry_${pollIndex}`);
      postUploadFetchStatusResponse = {
        executed: true,
        ...await fetchChromeWebStoreStatus({
          publisherId,
          itemId: existingItem.item_id,
          accessToken: tokenResult.accessToken
        })
      };
      result.last_http_status = postUploadFetchStatusResponse.http_status ?? postUploadFetchStatusResponse.status_code ?? null;
      uploadState = extractFetchStatusUploadState(postUploadFetchStatusResponse) ?? uploadState;
      if (uploadState !== "UPLOAD_IN_PROGRESS") {
        break;
      }
    }

    result.post_upload_fetch_status_response = postUploadFetchStatusResponse;
    result.post_upload_fetch_status_summary = summarizeFetchStatusArtifact(postUploadFetchStatusResponse);
    result.upload_state = uploadState ?? "not_reported";
    result.upload_response_crx_version = uploadResponseCrxVersion ?? null;
    result.uploaded_crx_version = result.upload_state === "SUCCEEDED"
      ? (result.upload_response_crx_version ?? null)
      : (result.upload_response_crx_version ?? null);
    result.crx_version = result.uploaded_crx_version;
    result.sandbox_upload_verified = Boolean(result.upload_response.ok && postUploadFetchStatusResponse?.ok);
    const versionConsistencyFailureReason = result.upload_state === "SUCCEEDED"
      && result.upload_response_crx_version
      && result.manifest_version
      && result.upload_response_crx_version !== result.manifest_version
      ? "upload_response_crx_version_mismatch"
      : null;
    result.version_consistency_check = {
      performed: result.upload_state === "SUCCEEDED" || Boolean(result.upload_response_crx_version),
      upload_state: result.upload_state,
      manifest_version: result.manifest_version,
      upload_response_crx_version: result.upload_response_crx_version,
      passed: versionConsistencyFailureReason === null,
      failure_reason: versionConsistencyFailureReason
    };

    if (!postUploadFetchStatusResponse?.ok) {
      result.failure_reason = `post-upload fetchStatus failed with HTTP ${postUploadFetchStatusResponse?.status_code ?? 0}.`;
      result.failure_phase = "chrome_webstore_fetch_status";
      result.diagnostic_hint = diagnosticHintForFetchStatus(postUploadFetchStatusResponse);
      result.retryable = retryableHttpStatus(postUploadFetchStatusResponse?.status_code ?? 0);
      return result;
    }
    if (versionConsistencyFailureReason) {
      result.failure_reason = versionConsistencyFailureReason;
      result.failure_phase = "post_upload_consistency_check";
      result.diagnostic_hint = "Upload response crxVersion did not match the package manifest version.";
      return result;
    }
    }

    if (validationPhase === "upload_only") {
      result.api_calls_skipped.push("publish: publish_validation_phase=upload_only");
      result.publish_response = {
        ok: true,
        status_code: 0,
        skipped: true,
        reason: "publish_validation_phase=upload_only"
      };
      return result;
    }

    if (!allowPublish) {
      result.api_calls_skipped.push("publish: CWS_ALLOW_SANDBOX_PUBLISH !== true");
      result.failure_reason = "publish_optional requires CWS_ALLOW_SANDBOX_PUBLISH=true and a configured sandbox item.";
      return result;
    }

    result.api_calls_attempted.push("publish");
    result.publish_response = {
      executed: true,
      ...await publishChromeWebStoreItem({
      publisherId,
      itemId: existingItem.item_id,
      accessToken: tokenResult.accessToken,
      publishType: publishTypeDecision.publish_type
      })
    };
    if (!result.publish_response.ok) {
      result.failure_reason = `publish failed with HTTP ${result.publish_response.status_code}.`;
      result.failure_phase = "chrome_webstore_publish";
      result.diagnostic_hint = "Sandbox publish returned a non-success HTTP response.";
      result.retryable = retryableHttpStatus(result.publish_response.status_code);
    }
    return result;
  } catch (error) {
    const failureMeta = failureMetaFromError(error, "chrome_webstore_fetch_status");
    const tokenFailure = analyzeTokenExchangeFailure({
      failurePhase: failureMeta.failure_phase,
      responseBodySummary: failureMeta.response_body_summary,
      errorDetails: failureMeta.diagnostic_error
    });
    result.failure_reason = failureMeta.failure_reason;
    result.failure_phase = failureMeta.failure_phase;
    result.diagnostic_hint = failureMeta.diagnostic_hint;
    result.retryable = failureMeta.retryable;
    result.diagnostic_error = failureMeta.diagnostic_error;
    result.network_mode = failureMeta.network_mode ?? result.network_mode;
    result.proxy_configured = failureMeta.proxy_configured ?? result.proxy_configured;
    result.proxy_source = failureMeta.proxy_source ?? result.proxy_source;
    result.proxy_url_redacted = failureMeta.proxy_url_redacted ?? result.proxy_url_redacted;
    result.likely_cause = tokenFailure.likely_cause;
    result.actionable_hint = tokenFailure.actionable_hint;
    if (failureMeta.http_status && failureMeta.failure_phase === "chrome_webstore_fetch_status") {
      result.fetch_status_response = {
        executed: true,
        ok: false,
        status_code: failureMeta.http_status,
        http_status: failureMeta.http_status,
        body: null,
        response_body_summary: failureMeta.response_body_summary,
        response_headers_summary: failureMeta.response_headers_summary,
        error_details: failureMeta.diagnostic_error
      };
    }
    if (result.failure_phase === "token_exchange" || result.failure_phase === "chrome_webstore_fetch_status" || result.failure_phase === "network_preflight") {
      result.network_probe_summary = await collectPublishNetworkProbeSummary();
      Object.assign(result, buildProxyMetadata(result.network_probe_summary, failureMeta));
    }
    return result;
  }
}

async function validateWithSchema(projectRoot, schemaFileName, label, data) {
  await assertMatchesSchema({
    data,
    schemaPath: path.join(projectRoot, "schemas", schemaFileName),
    label
  });
}

async function validateRunArtifact(runDir, schemaFileName, label, data) {
  const runContext = await readJson(artifactPath(runDir, "00_run_context.json"));
  await validateWithSchema(runContext.project_root, schemaFileName, label, data);
}

function hasRequiredKeys(object, keys) {
  return keys.every((key) => Object.prototype.hasOwnProperty.call(object, key));
}

function mapWedgeDefaults(wedgeFamily) {
  if (wedgeFamily === "tab_csv_window_export") {
    return {
      product_name_working: "QuickTab CSV",
      single_purpose_statement: "Export tabs from the current Chrome window to a clean CSV in one click.",
      target_user: "Operators, recruiters, researchers, and coordinators who frequently share current-window tab sets.",
      trigger_moment: "The user has the exact tabs they want open and needs a clean export immediately.",
      core_workflow: [
        "Open popup",
        "Click Export Current Window",
        "Review download prompt",
        "Share or archive the CSV"
      ],
      must_have_features: [
        "Current-window only export",
        "Clean CSV columns",
        "Visible success state after download"
      ],
      non_goals: [
        "No all-session history export",
        "No account sync",
        "No analytics dashboard"
      ],
      permission_budget: {
        required: ["tabs", "downloads"],
        forbidden: ["host_permissions", "storage", "identity", "history"]
      },
      data_handling_summary: "Reads tab title and URL from the current window only when the user clicks export. Generates CSV locally and does not send data to any server.",
      ui_surface: "popup",
      success_criteria: [
        "User exports current window in one click",
        "CSV opens cleanly in spreadsheet tools",
        "No hidden background behavior"
      ],
      positioning: "A narrow replacement for bloated tab managers when the only job is exporting the current window.",
      screenshot_angles: [
        "Popup ready state with one clear export action",
        "Export success confirmation",
        "CSV opened in a spreadsheet"
      ],
      listing_summary_seed: "Export the tabs in your current Chrome window to a clean CSV file."
    };
  }

  if (wedgeFamily === "single_profile_form_fill") {
    return {
      product_name_working: "LeadFill One Profile",
      single_purpose_statement: "Save one local profile and fill visible lead form fields on the current page in one click.",
      target_user: "Sales reps, recruiters, and operators repeatedly entering the same contact details into web forms.",
      trigger_moment: "The user lands on a repetitive intake form and wants to avoid manual retyping.",
      core_workflow: [
        "Open popup",
        "Save one reusable profile locally",
        "Navigate to a target form",
        "Click Fill Current Page"
      ],
      must_have_features: [
        "One reusable local profile",
        "Visible fields only",
        "Fill initiated only by explicit user click"
      ],
      non_goals: [
        "No CRM sync",
        "No multi-profile team workspace",
        "No cloud account"
      ],
      permission_budget: {
        required: ["storage", "activeTab", "scripting"],
        forbidden: ["host_permissions", "identity", "downloads", "background"]
      },
      data_handling_summary: "Stores one profile locally in Chrome storage and injects a fill script into the active tab only when the user clicks fill.",
      ui_surface: "popup",
      success_criteria: [
        "User can save one profile without signing in",
        "Visible page fields fill in one click",
        "No remote storage or sync"
      ],
      positioning: "A narrow form-fill wedge for users who need one local profile, not a full CRM assistant.",
      screenshot_angles: [
        "Popup with one local profile form",
        "Fill action on a target page",
        "Post-fill confirmation state"
      ],
      listing_summary_seed: "Save one local profile and fill visible form fields on the current page."
    };
  }

  if (wedgeFamily === "gmail_snippet") {
    return {
      product_name_working: "Compose Snippet QuickInsert",
      single_purpose_statement: "Save reusable email snippets locally and insert one into the focused compose editor in one click.",
      target_user: "Operators, recruiters, founders, and support staff who repeat short email replies all day.",
      trigger_moment: "The user is already in a compose flow and wants a short reusable reply inserted immediately.",
      core_workflow: [
        "Open popup",
        "Save a short reusable snippet locally",
        "Focus the compose editor",
        "Click one snippet to insert it"
      ],
      must_have_features: [
        "Local snippet storage",
        "One-click insertion into the focused editor",
        "No full dashboard or side panel"
      ],
      non_goals: [
        "No inbox analytics",
        "No shared team templates",
        "No mailbox sync or reading"
      ],
      permission_budget: {
        required: ["storage", "activeTab", "scripting"],
        forbidden: ["host_permissions", "identity", "tabs", "background", "gmail_read_scopes"]
      },
      data_handling_summary: "Stores snippets locally in Chrome storage and injects text into the active page only after the user clicks a saved snippet.",
      ui_surface: "popup",
      success_criteria: [
        "User can save snippets locally without signing in",
        "User can insert text into a focused compose editor in one click",
        "No server or mailbox access is required"
      ],
      positioning: "A narrow Gmail-adjacent snippet wedge that avoids the heavy compose dashboards used by larger template suites.",
      screenshot_angles: [
        "Popup showing the saved snippet list",
        "Snippet insertion action with the compose body focused",
        "Local snippet creation flow"
      ],
      listing_summary_seed: "Save email snippets locally and insert one into the focused compose editor in one click."
    };
  }

  return {
    product_name_working: "Builder Needed",
    single_purpose_statement: "This opportunity requires a dedicated builder before it can become a build-ready extension.",
    target_user: "Internal operator",
    trigger_moment: "A promising opportunity maps to an unsupported builder family.",
    core_workflow: ["Review opportunity", "Add archetype builder", "Retry build"],
    must_have_features: ["Explicit block reason"],
    non_goals: ["No low-quality generic fallback project"],
    permission_budget: { required: [], forbidden: ["all"] },
    data_handling_summary: "No extension is generated until a builder exists.",
    ui_surface: "none",
    success_criteria: ["Unsupported builder is clearly surfaced"],
    positioning: "A safe stop instead of forcing a low-quality generic build.",
    screenshot_angles: ["No screenshots"],
    listing_summary_seed: "Builder missing."
  };
}

function mapImplementationTemplate(archetype) {
  if (archetype === "tab_csv_window_export") {
    return {
      archetype,
      target_manifest_version: 3,
      module_plan: [
        "popup UI",
        "CSV serialization helper inside popup",
        "download trigger",
        "privacy page"
      ],
      files_to_generate: [
        "manifest.json",
        "popup.html",
        "popup.css",
        "popup.js",
        "privacy.html",
        "README.md",
        "icons/icon16.png",
        "icons/icon48.png",
        "icons/icon128.png"
      ],
      permissions: ["tabs", "downloads"],
      optional_permissions: [],
      test_matrix: [
        "manifest loads with MV3",
        "popup files exist",
        "downloads permission present",
        "privacy page exists",
        "zip package is non-empty"
      ],
      storage_plan: "No extension storage required.",
      qa_checks: [
        "manifest_validation",
        "permissions_match_plan",
        "popup_entrypoints_exist",
        "zip_exists",
        "privacy_page_exists"
      ],
      risk_flags: ["avoid exporting all browser history", "keep window scope narrow"]
    };
  }

  if (archetype === "single_profile_form_fill") {
    return {
      archetype,
      target_manifest_version: 3,
      module_plan: [
        "popup profile editor",
        "local storage bridge",
        "active-tab script injection",
        "field matching heuristics",
        "privacy page"
      ],
      files_to_generate: [
        "manifest.json",
        "popup.html",
        "popup.css",
        "popup.js",
        "privacy.html",
        "README.md",
        "icons/icon16.png",
        "icons/icon48.png",
        "icons/icon128.png"
      ],
      permissions: ["storage", "activeTab", "scripting"],
      optional_permissions: [],
      test_matrix: [
        "manifest loads with MV3",
        "popup files exist",
        "storage permission present",
        "activeTab permission present",
        "zip package is non-empty"
      ],
      storage_plan: "Store one reusable profile in chrome.storage.local.",
      qa_checks: [
        "manifest_validation",
        "permissions_match_plan",
        "popup_entrypoints_exist",
        "privacy_page_exists",
        "zip_exists"
      ],
      risk_flags: ["visible fields only", "no hidden server sync"]
    };
  }

  if (archetype === "gmail_snippet") {
    return {
      archetype,
      target_manifest_version: 3,
      module_plan: [
        "popup snippet list",
        "local snippet storage",
        "active-tab text insertion",
        "focused editable detection",
        "privacy page"
      ],
      files_to_generate: [
        "manifest.json",
        "popup.html",
        "popup.css",
        "popup.js",
        "privacy.html",
        "README.md",
        "icons/icon16.png",
        "icons/icon48.png",
        "icons/icon128.png"
      ],
      permissions: ["storage", "activeTab", "scripting"],
      optional_permissions: [],
      test_matrix: [
        "manifest loads with MV3",
        "popup files exist",
        "storage permission present",
        "activeTab permission present",
        "zip package is non-empty"
      ],
      storage_plan: "Store snippets in chrome.storage.local.",
      qa_checks: [
        "manifest_validation",
        "permissions_match_plan",
        "popup_entrypoints_exist",
        "privacy_page_exists",
        "zip_exists"
      ],
      risk_flags: ["insert only on explicit click", "do not request mailbox scopes"]
    };
  }

  return {
    archetype: "generic_fallback",
    target_manifest_version: 3,
    module_plan: ["no-op"],
    files_to_generate: [],
    permissions: [],
    optional_permissions: [],
    test_matrix: ["builder_missing"],
    storage_plan: "N/A",
    qa_checks: ["builder_missing"],
    risk_flags: ["missing_builder"]
  };
}

function buildBriefMarkdown(brief) {
  return `# ${brief.product_name_working}

## Single Purpose
${brief.single_purpose_statement}

## Target User
${brief.target_user}

## Trigger Moment
${brief.trigger_moment}

## Core Workflow
${brief.core_workflow.map((step, index) => `${index + 1}. ${step}`).join("\n")}

## Must-Have Features
${brief.must_have_features.map((item) => `- ${item}`).join("\n")}

## Non-Goals
${brief.non_goals.map((item) => `- ${item}`).join("\n")}

## Permission Budget
- Required: ${brief.permission_budget.required.join(", ") || "none"}
- Forbidden: ${brief.permission_budget.forbidden.join(", ") || "none"}

## Data Handling
${brief.data_handling_summary}

## Positioning
${brief.positioning}

## Screenshot Angles
${brief.screenshot_angles.map((item) => `- ${item}`).join("\n")}
`;
}

export async function ingestTask({ projectRoot, taskPath, runsRoot, runIdentity }) {
  const task = await readJson(taskPath);
  await validateWithSchema(projectRoot, "task.schema.json", taskPath, task);
  const requiredKeys = [
    "date",
    "allowed_categories",
    "blocked_categories",
    "thresholds",
    "builder",
    "publish",
    "assets",
    "brand_rules"
  ];

  if (!hasRequiredKeys(task, requiredKeys)) {
    throw new Error("task.json is missing required keys.");
  }

  if (!runIdentity?.runId || !runIdentity?.runDir) {
    throw new Error("INGEST_TASK requires a resolved run identity.");
  }

  const runDir = runIdentity.runDir;
  if (runIdentity.allowOverwrite) {
    await resetDir(runDir);
  } else {
    await ensureDir(runDir);
  }
  const portfolioRegistry = await loadPortfolioRegistry(projectRoot);
  const portfolioRegistrySummary = summarizePortfolioRegistry(portfolioRegistry);

  const runContext = {
    stage: "INGEST_TASK",
    status: "passed",
    generated_at: nowIso(),
    project_root: projectRoot,
    task_path: taskPath,
    task_mode: task.mode ?? runIdentity.taskMode,
    run_type: task.mode ?? runIdentity.taskMode,
    run_id: runIdentity.runId,
    run_id_strategy: runIdentity.runIdStrategy,
    allow_build_after_research_resolution: task.allow_build_after_research_resolution === true,
    allow_overwrite: runIdentity.allowOverwrite === true,
    overwrite_blocked: false,
    created_at: runIdentity.createdAt ?? nowIso(),
    requested_task_run_id: task.run_id ?? null,
    date: task.date,
    allowed_categories: task.allowed_categories,
    blocked_categories: task.blocked_categories,
    thresholds: task.thresholds,
    publish: task.publish,
    browser_smoke: {
      runtime: resolveBrowserSmokeRuntime(task.browser_smoke)
    },
    builder: task.builder,
    research: task.research ?? {
      mode: "fixture",
      fallback_to_fixture: true,
      max_sitemap_shards: 1,
      max_listing_pages: 8,
      max_github_issues: 5,
      timeout_ms: 15000
    },
    discovery: task.discovery ?? {
      mode: "fixture",
      max_candidates: 50,
      query_limit: 10,
      allow_auto_build: false,
      min_evidence_quality_score: task.thresholds?.min_evidence_quality_score ?? 60,
      max_portfolio_overlap_score: task.thresholds?.max_portfolio_overlap_penalty ?? 45,
      min_testability_score: task.thresholds?.min_testability_score ?? 60
    },
    market_test: {
      enabled: task.market_test?.enabled === true
    },
    monetization: {
      enabled: task.monetization?.enabled === true,
      product_id: task.monetization?.product_id ?? null,
      pricing_model: task.monetization?.pricing_model ?? "free_with_lifetime_unlock",
      free_limit: task.monetization?.free_limit ?? {
        amount: 10,
        unit: "actions",
        scope: "lifetime"
      },
      price_label: task.monetization?.price_label ?? "$19 lifetime unlock",
      upgrade_url: task.monetization?.upgrade_url ?? "https://payments.example.com/checkout/placeholder",
      license_verify_url: task.monetization?.license_verify_url ?? "https://license.example.com/license/verify",
      license_activate_url: task.monetization?.license_activate_url ?? "https://license.example.com/license/activate",
      support_email: task.monetization?.support_email ?? "support@example.com",
      pro_features: task.monetization?.pro_features ?? [],
      free_features: task.monetization?.free_features ?? [],
      local_only_claim: task.monetization?.local_only_claim !== false,
      payment_provider: task.monetization?.payment_provider ?? "manual_license",
      checkout_mode: task.monetization?.checkout_mode ?? "test",
      entitlement_cache_ttl_hours: Number(task.monetization?.entitlement_cache_ttl_hours ?? 24),
      offline_grace_hours: Number(task.monetization?.offline_grace_hours ?? 168),
      privacy_disclosure_required: task.monetization?.privacy_disclosure_required !== false
    },
    supported_builder_families: supportedFamilies(),
    assets: task.assets,
    brand_rules: task.brand_rules,
    monitoring: task.monitoring ?? {
      enabled: false,
      required: false,
      metrics_csv_path: path.join(projectRoot, "fixtures", "monitoring", "metrics.csv"),
      reviews_json_path: path.join(projectRoot, "fixtures", "monitoring", "reviews.json"),
      support_tickets_json_path: path.join(projectRoot, "fixtures", "monitoring", "support_tickets.json")
    },
    portfolio_registry: {
      path: resolvePortfolioRegistryPath(projectRoot),
      active_wedge_families: portfolioRegistrySummary.active_wedge_families,
      blocked_candidate_ids: portfolioRegistrySummary.blocked_candidate_ids,
      archetype_priors: portfolioRegistrySummary.archetype_priors,
      item_count: portfolioRegistrySummary.item_count
    }
  };

  await writeJson(artifactPath(runDir, "00_run_context.json"), runContext);
  await writeJson(artifactPath(runDir, "run_status.json"), {
    stage: "INGEST_TASK",
    status: "passed",
    generated_at: nowIso(),
    run_id: runContext.run_id,
    run_id_strategy: runContext.run_id_strategy,
    allow_overwrite: runContext.allow_overwrite,
    overwrite_blocked: runContext.overwrite_blocked,
    created_at: runContext.created_at,
    failure_reason: null
  });
  return { runContext, runDir };
}

export async function discoverCandidates({ projectRoot, runDir, runContext }) {
  const live = await collectLiveCandidates({ projectRoot, runDir, runContext });
  const source = live.candidates
    ? { generated_at: nowIso(), candidates: live.candidates, source_mode: live.report.resolved_mode ?? live.report.source_mode ?? "live" }
    : await readJson(path.join(projectRoot, "fixtures", "discovery", "candidates.json"));
  const portfolioRegistry = await loadPortfolioRegistry(projectRoot);
  const { candidateReport, shortlistQuality } = buildCandidateDiscoveryArtifacts({
    rawCandidates: source.candidates,
    runContext,
    portfolioRegistry,
    sourceModeOverride: source.source_mode ?? "fixture"
  });

  await validateRunArtifact(runDir, "candidate_report.schema.json", "10_candidate_report.json", candidateReport);
  await validateRunArtifact(runDir, "candidate_shortlist_quality.schema.json", "12_candidate_shortlist_quality.json", shortlistQuality);
  await writeJson(artifactPath(runDir, "10_candidate_report.json"), candidateReport);
  await writeJson(artifactPath(runDir, "12_candidate_shortlist_quality.json"), shortlistQuality);
  return candidateReport;
}

export async function enrichFeedback({ projectRoot, runDir, candidateReport }) {
  const runContext = await readJson(path.join(runDir, "00_run_context.json"));
  const liveEvidence = await enrichLiveEvidence({ runDir, runContext, candidateReport });
  const source = await readJson(path.join(projectRoot, "fixtures", "research", "feedback_evidence.json"));
  const evidenceReport = buildEvidenceReport({
    candidateReport,
    liveEvidenceByCandidate: liveEvidence,
    fixtureEvidenceByCandidate: source.evidence_by_candidate ?? {},
    sourceMode: liveEvidence ? (candidateReport.source_mode ?? "live") : (candidateReport.source_mode ?? "fixture")
  });

  await validateRunArtifact(runDir, "feedback_evidence.schema.json", "20_feedback_evidence.json", evidenceReport);
  await writeJson(artifactPath(runDir, "20_feedback_evidence.json"), evidenceReport);
  return evidenceReport;
}

export async function clusterPainPoints({ runDir, candidateReport, evidenceReport }) {
  const clusterReport = buildClusterReport({ candidateReport, evidenceReport });
  await validateRunArtifact(runDir, "feedback_clusters.schema.json", "21_feedback_clusters.json", clusterReport);
  await writeJson(artifactPath(runDir, "21_feedback_clusters.json"), clusterReport);
  return clusterReport;
}

export async function scoreOpportunities({ runDir, runContext, candidateReport, clusterReport }) {
  const portfolioRegistry = await loadPortfolioRegistry(runContext.project_root);
  const evidenceReport = await readJson(artifactPath(runDir, "20_feedback_evidence.json"));
  const shortlistQuality = await readJson(artifactPath(runDir, "12_candidate_shortlist_quality.json"));
  const { scoresReport, selectedReport } = buildOpportunityArtifacts({
    runContext,
    candidateReport,
    clusterReport,
    evidenceReport,
    portfolioRegistry,
    shortlistQuality
  });

  await validateRunArtifact(runDir, "opportunity_scores.schema.json", "30_opportunity_scores.json", scoresReport);
  await validateRunArtifact(runDir, "selected_candidate.schema.json", "31_selected_candidate.json", selectedReport);
  await writeJson(artifactPath(runDir, "30_opportunity_scores.json"), scoresReport);
  await writeJson(artifactPath(runDir, "31_selected_candidate.json"), selectedReport);
  return { scoresReport, selectedReport };
}

export async function buildGate({ runDir, runContext, selectedReport, clusterReport }) {
  const evidenceReport = await readJson(artifactPath(runDir, "20_feedback_evidence.json"));
  const gate = buildDiscoveryGate({
    runContext,
    selectedReport,
    clusterReport,
    evidenceReport
  });

  await validateRunArtifact(runDir, "build_gate.schema.json", "32_build_gate_decision.json", gate);
  await writeJson(artifactPath(runDir, "32_build_gate_decision.json"), gate);
  return gate;
}

export async function writeBriefStage({ runDir, selectedReport }) {
  const defaults = mapWedgeDefaults(selectedReport.candidate.wedge_family);
  const brief = {
    stage: "WRITE_BRIEF",
    status: "passed",
    generated_at: nowIso(),
    candidate_id: selectedReport.candidate.candidate_id,
    product_name_working: defaults.product_name_working,
    wedge_family: selectedReport.candidate.wedge_family,
    single_purpose_statement: defaults.single_purpose_statement,
    target_user: defaults.target_user,
    trigger_moment: defaults.trigger_moment,
    core_workflow: defaults.core_workflow,
    must_have_features: defaults.must_have_features,
    non_goals: defaults.non_goals,
    permission_budget: defaults.permission_budget,
    data_handling_summary: defaults.data_handling_summary,
    ui_surface: defaults.ui_surface,
    success_criteria: defaults.success_criteria,
    positioning: defaults.positioning,
    screenshot_angles: defaults.screenshot_angles,
    listing_summary_seed: defaults.listing_summary_seed,
    why_not_competitor_clone: "This brief narrows the job to one wedge and intentionally drops the broader competitor surface area."
  };

  await validateRunArtifact(runDir, "product_brief.schema.json", "41_product_brief.json", brief);
  await writeJson(artifactPath(runDir, "41_product_brief.json"), brief);
  await writeText(artifactPath(runDir, "41_product_brief.md"), buildBriefMarkdown(brief));
  return brief;
}

export async function planImplementationStage({ runDir, brief }) {
  const runContext = await loadRunContextForMonetization(runDir);
  const plan = {
    stage: "PLAN_IMPLEMENTATION",
    status: "passed",
    generated_at: nowIso(),
    ...augmentImplementationPlanWithMonetization(
      mapImplementationTemplate(brief.wedge_family),
      runContext
    )
  };
  await validateRunArtifact(runDir, "implementation_plan.schema.json", "42_implementation_plan.json", plan);
  await writeJson(artifactPath(runDir, "42_implementation_plan.json"), plan);
  return plan;
}

export async function buildExtensionStage({ runDir, brief, plan }) {
  const builder = getBuilder(plan.archetype);
  const workspaceDir = path.join(runDir, "workspace");
  await resetDir(workspaceDir);

  if (!builder) {
    const failed = {
      stage: "BUILD_EXTENSION",
      status: "failed",
      generated_at: nowIso(),
      failure_reason: `No builder registered for ${plan.archetype}.`
    };
    await writeJson(artifactPath(runDir, "50_build_report.json"), failed);
    return failed;
  }

  const buildReport = await builder({ runDir, brief, plan });
  buildReport.generated_at = nowIso();
  await writeJson(artifactPath(runDir, "50_build_report.json"), buildReport);
  await writeMonetizationTestMatrix({ runDir, brief, plan, buildReport });
  return buildReport;
}

export async function runQaStage({ runDir, brief, plan, buildReport }) {
  const runContext = await loadRunContextForMonetization(runDir);
  const monetizationEnabled = runContext?.monetization?.enabled === true;
  const paySiteMode = runContext?.monetization?.payment_provider === "pay_site_supabase_waffo";
  const checks_passed = [];
  const checks_failed = [];
  const warnings = [];
  const repair_suggestions = [];

  if (buildReport.status !== "passed") {
    const failed = {
      stage: "RUN_QA",
      status: "failed",
      generated_at: nowIso(),
      overall_status: "failed",
      checks_passed,
      checks_failed: [{ id: "build_report_failed", message: "Build report is not passed." }],
      warnings,
      repair_suggestions: ["Fix the builder or select a supported archetype."]
    };
    await validateRunArtifact(runDir, "qa_report.schema.json", "60_qa_report.json", failed);
    await writeJson(artifactPath(runDir, "60_qa_report.json"), failed);
    return failed;
  }

  const manifestPath = path.join(buildReport.workspace_dist, "manifest.json");
  const manifestExists = await fileExists(manifestPath);
  if (!manifestExists) {
    checks_failed.push({ id: "manifest_missing", message: "manifest.json not found in dist." });
  } else {
    checks_passed.push("manifest_exists");
    const manifest = await readJson(manifestPath);
    if (manifest.manifest_version === 3) {
      checks_passed.push("manifest_mv3");
    } else {
      checks_failed.push({ id: "manifest_version", message: "manifest_version is not 3." });
    }

    const permissions = [...(manifest.permissions ?? [])].sort();
    const expected = [...plan.permissions].sort();
    if (JSON.stringify(permissions) === JSON.stringify(expected)) {
      checks_passed.push("permissions_match_plan");
    } else {
      checks_failed.push({ id: "permissions_mismatch", message: `Expected ${expected.join(", ")} but got ${permissions.join(", ")}` });
    }

    if ((manifest.host_permissions ?? []).length === 0) {
      checks_passed.push("no_host_permissions");
    } else if (
      paySiteMode
      && (manifest.host_permissions ?? []).every((permission) =>
        permission === `${runContext.pay_site?.public_supabase_url ?? runContext.monetization?.public_supabase_url}/*`
        || permission === `${runContext.pay_site?.site_url ?? runContext.monetization?.site_url}/*`
      )
    ) {
      checks_passed.push("pay_site_host_permissions_limited_to_hwh_domains");
    } else {
      checks_failed.push({ id: "host_permissions_present", message: "host_permissions should not be present for this plan." });
    }

    if (monetizationEnabled) {
      if (permissions.includes("storage")) {
        checks_passed.push("monetization_storage_permission_present");
      } else {
        checks_failed.push({ id: "monetization_storage_permission_missing", message: "Monetized builds must include storage permission." });
      }
    }
  }

  const requiredFiles = unique([
    ...plan.files_to_generate.filter((file) => !file.endsWith(".png")),
    "icons/icon16.png",
    "icons/icon48.png",
    "icons/icon128.png"
  ]);

  for (const fileName of requiredFiles) {
    const exists = await fileExists(path.join(buildReport.workspace_dist, fileName));
    if (exists) {
      checks_passed.push(`exists:${fileName}`);
    } else {
      checks_failed.push({ id: `missing:${fileName}`, message: `${fileName} is missing from dist.` });
    }
  }

  if (buildReport.package_zip_size > 0) {
    checks_passed.push("zip_non_empty");
  } else {
    checks_failed.push({ id: "zip_empty", message: "package.zip is empty." });
  }

  if (brief.single_purpose_statement.length <= 140) {
    checks_passed.push("brief_single_purpose_clear");
  } else {
    warnings.push("single_purpose_statement_is_long");
  }

  const expectedPermissionBudget = monetizationEnabled
    ? unique([...(brief.permission_budget.required ?? []), "storage"])
    : (brief.permission_budget.required ?? []);
  if (expectedPermissionBudget.slice().sort().join(",") === plan.permissions.slice().sort().join(",")) {
    checks_passed.push("permission_budget_matches_plan");
  } else {
    checks_failed.push({ id: "permission_budget_mismatch", message: "Brief permission budget does not match implementation plan." });
  }

  if (monetizationEnabled) {
    const monetizationConfigPath = path.join(buildReport.workspace_dist, "monetization_config.json");
    const monetizationConfigExists = await fileExists(monetizationConfigPath);
    if (monetizationConfigExists) {
      checks_passed.push("monetization_config_present");
      const monetizationConfig = await readJson(monetizationConfigPath);
      await assertMatchesSchema({
        data: monetizationConfig,
        schemaPath: path.join(runContext.project_root, "schemas", "monetization_config.schema.json"),
        label: "monetization_config.json"
      }).then(() => {
        checks_passed.push("monetization_config_schema_valid");
      }).catch((error) => {
        checks_failed.push({ id: "monetization_config_schema_invalid", message: error.message });
      });
    } else {
      checks_failed.push({ id: "monetization_config_missing", message: "monetization_config.json is missing from dist." });
    }

    const licensePageExists = await fileExists(path.join(buildReport.workspace_dist, "monetization", "licensePage.html"));
    if (licensePageExists) {
      checks_passed.push("monetization_license_page_present");
    } else {
      checks_failed.push({ id: "monetization_license_page_missing", message: "monetization/licensePage.html is missing from dist." });
    }

    const popupHtml = await fs.readFile(path.join(buildReport.workspace_dist, "popup.html"), "utf8").catch(() => "");
    const privacyHtml = await fs.readFile(path.join(buildReport.workspace_dist, "privacy.html"), "utf8").catch(() => "");
    if (
      popupHtml.includes('id="upgrade-button"')
      && popupHtml.includes('id="open-license-page"')
      && popupHtml.includes('id="restore-license-button"')
    ) {
      checks_passed.push("monetization_popup_ui_present");
    } else {
      checks_failed.push({ id: "monetization_popup_ui_missing", message: "Popup monetization controls are missing." });
    }

    if (/10 free fills|free usage left|free fills left/i.test(popupHtml)) {
      checks_passed.push("monetization_free_usage_counter_present");
    } else {
      checks_failed.push({ id: "monetization_free_usage_counter_missing", message: "Popup does not expose the free usage counter clearly." });
    }

    const statusNodeMatches = popupHtml.match(/id="status"/g) ?? [];
    const upgradeButtonLooksValid = /id="upgrade-button"[\s\S]*?>\s*Unlock Lifetime - \$19/i.test(popupHtml);
    if (statusNodeMatches.length === 1 && upgradeButtonLooksValid) {
      checks_passed.push("monetization_popup_markup_valid");
    } else {
      checks_failed.push({ id: "monetization_popup_markup_invalid", message: "Popup monetization markup is malformed or the Upgrade button label is broken." });
    }

    const paymentTrustCopyPresent = paySiteMode
      ? /Local-only|No upload|No cloud sync/i.test(popupHtml)
        && /external secure payment page|Payment handled on external secure page|external payment page/i.test(privacyHtml)
        && /webhook-confirmed/i.test(`${popupHtml}\n${privacyHtml}`)
      : /Local-only|No upload|No cloud sync/i.test(popupHtml) && /external payment page/i.test(privacyHtml);
    if (paymentTrustCopyPresent) {
      checks_passed.push("monetization_trust_copy_present");
    } else {
      checks_failed.push({ id: "monetization_trust_copy_missing", message: "Popup or privacy page is missing required local-only or payment trust copy." });
    }
  }

  if (checks_failed.length > 0) {
    repair_suggestions.push("Review manifest, required files, and permission budget alignment.");
  }

  const qaReport = {
    stage: "RUN_QA",
    status: checks_failed.length === 0 ? "passed" : "failed",
    generated_at: nowIso(),
    overall_status: checks_failed.length === 0 ? "passed" : "failed",
    checks_passed,
    checks_failed,
    warnings,
    repair_suggestions
  };

  await validateRunArtifact(runDir, "qa_report.schema.json", "60_qa_report.json", qaReport);
  await writeJson(artifactPath(runDir, "60_qa_report.json"), qaReport);
  return qaReport;
}

export async function browserSmokeAndCaptureStage({ runDir, runContext, brief, plan, buildReport, qaReport }) {
  const { smokeReport, screenshotManifest } = await runBrowserSmokeAndCapture({
    runDir,
    runContext,
    brief,
    plan,
    buildReport,
    qaReport
  });

  await validateRunArtifact(runDir, "browser_smoke.schema.json", "61_browser_smoke.json", smokeReport);
  await validateRunArtifact(runDir, "screenshot_manifest.schema.json", "70_screenshot_manifest.json", screenshotManifest);
  await writeJson(artifactPath(runDir, "61_browser_smoke.json"), smokeReport);
  await writeJson(artifactPath(runDir, "70_screenshot_manifest.json"), screenshotManifest);
  return { browserSmokeReport: smokeReport, screenshotManifest };
}

export async function generateAssetsStage({ runDir, runContext, brief, buildReport, qaReport, screenshotManifest = null }) {
  const assetsDir = path.join(runDir, "70_listing_assets");
  await ensureDir(assetsDir);
  const repoIconsDir = path.join(buildReport.workspace_repo, "icons");
  await copyDir(repoIconsDir, assetsDir);

  const isFormFill = brief.wedge_family === "single_profile_form_fill";
  const isGmailSnippet = brief.wedge_family === "gmail_snippet";
  const palette = isFormFill
    ? { background: "#f7f0e7", header: "#9d5f2b", panel: "#ffffff", line: "#d6bea7", accent: "#9d5f2b" }
    : isGmailSnippet
      ? { background: "#eef4fb", header: "#255f93", panel: "#ffffff", line: "#bfd3e5", accent: "#255f93" }
      : { background: "#edf6f0", header: "#1d6f42", panel: "#ffffff", line: "#c9e0d2", accent: "#1d6f42" };
  const assetLayout = isFormFill ? "form_fill" : isGmailSnippet ? "gmail_snippet" : "tab_export";

  await createDraftPanelPng(path.join(assetsDir, "promo_440x280.png"), 440, 280, palette, assetLayout);
  await createDraftPanelPng(path.join(assetsDir, "promo_1400x560.png"), 1400, 560, palette, assetLayout);

  const screenshotFiles = Array.isArray(screenshotManifest?.screenshots)
    ? screenshotManifest.screenshots.map((item) => item.file_name).filter(Boolean)
    : [];
  const screenshotsVerified = screenshotManifest?.status === "passed" && screenshotFiles.length > 0;
  const monetizationEnabled = runContext?.monetization?.enabled === true;
  const monetizationConfigPath = path.join(buildReport.workspace_dist, "monetization_config.json");
  const monetizationConfig = monetizationEnabled && await fileExists(monetizationConfigPath)
    ? await readJson(monetizationConfigPath)
    : null;
  const paymentModeLive = `${monetizationConfig?.checkout_mode ?? ""}` === "live";
  const paySiteMode = `${monetizationConfig?.payment_provider ?? runContext?.monetization?.payment_provider ?? ""}` === "pay_site_supabase_waffo";
  const paidDisclosureLines = monetizationEnabled
    ? paySiteMode
      ? [
          `Free plan includes ${monetizationConfig?.free_limit?.amount ?? 10} ${monetizationConfig?.free_limit?.unit ?? "fills"}.`,
          `Unlock Lifetime - ${monetizationConfig?.price_label ?? "$19 lifetime"} through the external HWH checkout page.`,
          "Login with email and refresh membership after payment; Pro unlock depends on webhook-confirmed entitlement, not successUrl.",
          paymentModeLive
            ? "Production checkout must be verified before public launch."
            : "This revision stays in test or controlled payment mode. Production payment is not verified yet."
        ]
      : [
          `Free plan includes ${monetizationConfig?.free_limit?.amount ?? 10} ${monetizationConfig?.free_limit?.unit ?? "fills"}.`,
          `Unlock Lifetime - ${monetizationConfig?.price_label ?? "$19 lifetime"} through an external payment page.`,
          "Paste the license key inside the extension to activate or restore Pro access.",
          paymentModeLive
            ? "The current listing copy assumes the external payment page is live."
            : "This revision uses placeholder or test payment and license endpoints. It is not configured for live external payments yet."
        ]
    : [];
  const monetizationTestInstructions = monetizationEnabled
    ? paySiteMode
      ? [
          `Verify the free usage counter starts at ${monetizationConfig?.free_limit?.amount ?? 10} ${monetizationConfig?.free_limit?.unit ?? "fills"}.`,
          "Verify SEND_OTP and VERIFY_OTP work through the membership panel.",
          "Verify the Upgrade button creates a test-mode checkout with source=chrome_extension.",
          "Verify Refresh membership reads webhook-derived active entitlement; successUrl must not unlock Pro locally.",
          "Verify the 11th free fill returns QUOTA_EXCEEDED and Pro consume-usage is allowed."
        ]
      : [
          `Verify the free usage counter starts at ${monetizationConfig?.free_limit?.amount ?? 10} ${monetizationConfig?.free_limit?.unit ?? "fills"}.`,
          "Verify the Upgrade button opens the configured external payment placeholder in a new tab.",
          "Verify Enter License Key and Restore / Verify License both open the license flow.",
          "Verify a mock active entitlement unlocks unlimited usage and a stale license degrades after offline grace."
        ]
    : [];
  const privacyDisclosure = monetizationEnabled
    ? paySiteMode
      ? [
          brief.data_handling_summary,
          "Membership login uses email OTP and public Supabase endpoints.",
          "Upgrade opens the external HWH checkout page; the extension does not process card data.",
          "Pro access is read from webhook-confirmed entitlement via the public API.",
          "The extension does not ship service-role, Waffo, merchant, or webhook secrets.",
          "Form data remains local-only. No upload. No cloud sync."
        ].join(" ")
      : [
          brief.data_handling_summary,
          "Upgrade opens an external payment page. The extension does not process card data.",
          "License verification requires a network request to the configured external license service.",
          "Local-only. No upload. No cloud sync."
        ].join(" ")
    : brief.data_handling_summary;

  const listingCopy = {
    stage: "GENERATE_ASSETS",
    status: qaReport.overall_status === "passed" ? "passed" : "failed",
    generated_at: nowIso(),
    locale: runContext.assets.locale,
    asset_status: screenshotsVerified ? "browser_smoke_verified" : "missing_browser_smoke_capture",
    promo_asset_status: "draft_validation_only",
    screenshot_asset_status: screenshotsVerified ? "browser_smoke_happy_path" : "missing",
    store_summary: monetizationEnabled
      ? `${brief.listing_summary_seed} Includes ${monetizationConfig?.free_limit?.amount ?? 10} free ${monetizationConfig?.free_limit?.unit ?? "fills"}.`
      : brief.listing_summary_seed,
    store_description: [
      brief.single_purpose_statement,
      `Built for: ${brief.target_user}`,
      `Key workflow: ${brief.core_workflow.join(" -> ")}`,
      ...(isFormFill
        ? [
            "Supports common text, email, phone, textarea, and select fields when labels or descriptors match the saved profile.",
            paySiteMode
              ? "Stores one profile locally in chrome.storage.local. No cloud sync or remote transfer of form data."
              : "Stores one profile locally in chrome.storage.local. No cloud sync, account, or remote transfer.",
            ...(paySiteMode
              ? ["Email OTP is used only for membership and entitlement checks; form data stays local."]
              : []),
            "Does not overwrite fields that already contain values unless the user explicitly enables overwrite in the popup."
          ]
        : []),
      ...paidDisclosureLines,
      `Non-goals: ${brief.non_goals.join("; ")}`
    ].join("\n"),
    privacy_disclosure: privacyDisclosure,
    paid_features_disclosure: paidDisclosureLines,
    test_instructions: [
      "Load unpacked from the generated dist directory.",
      "Open the popup.",
      ...(isFormFill
        ? [
            "Verify text, textarea, and select fields fill from the saved local profile.",
            "Verify readonly or disabled fields are skipped and prefilled values are preserved by default."
          ]
        : []),
      ...monetizationTestInstructions,
      "Exercise the primary happy path described in the brief.",
      "Confirm no extra permissions are requested."
    ]
  };

  await writeJson(path.join(assetsDir, "asset_manifest.json"), {
    generated_at: nowIso(),
    screenshot_manifest: screenshotManifest ? artifactPath(runDir, "70_screenshot_manifest.json") : "",
    files: [
      "icon16.png",
      "icon48.png",
      "icon128.png",
      "promo_440x280.png",
      "promo_1400x560.png",
      ...screenshotFiles
    ]
  });
  await writeJson(artifactPath(runDir, "71_listing_copy.json"), listingCopy);
  return listingCopy;
}

export async function runPolicyGateStage({
  runDir,
  runContext,
  brief,
  plan,
  buildReport,
  qaReport,
  listingCopy,
  browserSmokeReport,
  screenshotManifest
}) {
  const issues = [];
  const manual_review_items = [];

  if (qaReport.overall_status !== "passed") {
    issues.push("qa_failed");
  }
  if (!brief.single_purpose_statement || brief.single_purpose_statement.length > 140) {
    issues.push("single_purpose_unclear");
  }
  if (plan.permissions.some((permission) => permission.includes("http"))) {
    issues.push("unexpected_host_permission");
  }

  if (!browserSmokeReport || browserSmokeReport.status !== "passed" || browserSmokeReport.happy_path_verified !== true) {
    issues.push("browser_smoke_missing_or_failed");
  }
  if (!screenshotManifest || screenshotManifest.status !== "passed") {
    issues.push("fresh_browser_screenshots_missing");
  }
  if (browserSmokeReport?.build_generated_at !== buildReport.generated_at) {
    issues.push("browser_smoke_not_from_current_build");
  }
  if (screenshotManifest?.build_generated_at !== buildReport.generated_at) {
    issues.push("screenshots_not_from_current_build");
  }

  const screenshots = Array.isArray(screenshotManifest?.screenshots) ? screenshotManifest.screenshots : [];
  if (screenshots.length === 0) {
    issues.push("browser_smoke_screenshots_empty");
  }

  for (const screenshot of screenshots) {
    if (screenshot.capture_source !== "browser_smoke_happy_path" || screenshot.from_happy_path !== true) {
      issues.push("screenshots_not_from_real_happy_path");
      break;
    }
    if (!(await fileExists(screenshot.path))) {
      issues.push("browser_smoke_screenshot_file_missing");
      break;
    }
  }

  if (listingCopy.asset_status !== "browser_smoke_verified") {
    issues.push("listing_assets_missing_verified_browser_screenshots");
  }
  if (listingCopy.promo_asset_status === "draft_validation_only") {
    manual_review_items.push("Replace draft promo tiles with final store-ready creative before public release.");
  }
  if (!runContext.publish.allow_public_release) {
    manual_review_items.push("Public release disabled by task configuration.");
  }

  const status = issues.length > 0 ? "fail" : manual_review_items.length > 0 ? "conditional_pass" : "pass";
  const gate = {
    stage: "RUN_POLICY_GATE",
    status,
    generated_at: nowIso(),
    issues,
    manual_review_items,
    checks: {
      single_purpose: Boolean(brief.single_purpose_statement),
      minimum_permissions: plan.permissions.length === brief.permission_budget.required.length,
      browser_smoke_passed: browserSmokeReport?.status === "passed",
      screenshots_from_current_build: screenshotManifest?.build_generated_at === buildReport.generated_at,
      screenshots_from_happy_path: screenshots.every((item) => item.capture_source === "browser_smoke_happy_path" && item.from_happy_path === true),
      truthfulness_review_needed: listingCopy.asset_status !== "browser_smoke_verified",
      public_release_allowed: runContext.publish.allow_public_release
    }
  };

  await writeJson(artifactPath(runDir, "72_policy_gate.json"), gate);
  return gate;
}

export async function decidePublishIntentStage({ runDir, runContext, selectedReport, qaReport, policyGate, buildGateReport = null }) {
  let publish_intent = "archive_no_publish";
  let reason = "Run did not meet the minimum delivery bar.";
  let next_manual_gate = "none";
  let blockers = [];

  if (selectedReport.status === "no_go") {
    publish_intent = "archive_no_publish";
    blockers = selectedReport.selected_reason ?? ["No supported candidate met the score threshold."];
    reason = blockers.join("; ");
  } else if (buildGateReport?.decision === "no_go") {
    publish_intent = "archive_no_publish";
    blockers = summarizeBuildGateBlockers({ runContext, selectedReport, buildGateReport });
    reason = `Build gate blocked: ${blockers.join("; ")}`;
  } else if (qaReport.overall_status !== "passed") {
    publish_intent = "archive_no_publish";
    blockers = summarizeQaFailures(qaReport);
    reason = `QA failed: ${blockers.join("; ")}`;
  } else if (policyGate.status === "fail") {
    publish_intent = "archive_no_publish";
    blockers = summarizePolicyFailures(policyGate);
    reason = `Policy gate failed: ${blockers.join("; ")}`;
  } else if (qaReport.overall_status === "passed" && policyGate.status === "pass" && runContext.publish.allow_public_release) {
    publish_intent = "publish_ready";
    reason = "QA and policy gate passed, and task allows public release.";
    next_manual_gate = "optional_final_release_check";
  } else if (qaReport.overall_status === "passed" && (policyGate.status === "pass" || policyGate.status === "conditional_pass")) {
    publish_intent = runContext.publish.default_publish_intent ?? "draft_only";
    reason = "Build is usable, but public release remains behind manual review or task constraints.";
    next_manual_gate = "human_listing_review";
  }

  const publishPlan = {
    stage: "DECIDE_PUBLISH_INTENT",
    status: "passed",
    generated_at: nowIso(),
    publish_intent,
    reason,
    blockers,
    review_strategy: runContext.publish.review_strategy,
    next_manual_gate,
    build_gate_decision: buildGateReport?.decision ?? "",
    qa_status: qaReport?.overall_status ?? "",
    policy_status: policyGate?.status ?? ""
  };

  await validateRunArtifact(runDir, "publish_plan.schema.json", "80_publish_plan.json", publishPlan);
  await writeJson(artifactPath(runDir, "80_publish_plan.json"), publishPlan);
  return publishPlan;
}

export async function humanApprovalGateStage({
  runDir,
  runContext,
  buildReport = null,
  publishPlan = null,
  publishExecution = null
}) {
  const packageHash = await buildPackageHash(runDir, buildReport).catch(() => ({
    algorithm: "sha256",
    value: "",
    package_path: "",
    package_size_bytes: 0
  }));
  const manifestVersion = await readManifestVersionForRun(runDir, buildReport).catch(() => null);
  return ensureDefaultHumanApprovalArtifact({
    runDir,
    projectRoot: runContext.project_root,
    runId: runContext.run_id,
    requestedAction: "none",
    itemId: publishExecution?.item_id ?? resolveExistingItemConfig(runContext, resolvePublishExecutionMode(runContext)).item_id,
    publisherId: resolvePublisherId(runContext),
    packageSha256: packageHash.value,
    manifestVersion,
    safetySummary: {
      publish_intent: publishPlan?.publish_intent ?? null,
      allow_public_release: runContext.publish.allow_public_release,
      production_write_disabled: true
    },
    nextStep: "use approve:sandbox-upload or approve:sandbox-publish before any real write action"
  });
}

export async function reviewStatusStage({ runDir }) {
  return runReviewStatusStage({ runDir });
}

export async function storeListingReleasePackageStage({ projectRoot, runDir }) {
  return runStoreReleasePackage({ projectRoot, runDir });
}

export async function recordHumanVisualReviewStage({ projectRoot, runDir, decision, note, reviewer }) {
  return recordHumanVisualReview({ projectRoot, runDir, decision, note, reviewer });
}

export async function monitorPostReleaseStage({
  runDir,
  runContext,
  publishExecution = null,
  reviewStatus = null
}) {
  return runMonitoringStage({
    runDir,
    runContext,
    publishExecution,
    reviewStatus
  });
}

export async function closeRunStage({
  runDir,
  runContext,
  selectedReport = null,
  brief = null,
  plan = null,
  screenshotManifest = null,
  publishPlan = null,
  publishExecution = null,
  reviewStatus = null,
  monitoringSnapshot = null,
  learningUpdate = null,
  policyGate = null
}) {
  return runCloseRunStage({
    runDir,
    runContext,
    selectedReport,
    brief,
    plan,
    screenshotManifest,
    publishPlan,
    publishExecution,
    reviewStatus,
    monitoringSnapshot,
    learningUpdate,
    policyGate
  });
}

export async function executePublishPlanStage({
  runDir,
  runContext,
  selectedReport,
  buildReport = null,
  publishPlan,
  listingPackageReport = null
}) {
  const executionMode = resolvePublishExecutionMode(runContext);
  const publishValidationPhase = resolvePublishValidationPhase(runContext);
  const lane = resolvePublishLane(runContext, publishPlan);
  const candidateId = selectedReport?.selected_candidate_id ?? selectedReport?.candidate?.id ?? null;
  const packageHash = await buildPackageHash(runDir, buildReport).catch(() => ({
    algorithm: "sha256",
    value: "",
    package_path: "",
    package_size_bytes: 0
  }));
  const latestSuccessfulUploadExecution = runContext?.task_mode === "sandbox_validation"
    ? await readLatestSuccessfulUploadExecution({
        projectRoot: runContext.project_root,
        runId: runContext.run_id,
        packageSha256: packageHash.value
      })
    : null;
  const publisherId = resolvePublisherId(runContext);
  const existingItem = resolveExistingItemConfig(runContext, executionMode);
  const configuredSandboxItemId = resolveConfiguredSandboxItemId(runContext);
  const publishTypeDecision = decidePublishType({ publishPlan, runContext });
  const humanApprovalReference = await loadManagedRunArtifact({
    runDir,
    artifactName: "82_human_approval.json",
    runContext
  });
  const humanApprovalArtifact = humanApprovalReference?.data ?? null;
  const functionalTestMatrixReference = await loadManagedRunArtifact({
    runDir,
    artifactName: "62_functional_test_matrix.json",
    runContext
  });
  const functionalTestMatrixArtifact = functionalTestMatrixReference?.data ?? null;
  const productAcceptanceReference = await loadManagedRunArtifact({
    runDir,
    artifactName: "94_product_acceptance_review.json",
    runContext
  });
  const productAcceptanceArtifact = productAcceptanceReference?.data ?? null;
  const listingQualityGateReference = await loadManagedRunArtifact({
    runDir,
    artifactName: "115_listing_quality_gate.json",
    runContext
  });
  const listingQualityGateArtifact = listingQualityGateReference?.data ?? null;
  const assetQualityReportReference = await loadManagedRunArtifact({
    runDir,
    artifactName: "118_asset_quality_report.json",
    runContext
  });
  const assetQualityReportArtifact = assetQualityReportReference?.data ?? null;
  const storeReleasePackageReference = await loadManagedRunArtifact({
    runDir,
    artifactName: "120_store_listing_release_package_report.json",
    runContext
  });
  const storeReleasePackageArtifact = storeReleasePackageReference?.data ?? null;
  const humanVisualReviewReference = await loadManagedRunArtifact({
    runDir,
    artifactName: "121_human_visual_review.json",
    runContext
  });
  const humanVisualReviewArtifact = humanVisualReviewReference?.data ?? null;
  const resourcePath = buildChromeWebStoreResourcePath({
    publisherId,
    itemId: existingItem.item_id
  });

  const manualNewItemHandoff = {
    status: lane === "manual_new_item_handoff" ? "ready" : "skipped",
    dashboard_path: "Chrome Web Store Developer Dashboard > Add new item",
    required_inputs: [
      "81_listing_package/",
      "81_listing_package.zip",
      "workspace/package.zip",
      "manual metadata review"
    ],
    notes: [
      "First-version new items remain behind manual handoff.",
      listingPackageReport?.package_zip
        ? `Review bundle ready at ${listingPackageReport.package_zip}.`
        : "Review bundle is not available yet."
    ]
  };

  const credentialsPreflight = resolveCredentialPreflight();
  const credentialSummary = resolveCredentialSummary(credentialsPreflight);
  const approvalManifestVersion = await readManifestVersionForRun(runDir, buildReport).catch(() => null);
  const productAcceptanceStatus = productAcceptanceArtifact?.acceptance_status ?? null;
  const functionalTestCoverageScore = functionalTestMatrixArtifact?.test_coverage_score ?? null;
  const productAcceptancePassed = productAcceptanceStatus === "passed";
  const functionalTestCoverageComplete = functionalTestCoverageScore === 100;
  const prePublishAssetGate = evaluatePrePublishAssetGate({
    listingQualityGate: listingQualityGateArtifact,
    assetQualityReport: assetQualityReportArtifact,
    storeReleasePackageReport: storeReleasePackageArtifact,
    humanVisualReview: humanVisualReviewArtifact
  });
  const uploadGuardPassed = executionMode === "sandbox_validate"
    && publishValidationPhase !== "fetch_status_only"
    && existingItem.item_id === configuredSandboxItemId
    && envFlagEnabled("CWS_ALLOW_SANDBOX_UPLOAD");
  const sandboxUploadEnvEnabled = envFlagEnabled("CWS_ALLOW_SANDBOX_UPLOAD");
  const publishGuardPassed = executionMode === "sandbox_validate"
    && publishValidationPhase === "publish_optional"
    && existingItem.item_id === configuredSandboxItemId
    && envFlagEnabled("CWS_ALLOW_SANDBOX_PUBLISH");
  const priorVerifiedUploadReady = Boolean(
    latestSuccessfulUploadExecution
    && latestSuccessfulUploadExecution.package_sha256 === packageHash.value
    && latestSuccessfulUploadExecution.sandbox_upload_verified === true
    && latestSuccessfulUploadExecution.upload_state === "SUCCEEDED"
    && (latestSuccessfulUploadExecution.uploaded_crx_version ?? latestSuccessfulUploadExecution.crx_version ?? null) === approvalManifestVersion
    && latestSuccessfulUploadExecution.version_consistency_check?.passed !== false
  );
  const requiredApprovalAction = publishValidationPhase === "upload_only"
    ? "sandbox_upload"
    : publishValidationPhase === "publish_optional"
      ? "sandbox_publish"
      : null;
  const approvalCheck = requiredApprovalAction
    ? evaluateApprovalForAction({
        approvalArtifact: humanApprovalArtifact,
        requestedAction: requiredApprovalAction,
        expectedScope: "sandbox",
        itemId: existingItem.item_id,
        publisherId,
        packageSha256: packageHash.value,
        manifestVersion: approvalManifestVersion,
        requireWriteAllowed: true
      })
    : { approved: true, reason: null };
  const existingItemFailures = [];
  if (lane === "existing_item_update_dry_run" && !existingItem.item_id) {
    existingItemFailures.push("No existing or sandbox item id is configured for existing_item_update_dry_run.");
  }
  if (lane === "existing_item_update_dry_run" && !publisherId) {
    existingItemFailures.push("No publisher id is configured for existing_item_update_dry_run.");
  }
  if (executionMode === "sandbox_validate" && lane !== "existing_item_update_dry_run") {
    existingItemFailures.push("sandbox_validate requires execution_lane=existing_item_update_dry_run or a configured sandbox item.");
  }
  if (executionMode === "sandbox_validate" && credentialsPreflight.status !== "passed") {
    existingItemFailures.push("sandbox_validate requires configured Chrome Web Store credentials.");
  }
  if (executionMode === "sandbox_validate" && !existingItem.sandbox) {
    existingItemFailures.push("sandbox_validate refuses to write to production items; configure task.publish.sandbox_item_id or CHROME_WEB_STORE_SANDBOX_ITEM_ID.");
  }
  if (
    publishValidationPhase === "upload_only"
    && executionMode === "sandbox_validate"
    && !uploadGuardPassed
  ) {
    existingItemFailures.push("upload_only is blocked by sandbox guard. Require configured sandbox item and CWS_ALLOW_SANDBOX_UPLOAD=true.");
  }
  if (
    publishValidationPhase === "publish_optional"
    && executionMode === "sandbox_validate"
    && !publishGuardPassed
  ) {
    existingItemFailures.push("publish_optional is blocked by sandbox guard. Require configured sandbox item and CWS_ALLOW_SANDBOX_PUBLISH=true.");
  }
  if (
    publishValidationPhase === "publish_optional"
    && executionMode === "sandbox_validate"
    && sandboxUploadEnvEnabled
  ) {
    existingItemFailures.push("publish_optional requires CWS_ALLOW_SANDBOX_UPLOAD=false; upload must not be retried during publish.");
  }
  if (
    publishValidationPhase === "publish_optional"
    && executionMode === "sandbox_validate"
    && !priorVerifiedUploadReady
  ) {
    existingItemFailures.push("publish_optional requires a prior verified sandbox upload with upload_state=SUCCEEDED and uploaded_crx_version matching the current manifest_version.");
  }
  if (
    publishValidationPhase === "publish_optional"
    && executionMode === "sandbox_validate"
    && !productAcceptancePassed
  ) {
    existingItemFailures.push("publish_optional requires product_acceptance_status=passed.");
  }
  if (
    publishValidationPhase === "publish_optional"
    && executionMode === "sandbox_validate"
    && !functionalTestCoverageComplete
  ) {
    existingItemFailures.push("publish_optional requires functional_test_coverage_score=100.");
  }
  if (
    publishValidationPhase !== "fetch_status_only"
    && executionMode === "sandbox_validate"
    && !approvalCheck.approved
  ) {
    existingItemFailures.push(approvalCheck.reason);
  }
  if (
    publishValidationPhase !== "fetch_status_only"
    && executionMode === "sandbox_validate"
    && prePublishAssetGate.blockers.length > 0
  ) {
    existingItemFailures.push(`Premium asset gate blocked publish path: ${prePublishAssetGate.blockers.join(", ")}.`);
  }

  const fetchStatusResponse = {
    executed: false,
    endpoint: `https://chromewebstore.googleapis.com/v2/${resourcePath}:fetchStatus`,
    method: "GET",
    ok: null,
    status_code: 0,
    http_status: null,
    body: null,
    response_body_summary: null,
    response_headers_summary: null,
    error_details: null
  };
  const uploadResponse = {
    executed: false,
    endpoint: `https://chromewebstore.googleapis.com/upload/v2/${resourcePath}:upload`,
    method: "POST",
    ok: null,
    status_code: 0,
    http_status: null,
    body: null,
    response_body_summary: null,
    response_headers_summary: null,
    error_details: null
  };
  const publishResponse = {
    executed: false,
    endpoint: `https://chromewebstore.googleapis.com/v2/${resourcePath}:publish`,
    method: "POST",
    publish_type: publishTypeDecision.publish_type,
    ok: null,
    status_code: 0,
    http_status: null,
    body: null,
    response_body_summary: null,
    response_headers_summary: null,
    error_details: null
  };

  let validatedCredentialsPreflight = { ...credentialsPreflight };
  let failureReason = existingItemFailures.length === 0 ? null : existingItemFailures.join(" ");
  let failurePhase = existingItemFailures.length === 0 ? null : "env_preflight";
  let diagnosticHint = existingItemFailures.length === 0 ? null : "Check publisher id, sandbox item id, and credential configuration before sandbox validation.";
  let retryable = false;
  let diagnosticError = null;
  let networkProbeSummary = buildEmptyNetworkProbeSummary();
  let proxyMetadata = buildProxyMetadata(networkProbeSummary, getChromeWebStoreNetworkSummary(GOOGLE_TOKEN_ENDPOINT));
  let writeActionsPerformed = false;
  let apiCallsAttempted = [];
  let apiCallsSkipped = [];
  let likelyCause = null;
  let actionableHint = null;
  let sandboxResult = null;

  const onlyPrePublishAssetGateFailure = existingItemFailures.length > 0
    && existingItemFailures.every((message) => `${message}`.startsWith("Premium asset gate blocked publish path:"));
  if (onlyPrePublishAssetGateFailure) {
    failurePhase = "pre_publish_asset_gate";
    diagnosticHint = "Generate the store release package, keep premium_feel_score >= 85, and complete human visual review before upload or publish.";
  }

  if (
    publishPlan.publish_intent !== "archive_no_publish"
    && executionMode === "sandbox_validate"
    && lane === "existing_item_update_dry_run"
    && existingItemFailures.length === 0
  ) {
    sandboxResult = await executeSandboxValidation({
      runDir,
      projectRoot: runContext.project_root,
      runId: runContext.run_id,
      publisherId,
      existingItem,
      validationPhase: publishValidationPhase,
      currentManifestVersion: approvalManifestVersion,
      packageHash,
      credentialsPreflight,
      publishTypeDecision,
      priorSuccessfulUploadExecution: latestSuccessfulUploadExecution,
      allowUpload: uploadGuardPassed,
      allowPublish: publishGuardPassed
    });
    validatedCredentialsPreflight = sandboxResult.credentials_preflight;
    apiCallsAttempted = sandboxResult.api_calls_attempted;
    apiCallsSkipped = sandboxResult.api_calls_skipped;
    failurePhase = sandboxResult.failure_phase;
    diagnosticHint = sandboxResult.diagnostic_hint;
    retryable = sandboxResult.retryable;
    diagnosticError = sandboxResult.diagnostic_error;
    networkProbeSummary = sandboxResult.network_probe_summary ?? networkProbeSummary;
    proxyMetadata = buildProxyMetadata(networkProbeSummary, sandboxResult);
    likelyCause = sandboxResult.likely_cause ?? null;
    actionableHint = sandboxResult.actionable_hint ?? null;

    if (sandboxResult.fetch_status_response) {
      Object.assign(fetchStatusResponse, sandboxResult.fetch_status_response);
    }
    if (sandboxResult.upload_response) {
      Object.assign(uploadResponse, sandboxResult.upload_response);
      writeActionsPerformed = uploadResponse.ok === true;
    }
    if (sandboxResult.publish_response) {
      Object.assign(publishResponse, {
        executed: sandboxResult.publish_response.executed === true,
        ...sandboxResult.publish_response
      });
      if (!sandboxResult.publish_response.skipped && publishResponse.ok === true) {
        writeActionsPerformed = true;
      }
    }
    failureReason = sandboxResult.failure_reason;
  } else {
    apiCallsSkipped = [
      publishPlan.publish_intent === "archive_no_publish"
        ? `fetchStatus: publish_intent=${publishPlan.publish_intent}`
        : executionMode !== "sandbox_validate"
          ? `fetchStatus: execution_mode=${executionMode}`
          : lane !== "existing_item_update_dry_run"
            ? `fetchStatus: lane=${lane}`
            : failureReason
    ].filter(Boolean);
  }

  const existingItemDryRun = {
    status: lane !== "existing_item_update_dry_run"
      ? "skipped"
      : failureReason
        ? "failed"
        : executionMode === "sandbox_validate" || existingItemFailures.length === 0
        ? "passed"
        : "failed",
    execution_mode: executionMode,
    publisher_id: publisherId,
    item_id: existingItem.item_id,
    package_sha256: packageHash.value,
    credentials_preflight: validatedCredentialsPreflight,
    item_existence_check: {
      status: lane !== "existing_item_update_dry_run"
        ? "skipped"
        : executionMode === "sandbox_validate" && fetchStatusResponse.executed && fetchStatusResponse.ok
          ? "validated_via_fetch_status"
          : existingItem.item_id
            ? "planned_check_only"
            : "missing_item_id",
      item_id: existingItem.item_id,
      source: existingItem.source
    },
    fetch_status_response: fetchStatusResponse,
    upload_response: {
      ...uploadResponse,
      package_path: packageHash.package_path,
      package_sha256: packageHash.value
    },
    publish_response: publishResponse,
    publish_type_decision: publishTypeDecision,
    pre_upload_checks: sandboxResult?.pre_upload_checks ?? null,
    post_upload_fetch_status_summary: sandboxResult?.post_upload_fetch_status_summary ?? null,
    failure_phase: lane === "existing_item_update_dry_run" ? failurePhase : null,
    diagnostic_hint: lane === "existing_item_update_dry_run" ? diagnosticHint : null,
    likely_cause: lane === "existing_item_update_dry_run" ? likelyCause : null,
    actionable_hint: lane === "existing_item_update_dry_run" ? actionableHint : null,
    retryable: lane === "existing_item_update_dry_run" ? retryable : false,
    network_probe_summary: networkProbeSummary,
    ...proxyMetadata,
    diagnostic_error: lane === "existing_item_update_dry_run" ? diagnosticError : null,
    failure_reason: lane === "existing_item_update_dry_run" ? failureReason : null
  };

  const safetyChecks = {
    execution_mode_is_sandbox_validate: executionMode === "sandbox_validate",
    sandbox_item_configured: Boolean(configuredSandboxItemId),
    item_matches_configured_sandbox: Boolean(existingItem.item_id && configuredSandboxItemId && existingItem.item_id === configuredSandboxItemId),
    production_item_blocked: executionMode !== "sandbox_validate" || existingItem.sandbox === true,
    upload_guard_passed: uploadGuardPassed,
    publish_guard_passed: publishGuardPassed,
    prior_verified_upload_ready: priorVerifiedUploadReady,
    product_acceptance_passed: productAcceptancePassed,
    functional_test_coverage_complete: functionalTestCoverageComplete,
    pre_publish_state_clear: sandboxResult?.failure_reason !== "previous_submission_still_pending",
    pre_publish_asset_gate_passed: prePublishAssetGate.gate_passed,
    sandbox_upload_env_enabled: sandboxUploadEnvEnabled,
    publish_validation_phase: publishValidationPhase
  };

  const topLevelFailureReason = publishPlan.publish_intent === "archive_no_publish"
    ? `Publish execution skipped because publish intent is ${publishPlan.publish_intent}.`
    : failureReason;
  const sandboxFetchStatusVerified = Boolean(fetchStatusResponse.executed && fetchStatusResponse.ok);
  const reusableSuccessfulUpload = Boolean(
    latestSuccessfulUploadExecution
    && latestSuccessfulUploadExecution.package_sha256 === packageHash.value
    && latestSuccessfulUploadExecution.sandbox_upload_verified === true
  );
  const sandboxUploadVerified = Boolean(sandboxResult?.sandbox_upload_verified || reusableSuccessfulUpload);
  const preUploadChecks = lane === "existing_item_update_dry_run"
    ? sandboxResult?.pre_upload_checks ?? null
    : null;
  const manifestVersion = sandboxResult?.manifest_version
    ?? preUploadChecks?.manifest_version
    ?? latestSuccessfulUploadExecution?.manifest_version
    ?? approvalManifestVersion
    ?? null;
  const currentSandboxItemVersion = sandboxResult?.current_sandbox_item_version
    ?? preUploadChecks?.remote_crx_version
    ?? extractFetchStatusCrxVersion(fetchStatusResponse)
    ?? latestSuccessfulUploadExecution?.current_sandbox_item_version
    ?? null;
  const uploadResponseCrxVersion = sandboxResult?.upload_response_crx_version
    ?? latestSuccessfulUploadExecution?.upload_response_crx_version
    ?? latestSuccessfulUploadExecution?.upload_response_summary?.crxVersion
    ?? latestSuccessfulUploadExecution?.upload_response_summary?.crx_version
    ?? null;
  const uploadState = sandboxResult?.upload_state
    ?? latestSuccessfulUploadExecution?.upload_state
    ?? "not_attempted";
  const uploadedCrxVersion = sandboxResult?.uploaded_crx_version
    ?? latestSuccessfulUploadExecution?.uploaded_crx_version
    ?? latestSuccessfulUploadExecution?.crx_version
    ?? uploadResponseCrxVersion
    ?? null;
  const crxVersion = sandboxResult?.crx_version
    ?? latestSuccessfulUploadExecution?.crx_version
    ?? uploadedCrxVersion
    ?? null;
  const submittedRevisionStatus = extractFetchStatusRevisionState(fetchStatusResponse.body, [
    "submittedItemRevisionStatus",
    "submittedRevisionStatus",
    "submitted_revision_status"
  ]);
  const publishedRevisionStatus = extractFetchStatusRevisionState(fetchStatusResponse.body, [
    "publishedItemRevisionStatus",
    "publishedRevisionStatus",
    "published_revision_status"
  ]);
  const currentDashboardState = deriveFetchStatusCurrentDashboardState({
    submittedRevisionStatus,
    publishedRevisionStatus
  });
  const publishedCrxVersion = sandboxResult?.published_crx_version
    ?? extractFetchStatusRevisionCrxVersion(fetchStatusResponse.body, [
      "publishedItemRevisionStatus",
      "publishedRevisionStatus",
      "published_revision_status"
    ])
    ?? latestSuccessfulUploadExecution?.published_crx_version
    ?? null;
  const publishRequestAttempted = Boolean(sandboxResult?.publish_response?.executed);
  const sandboxPublishVerified = Boolean(sandboxResult?.publish_response?.executed && sandboxResult?.publish_response?.ok);
  const reviewState = publishResponse.body?.state
    ?? currentDashboardState
    ?? null;
  const postUploadFetchStatusSummary = sandboxResult?.post_upload_fetch_status_summary
    ?? latestSuccessfulUploadExecution?.post_upload_fetch_status_summary
    ?? null;
  const versionConsistencyCheck = sandboxResult?.version_consistency_check
    ?? latestSuccessfulUploadExecution?.version_consistency_check
    ?? {
      performed: false,
      upload_state: uploadState,
      manifest_version: manifestVersion,
      upload_response_crx_version: uploadResponseCrxVersion,
      passed: true,
      failure_reason: null
    };
  const nextStep = topLevelFailureReason
    ? failurePhase === "pre_publish_state_check" && topLevelFailureReason === "previous_submission_still_pending"
      ? "manual_cancel_previous_review_then_retry"
      : failurePhase === "pre_publish_asset_gate"
        ? "generate_store_release_package_and_complete_human_visual_review_before_retry"
      : publishValidationPhase === "publish_optional"
        ? "resolve publish_optional failure before retrying"
        : publishValidationPhase === "upload_only"
          ? "resolve upload_only failure before retrying"
          : "resolve fetch_status_only failure before retrying"
    : publishValidationPhase === "publish_optional"
      ? `${reviewState ?? ""}`.trim().toUpperCase() === "PENDING_REVIEW"
        ? "wait_for_review_or_manual_cancel"
        : "manual verification required after publish_optional"
    : (publishValidationPhase === "upload_only" || sandboxUploadVerified)
      && uploadState === "UPLOAD_IN_PROGRESS"
      && !uploadResponseCrxVersion
      ? "poll_fetch_status_for_upload_completion"
    : publishValidationPhase === "upload_only" || sandboxUploadVerified
      ? "manual_approval_required_before_sandbox_publish"
      : sandboxFetchStatusVerified
        ? "manual approval required before sandbox upload"
        : "complete fetch_status_only before upload";

  const reportWithoutRedactionChecks = {
    stage: "EXECUTE_PUBLISH_PLAN",
    run_id: runContext.run_id,
    run_type: runContext.run_type ?? runContext.task_mode ?? null,
    source_run_id: runContext.source_run_id ?? null,
    status: publishPlan.publish_intent === "archive_no_publish"
      ? "skipped"
      : failureReason
        ? "failed"
        : "passed",
    generated_at: nowIso(),
    candidate_id: candidateId,
    publish_intent: publishPlan.publish_intent,
    execution_mode: executionMode,
    publish_validation_phase: publishValidationPhase,
    sandbox_fetch_status_verified: sandboxFetchStatusVerified,
    sandbox_upload_verified: sandboxUploadVerified,
    current_dashboard_state: currentDashboardState,
    submitted_revision_status: submittedRevisionStatus,
    published_revision_status: publishedRevisionStatus,
    latest_upload_status: uploadState,
    package_path: packageHash.package_path,
    current_sandbox_item_version: currentSandboxItemVersion,
    manifest_version: manifestVersion,
    upload_response_crx_version: uploadResponseCrxVersion,
    uploaded_crx_version: uploadedCrxVersion,
    published_crx_version: publishedCrxVersion,
    product_acceptance_status: productAcceptanceStatus,
    functional_test_coverage_score: functionalTestCoverageScore,
    publish_request_attempted: publishRequestAttempted,
    upload_request_attempted: Boolean(sandboxResult?.upload_request_attempted),
    upload_state: uploadState,
    crx_version: crxVersion,
    review_state: reviewState,
    sandbox_publish_verified: sandboxPublishVerified,
    version_consistency_check: versionConsistencyCheck,
    pre_publish_asset_gate: prePublishAssetGate,
    pre_upload_checks: preUploadChecks,
    post_upload_fetch_status_summary: postUploadFetchStatusSummary,
    retry_count: sandboxResult?.retry_count ?? 0,
    last_http_status: sandboxResult?.last_http_status ?? fetchStatusResponse.http_status ?? null,
    next_step: nextStep,
    lane,
    dry_run: executionMode !== "sandbox_validate",
    write_actions_performed: writeActionsPerformed,
    publisher_id: publisherId,
    item_id: existingItem.item_id,
    approval_id: humanApprovalArtifact?.approval_id ?? null,
    approval_mode: humanApprovalArtifact?.approval_mode ?? null,
    approval_write_authorized: approvalCheck.details?.approval_write_authorized
      ?? writeAuthorizationForApprovalArtifact(humanApprovalArtifact),
    package_sha256: packageHash.value,
    credential_type: credentialSummary.credential_type,
    credential_present: credentialSummary.credential_present,
    token_source: credentialSummary.token_source,
    failure_phase: topLevelFailureReason ? failurePhase : null,
    diagnostic_hint: topLevelFailureReason ? diagnosticHint : null,
    likely_cause: topLevelFailureReason ? likelyCause : null,
    actionable_hint: topLevelFailureReason ? actionableHint : null,
    retryable: topLevelFailureReason ? retryable : false,
    network_probe_summary: networkProbeSummary,
    ...proxyMetadata,
    diagnostic_error: topLevelFailureReason ? diagnosticError : null,
    api_calls_attempted: apiCallsAttempted,
    api_calls_skipped: apiCallsSkipped,
    credentials_preflight: validatedCredentialsPreflight,
    fetch_status_response: fetchStatusResponse,
    fetch_status_response_summary: summarizeApiResponse(fetchStatusResponse),
    upload_response: {
      ...uploadResponse,
      package_path: packageHash.package_path,
      package_sha256: packageHash.value
    },
    upload_response_summary: {
      ...summarizeApiResponse({
        ...uploadResponse,
        package_path: packageHash.package_path,
        package_sha256: packageHash.value
      }),
      upload_state: extractFetchStatusUploadState(uploadResponse) ?? "not_reported",
      crxVersion: extractFetchStatusCrxVersion(uploadResponse),
      crx_version: extractFetchStatusCrxVersion(uploadResponse)
    },
    publish_response: publishResponse,
    publish_response_summary: summarizeApiResponse(publishResponse),
    safety_checks: safetyChecks,
    human_approval: humanApprovalArtifact,
    package_hash: packageHash,
    manual_new_item_handoff: manualNewItemHandoff,
    existing_item_update_dry_run: existingItemDryRun,
    failure_reason: topLevelFailureReason
  };

  const report = buildSafePublishExecutionReport(reportWithoutRedactionChecks);

  await validateRunArtifact(runDir, "publish_execution.schema.json", "90_publish_execution.json", report);
  const publishExecutionWrite = await writeManagedRunArtifact({
    runDir,
    artifactName: "90_publish_execution.json",
    data: report,
    runContext
  });
  if (report.publisher_id && report.item_id) {
    const evidenceArtifacts = [publishExecutionWrite.artifactRelativePath];
    const ledgerActionSource = runContext.publish_action_source ?? "api";
    if (report.fetch_status_response?.ok) {
      await appendReleaseLedgerEvent(runContext.project_root, {
        runId: runContext.run_id,
        itemId: report.item_id,
        publisherId: report.publisher_id,
        itemName: selectedReport?.candidate?.name ?? null,
        packageSha256: report.package_sha256,
        manifestVersion: report.manifest_version,
        actionType: "fetch_status",
        actionSource: ledgerActionSource,
        actionStatus: "passed",
        evidenceArtifacts,
        responseSummary: report.fetch_status_response_summary,
        approvalArtifact: humanApprovalReference?.artifactRelativePath ?? null,
        productionWrite: false,
        sandboxOnly: true
      });
    }

    if (report.upload_request_attempted && !report.failure_reason) {
      await appendReleaseLedgerEvent(runContext.project_root, {
        runId: runContext.run_id,
        itemId: report.item_id,
        publisherId: report.publisher_id,
        itemName: selectedReport?.candidate?.name ?? null,
        packageSha256: report.package_sha256,
        manifestVersion: report.manifest_version,
        currentSandboxItemVersion: report.current_sandbox_item_version,
        uploadResponseCrxVersion: report.upload_response_crx_version,
        uploadedCrxVersion: report.uploaded_crx_version,
        publishedCrxVersion: report.published_crx_version,
        uploadState: report.upload_state,
        versionConsistencyCheck: report.version_consistency_check,
        actionType: "sandbox_upload",
        actionSource: ledgerActionSource,
        actionStatus: report.sandbox_upload_verified ? "passed" : "tracked",
        evidenceArtifacts,
        responseSummary: report.upload_response_summary,
        approvalArtifact: humanApprovalReference?.artifactRelativePath ?? null,
        productionWrite: false,
        sandboxOnly: true
      });
    }

    if (report.publish_response?.executed && report.publish_response?.ok) {
      await appendReleaseLedgerEvent(runContext.project_root, {
        runId: runContext.run_id,
        itemId: report.item_id,
        publisherId: report.publisher_id,
        itemName: selectedReport?.candidate?.name ?? null,
        packageSha256: report.package_sha256,
        manifestVersion: report.manifest_version,
        currentSandboxItemVersion: report.current_sandbox_item_version,
        uploadResponseCrxVersion: report.upload_response_crx_version,
        uploadedCrxVersion: report.uploaded_crx_version,
        publishedCrxVersion: report.published_crx_version,
        uploadState: report.upload_state,
        versionConsistencyCheck: report.version_consistency_check,
        actionType: "sandbox_publish_optional",
        actionSource: ledgerActionSource,
        actionStatus: "passed",
        evidenceArtifacts,
        responseSummary: report.publish_response_summary,
        approvalArtifact: humanApprovalReference?.artifactRelativePath ?? null,
        productionWrite: false,
        sandboxOnly: true
      });

      if (`${report.publish_response?.body?.state ?? ""}`.trim().toUpperCase() === "PENDING_REVIEW") {
        await appendReleaseLedgerEvent(runContext.project_root, {
          runId: runContext.run_id,
          itemId: report.item_id,
          publisherId: report.publisher_id,
          itemName: selectedReport?.candidate?.name ?? null,
          packageSha256: report.package_sha256,
          manifestVersion: report.manifest_version,
          currentSandboxItemVersion: report.current_sandbox_item_version,
          uploadResponseCrxVersion: report.upload_response_crx_version,
          uploadedCrxVersion: report.uploaded_crx_version,
          publishedCrxVersion: report.published_crx_version,
          uploadState: report.upload_state,
          versionConsistencyCheck: report.version_consistency_check,
          actionType: "review_pending",
          actionSource: ledgerActionSource,
          actionStatus: "observed",
          evidenceArtifacts,
          responseSummary: report.publish_response_summary,
          approvalArtifact: humanApprovalReference?.artifactRelativePath ?? null,
          productionWrite: false,
          sandboxOnly: true
        });
        await syncActiveReviewWatchForRun({
          runDir,
          runContext,
          publishExecution: report
        });
      }
    }
  }
  return report;
}

function buildSafePublishDiagnosticsReport(reportWithoutChecks) {
  const originalRedactionChecks = buildRedactionChecks(reportWithoutChecks);
  const redactionGuardTriggered = hasSecretLikeContent(originalRedactionChecks);
  const safeReportWithoutChecks = redactSecretLikeValue(reportWithoutChecks);

  if (redactionGuardTriggered) {
    safeReportWithoutChecks.status = "failed";
    safeReportWithoutChecks.failure_reason = "Publish diagnostics redaction guard blocked artifact write due to secret-like content.";
    safeReportWithoutChecks.failure_phase = safeReportWithoutChecks.failure_phase ?? "env_preflight";
    safeReportWithoutChecks.diagnostic_hint = "Remove any secret-like values from diagnostics output and retry.";
  }

  return {
    ...safeReportWithoutChecks,
    redaction_checks: {
      ...buildRedactionChecks(safeReportWithoutChecks),
      redaction_guard_triggered: redactionGuardTriggered
    }
  };
}

export async function runPublishDiagnosticsStage({
  runDir,
  runContext
}) {
  const publisherId = resolvePublisherId(runContext);
  const existingItem = resolveExistingItemConfig(runContext, "sandbox_validate");
  const credentialsPreflight = resolveCredentialPreflight();
  const credentialSummary = resolveCredentialSummary(credentialsPreflight);
  const serviceAccountSummary = await readChromeWebStoreServiceAccountSummary();
  const clockCheck = buildClockCheck();

  let failurePhase = null;
  let failureReason = null;
  let diagnosticHint = null;
  let retryable = false;
  let likelyCause = null;
  let actionableHint = null;
  let networkProbeSummary = buildEmptyNetworkProbeSummary();
  let proxyMetadata = buildProxyMetadata(networkProbeSummary, getChromeWebStoreNetworkSummary(GOOGLE_TOKEN_ENDPOINT));

  const envPreflight = {
    publisher_id_present: Boolean(publisherId),
    sandbox_item_id_present: Boolean(existingItem.item_id),
    google_application_credentials_present: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS),
    service_account_file_present: Boolean(process.env.CHROME_WEB_STORE_SERVICE_ACCOUNT_FILE),
    service_account_inline_json_present: Boolean(process.env.CHROME_WEB_STORE_SERVICE_ACCOUNT_JSON),
    cws_https_proxy_present: Boolean(process.env.CWS_HTTPS_PROXY),
    cws_http_proxy_present: Boolean(process.env.CWS_HTTP_PROXY),
    https_proxy_present: Boolean(process.env.HTTPS_PROXY),
    http_proxy_present: Boolean(process.env.HTTP_PROXY),
    no_proxy_present: Boolean(process.env.NO_PROXY ?? process.env.no_proxy),
    allow_sandbox_upload: envFlagEnabled("CWS_ALLOW_SANDBOX_UPLOAD"),
    allow_sandbox_publish: envFlagEnabled("CWS_ALLOW_SANDBOX_PUBLISH")
  };

  const tokenExchange = {
    attempted: false,
    status: "skipped",
    scope: CHROME_WEB_STORE_READONLY_SCOPE,
    token_mode: null,
    http_status: null,
    response_body_summary: null,
    response_headers_summary: null,
    error_details: null,
    failure_reason: null
  };

  const fetchStatus = {
    attempted: false,
    status: "skipped",
    endpoint: publisherId && existingItem.item_id
      ? `https://chromewebstore.googleapis.com/v2/publishers/${publisherId}/items/${existingItem.item_id}:fetchStatus`
      : "https://chromewebstore.googleapis.com/v2/publishers/{publisher_id}/items/{item_id}:fetchStatus",
    ok: null,
    status_code: 0,
    http_status: null,
    body: null,
    response_body_summary: null,
    response_headers_summary: null,
    error_details: null,
    failure_reason: null
  };

  if (!envPreflight.publisher_id_present || !envPreflight.sandbox_item_id_present) {
    failurePhase = "env_preflight";
    failureReason = "Publish diagnostics requires CHROME_WEB_STORE_PUBLISHER_ID and CHROME_WEB_STORE_SANDBOX_ITEM_ID.";
    diagnosticHint = "Set both publisher_id and sandbox_item_id before diagnostics.";
  } else if (credentialsPreflight.status !== "passed" || credentialSummary.credential_type !== "service_account") {
    failurePhase = "env_preflight";
    failureReason = "Publish diagnostics requires service-account credentials via GOOGLE_APPLICATION_CREDENTIALS or another service-account source.";
    diagnosticHint = "Use GOOGLE_APPLICATION_CREDENTIALS or CHROME_WEB_STORE_SERVICE_ACCOUNT_FILE for publish diagnostics.";
  } else if (serviceAccountSummary.error_details || serviceAccountSummary.credential_file_exists === false || !serviceAccountSummary.client_email_present) {
    failurePhase = "credentials_file_read";
    failureReason = serviceAccountSummary.error_details?.message ?? "Service-account diagnostics could not confirm client_email from the local credentials file.";
    diagnosticHint = "Verify that the local service-account JSON exists, parses, and includes client_email.";
  }

  networkProbeSummary = await collectPublishNetworkProbeSummary();
  proxyMetadata = buildProxyMetadata(networkProbeSummary);

  if (!failureReason) {
    try {
      tokenExchange.attempted = true;
      const tokenResult = await getChromeWebStoreAccessToken("service_account", {
        scope: CHROME_WEB_STORE_READONLY_SCOPE
      });
      tokenExchange.status = "passed";
      tokenExchange.token_mode = tokenResult.tokenMode;
      proxyMetadata = buildProxyMetadata(networkProbeSummary, tokenResult);

      fetchStatus.attempted = true;
      const fetchStatusResponse = await fetchChromeWebStoreStatus({
        publisherId,
        itemId: existingItem.item_id,
        accessToken: tokenResult.accessToken
      });
      Object.assign(fetchStatus, {
        status: fetchStatusResponse.ok ? "passed" : "failed",
        ok: fetchStatusResponse.ok,
        status_code: fetchStatusResponse.status_code,
        http_status: fetchStatusResponse.http_status ?? fetchStatusResponse.status_code,
        body: fetchStatusResponse.body,
        response_body_summary: fetchStatusResponse.response_body_summary ?? null,
        response_headers_summary: fetchStatusResponse.response_headers_summary ?? null,
        error_details: fetchStatusResponse.error_details ?? null
      });
      proxyMetadata = buildProxyMetadata(networkProbeSummary, fetchStatusResponse);

      if (!fetchStatusResponse.ok) {
        failurePhase = "chrome_webstore_fetch_status";
        failureReason = `fetchStatus failed with HTTP ${fetchStatusResponse.status_code}.`;
        diagnosticHint = diagnosticHintForFetchStatus(fetchStatusResponse);
        retryable = retryableHttpStatus(fetchStatusResponse.status_code);
        fetchStatus.failure_reason = failureReason;
      }
    } catch (error) {
      const failureMeta = failureMetaFromError(error, "token_exchange");
      const tokenFailure = analyzeTokenExchangeFailure({
        failurePhase: failureMeta.failure_phase,
        responseBodySummary: failureMeta.response_body_summary,
        errorDetails: failureMeta.diagnostic_error
      });
      failurePhase = failureMeta.failure_phase;
      failureReason = failureMeta.failure_reason;
      diagnosticHint = failureMeta.diagnostic_hint;
      retryable = failureMeta.retryable;
      likelyCause = tokenFailure.likely_cause;
      actionableHint = tokenFailure.actionable_hint;
      proxyMetadata = buildProxyMetadata(networkProbeSummary, failureMeta);

      if (failurePhase === "token_exchange") {
        Object.assign(tokenExchange, {
          status: "failed",
          http_status: failureMeta.http_status,
          response_body_summary: failureMeta.response_body_summary,
          response_headers_summary: failureMeta.response_headers_summary,
          error_details: failureMeta.diagnostic_error,
          failure_reason: failureMeta.failure_reason
        });
      } else {
        Object.assign(fetchStatus, {
          status: "failed",
          ok: false,
          http_status: failureMeta.http_status,
          status_code: failureMeta.http_status ?? 0,
          response_body_summary: failureMeta.response_body_summary,
          response_headers_summary: failureMeta.response_headers_summary,
          error_details: failureMeta.diagnostic_error,
          failure_reason: failureMeta.failure_reason
        });
      }
    }
  }

  if (!diagnosticHint && clockCheck.clock_sane === false) {
    diagnosticHint = clockCheck.diagnostic_hint;
  }

  const reportWithoutRedactionChecks = {
    stage: "PUBLISH_DIAGNOSTICS",
    status: failureReason ? "failed" : "passed",
    generated_at: nowIso(),
    local_time_iso: clockCheck.local_time_iso,
    clock_check_performed: clockCheck.clock_check_performed,
    clock_sane: clockCheck.clock_sane,
    publisher_id: publisherId,
    item_id: existingItem.item_id,
    credential_type: credentialSummary.credential_type,
    credential_present: credentialSummary.credential_present,
    token_source: credentialSummary.token_source,
    env_preflight: envPreflight,
    credentials_preflight: credentialsPreflight,
    service_account_summary: serviceAccountSummary,
    network_probe_summary: networkProbeSummary,
    ...proxyMetadata,
    token_exchange: tokenExchange,
    fetch_status: fetchStatus,
    failure_phase: failurePhase,
    diagnostic_hint: diagnosticHint,
    likely_cause: likelyCause,
    actionable_hint: actionableHint,
    retryable,
    failure_reason: failureReason
  };

  const report = buildSafePublishDiagnosticsReport(reportWithoutRedactionChecks);
  await validateRunArtifact(runDir, "publish_diagnostics.schema.json", "89_publish_diagnostics.json", report);
  await writeJson(artifactPath(runDir, "89_publish_diagnostics.json"), report);
  return report;
}

export function buildMonitoringSnapshotSkeleton({ runContext, publishExecution = null }) {
  return {
    stage: "MONITOR_POST_RELEASE",
    status: "pending",
    generated_at: nowIso(),
    publisher_id: publishExecution?.publisher_id ?? null,
    item_id: publishExecution?.item_id ?? null,
    publish_execution_path: publishExecution ? "90_publish_execution.json" : "",
    portfolio_registry_path: runContext?.portfolio_registry?.path ?? "",
    metrics_source: "unconfigured",
    metrics: {
      installs: null,
      uninstalls: null,
      impressions: null
    },
    review_intake: {
      new_reviews: 0,
      support_tickets: 0
    },
    failure_reason: null
  };
}

export function buildLearningUpdateSkeleton({ runContext, publishExecution = null }) {
  return {
    stage: "MONITOR_POST_RELEASE",
    status: "pending",
    generated_at: nowIso(),
    publisher_id: publishExecution?.publisher_id ?? null,
    item_id: publishExecution?.item_id ?? null,
    portfolio_registry_path: runContext?.portfolio_registry?.path ?? "",
    blacklist_updates: [],
    overlap_updates: [],
    archetype_priors: {},
    scoring_weight_suggestions: [],
    failure_reason: null
  };
}

export async function prepareListingPackageStage({
  runDir,
  selectedReport,
  brief = null,
  plan = null,
  buildReport = null,
  qaReport,
  browserSmokeReport = null,
  screenshotManifest = null,
  listingCopy = null,
  policyGate,
  publishPlan
}) {
  const packageDir = artifactPath(runDir, "81_listing_package");
  const packageZipPath = artifactPath(runDir, "81_listing_package.zip");
  await resetDir(packageDir);
  await fs.rm(packageZipPath, { force: true });

  if (publishPlan.publish_intent === "archive_no_publish" || qaReport.overall_status !== "passed") {
    const skipped = {
      stage: "PREPARE_LISTING_PACKAGE",
      status: "skipped",
      generated_at: nowIso(),
      reason: publishPlan.reason,
      publish_intent: publishPlan.publish_intent,
      candidate_id: selectedReport.selected_candidate_id,
      package_dir: packageDir,
      package_zip: "",
      included_files: ["package_manifest.json"]
    };
    await writeJson(path.join(packageDir, "package_manifest.json"), skipped);
    await validateRunArtifact(runDir, "listing_package.schema.json", "81_listing_package_report.json", skipped);
    await writeJson(artifactPath(runDir, "81_listing_package_report.json"), skipped);
    return skipped;
  }

  const readyBrief = requireStageInput(brief, "brief");
  const readyPlan = requireStageInput(plan, "implementation plan");
  const readyBuildReport = requireStageInput(buildReport, "build report");
  const readyListingCopy = requireStageInput(listingCopy, "listing copy");
  const readyPolicyGate = requireStageInput(policyGate, "policy gate");
  const extensionPackagePath = await resolveExtensionPackagePath(runDir, readyBuildReport);

  const reviewDir = path.join(packageDir, "review");
  await ensureDir(reviewDir);
  await copyDir(artifactPath(runDir, "70_listing_assets"), path.join(packageDir, "assets"));
  await fs.copyFile(extensionPackagePath, path.join(packageDir, "extension_package.zip"));

  await writeJson(path.join(packageDir, "listing_copy.json"), readyListingCopy);
  await writeJson(path.join(reviewDir, "product_brief.json"), readyBrief);
  await writeText(path.join(reviewDir, "product_brief.md"), buildBriefMarkdown(readyBrief));
  await writeJson(path.join(reviewDir, "implementation_plan.json"), readyPlan);
  await writeJson(path.join(reviewDir, "qa_report.json"), qaReport);
  if (browserSmokeReport) {
    await writeJson(path.join(reviewDir, "browser_smoke.json"), browserSmokeReport);
  }
  if (screenshotManifest) {
    await writeJson(path.join(reviewDir, "screenshot_manifest.json"), screenshotManifest);
  }
  await writeJson(path.join(reviewDir, "policy_gate.json"), readyPolicyGate);
  await writeJson(path.join(reviewDir, "publish_plan.json"), publishPlan);
  await writeText(path.join(packageDir, "listing_submission.md"), buildListingSubmissionMarkdown({
    brief: readyBrief,
    plan: readyPlan,
    listingCopy: readyListingCopy,
    policyGate: readyPolicyGate,
    publishPlan
  }));

  const includedFilesBeforeManifest = (await listFiles(packageDir)).map((file) => file.relativePath);
  const manifest = {
    stage: "PREPARE_LISTING_PACKAGE",
    status: "passed",
    generated_at: nowIso(),
    publish_intent: publishPlan.publish_intent,
    candidate_id: selectedReport.selected_candidate_id,
    product_name: readyBrief.product_name_working,
    package_dir: packageDir,
    package_zip: packageZipPath,
    extension_package: "extension_package.zip",
    asset_status: readyListingCopy.asset_status,
    policy_status: readyPolicyGate.status,
    manual_review_items: readyPolicyGate.manual_review_items,
    included_files: [
      "package_manifest.json",
      ...includedFilesBeforeManifest
    ].sort()
  };

  await writeJson(path.join(packageDir, "package_manifest.json"), manifest);
  const packageZipSize = await createZipFromDirectory(packageDir, packageZipPath);
  const report = {
    ...manifest,
    package_zip_size: packageZipSize
  };

  await validateRunArtifact(runDir, "listing_package.schema.json", "81_listing_package_report.json", report);
  await writeJson(artifactPath(runDir, "81_listing_package_report.json"), report);
  return report;
}

export async function writeFailure(runDir, stage, error) {
  await ensureDir(runDir);
  const runContextPath = artifactPath(runDir, "00_run_context.json");
  const priorStatusPath = artifactPath(runDir, "run_status.json");
  const runContext = await (await fileExists(runContextPath) ? readJson(runContextPath) : null);
  const priorStatus = await (await fileExists(priorStatusPath) ? readJson(priorStatusPath) : null);
  await writeJson(artifactPath(runDir, "run_status.json"), {
    stage,
    status: "failed",
    generated_at: nowIso(),
    run_id: runContext?.run_id ?? priorStatus?.run_id ?? path.basename(runDir),
    run_id_strategy: runContext?.run_id_strategy ?? priorStatus?.run_id_strategy ?? "unknown",
    allow_overwrite: runContext?.allow_overwrite ?? priorStatus?.allow_overwrite ?? false,
    overwrite_blocked: runContext?.overwrite_blocked ?? priorStatus?.overwrite_blocked ?? false,
    created_at: runContext?.created_at ?? priorStatus?.created_at ?? nowIso(),
    failure_reason: redactSecretLikeText(error.message)
  });
}
