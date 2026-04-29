import { getEntitlement } from "./quotaStore.js";

export async function refreshEntitlement() {
  // V0.2 is local prototype only. Website/backend entitlement will be connected
  // after this plugin is added to the HWH product catalog.
  return getEntitlement();
}
