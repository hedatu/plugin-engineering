# Server Services Plan

## Planned Services

| Service | Purpose | First enabled phase | Enable on California now? | Enable on Singapore now? |
| --- | --- | --- | --- | --- |
| `factory-worker` | discovery, build, QA, packaging, registry maintenance | 3 | yes | no |
| `review-watch` | read-only Chrome Web Store review polling every 6 hours | 3 | yes | no |
| `plugin-site` | static product pages, pricing pages, product catalog pages | 4 | yes | no |
| `reverse-proxy` | HTTPS routing for factory dashboard, plugin-site, future pay site | 4 | later | no |
| `backup-job` | replicate artifacts and audit files to Singapore / object storage | 3 | yes | receive only |
| `hwh-pay-api` / Supabase / Edge Functions | auth, entitlement, checkout, webhook | 5 | not yet | not yet |

## Factory Worker Scope

`factory-worker` may run:

- discovery queue jobs
- build and QA
- premium packaging
- listing package generation
- product catalog maintenance

`factory-worker` must not run without explicit approval:

- sandbox upload
- sandbox publish
- production upload
- production publish
- automatic final publish

## Review-Watch

Allowed:

- read-only Chrome Web Store `fetchStatus`
- state update for watcher diagnostics
- schedule every 6 hours

Not allowed:

- upload
- publish
- cancel review automatically

## Plugin-Site

Serves:

- plugin detail page
- pricing page
- product catalog index
- generated screenshots or static asset links

Does not imply:

- live payment cutover
- live checkout readiness

## HWH Migration Readiness

Before HWH can run on California:

- SMTP design for the new host must be defined and tested.
- Auth redirect URLs must be revalidated on the new domains.
- Waffo test payment must be re-run after migration prep.
- Webhook, orders, payments, and payment-derived entitlement must all be verified.

Historical blocker snapshot from earlier HWH notes:

- SMTP / OTP not verified
- `SEND_OTP` HTTP `500`
- Auth pointed at `supabase-mail:2500`
- Waffo test payment not verified
- webhook / orders / payments not verified
- payment-derived entitlement not verified

Current planning status on `2026-04-22`:

- OTP was repaired on the existing host later that day.
- HWH is still blocked for migration because payment and webhook E2E remain incomplete.

## Backup Job Scope

Back up:

- `state/`
- `runs/`
- `generated/`
- `release_ledger`
- `product_catalog`
- store release packages and Remotion assets

Do not back up with the same job:

- raw secrets
- `.env` files containing secrets
- service-account private key material

