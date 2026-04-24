# HWH California Deploy Plan

## Objective
Rebuild the HWH commercial stack on California as the new primary target, then verify OTP, checkout, webhook, entitlement, and usage before any DNS cutover.

## Target Domains
- `pay.915500.xyz`
- `pay-api.915500.xyz`
- `https://pay.915500.xyz/checkout/success`
- `https://pay.915500.xyz/checkout/cancel`
- `https://pay-api.915500.xyz/functions/v1/waffo-webhook`

## Deploy Components
1. pay-site frontend
2. pay-api / Supabase gateway
3. Supabase Auth / Edge Functions / database runtime
4. Waffo webhook receiver
5. product catalog exposure for pay-site
6. entitlement and usage APIs
7. reverse proxy and HTTPS termination

## Required Configuration Principles
- Do not reuse the old placeholder `supabase-mail:2500` path.
- Start with a real SMTP provider or another verified reachable SMTP bridge.
- Use `pay.915500.xyz` and `pay-api.915500.xyz` from day one.
- Do not let auth emails or magic-link redirects fall back to `weiwang.915500.xyz`.
- Keep LeadFill and weiwang isolated by `productKey`.

## Product Isolation In New Environment
### LeadFill commercial
- `productKey=leadfill-one-profile`
- `planKey=lifetime`
- billing type: one-time
- price: `USD 19.00`
- feature key: `leadfill_fill_action`

### weiwang public welfare
- monetization disabled
- checkout disabled
- no paid entitlement dependency

## Verification Sequence Before DNS
1. Deploy pay-site and pay-api behind a temporary California test endpoint.
2. Verify `SEND_OTP` with a real mailbox.
3. Verify `VERIFY_OTP`, session creation, and `get-entitlement`.
4. Verify `register-installation`.
5. Verify `consume-usage` free quota.
6. Verify `create-checkout-session`.
7. Run Waffo test payment.
8. Verify webhook delivery and signature validation.
9. Verify `processed_webhooks`, `webhook_events`, `orders`, and `payments`.
10. Verify entitlement becomes `active`.
11. Verify `consume-usage` Pro branch.

## Current Known State
- Old environment SMTP/OTP is now repaired and verified.
- `create-checkout-session` is already verified.
- free quota and quota exceeded are already verified.
- Pro usage is verified only with manual active entitlement.
- Payment-derived webhook entitlement remains unverified and must be redone in California.

## Recommendation
- Migrate HWH directly to California because the old server is expiring.
- Do it as a staged rebuild with no DNS cutover until `migration/dns_cutover_gate.json` passes.
- Expect California either to be resized or to run only the core HWH services while heavier factory rendering stays elsewhere.
