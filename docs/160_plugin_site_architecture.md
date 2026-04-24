# 160 Plugin Site Architecture

## Purpose

The website is now structured as a plugin product center, not a generic membership hub.

## Route Model

- `/products`
  - catalog landing page
  - shows active products from the product catalog or local fallback
- `/products/:slug`
  - product details page for one plugin
- `/products/:slug/pricing`
  - pricing page for one plugin
- `/checkout/start`
  - normalized checkout bootstrap route
- `/account?productKey=<productKey>`
  - account and entitlement page scoped to one product
- `/pricing`
  - redirect only
  - currently redirects to `/products/leadfill-one-profile/pricing`

## Product Catalog Source

The site resolves products from:

1. Supabase `products` and `plans` when available
2. local fallback product catalog when remote data is unavailable

## Checkout Architecture

The website never embeds a fixed Waffo URL.

The pricing page links to `/checkout/start`, which:

1. validates `productKey` and `planKey`
2. confirms login
3. creates a server-side checkout session
4. redirects to the hosted checkout URL

## Activation Rules

- checkout success page is not an activation surface
- paid status only becomes active after webhook verification and entitlement write
- account and extension both refresh entitlement from the backend

## Extension Interaction

The extension Upgrade button opens the website pricing route for the product:

- `/products/leadfill-one-profile/pricing?source=chrome_extension&installationId=<...>&extensionId=<...>`

The extension does not:

- hold Waffo secrets
- hold service-role credentials
- open a bare Waffo payment link directly
