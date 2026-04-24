# California SMTP Independence

- Provider: `resend`
- Status: `verified_independent`
- Old relay dependency removed: `true`
- Current blocker: none for SMTP
- Current live SMTP host: `smtp.resend.com`
- Current live SMTP port: `2587`
- Current sender: `no-reply@notify.915500.xyz`

## Applied Resend SMTP

- `SMTP_HOST=smtp.resend.com`
- `SMTP_PORT=2587`
- `SMTP_USER=resend`
- `SMTP_PASSWORD=<RESEND_API_KEY>`
- `SMTP_SENDER=no-reply@notify.915500.xyz`

## Verification

- `notify.915500.xyz` is verified in Resend.
- SEND_OTP returned HTTP 200.
- The OTP email was delivered.
- VERIFY_OTP returned HTTP 200 and created a session.
- `get-entitlement` succeeded for `leadfill-one-profile`.
- `register-installation` succeeded.
- `consume-usage` allowed 10 free attempts and returned `QUOTA_EXCEEDED` on the 11th attempt.

## Port Note

- DigitalOcean blocked outbound SMTP ports `465`, `587`, and `25` to `smtp.resend.com`.
- Resend alternate port `2587` is reachable from California and passed the Auth OTP E2E.
- DMARC for `_dmarc.notify.915500.xyz` is still recommended, but SMTP independence is verified.
