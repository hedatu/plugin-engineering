# Resend Domain Status - California

- Domain: `notify.915500.xyz`
- Sender: `no-reply@notify.915500.xyz`
- Resend domain exists: `true`
- Resend domain verified: `true`
- DMARC present: `false`

## Cloudflare Upserts

- deleted duplicate suffix record: MX send.notify.notify.915500.xyz
- deleted duplicate suffix record: TXT resend._domainkey.notify.notify.915500.xyz
- deleted duplicate suffix record: TXT send.notify.notify.915500.xyz
- created: TXT resend._domainkey.notify.915500.xyz
- created: MX send.notify.915500.xyz
- created: TXT send.notify.915500.xyz

## Current SMTP Target

- Expected host: `smtp.resend.com`
- Expected port: `2587`
- Expected user: `resend`
- Expected sender: `no-reply@notify.915500.xyz`

## Warnings

- `dmarc_record_not_detected`

## Public DNS

- `send.notify.915500.xyz` TXT is visible via `1.1.1.1` and `8.8.8.8`.
- `send.notify.915500.xyz` MX is visible via `1.1.1.1` and `8.8.8.8`.
- `resend._domainkey.notify.915500.xyz` TXT is visible via `1.1.1.1` and `8.8.8.8`.
- `_dmarc.notify.915500.xyz` TXT is not detected.

## Blockers

- none
