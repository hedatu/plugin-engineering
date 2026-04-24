# Environment Variable Matrix

## Scope Summary

This project has three practical scopes:

1. Public runtime variables for `apps/web`.
2. Public runtime variables for the Chrome extension package.
3. Supabase Secrets for Edge Functions only.

Never expose Waffo merchant private keys or Supabase service role keys to the frontend or extension.

## Public Runtime Variables

| Variable | Used By | Required | Example | Notes |
| --- | --- | --- | --- | --- |
| `SITE_URL` | web, extension | yes | `https://hwh.915500.xyz` | Official site URL. |
| `PUBLIC_SUPABASE_URL` | web build | yes | `https://hwh-api.915500.xyz` | `apps/web` reads this exact name. Use the isolated API domain for this project. |
| `PUBLIC_SUPABASE_ANON_KEY` | web build | yes | `<anon key>` | `apps/web` reads this exact name. |
| `SUPABASE_URL` | extension and function alias | recommended | `https://hwh-api.915500.xyz` | Keep aligned with `PUBLIC_SUPABASE_URL`. |
| `SUPABASE_ANON_KEY` | extension and function alias | recommended | `<anon key>` | Keep aligned with `PUBLIC_SUPABASE_ANON_KEY`. |
| `PRODUCT_KEY` | web, extension | optional | `leadfill-one-profile` | Defaults to `leadfill-one-profile`. Legacy `chatgpt2obsidian` is test-only. |
| `CHROME_EXTENSION_ID` | extension | optional | `<your-extension-id>` | Used for allowlists and packaging docs. |

## Supabase Secrets Only

These values belong in Supabase Secrets and nowhere else.

| Variable | Required | Example | Notes |
| --- | --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | `<service role key>` | Required by membership, payment, and installation writes. |
| `WAFFO_MERCHANT_ID` | yes | `MER_1rr8qw61O6jzcPhj4J00c9` | Safe to document, but still keep it server-side for consistency. |
| `WAFFO_PRIVATE_KEY` | yes, unless base64 variant used | `<pem>` | Must never be readable by web or extension code. |
| `WAFFO_PRIVATE_KEY_BASE64` | optional alternative | `<base64 pem>` | Supported as an alternative to raw PEM secret. |
| `WAFFO_ENVIRONMENT` | yes | `test` | Preferred environment variable name in current code. |
| `WAFFO_ENV` | optional compatibility alias | `test` | Still accepted for backward compatibility. |
| `WAFFO_API_BASE_URL` | optional | `https://api.waffo.ai` | Override only if Waffo provides a different base URL. |
| `WAFFO_ONETIME_PRODUCT_ID` | optional deploy helper | `PROD_1LTEolO39KqxFSQLCXeAgR` | Useful for manual SQL or seed validation. Runtime checkout reads plan mapping from the database. |
| `WAFFO_WEBHOOK_PUBLIC_KEY_TEST` | optional | `<public key pem>` | Current project-specific secret name. Use for explicit key pinning or rotation. |
| `WAFFO_WEBHOOK_PUBLIC_KEY_PROD` | optional | `<public key pem>` | Current project-specific secret name. Use for explicit key pinning or rotation. |
| `WAFFO_WEBHOOK_TEST_PUBLIC_KEY` | optional official alias | `<public key pem>` | Supported for compatibility with SDK docs naming. |
| `WAFFO_WEBHOOK_PROD_PUBLIC_KEY` | optional official alias | `<public key pem>` | Supported for compatibility with SDK docs naming. |
| `WAFFO_CHECKOUT_SUCCESS_URL` | yes | `https://hwh.915500.xyz/checkout/success` | Default success redirect used by `create-checkout-session`. |
| `WAFFO_CHECKOUT_CANCEL_URL` | yes | `https://hwh.915500.xyz/checkout/cancel` | Stored locally and documented, but current SDK checkout API does not expose a `cancelUrl` parameter. |
| `ALLOWED_ORIGINS` | yes | `https://hwh.915500.xyz,chrome-extension://<your-extension-id>` | Used by Edge Function CORS handling. |
| `SUPABASE_PROJECT_REF` | optional local helper | `<project-ref>` | Not used by the current self-hosted Supabase deployment. |

## Self-Hosted Auth SMTP

For the current self-hosted Supabase Auth deployment, OTP email delivery depends on the server-side `.env` values below.

| Variable | Required | Recommended Value | Notes |
| --- | --- | --- | --- |
| `SMTP_HOST` | yes | `<your real SMTP host>` | Must be a real reachable SMTP host. `supabase-mail` is only valid if a matching mail container/service exists. |
| `SMTP_PORT` | yes | `<your SMTP port>` | Common values are `465`, `587`, or provider-specific SMTP ports. |
| `SMTP_USER` | yes | `<your SMTP username>` | Usually the mailbox address or provider-issued SMTP username. |
| `SMTP_PASS` | yes | `<your SMTP password or app password>` | Keep server-side only. Never expose it to web, extension, logs, or docs with real content. |
| `SMTP_ADMIN_EMAIL` | yes | `support@915500.xyz` | Sender/admin mailbox used by Supabase Auth. |
| `SMTP_SENDER_NAME` | yes | `915500 Support` | Human-readable sender name for OTP emails. |
| `SITE_URL` | yes | `https://hwh.915500.xyz` | Should match the public payment/member website. |
| `API_EXTERNAL_URL` | yes | `https://hwh-api.915500.xyz` | Should match the public API/webhook domain for this isolated project. |
| `ADDITIONAL_REDIRECT_URLS` | yes | `https://hwh.915500.xyz/*,chrome-extension://<your-extension-id>/*` | Allow both web and extension redirect targets. |
| `ENABLE_EMAIL_SIGNUP` | yes | `true` | Keeps OTP email login enabled. |
| `ENABLE_EMAIL_AUTOCONFIRM` | recommended | `true` | Keeps email OTP flow simple during current test stage. |

## Actual Resolution Rules In Code

Current code behavior:

- `apps/web` reads `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, and `SITE_URL`.
- Edge Functions accept either `PUBLIC_SUPABASE_URL` or `SUPABASE_URL`.
- Edge Functions accept either `PUBLIC_SUPABASE_ANON_KEY` or `SUPABASE_ANON_KEY`.
- Waffo mode accepts either `WAFFO_ENVIRONMENT` or `WAFFO_ENV`.
- Waffo private key accepts either:
  - `WAFFO_PRIVATE_KEY`
  - `WAFFO_PRIVATE_KEY_BASE64`
- Waffo webhook public keys accept either:
  - `WAFFO_WEBHOOK_PUBLIC_KEY_TEST` / `WAFFO_WEBHOOK_PUBLIC_KEY_PROD`
  - `WAFFO_WEBHOOK_TEST_PUBLIC_KEY` / `WAFFO_WEBHOOK_PROD_PUBLIC_KEY`

Recommended deployment practice:

| Logical Value | Set These Variables |
| --- | --- |
| Supabase URL | `PUBLIC_SUPABASE_URL` and `SUPABASE_URL` |
| Supabase anon key | `PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_ANON_KEY` |
| Waffo test environment | `WAFFO_ENVIRONMENT=test` |

Current real deployment target:

- `PUBLIC_SUPABASE_URL=https://hwh-api.915500.xyz`
- `SUPABASE_URL=https://hwh-api.915500.xyz`
- Waffo webhook URL should be `https://hwh-api.915500.xyz/functions/v1/waffo-webhook`
- `api.915500.xyz` must not be used by this project.

## Security Rules

- `WAFFO_PRIVATE_KEY` and `WAFFO_PRIVATE_KEY_BASE64` must only live in Supabase Secrets.
- `WAFFO_PRIVATE_KEY` must never be written into:
  - frontend source
  - extension source
  - README examples with real content
  - test output
  - committed SQL
- `SUPABASE_SERVICE_ROLE_KEY` must never be readable by client code.
- Chrome extension content scripts must not directly hold merchant secrets.

## Function Auth Policy

JWT policy from `supabase/config.toml`:

| Function | JWT Required |
| --- | --- |
| `create-checkout-session` | yes |
| `get-entitlement` | yes |
| `consume-usage` | yes |
| `register-installation` | yes |
| `waffo-webhook` | no |

`waffo-webhook` stays unauthenticated at the Supabase entrypoint and establishes trust with:

- raw body verification
- `x-waffo-signature`
- timestamp tolerance
- mode-specific public key selection
- idempotent dedupe in `processed_webhooks`

Official SDK note:

- `@waffo/pancake-ts` includes built-in test/prod webhook public keys.
- Current project now prefers explicit env keys when provided, but does not hard-require them for verification.

Current blocker:

- Self-hosted Supabase Auth is still configured with `SMTP_HOST=supabase-mail`, but there is no `supabase-mail` Docker service/container on the current server.
- Current shared self-hosted Auth `.env` still points `SITE_URL` and `API_EXTERNAL_URL` at `https://weiwang.915500.xyz`. This was left unchanged during the `hwh` cutover to avoid breaking the other project before OTP redirect behavior is re-verified.


