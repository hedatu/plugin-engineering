import path from "node:path";
import { inspectOpportunityBacklog } from "../src/discovery/opportunityBacklog.mjs";

async function main() {
  const projectRoot = process.cwd();
  const summary = await inspectOpportunityBacklog(projectRoot);
  console.log(JSON.stringify({
    path: path.join(projectRoot, "state", "opportunity_backlog.json"),
    ...summary
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
