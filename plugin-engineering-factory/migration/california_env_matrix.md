# California Environment Matrix

## Public Runtime Config
These values may appear in frontend apps or extension config.

| Variable | Target Value | Consumer |
| --- | --- | --- |
| `SITE_URL` | `https://pay.915500.xyz` | pay-site frontend, auth links |
| `API_EXTERNAL_URL` | `https://pay-api.915500.xyz` | reverse proxy, auth, API clients |
| `PUBLIC_SUPABASE_URL` | `https://pay-api.915500.xyz` | extension background/service worker, pay-site frontend |
| `PUBLIC_SUPABASE_ANON_KEY` | injected at deploy time | extension background/service worker, pay-site frontend |
| `PRODUCT_KEY` | `leadfill-one-profile` | extension config, pay-site config |
| `PLAN_KEY` | `lifetime` | extension config, checkout flow |
| `SUCCESS_URL` | `https://pay.915500.xyz/checkout/success` | checkout redirect |
| `CANCEL_URL` | `https://pay.915500.xyz/checkout/cancel` | checkout redirect |

## Server-Side Secret Config
These values must stay only in server env files or secret storage.

| Variable | Purpose | Secret |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | privileged API and webhook writes | yes |
| `WAFFO_PRIVATE_KEY` | Waffo checkout creation / server auth | yes |
| `WAFFO_WEBHOOK_SECRET` | webhook signature verification | yes |
| `SMTP_HOST` | real SMTP provider host | yes |
| `SMTP_PORT` | SMTP port | no, but server-only |
| `SMTP_USER` | SMTP auth username | yes |
| `SMTP_PASSWORD` | SMTP auth password | yes |
| `SMTP_SENDER` | sender identity | no, but server-only |
| `DATABASE_URL` | Postgres connection | yes |

## Auth-Specific Config
- `GOTRUE_SITE_URL=https://pay.915500.xyz`
- `GOTRUE_URI_ALLOW_LIST` must include:
  - `https://pay.915500.xyz/*`
  - `https://pay-api.915500.xyz/*`
  - `chrome-extension://*/*`
- `GOTRUE_MAILER_EXTERNAL_HOSTS` should include:
  - `pay.915500.xyz`
  - `pay-api.915500.xyz`

## Product Isolation Rules
- LeadFill commercial product:
  - `PRODUCT_KEY=leadfill-one-profile`
  - `PLAN_KEY=lifetime`
  - `FEATURE_KEY=leadfill_fill_action`
- weiwang public welfare project:
  - no paid plan
  - no checkout
  - no paid entitlement dependency
- legacy `chatgpt2obsidian` remains test-only and must not be reused for LeadFill.
