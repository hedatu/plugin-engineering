import { loadOpportunityBacklog, validateOpportunityBacklog } from "../src/discovery/opportunityBacklog.mjs";

async function main() {
  const projectRoot = process.cwd();
  const backlog = await loadOpportunityBacklog(projectRoot);
  await validateOpportunityBacklog(projectRoot, backlog);
  console.log(JSON.stringify({
    path: "state/opportunity_backlog.json",
    status: "passed",
    total_opportunities: backlog.opportunities.length
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
