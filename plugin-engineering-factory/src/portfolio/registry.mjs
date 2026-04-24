import crypto from "node:crypto";
import path from "node:path";
import { listLedgerEntryIdsForRun } from "../publish/releaseLedger.mjs";
import { assertMatchesSchema } from "../utils/schema.mjs";
import { ensureDir, fileExists, nowIso, readJson, writeJson } from "../utils/io.mjs";

export const PORTFOLIO_REGISTRY_PATH = path.join("state", "portfolio_registry.json");

function absoluteRegistryPath(projectRoot) {
  return path.join(projectRoot, PORTFOLIO_REGISTRY_PATH);
}

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function intersection(left, right) {
  const rightSet = new Set(right ?? []);
  return unique((left ?? []).filter((value) => rightSet.has(value)));
}

export function defaultPortfolioRegistry() {
  return {
    stage: "PORTFOLIO_REGISTRY",
    status: "passed",
    generated_at: nowIso(),
    last_updated_run_id: null,
    active_wedge_families: [],
    blocked_candidate_ids: [],
    items: [],
    blacklist_updates: [],
    known_bad_patterns: [],
    product_revision_history: [],
    overlap_updates: [],
    archetype_priors: {},
    scoring_weight_suggestions: []
  };
}

export async function validatePortfolioRegistry(projectRoot, data) {
  await assertMatchesSchema({
    data,
    schemaPath: path.join(projectRoot, "schemas", "portfolio_registry.schema.json"),
    label: PORTFOLIO_REGISTRY_PATH
  });
}

export async function loadPortfolioRegistry(projectRoot) {
  const registryPath = absoluteRegistryPath(projectRoot);
  if (!(await fileExists(registryPath))) {
    const initialized = defaultPortfolioRegistry();
    await ensureDir(path.dirname(registryPath));
    await validatePortfolioRegistry(projectRoot, initialized);
    await writeJson(registryPath, initialized);
    return initialized;
  }

  const current = await readJson(registryPath);
  const normalized = {
    ...defaultPortfolioRegistry(),
    ...current,
    items: current.items ?? current.released_items ?? [],
    known_bad_patterns: current.known_bad_patterns ?? [],
    product_revision_history: current.product_revision_history ?? []
  };
  await validatePortfolioRegistry(projectRoot, normalized);
  return normalized;
}

export function summarizePortfolioRegistry(registry) {
  const items = registry.items ?? [];
  return {
    path: PORTFOLIO_REGISTRY_PATH,
    active_wedge_families: unique(items.map((item) => item.family).filter(Boolean)),
    blocked_candidate_ids: unique((registry.blacklist_updates ?? []).map((item) => item.candidate_id).filter(Boolean)),
    known_bad_patterns: registry.known_bad_patterns ?? [],
    product_revision_history: registry.product_revision_history ?? [],
    archetype_priors: registry.archetype_priors ?? {},
    item_count: items.length
  };
}

export function computeRegistryCandidateAdjustments(candidate, registry) {
  const items = registry.items ?? [];
  const candidateTags = unique([...(candidate.signals ?? []), candidate.wedge_family]);
  const overlapHits = [];

  for (const item of items) {
    const sharedTags = intersection(candidateTags, item.overlap_tags ?? []);
    if (sharedTags.length === 0 && item.family !== candidate.wedge_family) {
      continue;
    }
    const penalty = Math.min(18, sharedTags.length * 3 + (item.family === candidate.wedge_family ? 4 : 0));
    overlapHits.push({
      item_id: item.item_id,
      run_id: item.run_id,
      shared_tags: sharedTags,
      penalty
    });
  }

  const overlapPenalty = Math.min(18, overlapHits.reduce((sum, item) => sum + item.penalty, 0));
  const prior = registry.archetype_priors?.[candidate.wedge_family] ?? {
    score_multiplier: 1
  };
  const blacklistPenalty = (registry.blacklist_updates ?? [])
    .filter((item) => item.active !== false && item.wedge_family === candidate.wedge_family)
    .reduce((sum, item) => sum + (item.penalty ?? 8), 0);

  return {
    overlap_penalty: overlapPenalty,
    overlap_hits: overlapHits,
    archetype_prior_multiplier: typeof prior.score_multiplier === "number" ? prior.score_multiplier : 1,
    blacklist_penalty: Math.min(18, blacklistPenalty)
  };
}

function healthStatusForRegistry(monitoringSnapshot) {
  if (!monitoringSnapshot) {
    return "unobserved";
  }
  return monitoringSnapshot.health_status ?? (monitoringSnapshot.status === "skipped" ? "monitoring_skipped" : "unknown");
}

function publishStateForRegistry({ publishPlan, publishExecution, reviewStatus }) {
  if (reviewStatus?.current_dashboard_state) {
    return reviewStatus.current_dashboard_state;
  }
  if (publishExecution?.publish_response?.body?.state) {
    return publishExecution.publish_response.body.state;
  }
  return publishPlan?.publish_intent ?? "unknown";
}

function knownIssuesForRegistry({ policyGate, monitoringSnapshot, learningUpdate }) {
  return unique([
    ...(policyGate?.issues ?? []),
    ...(policyGate?.manual_review_items ?? []),
    ...((monitoringSnapshot?.reviews_summary?.top_topics ?? []).map((item) => item.topic)),
    ...((monitoringSnapshot?.support_summary?.top_topics ?? []).map((item) => item.topic)),
    ...(learningUpdate?.reviewer_notes ?? [])
  ]);
}

function deriveBlacklistUpdates({ selectedReport, reviewStatus, monitoringSnapshot }) {
  const updates = [];
  if (reviewStatus?.is_rejected) {
    updates.push({
      candidate_id: selectedReport?.selected_candidate_id ?? null,
      wedge_family: selectedReport?.candidate?.wedge_family ?? null,
      reason: "review_rejected",
      penalty: 12,
      active: true,
      updated_at: nowIso()
    });
  }
  if (monitoringSnapshot?.health_status === "unhealthy") {
    updates.push({
      candidate_id: selectedReport?.selected_candidate_id ?? null,
      wedge_family: selectedReport?.candidate?.wedge_family ?? null,
      reason: "low_health_status",
      penalty: 10,
      active: true,
      updated_at: nowIso()
    });
  }
  return updates;
}

function deriveArchetypePriors(items) {
  const grouped = new Map();
  for (const item of items) {
    if (!item.family) {
      continue;
    }
    if (!grouped.has(item.family)) {
      grouped.set(item.family, []);
    }
    grouped.get(item.family).push(item);
  }

  return Object.fromEntries(
    [...grouped.entries()].map(([family, familyItems]) => {
      let multiplier = 1;
      if (familyItems.some((item) => item.latest_review_state === "REJECTED")) {
        multiplier = 0.75;
      } else if (familyItems.some((item) => item.latest_health_status === "unhealthy")) {
        multiplier = 0.85;
      } else if (familyItems.some((item) => item.latest_review_state === "DRAFT")) {
        multiplier = 0.95;
      }

      return [family, {
        score_multiplier: multiplier,
        item_count: familyItems.length,
        last_updated_at: nowIso()
      }];
    })
  );
}

function hashValue(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function registryEntryIdForItem(existing, itemId, runId) {
  if (existing?.registry_entry_id) {
    return existing.registry_entry_id;
  }
  return `registry-${hashValue({ itemId, runId }).slice(0, 12)}`;
}

export async function updatePortfolioRegistryForRun({
  projectRoot,
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
  const registry = await loadPortfolioRegistry(projectRoot);
  const items = [...(registry.items ?? [])];
  const candidate = selectedReport?.candidate ?? null;
  const itemId = publishExecution?.item_id
    ?? (runContext.run_type === "sandbox_validation" || runContext.task_mode === "sandbox_validation"
      ? runContext.publish?.sandbox_item_id ?? `sandbox:${runContext.run_id}`
      : `draft:${runContext.run_id}`);
  let existingIndex = items.findIndex((item) => item.run_id === runContext.run_id);
  if (existingIndex < 0) {
    const preserveHistoricalSandboxRuns = (runContext.run_type ?? runContext.task_mode) === "sandbox_validation";
    existingIndex = preserveHistoricalSandboxRuns
      ? -1
      : items.findIndex((item) => item.item_id === itemId);
  }
  const existing = existingIndex >= 0 ? items[existingIndex] : null;
  const ledgerEntryIds = await listLedgerEntryIdsForRun(projectRoot, {
    runId: runContext.run_id,
    itemId
  });
  const nextItem = {
    registry_entry_id: registryEntryIdForItem(existing, itemId, runContext.run_id),
    item_id: itemId,
    run_id: runContext.run_id,
    source_run_id: runContext.source_run_id ?? null,
    run_type: runContext.run_type ?? runContext.task_mode ?? "daily",
    created_at: existing?.created_at ?? nowIso(),
    archetype: plan?.archetype ?? candidate?.wedge_family ?? null,
    wedge: brief?.product_name_working ?? candidate?.name ?? null,
    target_user: brief?.target_user ?? null,
    permissions: plan?.permissions ?? [],
    host_permissions: [],
    publish_intent: publishPlan?.publish_intent ?? null,
    publish_state: publishStateForRegistry({ publishPlan, publishExecution, reviewStatus }),
    latest_review_state: reviewStatus?.current_dashboard_state ?? null,
    latest_health_status: healthStatusForRegistry(monitoringSnapshot),
    known_issues: knownIssuesForRegistry({ policyGate, monitoringSnapshot, learningUpdate }),
    known_product_risks: existing?.known_product_risks ?? [],
    product_acceptance_status: existing?.product_acceptance_status ?? "not_reviewed",
    revision_required: existing?.revision_required ?? false,
    blocked_from_publish_until_acceptance_passed: existing?.blocked_from_publish_until_acceptance_passed ?? false,
    revision_resolved: existing?.revision_resolved ?? false,
    next_product_step: existing?.next_product_step ?? null,
    overlap_tags: unique([...(candidate?.signals ?? []), candidate?.wedge_family]),
    family: candidate?.wedge_family ?? plan?.archetype ?? null,
    screenshots_manifest_hash: screenshotManifest ? hashValue(screenshotManifest) : "",
    package_sha256: publishExecution?.package_sha256 ?? "",
    manifest_version: publishExecution?.manifest_version ?? null,
    ledger_entry_ids: ledgerEntryIds,
    learning_updates: learningUpdate ?? {
      release_health_summary: monitoringSnapshot?.health_status ?? "not_collected",
      blacklist_updates: [],
      overlap_updates: [],
      archetype_priors: {},
      scoring_weight_suggestions: [],
      reviewer_notes: [],
      should_pause_similar_builds: false,
      should_prioritize_followup: false
    }
  };

  if (existingIndex >= 0) {
    items.splice(existingIndex, 1, nextItem);
  } else {
    items.push(nextItem);
  }

  const derivedBlacklistUpdates = deriveBlacklistUpdates({ selectedReport, reviewStatus, monitoringSnapshot });
  const blacklistUpdates = unique([
    ...(registry.blacklist_updates ?? []).map((item) => JSON.stringify(item)),
    ...derivedBlacklistUpdates.map((item) => JSON.stringify(item)),
    ...((learningUpdate?.blacklist_updates ?? []).map((item) => JSON.stringify(item)))
  ]).map((item) => JSON.parse(item));

  const overlapUpdates = unique([
    ...(registry.overlap_updates ?? []).map((item) => JSON.stringify(item)),
    ...((learningUpdate?.overlap_updates ?? []).map((item) => JSON.stringify(item)))
  ]).map((item) => JSON.parse(item));

  const scoringWeightSuggestions = unique([
    ...(registry.scoring_weight_suggestions ?? []).map((item) => JSON.stringify(item)),
    ...((learningUpdate?.scoring_weight_suggestions ?? []).map((item) => JSON.stringify(item)))
  ]).map((item) => JSON.parse(item));

  const updated = {
    stage: "PORTFOLIO_REGISTRY",
    status: "passed",
    generated_at: nowIso(),
    last_updated_run_id: runContext.run_id,
    active_wedge_families: unique(items.map((item) => item.family)),
    blocked_candidate_ids: unique(blacklistUpdates.map((item) => item.candidate_id).filter(Boolean)),
    items,
    blacklist_updates: blacklistUpdates,
    known_bad_patterns: registry.known_bad_patterns ?? [],
    product_revision_history: registry.product_revision_history ?? [],
    overlap_updates: overlapUpdates,
    archetype_priors: deriveArchetypePriors(items),
    scoring_weight_suggestions: scoringWeightSuggestions
  };

  await validatePortfolioRegistry(projectRoot, updated);
  await ensureDir(path.dirname(absoluteRegistryPath(projectRoot)));
  await writeJson(absoluteRegistryPath(projectRoot), updated);
  return updated;
}

export async function recordKnownBadPattern(projectRoot, pattern) {
  const registry = await loadPortfolioRegistry(projectRoot);
  const knownBadPatterns = [
    ...(registry.known_bad_patterns ?? [])
  ];

  knownBadPatterns.push({
    recorded_at: nowIso(),
    ...pattern
  });

  const updated = {
    ...registry,
    generated_at: nowIso(),
    known_bad_patterns: knownBadPatterns
  };

  await validatePortfolioRegistry(projectRoot, updated);
  await ensureDir(path.dirname(absoluteRegistryPath(projectRoot)));
  await writeJson(absoluteRegistryPath(projectRoot), updated);
  return updated;
}

export async function updateRegistryItemByRunId(projectRoot, runId, updater) {
  const registry = await loadPortfolioRegistry(projectRoot);
  const items = [...(registry.items ?? [])];
  const itemIndex = items.findIndex((item) => item.run_id === runId);
  if (itemIndex < 0) {
    throw new Error(`No portfolio registry item found for run ${runId}.`);
  }

  const nextItem = updater({ ...items[itemIndex] });
  items.splice(itemIndex, 1, nextItem);

  const updated = {
    ...registry,
    generated_at: nowIso(),
    items,
    active_wedge_families: unique(items.map((item) => item.family).filter(Boolean)),
    blocked_candidate_ids: unique((registry.blacklist_updates ?? []).map((item) => item.candidate_id).filter(Boolean))
  };

  await validatePortfolioRegistry(projectRoot, updated);
  await ensureDir(path.dirname(absoluteRegistryPath(projectRoot)));
  await writeJson(absoluteRegistryPath(projectRoot), updated);
  return updated;
}

export async function appendProductRevisionHistory(projectRoot, record) {
  const registry = await loadPortfolioRegistry(projectRoot);
  const updated = {
    ...registry,
    generated_at: nowIso(),
    product_revision_history: [
      ...(registry.product_revision_history ?? []),
      {
        recorded_at: nowIso(),
        ...record
      }
    ]
  };

  await validatePortfolioRegistry(projectRoot, updated);
  await ensureDir(path.dirname(absoluteRegistryPath(projectRoot)));
  await writeJson(absoluteRegistryPath(projectRoot), updated);
  return updated;
}
