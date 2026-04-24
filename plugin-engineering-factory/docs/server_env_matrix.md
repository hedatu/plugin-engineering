# Server Environment Matrix

## Chrome Web Store

| Variable | Public or secret | Used by | Notes |
| --- | --- | --- | --- |
| `CHROME_WEB_STORE_PUBLISHER_ID` | secret-ish server config | factory, review-watch | server-side only |
| `CHROME_WEB_STORE_SANDBOX_ITEM_ID` | secret-ish server config | factory, review-watch | server-side only |
| `GOOGLE_APPLICATION_CREDENTIALS` | secret | review-watch, publish status | path to service-account file outside repo |
| `CHROME_WEB_STORE_SERVICE_ACCOUNT_JSON` | secret | review-watch, publish status | only if file path is not used |

## Proxy

| Variable | Public or secret | Used by | Notes |
| --- | --- | --- | --- |
| `CWS_HTTPS_PROXY` | secret-ish infra config | review-watch | optional |
| `CWS_HTTP_PROXY` | secret-ish infra config | review-watch | optional |
| `HTTPS_PROXY` | secret-ish infra config | server processes | optional |
| `HTTP_PROXY` | secret-ish infra config | server processes | optional |
| `NO_PROXY` | infra config | server processes | optional |

## HWH Public Config

| Variable | Public or secret | Used by | Notes |
| --- | --- | --- | --- |
| `SITE_URL` | public | plugin-site, extension | public |
| `PUBLIC_SUPABASE_URL` | public | extension, plugin-site | public |
| `PUBLIC_SUPABASE_ANON_KEY` | public | extension, plugin-site | public anon key only |
| `PRODUCT_KEY` | public | extension | `leadfill-one-profile` for LeadFill |
| `PLAN_KEY` | public | extension | `lifetime` for LeadFill |

## HWH Secret Config

| Variable | Public or secret | Used by | Notes |
| --- | --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | HWH server only | never in extension |
| `WAFFO_PRIVATE_KEY` | secret | HWH server only | never in extension |
| `WAFFO_WEBHOOK_SECRET` | secret | webhook handler only | never in extension |
| `SMTP_HOST` | secret-ish infra config | auth server | server-side only |
| `SMTP_PORT` | secret-ish infra config | auth server | server-side only |
| `SMTP_USER` | secret | auth server | server-side only |
| `SMTP_PASSWORD` | secret | auth server | server-side only |
| `DATABASE_URL` | secret | HWH server only | server-side only |

## Policy Rules

- `.env.server.example` contains placeholders only.
- Public config and secret config must stay separated.
- The extension may only consume public config.
- `successUrl` is not proof of membership activation.
- Paid unlock still depends on webhook-confirmed entitlement.
- `LeadFill` and `未忘 / weiwang` must remain isolated by product key and monetization rules.

