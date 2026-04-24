# DNS Cutover Runbook

## Preconditions
- `migration/dns_cutover_gate.json` must be fully green.
- User approval is mandatory.
- TTL should be lowered to `300` before the cutover window.

## Cutover Steps
1. Confirm the final old-server backup and manifest are complete.
2. Confirm California pay-site health.
3. Confirm California pay-api health.
4. Confirm California OTP flow:
   - `SEND_OTP`
   - mailbox receipt
   - `VERIFY_OTP`
5. Confirm California checkout flow.
6. Confirm California Waffo test payment and webhook flow.
7. Update DNS records only after all checks pass.
8. Monitor logs and payment events for 24 hours.

## Rollback Steps
1. If OTP, checkout, webhook, or entitlement fails after cutover, revert DNS to old server targets.
2. Keep the old server online until the rollback window ends.
3. Re-verify public traffic on the old environment.
4. Record the incident and refresh the migration blockers.

## Rules
- Do not cut DNS early because the old server is expiring.
- Do not use `successUrl` as evidence of paid activation.
- Paid activation is valid only after webhook-derived entitlement is active.
