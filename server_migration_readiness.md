# Server Migration Readiness

## 1. Current External Domains

- `https://pay.915500.xyz`
- `https://pay-api.915500.xyz`
- `https://hwh.915500.xyz`
- `https://hwh-api.915500.xyz`
- `https://pancake.waffo.ai`

## 2. Env That Must Migrate

Public env:

- `SITE_URL`
- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `PRODUCT_KEY`
- `CHROME_EXTENSION_ID`

Secret env:

- `SUPABASE_SERVICE_ROLE_KEY`
- `WAFFO_MERCHANT_ID`
- `WAFFO_PRIVATE_KEY` or `WAFFO_PRIVATE_KEY_BASE64`
- `WAFFO_WEBHOOK_PUBLIC_KEY_TEST`
- `WAFFO_WEBHOOK_PUBLIC_KEY_PROD`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_ADMIN_EMAIL`
- `SMTP_SENDER_NAME`

Infra env:

- `API_EXTERNAL_URL`
- `SUPABASE_PUBLIC_URL`
- `ADDITIONAL_REDIRECT_URLS`
- `GOTRUE_MAILER_EXTERNAL_HOSTS`
- `ALLOWED_ORIGINS`
- `WAFFO_CHECKOUT_SUCCESS_URL`
- `WAFFO_CHECKOUT_CANCEL_URL`

## 3. Public Vs Secret Boundary

Public values may go into web builds and the extension:

- `SITE_URL`
- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`
- `PRODUCT_KEY`
- `PLAN_KEY`
- `FEATURE_KEY`

Secret values must stay server-side only:

- `SUPABASE_SERVICE_ROLE_KEY`
- `WAFFO_PRIVATE_KEY`
- merchant secret
- webhook secret
- `SMTP_PASS`

## 4. Product Catalog Migration

- Reapply `supabase/migrations`, especially `202604221730_leadfill_one_profile.sql`.
- Verify `leadfill-one-profile` remains the paid product and `chatgpt2obsidian` remains `legacy_test_only`.
- Do not create a paid weiwang product in this catalog unless its business model changes explicitly.

## 5. Waffo Webhook URL Switch

- Update Waffo Dashboard webhook target to the new API domain.
- Keep the path stable: `/functions/v1/waffo-webhook`.
- Re-test signature verification after every domain or certificate change.

## 6. Supabase Auth URL Switch

- Set `SITE_URL` to the new public site.
- Set `API_EXTERNAL_URL` and `SUPABASE_PUBLIC_URL` to the new API domain.
- Keep `ADDITIONAL_REDIRECT_URLS` aligned with web and extension targets.
- Keep `GOTRUE_MAILER_EXTERNAL_HOSTS` aligned with all public hostnames that may reach Auth.

## 7. SMTP Migration

- Replace `supabase-mail` with a real SMTP provider or a real relay service.
- Verify host DNS resolution from inside `supabase-auth`.
- Verify sender identity and mailbox permissions.
- Do not migrate without a test that confirms real inbox delivery.

## 8. Extension Config Migration

- Do not hardcode domains into runtime logic.
- Update only the config inputs:
  - `SITE_URL`
  - `PUBLIC_SUPABASE_URL`
  - `PUBLIC_SUPABASE_ANON_KEY`
  - `PRODUCT_KEY`
  - `PLAN_KEY`
- Keep tokens in background/service worker only.

## 9. E2E Tests To Re-run After Migration

1. `SEND_OTP` returns 200 and a real inbox receives the message.
2. `VERIFY_OTP` creates a usable Supabase session.
3. `get-entitlement` returns the expected free state for LeadFill.
4. `register-installation` succeeds for LeadFill.
5. `consume-usage` passes free 10 and blocks the 11th.
6. `create-checkout-session` returns a live Waffo checkout URL.
7. One Waffo test payment lands `order.completed`.
8. `processed_webhooks`, `webhook_events`, `orders`, `payments`, and `entitlements` update.
9. Payment-derived `get-entitlement` returns active Pro.
