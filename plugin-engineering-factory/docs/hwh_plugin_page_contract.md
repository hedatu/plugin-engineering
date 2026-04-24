# HWH Plugin Page Contract

This contract defines how the HWH or Waffo payment site can consume the local product catalog and generated plugin page package without placing secrets inside the extension.

## Routes

- `/plugins/<slug>`
- `/plugins/<slug>/pricing`
- `/checkout/success`
- `/checkout/cancel`

## Required product catalog fields

- `productKey`
- `slug`
- `name`
- `priceLabel`
- `freeLimit`
- `proFeatures`
- `freeFeatures`
- `checkoutMode`
- `installUrl`
- `supportUrl`
- `privacyUrl`
- `changelogUrl`
- `listingAssetsPath`
- `remotionAssetsPath`

## HWH page behavior

1. When logged out, show email OTP login.
2. When logged in and not purchased, create checkout for the configured product and plan.
3. When purchased, show owned state and open-extension guidance.
4. On success, refresh entitlement.
5. Do not treat `successUrl` as proof of membership.
6. If SMTP is not working, show login unavailable or coming soon.

## Security boundaries

- Only public values may appear in extension or public page config.
- Do not expose `SUPABASE_SERVICE_ROLE_KEY`.
- Do not expose `WAFFO_PRIVATE_KEY`.
- Do not expose merchant or webhook secrets.
- Background or service worker owns tokens and API requests.
- Content scripts must not hold access or refresh tokens.

## Payment truthfulness rules

- Webhook-confirmed entitlement is the unlock source.
- Disabled or test-only checkout must look disabled or test-only.
- Do not imply Google endorsement.
- Do not hide free versus Pro differences.
- Do not claim real payment is live until product key, plan key, SMTP, checkout, webhook, and entitlement validation are complete.
