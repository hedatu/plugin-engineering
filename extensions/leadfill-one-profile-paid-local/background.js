import { installMembershipBackgroundHandlers } from "./monetization/membershipClient.js";

installMembershipBackgroundHandlers().catch((error) => {
  console.error("Membership background init failed:", error.message);
});
