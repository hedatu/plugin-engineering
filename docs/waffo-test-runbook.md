# Waffo Test Runbook

## Goal

Move the project from "Waffo placeholders exist" to "Supabase + Waffo Test checkout and webhook are ready for real joint testing".

This document does not claim real payment success. Anything not actually executed remains `unverified`.

## Known Non-Secret Test Values

- `merchantId = MER_1rr8qw61O6jzcPhj4J00c9`
- `environment = test`
- `productId = PROD_1LTEolO39KqxFSQLCXeAgR`
- `productType = onetime`
- `currency = USD`
- `successUrl = https://hwh.915500.xyz/checkout/success`
- `cancelUrl = https://hwh.915500.xyz/checkout/cancel`

## Still Missing Or Pending Confirmation

- Waffo Dashboard registration of the deployed webhook URL after TLS is corrected.
- Whether Waffo Dashboard test webhook events are enabled.
- Subscription product mapping for `pro_monthly`.
- Real test webhook payload samples.
- Current SDK handling for cancel redirects.

## Preconditions

- Real Supabase project exists.
- Current project API domain should be isolated at `https://hwh-api.915500.xyz`.
- `hwh.915500.xyz` is already live.
- Supabase schema has been pushed with the latest migrations.
- Edge Functions are deployed.
- Supabase Secrets are configured.
- `public.plans` contains Waffo test mapping for `lifetime` and `one_time_test`.
- `hwh-api.915500.xyz` already resolves to `45.62.105.166`.
- `https://hwh-api.915500.xyz` must present a valid certificate before real external webhook testing.
- Upstream `/functions/v1/waffo-webhook` currently returns `405` on `GET`, which confirms the route is live.

## Required Secrets

At minimum:

- `SUPABASE_SERVICE_ROLE_KEY`
- `WAFFO_MERCHANT_ID`
- `WAFFO_PRIVATE_KEY` or `WAFFO_PRIVATE_KEY_BASE64`
- `WAFFO_ENVIRONMENT=test`
- `WAFFO_WEBHOOK_PUBLIC_KEY_TEST`
- `WAFFO_CHECKOUT_SUCCESS_URL=https://hwh.915500.xyz/checkout/success`
- `WAFFO_CHECKOUT_CANCEL_URL=https://hwh.915500.xyz/checkout/cancel`
- `ALLOWED_ORIGINS=https://hwh.915500.xyz,chrome-extension://<your-extension-id>`

## Required Plan Mapping

Check remote `public.plans`:

| plan_key | expected billing_type | expected test product id | expected product type |
| --- | --- | --- | --- |
| `lifetime` | `onetime` | `PROD_1LTEolO39KqxFSQLCXeAgR` | `onetime` |
| `one_time_test` | `onetime` | `PROD_1LTEolO39KqxFSQLCXeAgR` | `onetime` |

## Deployment Commands

```powershell
supabase login
supabase db push
supabase secrets set --env-file supabase/.env.waffo.local
supabase functions deploy create-checkout-session
supabase functions deploy get-entitlement
supabase functions deploy consume-usage
supabase functions deploy register-installation
supabase functions deploy waffo-webhook --no-verify-jwt
```

Webhook target for Waffo Dashboard after deploy:

```text
https://hwh-api.915500.xyz/functions/v1/waffo-webhook
```

## Test Flow

### 1. Login

1. Open `/login`.
2. Sign in with Supabase OTP.
3. Open `/account`.
4. Confirm the current plan is still free before payment.

### 2. Create Checkout

1. Open `/pricing`.
2. Choose `lifetime` or `one_time_test`.
3. Trigger `create-checkout-session`.
4. Check `checkout_sessions`:
   - `local_order_id` exists
   - `status = opened`
   - `waffo_session_id` exists
   - metadata contains `userId`, `productKey`, `planKey`, `localOrderId`, `source`

### 3. Open Waffo Checkout

1. Use the returned `checkoutUrl`.
2. Confirm the checkout opens in Waffo Test.
3. Complete a test payment.

Important:

- Do not treat `/checkout/success` as the proof of activation.
- Membership activation must still come from webhook processing.

### 4. Verify Webhook

Check `processed_webhooks`:

- `signature_valid = true`
- `processed_at` is not null
- dedupe key is the SDK delivery record ID `event.id`

Optional audit mirror:

- `webhook_events`

### 5. Verify Billing Writes

Check:

- `orders`
- `payments`
- `entitlements`

Focus fields:

- `orders.waffo_order_id`
- `orders.merchant_provided_buyer_identity`
- `orders.order_metadata`
- `payments.waffo_payment_id`
- `entitlements.status`
- `entitlements.plan_id`

### 6. Verify Frontend State

1. Open `/checkout/success`.
2. Confirm it only polls `get-entitlement`.
3. Open `/account`.
4. Confirm paid status appears only after webhook processing has completed.

## Troubleshooting

### `create-checkout-session` fails

Check:

- `WAFFO_MERCHANT_ID`
- `WAFFO_PRIVATE_KEY` or `WAFFO_PRIVATE_KEY_BASE64`
- `WAFFO_CHECKOUT_SUCCESS_URL`
- plan row has `waffo_product_id_test`
- plan row has `waffo_product_type_test`

### Webhook verification fails

Check:

- `x-waffo-signature` header exists
- payload mode is actually `test`
- `hwh-api.915500.xyz` certificate matches the hostname being called
- `WAFFO_WEBHOOK_PUBLIC_KEY_TEST` matches Waffo Test dashboard if explicit key pinning is used
- raw body is read with `request.text()` before any JSON parsing logic

### Entitlement does not update

Check:

- `processed_webhooks.processed_at`
- `orders` row exists
- `payments` row exists for `order.completed`
- metadata includes `userId`, `productKey`, `planKey`, `localOrderId`
- `merchantProvidedBuyerIdentity` matches the Supabase user ID

## Current Verification Status

- SDK package inspection: verified
- Official webhook dedupe guidance: verified
- Host Nginx reverse proxy for `hwh-api.915500.xyz`: verified
- Intended Waffo webhook URL: verified
- DNS and HTTPS on `hwh-api.915500.xyz`: verified
- Current upstream webhook `405 METHOD_NOT_ALLOWED` on `GET`: verified
- Real checkout creation: unverified
- Real webhook delivery: unverified
- Real paid entitlement activation: unverified


