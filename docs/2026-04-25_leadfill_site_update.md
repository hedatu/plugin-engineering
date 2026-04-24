# LeadFill Site Update - 2026-04-25

## Scope

This update keeps the project on the narrowed `LeadFill One Profile` mainline. It does not add discovery work, factory expansion, a second plugin, Chrome upload or publish, or production payment activation.

## What changed

### Website structure

- Kept the site as a plugin product center rather than a payment hub.
- Standardized the main routes around the LeadFill single-product flow:
  - `/`
  - `/products`
  - `/products/leadfill-one-profile`
  - `/products/leadfill-one-profile/pricing`
  - `/checkout/start`
  - `/checkout/success`
  - `/checkout/cancel`
  - `/account`
  - `/privacy`
  - `/refund`
  - `/terms`
- Kept top navigation limited to `Product / Pricing / Account`.
- Kept `Refund / Privacy / Terms` in the footer only.

### Visual and copy rewrite

- Reworked the homepage into a product-first landing page for LeadFill.
- Reworked the product detail page into a clearer single-product detail page instead of reusing a generic membership-style layout.
- Reworked pricing into two user-facing cards only:
  - Free
  - Lifetime Unlock
- Reduced technical and internal language on commercial pages.
- Kept payment explanation concise and moved technical enforcement language away from top-of-page product messaging.
- Reworked legal pages into more formal document-style pages.
- Simplified success and cancel pages into minimal state pages with clear next steps.
- Simplified account presentation to focus on:
  - Current access
  - Usage
  - Orders / payments

### Checkout and upgrade flow

- Kept plugin upgrade flow pointed to the website pricing page, not a fixed Waffo checkout URL.
- Kept `/checkout/start` as the dynamic entry that resolves product and plan, checks login, and creates checkout through the backend.
- Kept the rule that `successUrl` does not locally activate Pro.
- Kept webhook-confirmed entitlement as the only paid activation source of truth.

### Documentation

- Added Waffo merchant review checklist:
  - `docs/waffo_merchant_review_checklist.md`
- Kept LeadFill-focused architecture and contract docs under:
  - `docs/160_plugin_site_architecture.md`
  - `docs/161_product_catalog_contract.json`
  - `docs/162_checkout_start_flow.md`
  - `docs/163_extension_upgrade_contract.md`
  - `docs/164_hwh_waffo_product_mapping_contract.md`
  - `docs/165_extension_website_release_sequence.md`
  - `docs/166_ui_simplification_plan.md`

### Screenshots

Current page screenshots are stored in:

- `docs/screenshots/leadfill-site/01-home.png`
- `docs/screenshots/leadfill-site/02-products.png`
- `docs/screenshots/leadfill-site/03-product-leadfill.png`
- `docs/screenshots/leadfill-site/04-pricing.png`
- `docs/screenshots/leadfill-site/05-account.png`
- `docs/screenshots/leadfill-site/06-login.png`
- `docs/screenshots/leadfill-site/07-privacy.png`
- `docs/screenshots/leadfill-site/08-refund.png`
- `docs/screenshots/leadfill-site/09-terms.png`
- `docs/screenshots/leadfill-site/10-checkout-success.png`
- `docs/screenshots/leadfill-site/11-checkout-cancel.png`

See also:

- `docs/screenshots/leadfill-site/README.md`

## Validation

The following checks were run successfully before packaging this update:

- `npm run site:smoke`
- `npm run catalog:validate`
- `npm run security:scan`
- `npm run typecheck`
- `npm run build:web`

## Constraints still in force

- No Chrome upload
- No Chrome publish
- No production payment activation
- No Google login
- No second plugin
- No factory/discovery expansion
