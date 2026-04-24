# Waffo Dashboard Webhook Checklist

Manual confirmation is still required because the repo and runtime cannot read the Waffo dashboard directly.

Observed from California:
- `https://ca-hwh-api.915500.xyz/functions/v1/waffo-webhook` is routable and returns `401 INVALID_SIGNATURE` for a valid unsigned POST.
- California received one Waffo-signed webhook on 2026-04-23 01:26:21 UTC, but it was a generic dashboard verification event from `[TEST] Store` with product name `[TEST] Webhook Verification`.
- That event did not contain LeadFill order metadata and did not create `orders`, `payments`, or `entitlements`.

Please verify in the Waffo dashboard:
1. The active environment is `test` / `sandbox`, not `live`.
2. The actual LeadFill store or merchant webhook URL is `https://ca-hwh-api.915500.xyz/functions/v1/waffo-webhook`.
3. The actual LeadFill success URL is `https://ca-hwh.915500.xyz/checkout/success`.
4. The actual LeadFill cancel URL is `https://ca-hwh.915500.xyz/checkout/cancel`.
5. The checkout product / price used by the session maps to `leadfill-one-profile` / `lifetime` / `USD 19.00` / `onetime`.
6. Recent checkout session metadata includes:
   - `productKey=leadfill-one-profile`
   - `planKey=lifetime`
   - `localOrderId`
   - `userId`
   - `installationId`
   - `source`
7. The dashboard delivery log shows a delivery attempt for the real paid order, not only the generic webhook verification ping.
8. If Waffo supports resend, resend the real `order.completed` event for the LeadFill sandbox order after confirming the target URL.
9. If there are separate app-level and store-level webhook settings, confirm the LeadFill checkout is using the same one that now points at `ca-hwh-api`.

Do not treat `successUrl` alone as proof of entitlement. California should only unlock Pro after the real paid webhook creates `orders`, `payments`, and an `active` entitlement.
