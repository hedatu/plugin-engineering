import path from "node:path";
import { loadPortfolioRegistry, validatePortfolioRegistry } from "../src/portfolio/registry.mjs";

async function main() {
  const projectRoot = process.cwd();
  const registry = await loadPortfolioRegistry(projectRoot);
  await validatePortfolioRegistry(projectRoot, registry);
  console.log(`Portfolio registry is valid: ${path.join(projectRoot, "state", "portfolio_registry.json")}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
