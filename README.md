# Plugin Membership Platform

Cloudflare Pages frontend + Supabase backend + Waffo Pancake payment + Chrome Extension membership system.

## Current Status

This repository is now in the Waffo Pancake Test SDK integration stage.

Implemented in code:

- `create-checkout-session` is server-side only and requires Supabase user JWT.
- `create-checkout-session` now uses `@waffo/pancake-ts` authenticated checkout.
- `waffo-webhook` now verifies signatures with the official Waffo SDK.
- `/checkout/success` only polls `get-entitlement`.
- Membership activation is still webhook-driven only.
- `orders`, `payments`, `entitlements`, and `processed_webhooks` remain the core billing tables.

Not yet verified in reality:

- Real Waffo test checkout creation.
- Real Waffo test webhook delivery.
- Real payment success -> entitlement activation.

## Known Waffo Test Values

These values are not secrets and are already reflected in code and docs:

- `merchantId = MER_1rr8qw61O6jzcPhj4J00c9`
- `environment = test`
- `onetime productId = PROD_1LTEolO39KqxFSQLCXeAgR`
- `productType = onetime`
- `currency = USD`
- `successUrl = https://hwh.915500.xyz/checkout/success`
- `cancelUrl = https://hwh.915500.xyz/checkout/cancel`

Still missing or pending confirmation:

- Final Waffo Dashboard webhook registration after the remote function is deployed.
- Whether Waffo Dashboard test webhook events are enabled.
- Subscription product ID and pricing objects for `pro_monthly`.
- Real test webhook payload samples.
- Local private key is already placed at `supabase/WAFFO_PRIVATE_KEY.txt`, but it must not be committed or printed.

Current remote Supabase finding:

- The plugin membership system should use its own API domain: `https://hwh-api.915500.xyz`.
- The intended Waffo webhook URL is `https://hwh-api.915500.xyz/functions/v1/waffo-webhook`.
- Host-level Nginx reverse proxy and HTTPS for `hwh-api.915500.xyz` are live on `45.62.105.166`.
- `https://hwh-api.915500.xyz/auth/v1/health` now reaches Kong and returns `401 No API key found` when called without credentials.
- `https://hwh-api.915500.xyz/functions/v1/waffo-webhook` now reaches the deployed Edge Function and returns `405` on `GET`.

## Repo Layout

```text
apps/web                    React frontend
extensions/main-extension   Chrome MV3 extension
packages/extension-sdk      Shared types and extension SDK
supabase/config.toml        Supabase local config and function JWT policy
supabase/schema.sql         Schema snapshot
supabase/seed.sql           Seed data
supabase/migrations         Safe database migrations
supabase/functions          Edge Functions
docs                        Decisions, runbooks, env matrix, deployment checklist
```

## Environment Variables

Copy `.env.example` to a local env file as needed. Do not commit real secrets.

Public runtime variables:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SITE_URL=https://hwh.915500.xyz`
- `PRODUCT_KEY=leadfill-one-profile`
- `CHROME_EXTENSION_ID`

Supabase Secrets only:

- `SUPABASE_SERVICE_ROLE_KEY`
- `WAFFO_MERCHANT_ID`
- `WAFFO_PRIVATE_KEY`
- `WAFFO_PRIVATE_KEY_BASE64`
- `WAFFO_ENVIRONMENT=test`
- `WAFFO_ONETIME_PRODUCT_ID`
- `WAFFO_WEBHOOK_PUBLIC_KEY_TEST`
- `WAFFO_WEBHOOK_PUBLIC_KEY_PROD`
- `WAFFO_CHECKOUT_SUCCESS_URL=https://hwh.915500.xyz/checkout/success`
- `WAFFO_CHECKOUT_CANCEL_URL=https://hwh.915500.xyz/checkout/cancel`
- `ALLOWED_ORIGINS=https://hwh.915500.xyz,https://pay.915500.xyz,chrome-extension://<your-extension-id>`

Important:

- Never expose `SUPABASE_SERVICE_ROLE_KEY` to the frontend.
- Never expose `WAFFO_PRIVATE_KEY` or `WAFFO_PRIVATE_KEY_BASE64` to the frontend or extension.
- The Chrome extension must not contain Waffo merchant secrets.

## Local Development

Install dependencies:

```bash
npm install
```

Run the web app:

```bash
npm run dev:web
```

Build the extension:

```bash
npm run build:extension
```

Run workspace typecheck and build:

```bash
npm run typecheck
npm run build
```

Supabase helper scripts:

```bash
npm run supabase:start
npm run supabase:functions:serve
```

Do not use `npm run supabase:db:reset` against a linked remote project.

## Waffo Checkout Flow

`create-checkout-session` currently works like this:

1. Require authenticated Supabase user.
2. Read the selected plan from `public.plans`.
3. Read `waffo_product_id_*`, `waffo_product_type_*`, and local currency from that plan row.
4. Create a local `checkout_sessions` record first.
5. Call `client.checkout.authenticated.create()` from `@waffo/pancake-ts`.
6. Return only:
   - `checkoutUrl`
   - `sessionId`
   - `localOrderId`

Notes:

- Buyer identity passed to Waffo is the current Supabase `user.id`.
- Buyer email is pre-filled from the current Supabase user email when available.
- Metadata includes:
  - `userId`
  - `productKey`
  - `planKey`
  - `localOrderId`
  - `source`
  - `localCheckoutSessionId`
  - `installationId`
  - `environment`
- The SDK checkout API exposes `successUrl`.
- `cancelUrl` is kept in local metadata and docs, but is not sent to the SDK because the official SDK type surface does not currently expose a `cancelUrl` parameter.

## Waffo Webhook Flow

`waffo-webhook` currently works like this:

1. Read `request.text()` first.
2. Read `x-waffo-signature`.
3. Parse raw JSON only after the raw string has been captured.
4. Resolve mode from payload (`test` or `prod`).
5. Verify the raw body with the official SDK and the mode-specific public key.
6. Return `401` on verification failure.
7. Deduplicate using the SDK delivery record ID `event.id`.
8. Process billing updates into:
   - `orders`
   - `payments`
   - `subscriptions`
   - `entitlements`

Event handling:

- `order.completed`: one-time / lifetime entitlement activation
- `subscription.activated`: reserved and implemented for subscription activation
- `subscription.payment_succeeded`: reserved and implemented for subscription renewals
- `refund.succeeded`: reserved and implemented for revoke / downgrade logic

Success page behavior:

- `/checkout/success` does not activate membership.
- It only polls `get-entitlement`.
- Webhook remains the only source of truth for paid entitlement activation.

## Database Notes

Current Waffo-related plan mapping fields:

- `waffo_product_id_test`
- `waffo_product_id_prod`
- `waffo_product_type_test`
- `waffo_product_type_prod`
- `waffo_plan_id_test`
- `waffo_plan_id_prod`
- `waffo_price_id_test`
- `waffo_price_id_prod`

Local seed now maps:

- `leadfill-one-profile / free` -> `10` lifetime fills
- `leadfill-one-profile / lifetime` -> `$19` one-time unlock
- `chatgpt2obsidian` -> retained as `legacy_test_only`

## Supabase Deployment

See the detailed checklist here:

- [env-matrix.md](/D:/code/鏀粯缃戠珯璁捐妯″潡/plugin-membership-supabase-waffo-design/docs/env-matrix.md)
- [supabase-deploy-checklist.md](/D:/code/鏀粯缃戠珯璁捐妯″潡/plugin-membership-supabase-waffo-design/docs/supabase-deploy-checklist.md)
- [waffo-test-runbook.md](/D:/code/鏀粯缃戠珯璁捐妯″潡/plugin-membership-supabase-waffo-design/docs/waffo-test-runbook.md)
- [waffo-payload-mapping.md](/D:/code/鏀粯缃戠珯璁捐妯″潡/plugin-membership-supabase-waffo-design/docs/waffo-payload-mapping.md)

High-level safe rollout:

```bash
ssh bwg-166
cd /opt/supabase-project
# apply the repo migration/function deployment flow without remote db reset
```

## Manual Configuration Still Needed

- Fill real Supabase Secrets.
- Fill remote `plans` rows for any non-test or subscription products.
- Configure `https://hwh-api.915500.xyz/functions/v1/waffo-webhook` in Waffo Dashboard.
- Enable Waffo test webhook events if not already enabled.
- Confirm how Waffo wants cancel behavior configured when using the current SDK checkout API.

## Verification Status

Verified in this turn:

- SDK package shape inspected from npm package contents.
- Official webhook dedupe guidance confirmed from SDK webhook guide.
- Host Nginx reverse proxy for `hwh-api.915500.xyz` is live.
- Remote `waffo-webhook` target path is `/functions/v1/waffo-webhook`.
- `hwh.915500.xyz` and `hwh-api.915500.xyz` both resolve to `45.62.105.166`.
- Current upstream `/functions/v1/waffo-webhook` probe returns `405 METHOD_NOT_ALLOWED` on `GET` and is ready for signed webhook tests.

Unverified in this turn:

- Real checkout session creation against Waffo test environment.
- Real webhook delivery from Waffo.
- Real end-to-end payment success.


