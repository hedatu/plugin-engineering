import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { assertMatchesSchema } from "../utils/schema.mjs";
import {
  ensureDir,
  fileExists,
  nowIso,
  readJson,
  writeJson
} from "../utils/io.mjs";
import {
  hasSecretLikeContent,
  inspectSecretLikeContent,
  redactSecretLikeValue
} from "../utils/redaction.mjs";

export const RELEASE_LEDGER_PATH = path.join("state", "release_ledger.json");

function absoluteLedgerPath(projectRoot) {
  return path.join(projectRoot, RELEASE_LEDGER_PATH);
}

function ledgerLockPath(projectRoot) {
  return path.join(projectRoot, "state", ".locks", "release_ledger.lock.json");
}

function uniqueStrings(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function hashJson(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function shortRandom() {
  return crypto.randomBytes(3).toString("hex");
}

function buildLedgerEntryId(actionType) {
  return `ledger-${actionType}-${Date.now()}-${shortRandom()}`;
}

function buildRedactionChecks(value) {
  return inspectSecretLikeContent(value);
}

function buildSafeLedgerEntry(entryWithoutChecks) {
  const initialChecks = buildRedactionChecks(entryWithoutChecks);
  const redactionGuardTriggered = hasSecretLikeContent(initialChecks);
  const safeEntry = redactSecretLikeValue(entryWithoutChecks);

  if (redactionGuardTriggered) {
    safeEntry.action_status = "failed_redaction_guard";
  }

  return {
    ...safeEntry,
    redaction_checks: {
      ...buildRedactionChecks(safeEntry),
      redaction_guard_triggered: redactionGuardTriggered
    }
  };
}

export function defaultReleaseLedger() {
  return {
    stage: "RELEASE_LEDGER",
    status: "passed",
    generated_at: nowIso(),
    entries: []
  };
}

export async function validateReleaseLedger(projectRoot, data) {
  await assertMatchesSchema({
    data,
    schemaPath: path.join(projectRoot, "schemas", "release_ledger.schema.json"),
    label: RELEASE_LEDGER_PATH
  });
}

export async function loadReleaseLedger(projectRoot) {
  const ledgerPath = absoluteLedgerPath(projectRoot);
  if (!(await fileExists(ledgerPath))) {
    const initialized = defaultReleaseLedger();
    await ensureDir(path.dirname(ledgerPath));
    await validateReleaseLedger(projectRoot, initialized);
    await writeJson(ledgerPath, initialized);
    return initialized;
  }

  const current = await readJson(ledgerPath);
  const normalized = {
    ...defaultReleaseLedger(),
    ...current,
    entries: current.entries ?? []
  };
  await validateReleaseLedger(projectRoot, normalized);
  return normalized;
}

async function computeEvidenceHashes(projectRoot, evidenceArtifacts = []) {
  const hashes = {};
  for (const relativePath of evidenceArtifacts) {
    const absolutePath = path.isAbsolute(relativePath)
      ? relativePath
      : path.join(projectRoot, relativePath);
    if (!(await fileExists(absolutePath))) {
      continue;
    }
    const value = await readJsonOrBufferHash(absolutePath);
    hashes[relativePath.replaceAll("\\", "/")] = value;
  }
  return hashes;
}

async function readJsonOrBufferHash(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withLedgerLock(projectRoot, action) {
  const lockPath = ledgerLockPath(projectRoot);
  await ensureDir(path.dirname(lockPath));
  let handle = null;
  let lastError = null;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      handle = await fs.open(lockPath, "wx");
      await handle.writeFile(`${JSON.stringify({
        pid: process.pid,
        acquired_at: nowIso()
      }, null, 2)}\n`, "utf8");
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      lastError = error;
      await sleep(50);
    }
  }

  if (!handle) {
    throw lastError ?? new Error("Could not acquire release ledger lock.");
  }

  try {
    return await action();
  } finally {
    await handle.close().catch(() => {});
    await fs.rm(lockPath, { force: true }).catch(() => {});
  }
}

export async function appendReleaseLedgerEntry(projectRoot, entry) {
  return withLedgerLock(projectRoot, async () => {
    const ledger = await loadReleaseLedger(projectRoot);
    const safeEntry = buildSafeLedgerEntry({
      ledger_entry_id: entry.ledger_entry_id ?? buildLedgerEntryId(entry.action_type ?? "event"),
      run_id: entry.run_id ?? null,
      source_run_id: entry.source_run_id ?? null,
      sandbox_run_id: entry.sandbox_run_id ?? null,
      source_sandbox_run_id: entry.source_sandbox_run_id ?? null,
      new_sandbox_run_id: entry.new_sandbox_run_id ?? null,
      item_id: entry.item_id ?? null,
      publisher_id: entry.publisher_id ?? null,
      item_name: entry.item_name ?? null,
      package_sha256: entry.package_sha256 ?? "",
      manifest_version: entry.manifest_version ?? null,
      current_sandbox_item_version: entry.current_sandbox_item_version ?? null,
      upload_response_crx_version: entry.upload_response_crx_version ?? null,
      uploaded_crx_version: entry.uploaded_crx_version ?? null,
      published_crx_version: entry.published_crx_version ?? null,
      upload_state: entry.upload_state ?? null,
      version_consistency_check: entry.version_consistency_check ?? null,
      previous_manifest_version: entry.previous_manifest_version ?? null,
      target_manifest_version: entry.target_manifest_version ?? null,
      old_package_sha256: entry.old_package_sha256 ?? "",
      new_package_sha256: entry.new_package_sha256 ?? "",
      action_type: entry.action_type,
      action_source: entry.action_source,
      action_status: entry.action_status ?? "observed",
      occurred_at: entry.occurred_at ?? nowIso(),
      evidence_artifacts: uniqueStrings(entry.evidence_artifacts ?? []),
      evidence_hashes: entry.evidence_hashes ?? {},
      chrome_webstore_response_summary: entry.chrome_webstore_response_summary ?? null,
      dashboard_manual_note: entry.dashboard_manual_note ?? null,
      approved_by: entry.approved_by ?? null,
      approval_artifact: entry.approval_artifact ?? null,
      corrects_ledger_entry_id: entry.corrects_ledger_entry_id ?? null,
      corrected_fields: entry.corrected_fields ?? [],
      reason: entry.reason ?? null,
      production_write: entry.production_write === true,
      sandbox_only: entry.sandbox_only !== false,
      evidence_quality: entry.evidence_quality ?? "direct_artifact",
      original_artifact_available: entry.original_artifact_available !== false,
      recovery_reason: entry.recovery_reason ?? null
    });

    const nextLedger = {
      ...ledger,
      generated_at: nowIso(),
      entries: [
        ...ledger.entries,
        safeEntry
      ]
    };
    await validateReleaseLedger(projectRoot, nextLedger);
    await writeJson(absoluteLedgerPath(projectRoot), nextLedger);
    return safeEntry;
  });
}

export async function appendReleaseLedgerEvent(projectRoot, {
  runId = null,
  sourceRunId = null,
  sandboxRunId = null,
  itemId = null,
  publisherId = null,
  itemName = null,
  packageSha256 = "",
  manifestVersion = null,
  currentSandboxItemVersion = null,
  uploadResponseCrxVersion = null,
  uploadedCrxVersion = null,
  publishedCrxVersion = null,
  uploadState = null,
  versionConsistencyCheck = null,
  actionType,
  actionSource,
  actionStatus = "observed",
  occurredAt = nowIso(),
  evidenceArtifacts = [],
  responseSummary = null,
  dashboardManualNote = null,
  approvedBy = null,
  approvalArtifact = null,
  productionWrite = false,
  sandboxOnly = true,
  evidenceQuality = "direct_artifact",
  originalArtifactAvailable = true,
  recoveryReason = null
}) {
  const evidenceHashes = await computeEvidenceHashes(projectRoot, evidenceArtifacts);
  return appendReleaseLedgerEntry(projectRoot, {
    run_id: runId,
    source_run_id: sourceRunId,
    sandbox_run_id: sandboxRunId,
    item_id: itemId,
    publisher_id: publisherId,
    item_name: itemName,
    package_sha256: packageSha256,
    manifest_version: manifestVersion,
    current_sandbox_item_version: currentSandboxItemVersion,
    upload_response_crx_version: uploadResponseCrxVersion,
    uploaded_crx_version: uploadedCrxVersion,
    published_crx_version: publishedCrxVersion,
    upload_state: uploadState,
    version_consistency_check: versionConsistencyCheck,
    action_type: actionType,
    action_source: actionSource,
    action_status: actionStatus,
    occurred_at: occurredAt,
    evidence_artifacts: evidenceArtifacts,
    evidence_hashes: evidenceHashes,
    chrome_webstore_response_summary: responseSummary,
    dashboard_manual_note: dashboardManualNote,
    approved_by: approvedBy,
    approval_artifact: approvalArtifact,
    production_write: productionWrite,
    sandbox_only: sandboxOnly,
    evidence_quality: evidenceQuality,
    original_artifact_available: originalArtifactAvailable,
    recovery_reason: recoveryReason
  });
}

export async function findLatestLedgerEntryForItem(projectRoot, { itemId, publisherId, actionTypes = [] }) {
  const ledger = await loadReleaseLedger(projectRoot);
  const allowedTypes = new Set(actionTypes);
  const entries = ledger.entries
    .filter((entry) => entry.item_id === itemId && entry.publisher_id === publisherId)
    .filter((entry) => allowedTypes.size === 0 || allowedTypes.has(entry.action_type));
  return entries.at(-1) ?? null;
}

export async function listLedgerEntryIdsForRun(projectRoot, { runId, itemId = null }) {
  const ledger = await loadReleaseLedger(projectRoot);
  return ledger.entries
    .filter((entry) => entry.run_id === runId && (!itemId || entry.item_id === itemId))
    .map((entry) => entry.ledger_entry_id);
}

export async function inspectReleaseLedger(projectRoot) {
  const ledger = await loadReleaseLedger(projectRoot);
  return {
    path: absoluteLedgerPath(projectRoot),
    entry_count: ledger.entries.length,
    action_types: uniqueStrings(ledger.entries.map((entry) => entry.action_type)),
    item_ids: uniqueStrings(ledger.entries.map((entry) => entry.item_id)),
    latest_entry_id: ledger.entries.at(-1)?.ledger_entry_id ?? null
  };
}

export function summarizeLedgerEntryHash(entry) {
  return hashJson(entry);
}
