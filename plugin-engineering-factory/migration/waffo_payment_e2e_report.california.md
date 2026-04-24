# California Waffo Payment E2E

- Generated at: `2026-04-22T21:14:46.1861567+08:00`
- Result: `not_verified`

## Verified So Far

- California `create-checkout-session` returns a real Waffo test checkout session
- Latest California checkout session:
  - `session_id`: `cs_23d95ec9-103b-3059-b460-56c970690527`
  - `local_order_id`: `ord_1776863029773_c07ef4dc`

## Still Not Verified

- Completing the Waffo test payment against California
- Webhook delivery into California
- Signature validation on California
- `orders` / `payments` / `processed_webhooks` / `webhook_events` row creation on California
- Payment-derived entitlement activation on California
- Pro usage after webhook-derived paid entitlement

## Why It Is Blocked

- `ca-pay.915500.xyz` and `ca-pay-api.915500.xyz` still do not resolve publicly
- Waffo webhook validation needs a public HTTPS target
- Completing checkout before the staging webhook target is correct would risk writing the result into the wrong environment
