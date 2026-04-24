# Supabase Deploy Checklist

This checklist prepares the real Supabase project for Waffo Pancake Test integration without using remote `db reset`.

## Safety Rules

- Do not run remote `supabase db reset`.
- Use `supabase db push` for remote schema rollout.
- Use `supabase functions deploy` for Edge Functions.
- Deploy `waffo-webhook` with `--no-verify-jwt`.
- Waffo signature verification must happen inside the function.
- `/checkout/success` must never activate membership directly.

## 1. Local Tooling Prerequisites

Expected commands:

```powershell
supabase --version
deno --version
```

Current local blocker status in this workspace:

- `supabase` CLI: not available in PATH
- `deno`: not available in PATH

## 2. Login And Link

```powershell
supabase login
```

Note:

- The current project should use the isolated API domain `https://hwh-api.915500.xyz`, not `weiwang.915500.xyz` and not `*.supabase.co`.
- `supabase link --project-ref ...` is an official-cloud workflow and is not the primary path for this server.
- Use the server deployment flow for `/opt/supabase-project` instead of inventing a cloud project ref.

## 3. Push Safe Migrations

Current migration set includes the Waffo SDK alignment migration:

- `202604210001_initial_schema.sql`
- `202604210002_waffo_test_alignment.sql`
- `202604210003_waffo_sdk_checkout.sql`

Apply them safely:

```powershell
supabase db push
```

## 4. Prepare Secrets File

Create a local untracked file at:

`supabase/.env.waffo.local`

Recommended contents:

```dotenv
PUBLIC_SUPABASE_URL=https://hwh-api.915500.xyz
SUPABASE_URL=https://hwh-api.915500.xyz
PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
WAFFO_MERCHANT_ID=MER_1rr8qw61O6jzcPhj4J00c9
WAFFO_PRIVATE_KEY=<pem>
WAFFO_PRIVATE_KEY_BASE64=
WAFFO_ENVIRONMENT=test
WAFFO_ENV=test
WAFFO_API_BASE_URL=https://api.waffo.ai
WAFFO_ONETIME_PRODUCT_ID=PROD_1LTEolO39KqxFSQLCXeAgR
WAFFO_WEBHOOK_PUBLIC_KEY_TEST=
WAFFO_WEBHOOK_PUBLIC_KEY_PROD=
WAFFO_CHECKOUT_SUCCESS_URL=https://hwh.915500.xyz/checkout/success
WAFFO_CHECKOUT_CANCEL_URL=https://hwh.915500.xyz/checkout/cancel
ALLOWED_ORIGINS=https://hwh.915500.xyz,chrome-extension://<your-extension-id>
```

Then load secrets:

```powershell
supabase secrets set --env-file supabase/.env.waffo.local
```

## 5. Deploy Edge Functions

Deploy the Waffo-related functions explicitly:

```powershell
supabase functions deploy create-checkout-session
supabase functions deploy get-entitlement
supabase functions deploy consume-usage
supabase functions deploy register-installation
supabase functions deploy waffo-webhook --no-verify-jwt
```

Minimum required by this SDK integration phase:

```powershell
supabase functions deploy create-checkout-session
supabase functions deploy waffo-webhook --no-verify-jwt
```

## 6. JWT Strategy

| Function | JWT Policy | Why |
| --- | --- | --- |
| `create-checkout-session` | require JWT | Checkout creation must be bound to the authenticated user. |
| `get-entitlement` | require JWT | Success page and extension status checks are user-scoped. |
| `consume-usage` | require JWT | Quota deduction is user-scoped. |
| `register-installation` | require JWT | Installation registration is user-scoped. |
| `waffo-webhook` | no JWT | Waffo server cannot provide a Supabase user JWT. |

## 7. Remote Data Requirements

After `db push`, verify remote `public.plans` rows:

- `lifetime`
- `one_time_test`

Expected test mapping:

- `waffo_product_id_test = PROD_1LTEolO39KqxFSQLCXeAgR`
- `waffo_product_type_test = onetime`
- `currency = USD`
- `billing_type = onetime`

If `pro_monthly` will be tested later, its subscription mapping still needs real Waffo product data.

## 8. Webhook Expectations

`waffo-webhook` now uses the official SDK verification path.

Runtime expectations:

- Read `request.text()` first.
- Read `x-waffo-signature`.
- Resolve payload mode.
- Verify raw body with the mode-specific public key.
- Return `401` on verification failure.
- Deduplicate by SDK delivery record ID `event.id`.
- Use `orderMetadata` and `merchantProvidedBuyerIdentity` to resolve local billing context.
- Update `orders`, `payments`, `subscriptions`, and `entitlements`.

Key behavior:

- If explicit Waffo webhook public keys are provided in Secrets, the function uses them.
- If they are not provided, the SDK can fall back to its built-in test/prod public keys.

## 9. Post-Deploy Validation

After deploy, validate in this order:

1. Authenticated `get-entitlement` call works.
2. Authenticated `create-checkout-session` returns:
   - `checkoutUrl`
   - `sessionId`
   - `localOrderId`
3. Waffo Dashboard webhook target is configured to the deployed webhook URL.
4. Test delivery creates a `processed_webhooks` row.
5. `order.completed` updates `orders`, `payments`, and `entitlements`.
6. `/checkout/success` only polls `get-entitlement`.

If any step was not actually run, mark it as `unverified`.

## 10. Remote Runtime Reality

Checked against the current server:

- Self-hosted Supabase project directory: `/opt/supabase-project`
- Intended project API base URL: `https://hwh-api.915500.xyz`
- Intended Waffo webhook URL: `https://hwh-api.915500.xyz/functions/v1/waffo-webhook`
- Host Nginx reverse proxy config path: `/etc/nginx/sites-available/hwh-api.915500.xyz`
- `waffo-webhook` remains `verify_jwt = false` in [`supabase/config.toml`](D:/code/鏀粯缃戠珯璁捐妯″潡/plugin-membership-supabase-waffo-design/supabase/config.toml)

Current blocker:

- `hwh-api.915500.xyz` DNS and HTTPS are already live on `45.62.105.166`.
- Current upstream `https://hwh-api.915500.xyz/functions/v1/waffo-webhook` returns `405` on `GET`, which confirms the deployed function is reachable for signed webhook tests.


