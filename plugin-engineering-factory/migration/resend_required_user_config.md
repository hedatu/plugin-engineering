# Resend Required User Config

## Secure Env File

Provide one secure env file outside the repo for:

`npm run hwh:smtp-switch -- --server california --smtp-provider resend --env-file <secure-env-file>`

Required keys for the current switch script:

```env
SMTP_HOST=smtp.resend.com
SMTP_PORT=2587
SMTP_USER=resend
SMTP_PASSWORD=<RESEND_API_KEY>
SMTP_SENDER=no-reply@notify.915500.xyz
SMTP_SENDER_NAME=915500 Support
```

Notes:

- `SMTP_PASSWORD` should be the Resend API key when using SMTP relay.
- Do not store this file inside the repo.
- Do not send the raw API key in chat logs.

## Resend Dashboard Items

User still needs to confirm:

- domain created in Resend: `notify.915500.xyz`
- domain status in Resend: `verified`
- from email allowed by the verified domain: `no-reply@notify.915500.xyz`
- SMTP/API credential created and usable for SMTP relay

## Cloudflare DNS Items

If DNS is managed in Cloudflare, confirm the exact records shown by the Resend dashboard. The dashboard values win if they differ from public DNS observations.

Expected categories:

- SPF / return-path TXT record for `send.notify.915500.xyz`
- feedback / return-path MX record for `send.notify.915500.xyz`
- DKIM record for `resend._domainkey.notify.915500.xyz`
- DMARC TXT record for `_dmarc.notify.915500.xyz`

Current public DNS / Cloudflare status:

- `send.notify.915500.xyz` TXT: present
- `send.notify.915500.xyz` MX: present
- `resend._domainkey.notify.915500.xyz` TXT: present
- `_dmarc.notify.915500.xyz` TXT: not detected

Recommended user handoff items:

- Resend dashboard screenshot or proof that `notify.915500.xyz` is verified
- proof that SPF and DKIM are passing
- DMARC record added and visible in public DNS
- secure env file path kept outside the repo for future `hwh:smtp-switch` runs

## Port Note

- DigitalOcean blocks outbound SMTP ports `465`, `587`, and `25` from the California droplet to Resend.
- Resend alternate port `2587` is reachable and has passed California OTP E2E.
