# LeadFill Site Route Mismatch Report

Date: 2026-04-24
Scope: `https://pay.915500.xyz`

## What happened

The earlier screenshot batch showed many `Unexpected Application Error / 404 Not Found` pages.

That was not caused by a total site outage.

It happened because two different site models are currently mixed together:

1. A generated static product-page tree under `generated/plugin-pages/leadfill-one-profile/`
2. A deployed React SPA at `pay.915500.xyz`

The static tree uses routes like:

- `/product.html`
- `/pricing.html`
- `/account.html`
- `/refund.html`
- `/privacy.html`
- `/terms.html`
- `/zh-cn/...`

The live SPA uses routes like:

- `/`
- `/products`
- `/products/leadfill-one-profile`
- `/pricing`
- `/account`
- `/refund`
- `/privacy`
- `/terms`
- `/checkout/success`
- `/checkout/cancel`

When a request like `/pricing.html` hits production, Nginx falls back to `/index.html`, the SPA boots, and React Router cannot match that path. The result is an application-level 404 page with HTTP 200.

## Evidence

### Static generator outputs

- `generated/plugin-pages/leadfill-one-profile/index.html`
- `generated/plugin-pages/leadfill-one-profile/product.html`
- `generated/plugin-pages/leadfill-one-profile/pricing.html`
- `generated/plugin-pages/leadfill-one-profile/account.html`
- `generated/plugin-pages/leadfill-one-profile/zh-cn/index.html`

### Current live server behavior

The backed-up Nginx config uses:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

This means unknown paths still return the SPA shell instead of a real static file.

Reference:

- `migration/backups/old_server/20260422-195340/remote/nginx/pay.915500.xyz`

### Correct live route screenshots

See:

- `docs/site-screenshots-live-routes-2026-04-24/manifest.json`
- `docs/site-screenshots-live-routes-2026-04-24/README.md`

## Root causes

### 1. Route contract mismatch

Generated pages assume static `.html` routes.
Production runs an SPA route table without those `.html` paths.

### 2. Deployment target mismatch

The redesigned LeadFill product-first pages exist locally, but they were not promoted as the production site shell.
Production is still serving the membership-hub SPA.

### 3. Locale route mismatch

Generated redesign includes `zh-cn`, `ja`, and `es` static folders.
Production SPA does not define locale-prefixed routes.

### 4. Health checks were too shallow

Previous smoke checks treated `HTTP 200` as success for the frontend and did not fail on body text such as:

- `Unexpected Application Error`
- `404 Not Found`

## What is actually working right now

The live SPA itself is reachable and its real routes load:

- `/`
- `/products`
- `/products/leadfill-one-profile`
- `/pricing`
- `/account`
- `/refund`
- `/privacy`
- `/terms`
- `/checkout/success`
- `/checkout/cancel`
- `/login`

The problem is not “the whole site is down”.

The problem is “the product-first redesign and its documented URL scheme are not the same thing as the deployed site”.

## Recommended repair order

### Option A. Keep the SPA and make it the single source of truth

Recommended if the current interactive account/login/checkout pages must stay dynamic.

Actions:

1. Replace the SPA home page with a LeadFill-first product homepage.
2. Replace the SPA product, pricing, account, refund, privacy, and terms views with the new product-first information architecture.
3. Add route aliases for the documented static URLs:
   - `/product.html`
   - `/pricing.html`
   - `/account.html`
   - `/refund.html`
   - `/privacy.html`
   - `/terms.html`
   - `/checkout/success.html`
   - `/checkout/cancel.html`
4. Add locale-prefixed route support or remove multilingual claims from production until real locale routing exists.
5. Update all handoff/docs/screenshots to point to SPA routes, not generated `.html` paths.

### Option B. Promote the generated static site to production

Recommended only if the generated pages are extended to support the current interactive account/login/payment UX.

Right now this is not enough by itself, because the generated pages are mostly content pages and do not replace the current live OTP/account interaction surface.

## Minimum fixes that should happen immediately

1. Stop using static `.html` URLs as if they are the current live production routes.
2. Use the live SPA routes for screenshots and QA until deployment is unified.
3. Add a frontend smoke assertion that fails if page text contains:
   - `Unexpected Application Error`
   - `404 Not Found`
4. Choose one route contract:
   - static `.html` tree
   - or SPA routes

Do not keep both as parallel “truths”.

## Recommendation

Use **Option A**.

Reason:

- The live site already has working OTP, account, pricing, checkout success, and cancel flows.
- The current failure is mostly an IA + routing mismatch, not a missing backend.
- The shortest stable path is to rewrite the existing SPA into the LeadFill-first product site and add compatibility aliases for the documented `.html` URLs.
