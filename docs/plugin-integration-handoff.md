# Chrome Extension Payment Integration Handoff

This document is for the plugin project team that needs to connect to the membership and payment hub.

## Online URLs

- Web hub: `https://hwh.915500.xyz`
- API / self-hosted Supabase gateway: `https://hwh-api.915500.xyz`
- Waffo success URL: `https://hwh.915500.xyz/checkout/success`
- Waffo cancel URL: `https://hwh.915500.xyz/checkout/cancel`
- Waffo webhook URL: `https://hwh-api.915500.xyz/functions/v1/waffo-webhook`

## Product and plan keys

- Current product key: `leadfill-one-profile`
- Feature key: `leadfill_fill_action`
- Free plan: `free`
- Lifetime plan: `lifetime`
- Legacy product key: `chatgpt2obsidian` (`legacy test-only`, not for LeadFill)

The extension should always pass `productKey` and `planKey` to the backend. Do not hardcode Waffo product links in the extension.

## Security boundary

- The extension may only read public values such as `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SITE_URL`, `PRODUCT_KEY`, and `CHROME_EXTENSION_ID`.
- The extension must never contain `SUPABASE_SERVICE_ROLE_KEY`, `WAFFO_PRIVATE_KEY`, `WAFFO_PRIVATE_KEY_BASE64`, or any other merchant secret.
- Session tokens must be stored by the `background` / service worker only.
- `content scripts` must not directly hold access tokens or refresh tokens.
- Membership activation must remain webhook-driven.
- The success page must not activate membership.

## Build-time environment for the extension

```env
SITE_URL=https://hwh.915500.xyz
PUBLIC_SUPABASE_URL=https://hwh-api.915500.xyz
PUBLIC_SUPABASE_ANON_KEY=<anon-key>
PRODUCT_KEY=leadfill-one-profile
CHROME_EXTENSION_ID=<your-extension-id>
```

## Required runtime flow

1. User installs the Chrome extension for free from Chrome Web Store.
2. The extension uses Supabase email OTP to sign the user in.
3. The extension registers its installation ID with `register-installation`.
4. When the user clicks Upgrade, the extension sends a JWT-authenticated request to `create-checkout-session`.
5. The backend creates the Waffo checkout session and returns only:
   - `checkoutUrl`
   - `sessionId`
   - `localOrderId`
6. The extension opens the returned `checkoutUrl`.
7. Waffo redirects the browser to `/checkout/success` or `/checkout/cancel`.
8. The real membership change happens only after Waffo calls the webhook.
9. The extension refreshes entitlement from `get-entitlement`.

## Extension message protocol

Shared message types live in [packages/extension-sdk/src/types.ts](/D:/code/支付网站设计模块/plugin-membership-supabase-waffo-design/packages/extension-sdk/src/types.ts).

Current request types:

```ts
type ExtensionMessageRequest =
  | { type: 'GET_AUTH_STATE' }
  | { type: 'SEND_OTP'; email: string }
  | { type: 'VERIFY_OTP'; email: string; token: string }
  | { type: 'SIGN_OUT' }
  | { type: 'REFRESH_ENTITLEMENT'; productKey: string }
  | { type: 'REGISTER_INSTALLATION'; productKey: string; installationId: string; extensionId?: string; browser?: string; version?: string }
  | { type: 'CREATE_CHECKOUT'; productKey: string; planKey: string; installationId?: string; successUrl?: string; cancelUrl?: string }
  | { type: 'CONSUME_USAGE'; productKey: string; featureKey: string; amount?: number; installationId?: string }
```

## Backend endpoints used by the extension

- `POST https://hwh-api.915500.xyz/functions/v1/get-entitlement`
- `POST https://hwh-api.915500.xyz/functions/v1/register-installation`
- `POST https://hwh-api.915500.xyz/functions/v1/consume-usage`
- `POST https://hwh-api.915500.xyz/functions/v1/create-checkout-session`

All four endpoints require the extension to send the user JWT except the public OTP flow handled through Supabase Auth endpoints.

## What the extension should display

- Before purchase: show Free tier or current entitlement state.
- During checkout creation: show loading state only.
- After redirect to success page: do not claim payment is active yet.
- After webhook lands: refresh entitlement and then unlock paid features.

Recommended copy:

- `Payment submitted. We are syncing membership from the secure payment webhook.`
- `Refresh membership status`

Avoid copy such as:

- `Payment succeeded, membership enabled immediately`
- `Success page means membership is already active`

## How to merge into the new AI plugin project

Keep the billing system as a separate capability module, not as a separate product site baked into business logic.

Recommended integration split:

- Reuse the current Supabase schema, migrations, and Edge Functions as the shared membership backend.
- Reuse the extension-side auth, installation, entitlement, and checkout message flow.
- Move the new AI plugin project UI onto the same public web hub patterns:
  - `/products`
  - `/products/:productKey`
  - `/pricing`
  - `/account`
- Add a new `productKey` and matching `products` / `plans` rows for the AI plugin instead of forking billing logic.
- Keep a single Upgrade button contract:
  - extension asks backend for `create-checkout-session`
  - backend returns `checkoutUrl`
  - extension opens that URL

## Current verification status

Verified:

- `https://hwh.915500.xyz` is live.
- `https://hwh-api.915500.xyz` is live.
- `GET https://hwh-api.915500.xyz/functions/v1/waffo-webhook` returns `405`.
- Unsigned webhook `POST` returns `401 INVALID_SIGNATURE`.

Not yet verified:

- Real OTP login end to end.
- Real Waffo test checkout completed by a signed-in user.
- Real webhook event from Waffo Test dashboard.
- Real entitlement activation after payment.
