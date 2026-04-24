# Final Cutover Command Plan

This plan is manual. Do not execute DNS changes without final user approval.

## Manual DNS Changes

- Confirm final user approval for DNS cutover.
- Confirm old server A records are recorded for rollback.
- Set TTL to `300` for `pay.915500.xyz` and `pay-api.915500.xyz` if possible.
- Change `pay.915500.xyz` A record to `134.199.226.198`.
- Change `pay-api.915500.xyz` A record to `134.199.226.198`.
- Keep `ca-hwh.915500.xyz` and `ca-hwh-api.915500.xyz` unchanged.

## HTTP Health Checks

Run after DNS propagation starts:

```powershell
Resolve-DnsName pay.915500.xyz -Type A
Resolve-DnsName pay-api.915500.xyz -Type A
curl.exe -I https://pay.915500.xyz
curl.exe -I https://pay-api.915500.xyz/auth/v1/settings
curl.exe -i https://pay-api.915500.xyz/functions/v1/waffo-webhook
```

Expected:

- `pay.915500.xyz` resolves to `134.199.226.198`.
- `pay-api.915500.xyz` resolves to `134.199.226.198`.
- Frontend returns HTTP 200 or a normal app response.
- Auth settings endpoint returns HTTP 200 when called with the public anon key.
- Waffo webhook GET returns 405, meaning route is online.

## OTP / Checkout / Webhook Checks

- Use only test mode for checkout and Waffo.
- Run SEND_OTP from `https://pay.915500.xyz`.
- Confirm the email is delivered by Resend from `no-reply@notify.915500.xyz`.
- Confirm email links use `pay.915500.xyz` / `pay-api.915500.xyz`, not `weiwang`.
- Run VERIFY_OTP and confirm session creation.
- Call `get-entitlement` for `productKey=leadfill-one-profile`.
- Call `register-installation`.
- Call `consume-usage` for free quota.
- Call `create-checkout-session` in test mode and confirm a Waffo sandbox checkout URL.
- If Waffo test dashboard webhook target is changed for cutover smoke only, verify `https://pay-api.915500.xyz/functions/v1/waffo-webhook`.
- Do not switch Waffo to live mode.
- Do not execute production payment.

## Plugin-Site Checks

- Verify product catalog viewer loads from California.
- Verify generated plugin pages load from California.
- Verify LeadFill product page uses `productKey=leadfill-one-profile`.
- Verify `weiwang` remains free-only and is not tied to LeadFill entitlement.
- Verify release ledger and backlog reader remain read-only.
- Verify review-watch logs update in read-only mode.
- Confirm automatic Chrome Web Store upload and publish remain disabled.

## Stop Conditions

- Stop if DNS does not resolve to `134.199.226.198` after expected TTL.
- Stop if frontend returns TLS or 5xx errors.
- Stop if Auth/OTP fails.
- Stop if webhook route does not respond with expected 405 for GET or `INVALID_SIGNATURE` for unsigned POST.
- Stop if any code path attempts live payment.
- Stop if any process attempts Chrome upload or publish.
