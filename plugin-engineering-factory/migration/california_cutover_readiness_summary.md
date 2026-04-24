# California Cutover Readiness

- Status: `blocked`
- SMTP independent verified: `true`
- Payment E2E verified: `true`
- `source=chrome_extension` verified: `true`
- California review-watch verified: `true`
- Selected SMTP provider: `resend`
- SMTP domain: `notify.915500.xyz`
- SMTP sender: `no-reply@notify.915500.xyz`
- SMTP port: `2587`

## Remaining Blockers

- `low_memory_server`
- `user_cutover_approval_missing`

## Risk Interpretation

- The user currently accepts `1GB + swap` as a temporary California risk, so `low_memory_server` is an acknowledged risk rather than a staging blocker.
- SMTP independent verification has passed. The remaining cutover blockers are `low_memory_server` and `user_cutover_approval_missing`.

## Resend SMTP Result

- `notify.915500.xyz` is verified in Resend.
- California Auth no longer uses the old relay.
- SEND_OTP, email delivery, VERIFY_OTP, session creation, get-entitlement, register-installation, 10 free consume-usage attempts, and the 11th `QUOTA_EXCEEDED` path are verified.
- DigitalOcean blocks outbound SMTP ports `465`, `587`, and `25` to Resend, so California uses Resend alternate port `2587`.

## Public DNS Snapshot

- `send.notify.915500.xyz` exposes the Resend SPF TXT record and feedback MX record.
- `resend._domainkey.notify.915500.xyz` exposes the Resend DKIM TXT record.
- `_dmarc.notify.915500.xyz` is not currently visible in public DNS and should be added for deliverability.

## Next Step

- Decide whether to approve formal DNS cutover. Do not cut DNS until the user explicitly approves.
