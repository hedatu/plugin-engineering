# SMTP Independence Plan

## Recommendation

- recommended_provider: Resend
- reason: the user selected Resend for the California blocker-removal path, `notify.915500.xyz` is verified in Resend, and California Auth OTP E2E has passed without the old SMTP relay.

## What The User Needs To Prepare

- sending_domain: `notify.915500.xyz`
- from_email: `no-reply@notify.915500.xyz`
- smtp_host: `smtp.resend.com`
- smtp_port: `2587`
- smtp_user: `resend`
- smtp_password_or_api_key: Resend API key used as SMTP password
- dns_records: exact SPF, MX, and DKIM records shown by the Resend dashboard, plus a DMARC record for `_dmarc.notify.915500.xyz`

## Current Public DNS Observation

- `send.notify.915500.xyz` resolves with the Resend SPF TXT record and feedback MX record.
- `resend._domainkey.notify.915500.xyz` resolves with the Resend DKIM TXT record.
- `_dmarc.notify.915500.xyz` is not currently visible in public DNS.
- `notify.915500.xyz` is verified in Resend.

## California Cutover Steps

1. Create the provider account and verify the sending domain.
2. Store provider SMTP credentials in a secure env file outside the repo.
3. Run `npm run hwh:smtp-switch -- --server california --smtp-provider resend --env-file <secure-env-file>`.
4. Re-run SEND_OTP and VERIFY_OTP against California staging with a real mailbox.
5. OTP passed on the independent provider, so `california_smtp_still_depends_on_old_server_relay` has been removed from the DNS cutover blockers.

## Completed Result

- California Auth has been switched from the old relay to Resend.
- The old relay dependency is removed.
- SEND_OTP, email delivery, VERIFY_OTP, session creation, get-entitlement, register-installation, 10 free usage attempts, and 11th-attempt `QUOTA_EXCEEDED` are verified.
- DigitalOcean blocks outbound SMTP ports `465`, `587`, and `25` to Resend; port `2587` is the verified working Resend port for this droplet.

## Why Not Keep The Old Relay

- California no longer points SMTP at the old server relay on `45.62.xxx.xxx:2500`.
- If the old server expires, California OTP should continue working through Resend.
- Formal DNS cutover still remains blocked until the user explicitly approves.
