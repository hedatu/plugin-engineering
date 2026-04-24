# Final California Cutover Checklist

## Current Passed Items

- California staging is reachable on `ca-hwh.915500.xyz` and `ca-hwh-api.915500.xyz` over HTTPS.
- HWH pay-site, pay-api, Supabase Auth/DB/Functions, and Waffo webhook are deployed on California staging.
- Resend SMTP is verified for `notify.915500.xyz` with sender `no-reply@notify.915500.xyz`.
- California Auth no longer depends on the old server SMTP relay.
- OTP E2E passed on Resend: SEND_OTP, email delivery, VERIFY_OTP, session creation, `get-entitlement`, `register-installation`, 10 free usage attempts, and 11th `QUOTA_EXCEEDED`.
- Waffo test-mode payment E2E passed: checkout session, paid webhook, signature verification, `orders` / `payments`, webhook-derived active entitlement, and Pro usage.
- Real `source=chrome_extension` E2E passed in staging.
- Review-watch is enabled on California in read-only mode; upload and publish remain disabled.
- Backups are recorded as completed and off-host backup is confirmed in the cutover gate.
- Rollback plan is marked ready.

## Current Risk Items

- `low_memory_server`: California is a 1GB RAM droplet with 2GB swap. User has accepted this as a temporary risk, but it remains visible in the gate.
- `_dmarc.notify.915500.xyz` is not currently detected. This is a deliverability recommendation, not a cutover blocker.
- DigitalOcean blocks outbound SMTP ports `465`, `587`, and `25` to Resend; California uses verified Resend alternate port `2587`.
- Formal DNS cutover still requires a separate final user approval.
- Production payment mode must remain disabled until separately approved and verified.
- Chrome Web Store upload/publish must remain disabled until separately approved.

## DNS Change Items

- Before cutover, set TTL to `300` if the DNS provider allows it.
- Update `pay.915500.xyz` A record to `134.199.226.198`.
- Update `pay-api.915500.xyz` A record to `134.199.226.198`.
- Keep `ca-hwh.915500.xyz` and `ca-hwh-api.915500.xyz` in place during the transition.
- Do not change Waffo live payment mode during this DNS cutover.
- Do not change Chrome Web Store listing or publish state during this DNS cutover.

## Verification Items

- Verify `https://pay.915500.xyz` returns the HWH frontend.
- Verify `https://pay-api.915500.xyz/auth/v1/settings` returns HTTP 200 with the public anon key.
- Verify `GET https://pay-api.915500.xyz/functions/v1/waffo-webhook` returns the expected 405 route-online response.
- Verify an unsigned POST to the webhook endpoint reaches the function and returns `INVALID_SIGNATURE`.
- Verify OTP login using Resend from the production hostnames.
- Verify `get-entitlement` for `productKey=leadfill-one-profile`.
- Verify `register-installation`.
- Verify `consume-usage` free quota path.
- Verify test-mode `create-checkout-session`.
- If Waffo test dashboard target is updated for the production hostnames, verify test webhook only. Do not run production payment.
- Verify plugin-site/static product pages and product catalog viewer remain reachable.
- Verify review-watch remains read-only and does not upload or publish.

## Rollback Items

- If frontend fails after DNS cutover, revert `pay.915500.xyz` to the old server A record.
- If API/Auth fails after DNS cutover, revert `pay-api.915500.xyz` to the old server A record.
- Keep old server running until 24-hour monitoring completes or until the old server expiry makes that impossible.
- Keep TTL at `300` during the observation window.
- Do not roll back by deleting California data.
- Do not stop California services during rollback unless explicitly required.
- After rollback, record the failure phase and preserve California logs for diagnosis.
