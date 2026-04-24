import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { assertMatchesSchema } from "../utils/schema.mjs";
import { ensureDir, fileExists, nowIso, readJson, writeJson } from "../utils/io.mjs";
import { hasSecretLikeContent, inspectSecretLikeContent, redactSecretLikeValue } from "../utils/redaction.mjs";
import { loadManagedRunArtifact, writeManagedRunArtifact } from "../workflow/runEventArtifacts.mjs";

export const HUMAN_APPROVAL_ARTIFACT = "82_human_approval.json";
export const APPROVAL_MODE_TEST_ARTIFACT_ONLY = "test_artifact_only";
export const APPROVAL_MODE_WRITE_ALLOWED = "write_allowed";

const APPROVAL_EXPIRY_HOURS = 24;
const GENERIC_WRITE_BLOCKED_NOTE_PATTERNS = [
  /artifact only/i
];
const UPLOAD_WRITE_BLOCKED_NOTE_PATTERNS = [
  /do not upload/i
];
const PUBLISH_WRITE_BLOCKED_NOTE_PATTERNS = [
  /do not publish/i
];

function artifactPath(runDir, fileName) {
  return path.join(runDir, fileName);
}

function addHours(iso, hours) {
  const value = new Date(iso);
  value.setHours(value.getHours() + hours);
  return value.toISOString();
}

function safeActionScope(requestedAction) {
  if (`${requestedAction}`.startsWith("sandbox_")) {
    return "sandbox";
  }
  if (`${requestedAction}`.startsWith("production_")) {
    return "production";
  }
  return "none";
}

export function normalizeApprovalMode(value) {
  return value === APPROVAL_MODE_WRITE_ALLOWED
    ? APPROVAL_MODE_WRITE_ALLOWED
    : APPROVAL_MODE_TEST_ARTIFACT_ONLY;
}

function writeBlockedNotePatternsForAction(requestedAction = null) {
  const action = `${requestedAction ?? ""}`.trim();
  if (action === "sandbox_upload" || action === "production_upload") {
    return [
      ...GENERIC_WRITE_BLOCKED_NOTE_PATTERNS,
      ...UPLOAD_WRITE_BLOCKED_NOTE_PATTERNS
    ];
  }
  if (action === "sandbox_publish" || action === "production_publish") {
    return [
      ...GENERIC_WRITE_BLOCKED_NOTE_PATTERNS,
      ...PUBLISH_WRITE_BLOCKED_NOTE_PATTERNS
    ];
  }
  return [
    ...GENERIC_WRITE_BLOCKED_NOTE_PATTERNS,
    ...UPLOAD_WRITE_BLOCKED_NOTE_PATTERNS,
    ...PUBLISH_WRITE_BLOCKED_NOTE_PATTERNS
  ];
}

export function approvalNoteContainsWriteBlocker(note = "", requestedAction = null) {
  return writeBlockedNotePatternsForAction(requestedAction)
    .some((pattern) => pattern.test(`${note ?? ""}`));
}

export function writeAuthorizationForApprovalArtifact(approvalArtifact) {
  if (!approvalArtifact) {
    return false;
  }
  return approvalArtifact.approval_status === "approved"
    && normalizeApprovalMode(approvalArtifact.approval_mode) === APPROVAL_MODE_WRITE_ALLOWED
    && approvalArtifact.note_policy_blocked !== true
    && approvalNoteContainsWriteBlocker(
      approvalArtifact.approval_notes,
      approvalArtifact.requested_action
    ) === false;
}

async function resolveProjectRoot(runDir, projectRoot = null) {
  if (projectRoot) {
    return projectRoot;
  }
  const runContext = await readJson(artifactPath(runDir, "00_run_context.json"));
  return runContext.project_root;
}

function summarizeApprovalRedactionChecks(reportWithoutChecks) {
  return inspectSecretLikeContent(reportWithoutChecks);
}

function buildSafeHumanApprovalArtifact(reportWithoutChecks) {
  const initialChecks = summarizeApprovalRedactionChecks(reportWithoutChecks);
  const redactionGuardTriggered = hasSecretLikeContent(initialChecks);
  const safeReport = redactSecretLikeValue(reportWithoutChecks);

  if (redactionGuardTriggered) {
    safeReport.approval_status = "rejected";
    safeReport.blockers = [
      ...(safeReport.blockers ?? []),
      "redaction_guard_triggered"
    ];
    safeReport.next_step = "remove secret-like content from approval artifact inputs and retry approval";
  }

  return {
    ...safeReport,
    redaction_checks: {
      ...summarizeApprovalRedactionChecks(safeReport),
      redaction_guard_triggered: redactionGuardTriggered
    }
  };
}

export async function validateHumanApprovalArtifact({ runDir, projectRoot = null, data }) {
  const resolvedProjectRoot = await resolveProjectRoot(runDir, projectRoot);
  await assertMatchesSchema({
    data,
    schemaPath: path.join(resolvedProjectRoot, "schemas", "human_approval.schema.json"),
    label: HUMAN_APPROVAL_ARTIFACT
  });
}

export async function loadHumanApprovalArtifact(runDir) {
  const loaded = await loadManagedRunArtifact({
    runDir,
    artifactName: HUMAN_APPROVAL_ARTIFACT
  });
  return loaded?.data ?? null;
}

export async function writeHumanApprovalArtifact({
  runDir,
  projectRoot = null,
  runId,
  requestedAction,
  actionScope = safeActionScope(requestedAction),
  itemId = null,
  publisherId = null,
  packageSha256 = "",
  manifestVersion = null,
  approvalStatus,
  approvedBy = "",
  approvedAt = null,
  approvalSource = "",
  approvalNotes = "",
  expiresAt = null,
  approvalMode = APPROVAL_MODE_TEST_ARTIFACT_ONLY,
  safetySummary = {},
  blockers = [],
  nextStep = ""
}) {
  const normalizedApprovalMode = normalizeApprovalMode(approvalMode);
  const notePolicyBlocked = approvalNoteContainsWriteBlocker(approvalNotes, requestedAction);
  const writeAuthorized = approvalStatus === "approved"
    && normalizedApprovalMode === APPROVAL_MODE_WRITE_ALLOWED
    && !notePolicyBlocked;
  const approvalId = `approval-${requestedAction}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const report = buildSafeHumanApprovalArtifact({
    stage: "HUMAN_APPROVAL_GATE",
    approval_id: approvalId,
    run_id: runId,
    requested_action: requestedAction,
    action_scope: actionScope,
    item_id: itemId,
    publisher_id: publisherId,
    package_sha256: packageSha256,
    manifest_version: manifestVersion,
    approval_status: approvalStatus,
    approved_by: approvedBy,
    approved_at: approvedAt,
    approval_source: approvalSource,
    approval_notes: approvalNotes,
    expires_at: expiresAt,
    approval_mode: normalizedApprovalMode,
    note_policy_blocked: notePolicyBlocked,
    write_authorized: writeAuthorized,
    safety_summary: safetySummary,
    blockers: [
      ...blockers,
      ...(normalizedApprovalMode !== APPROVAL_MODE_WRITE_ALLOWED ? ["approval_mode_not_write_allowed"] : []),
      ...(notePolicyBlocked ? ["approval_note_blocks_write"] : [])
    ],
    next_step: nextStep
  });

  await validateHumanApprovalArtifact({ runDir, projectRoot, data: report });
  await writeManagedRunArtifact({
    runDir,
    artifactName: HUMAN_APPROVAL_ARTIFACT,
    data: report
  });
  return report;
}

export async function ensureDefaultHumanApprovalArtifact({
  runDir,
  projectRoot = null,
  runId,
  requestedAction = "none",
  itemId = null,
  publisherId = null,
  packageSha256 = "",
  manifestVersion = null,
  safetySummary = {},
  nextStep = "human approval required before any upload or publish action"
}) {
  const existing = await loadHumanApprovalArtifact(runDir);
  if (existing) {
    return existing;
  }

  return writeHumanApprovalArtifact({
    runDir,
    projectRoot,
    runId,
    requestedAction,
    actionScope: safeActionScope(requestedAction),
    itemId,
    publisherId,
    packageSha256,
    manifestVersion,
    approvalStatus: "not_requested",
    approvedBy: "",
    approvedAt: null,
    approvalSource: "workflow_default",
    approvalNotes: "",
    expiresAt: null,
    approvalMode: APPROVAL_MODE_TEST_ARTIFACT_ONLY,
    safetySummary,
    blockers: [
      "explicit_human_approval_required_before_write_actions"
    ],
    nextStep
  });
}

export async function approveHumanAction({
  runDir,
  requestedAction,
  itemId = null,
  publisherId = null,
  packageSha256 = "",
  manifestVersion = null,
  note = "",
  allowWrite = false,
  safetySummary = {},
  approvedBy = os.userInfo().username
}) {
  const runContext = await readJson(artifactPath(runDir, "00_run_context.json"));
  const approvedAt = nowIso();

  return writeHumanApprovalArtifact({
    runDir,
    projectRoot: runContext.project_root,
    runId: runContext.run_id,
    requestedAction,
    actionScope: safeActionScope(requestedAction),
    itemId,
    publisherId,
    packageSha256,
    manifestVersion,
    approvalStatus: "approved",
    approvedBy,
    approvedAt,
    approvalSource: "local_cli",
    approvalNotes: note ?? "",
    expiresAt: addHours(approvedAt, APPROVAL_EXPIRY_HOURS),
    approvalMode: allowWrite ? APPROVAL_MODE_WRITE_ALLOWED : APPROVAL_MODE_TEST_ARTIFACT_ONLY,
    safetySummary,
    blockers: [],
    nextStep: allowWrite
      ? `${requestedAction} approved for write execution; a separate explicit write command is still required`
      : `${requestedAction} approval artifact created for testing only; rerun with --allow-write before any upload or publish`
  });
}

export function evaluateApprovalForAction({
  approvalArtifact,
  requestedAction,
  expectedScope,
  itemId,
  publisherId,
  packageSha256 = null,
  manifestVersion = null,
  requireWriteAllowed = true
}) {
  if (!approvalArtifact) {
    return {
      approved: false,
      reason: `Missing ${HUMAN_APPROVAL_ARTIFACT}; explicit human approval is required before ${requestedAction}.`,
      details: {
        approval_found: false,
        approval_mode: APPROVAL_MODE_TEST_ARTIFACT_ONLY,
        approval_write_authorized: false,
        blocked_reason: "write_approval_required"
      }
    };
  }

  if (approvalArtifact.approval_status !== "approved") {
    return {
      approved: false,
      reason: `${HUMAN_APPROVAL_ARTIFACT} approval_status=${approvalArtifact.approval_status}; explicit approval is required before ${requestedAction}.`,
      details: {
        approval_found: true,
        approval_mode: normalizeApprovalMode(approvalArtifact.approval_mode),
        approval_write_authorized: false,
        blocked_reason: "approval_not_approved"
      }
    };
  }

  if (approvalArtifact.requested_action !== requestedAction) {
    return {
      approved: false,
      reason: `${HUMAN_APPROVAL_ARTIFACT} requested_action=${approvalArtifact.requested_action}; expected ${requestedAction}.`,
      details: {
        approval_found: true,
        approval_mode: normalizeApprovalMode(approvalArtifact.approval_mode),
        approval_write_authorized: false,
        blocked_reason: "approval_action_mismatch"
      }
    };
  }

  if (approvalArtifact.action_scope !== expectedScope) {
    return {
      approved: false,
      reason: `${HUMAN_APPROVAL_ARTIFACT} action_scope=${approvalArtifact.action_scope}; expected ${expectedScope}.`,
      details: {
        approval_found: true,
        approval_mode: normalizeApprovalMode(approvalArtifact.approval_mode),
        approval_write_authorized: false,
        blocked_reason: "approval_scope_mismatch"
      }
    };
  }

  if (approvalArtifact.item_id && itemId && approvalArtifact.item_id !== itemId) {
    return {
      approved: false,
      reason: `${HUMAN_APPROVAL_ARTIFACT} item_id does not match the requested item.`,
      details: {
        approval_found: true,
        approval_mode: normalizeApprovalMode(approvalArtifact.approval_mode),
        approval_write_authorized: false,
        blocked_reason: "approval_item_mismatch"
      }
    };
  }

  if (approvalArtifact.publisher_id && publisherId && approvalArtifact.publisher_id !== publisherId) {
    return {
      approved: false,
      reason: `${HUMAN_APPROVAL_ARTIFACT} publisher_id does not match the requested publisher.`,
      details: {
        approval_found: true,
        approval_mode: normalizeApprovalMode(approvalArtifact.approval_mode),
        approval_write_authorized: false,
        blocked_reason: "approval_publisher_mismatch"
      }
    };
  }

  if (packageSha256 && approvalArtifact.package_sha256 && approvalArtifact.package_sha256 !== packageSha256) {
    return {
      approved: false,
      reason: `${HUMAN_APPROVAL_ARTIFACT} package_sha256 does not match the current sandbox validation package.`,
      details: {
        approval_found: true,
        approval_mode: normalizeApprovalMode(approvalArtifact.approval_mode),
        approval_write_authorized: false,
        blocked_reason: "approval_package_hash_mismatch"
      }
    };
  }

  if (manifestVersion && approvalArtifact.manifest_version && approvalArtifact.manifest_version !== manifestVersion) {
    return {
      approved: false,
      reason: `${HUMAN_APPROVAL_ARTIFACT} manifest_version does not match the current sandbox validation manifest version.`,
      details: {
        approval_found: true,
        approval_mode: normalizeApprovalMode(approvalArtifact.approval_mode),
        approval_write_authorized: false,
        blocked_reason: "approval_manifest_version_mismatch"
      }
    };
  }

  if (approvalArtifact.expires_at) {
    const expiry = new Date(approvalArtifact.expires_at);
    if (Number.isFinite(expiry.getTime()) && expiry.getTime() < Date.now()) {
      return {
        approved: false,
        reason: `${HUMAN_APPROVAL_ARTIFACT} approval expired at ${approvalArtifact.expires_at}.`,
        details: {
          approval_found: true,
          approval_mode: normalizeApprovalMode(approvalArtifact.approval_mode),
          approval_write_authorized: false,
          blocked_reason: "approval_expired"
        }
      };
    }
  }

  if (approvalArtifact.action_scope === "production") {
    return {
      approved: false,
      reason: "Production write approval artifacts are blocked by default.",
      details: {
        approval_found: true,
        approval_mode: normalizeApprovalMode(approvalArtifact.approval_mode),
        approval_write_authorized: false,
        blocked_reason: "production_scope_blocked"
      }
    };
  }

  if (requireWriteAllowed && normalizeApprovalMode(approvalArtifact.approval_mode) !== APPROVAL_MODE_WRITE_ALLOWED) {
    return {
      approved: false,
      reason: `${HUMAN_APPROVAL_ARTIFACT} approval_mode=${normalizeApprovalMode(approvalArtifact.approval_mode)}; write_allowed approval is required before ${requestedAction}.`,
      details: {
        approval_found: true,
        approval_mode: normalizeApprovalMode(approvalArtifact.approval_mode),
        approval_write_authorized: false,
        blocked_reason: "write_approval_required"
      }
    };
  }

  if (
    approvalArtifact.note_policy_blocked === true
    || approvalNoteContainsWriteBlocker(approvalArtifact.approval_notes, requestedAction)
  ) {
    return {
      approved: false,
      reason: `${HUMAN_APPROVAL_ARTIFACT} approval_notes contain a fail-safe write block.`,
      details: {
        approval_found: true,
        approval_mode: normalizeApprovalMode(approvalArtifact.approval_mode),
        approval_write_authorized: false,
        blocked_reason: "approval_note_blocks_write"
      }
    };
  }

  return {
    approved: true,
    reason: null,
    details: {
      approval_found: true,
      approval_mode: normalizeApprovalMode(approvalArtifact.approval_mode),
      approval_write_authorized: writeAuthorizationForApprovalArtifact(approvalArtifact),
      blocked_reason: null
    }
  };
}

export function sha256ForJson(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function ensureHumanApprovalDirectory(runDir) {
  await ensureDir(path.dirname(artifactPath(runDir, HUMAN_APPROVAL_ARTIFACT)));
}
