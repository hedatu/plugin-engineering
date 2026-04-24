import { DEFAULT_SERVER_INVENTORY_ROOT, runServerInventory } from "../src/server/inventory.mjs";
import { parseArgs } from "../src/utils/io.mjs";

async function main() {
  const args = parseArgs(process.argv);
  const inventory = await runServerInventory({
    projectRoot: process.cwd(),
    inventoryRoot: args["inventory-root"] || DEFAULT_SERVER_INVENTORY_ROOT
  });
  console.log(JSON.stringify(inventory, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

