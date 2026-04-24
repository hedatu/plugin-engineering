# Server Expiry Risk Plan

## Current Situation
- The old HWH server is close to expiry.
- Exact expiry date still needs to be filled in by the user.
- California is the intended new primary server.
- Singapore is backup and staging only.

## Latest Practical Recommendation
- Move directly toward California as the new HWH primary target.
- Do not cut DNS until California OTP, checkout, webhook, entitlement, and usage are all verified.

## What To Do If OTP Is Not Ready Before Expiry
- Prioritize California SMTP and OTP validation first.
- If needed, migrate pay-site static pages first, but keep payment flows clearly marked as not ready.
- Do not claim commercial launch readiness until webhook-derived entitlement is verified.

## What To Do If Waffo Webhook Is Not Ready Before Expiry
- Keep public payment cutover blocked.
- Continue with plugin-site and read-only factory migration separately.
- Preserve old server snapshots or dumps for rollback and reference.

## Release Impact
- Commercial public launch should remain paused until California payment E2E passes.
- No Chrome Web Store upload or publish should be coupled to this migration phase.

## Capacity Risk
- California currently has `1 GB` RAM.
- If the combined factory plus HWH stack shows memory pressure, resize California or split services before final public cutover.
