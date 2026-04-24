import path from "node:path";
import { loadPortfolioRegistry } from "../src/portfolio/registry.mjs";

async function main() {
  const projectRoot = process.cwd();
  const registry = await loadPortfolioRegistry(projectRoot);
  const summary = {
    path: path.join(projectRoot, "state", "portfolio_registry.json"),
    item_count: registry.items.length,
    active_wedge_families: registry.active_wedge_families,
    blocked_candidate_ids: registry.blocked_candidate_ids,
    known_bad_patterns_count: (registry.known_bad_patterns ?? []).length,
    archetype_prior_keys: Object.keys(registry.archetype_priors ?? {})
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
