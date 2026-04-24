# Waffo LeadFill Dashboard Verification Checklist

Use this checklist to confirm the Waffo test configuration that produced the verified California staging payment.

## Known good runtime evidence

- Verified paid order localOrderId: `ord_1776912964691_ddb727d5`
- Verified checkout session: `cs_6566cb90-062e-0f9d-7863-39203265e517`
- Verified paid webhook event: `PAY_0adLohkJYNiExote8KDSWQ`
- Observed webhook event type: `order.completed`
- Effective webhook target that received the paid event: `https://ca-hwh-api.915500.xyz/functions/v1/waffo-webhook`
- Success URL used by checkout creation: `https://ca-hwh.915500.xyz/checkout/success`
- Cancel URL used by checkout creation: `https://ca-hwh.915500.xyz/checkout/cancel`
- Product mapping: `productKey=leadfill-one-profile`, `planKey=lifetime`, `billingType=onetime`, `price=USD 19.00`

## Dashboard fields to confirm manually

1. Confirm the active Waffo environment is `test` or `sandbox`, not `live`.
2. Confirm the store or app used by the latest LeadFill checkout matches the same test store as the verified checkout URL path under `pancake.waffo.ai/store/...`.
3. Confirm the LeadFill lifetime product mapping matches the verified runtime trace:
   `productKey=leadfill-one-profile`
   `planKey=lifetime`
   `billingType=onetime`
   `price=USD 19.00`
4. Confirm the configured webhook URL is exactly `https://ca-hwh-api.915500.xyz/functions/v1/waffo-webhook`.
5. Confirm the configured success URL is exactly `https://ca-hwh.915500.xyz/checkout/success`.
6. Confirm the configured cancel URL is exactly `https://ca-hwh.915500.xyz/checkout/cancel`.
7. Confirm the recent successful sandbox payment has a webhook delivery attempt for the paid event, not only a generic verification ping.
8. Confirm the delivery log for the paid event shows a `200` response, or record the exact HTTP status and response body if it does not.
9. If Waffo supports resend, note the resend entrypoint for the latest paid `order.completed` event so the team can retry without creating a new checkout.

## Metadata fields expected on paid checkout sessions

- `productKey=leadfill-one-profile`
- `planKey=lifetime`
- `localOrderId`
- `userId`
- `source`
- `installationId`

## Important note

The dashboard UI itself was not scraped automatically in this run. The webhook target is considered operationally confirmed because a real paid `order.completed` event reached `ca-hwh-api`, verified signature, and wrote `orders`, `payments`, and purchase-derived `entitlements`.
