import path from "node:path";
import { loadManagedRunArtifact, runEventsDirectory, usesRunEventSidecars, writeManagedRunArtifact } from "../workflow/runEventArtifacts.mjs";
import { assertMatchesSchema } from "../utils/schema.mjs";
import {
  ensureDir,
  fileExists,
  nowIso,
  readJson,
  writeText
} from "../utils/io.mjs";
import {
  hasSecretLikeContent,
  inspectSecretLikeContent,
  redactSecretLikeValue
} from "../utils/redaction.mjs";

export function artifactPath(runDir, fileName) {
  return path.join(runDir, fileName);
}

export async function readOptionalJson(filePath) {
  if (!(await fileExists(filePath))) {
    return null;
  }
  return readJson(filePath);
}

export function normalizeRelativePath(projectRoot, absolutePath) {
  return path.relative(projectRoot, absolutePath).replaceAll("\\", "/");
}

export function sidecarStamp(occurredAt = nowIso()) {
  return `${occurredAt}`.replace(/[:.]/g, "-");
}

export function buildSafeReport(reportWithoutChecks) {
  const initialChecks = inspectSecretLikeContent(reportWithoutChecks);
  const redactionGuardTriggered = hasSecretLikeContent(initialChecks);
  const safeReport = redactSecretLikeValue(reportWithoutChecks);

  if (redactionGuardTriggered) {
    safeReport.status = "failed";
    safeReport.next_step = "remove secret-like content from review inputs and retry";
  }

  return {
    ...safeReport,
    redaction_checks: {
      ...inspectSecretLikeContent(safeReport),
      redaction_guard_triggered: redactionGuardTriggered
    }
  };
}

export async function validateArtifact(projectRoot, schemaName, label, data) {
  await assertMatchesSchema({
    data,
    schemaPath: path.join(projectRoot, "schemas", schemaName),
    label
  });
}

export async function writeManagedMarkdownArtifact({
  runDir,
  runContext,
  fileName,
  category,
  prefix,
  content,
  occurredAt = nowIso()
}) {
  if (await usesRunEventSidecars({ runDir, runContext })) {
    const baseDir = runEventsDirectory(runContext.project_root, runContext.run_id);
    const latestPath = path.join(baseDir, fileName);
    const eventPath = path.join(baseDir, category, `${prefix}-${sidecarStamp(occurredAt)}.md`);
    await ensureDir(path.dirname(eventPath));
    await writeText(eventPath, content);
    await writeText(latestPath, content);
    return {
      storage: "sidecar",
      artifactPath: latestPath,
      artifactRelativePath: normalizeRelativePath(runContext.project_root, latestPath),
      eventPath,
      eventRelativePath: normalizeRelativePath(runContext.project_root, eventPath)
    };
  }

  const targetPath = artifactPath(runDir, fileName);
  await writeText(targetPath, content);
  return {
    storage: "run",
    artifactPath: targetPath,
    artifactRelativePath: normalizeRelativePath(runContext.project_root, targetPath),
    eventPath: null,
    eventRelativePath: null
  };
}

export async function loadOptionalManagedArtifact({ runDir, artifactName, runContext = null }) {
  const loaded = await loadManagedRunArtifact({
    runDir,
    artifactName,
    runContext
  });
  return loaded?.data ?? null;
}

export async function writeManagedJsonArtifact({
  runDir,
  runContext,
  artifactName,
  data,
  occurredAt = nowIso()
}) {
  return writeManagedRunArtifact({
    runDir,
    artifactName,
    data,
    runContext,
    occurredAt
  });
}

export function markdownSection(title, body) {
  return `## ${title}\n\n${body}`.trim();
}

export function markdownList(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return "- none";
  }
  return items.map((item) => `- ${item}`).join("\n");
}
