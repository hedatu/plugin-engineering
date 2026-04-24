# 163 Extension Upgrade Contract

## Upgrade Entry

The extension Upgrade action must open the product pricing page on the website.

Current LeadFill target:

- `https://pay.915500.xyz/products/leadfill-one-profile/pricing?source=chrome_extension&installationId=<installationId>&extensionId=<extensionId>`

## Why

This keeps the extension out of direct payment-link management and makes the website the canonical place for:

- pricing
- legal copy
- account context
- checkout bootstrap

## Extension Rules

The extension may:

- send OTP
- verify OTP
- refresh entitlement
- register installation
- consume usage
- open website pricing and account routes

The extension may not:

- hold `SUPABASE_SERVICE_ROLE_KEY`
- hold `WAFFO_PRIVATE_KEY`
- hold merchant secrets
- trust the success page as proof of activation
- set Pro locally without refreshed entitlement
