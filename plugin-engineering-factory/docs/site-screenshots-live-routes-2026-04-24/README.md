# Live Site Screenshots

Captured on: 2026-04-24
Source site: https://pay.915500.xyz
Capture mode: live SPA routes

Why this folder exists:

- The earlier screenshot batch under `docs/site-screenshots-2026-04-24/` used static `.html` paths derived from `generated/plugin-pages/leadfill-one-profile/`.
- The live production site is currently a React SPA, not that static page tree.
- Valid live routes use paths like `/pricing`, `/account`, and `/products/leadfill-one-profile`.
- Invalid `.html` requests fall through to SPA `index.html` and then render the React 404 boundary.

Captured live routes:

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

Files:

- `manifest.json`
- `home.png`
- `products.png`
- `product-leadfill.png`
- `pricing.png`
- `account.png`
- `refund.png`
- `privacy.png`
- `terms.png`
- `checkout-success.png`
- `checkout-cancel.png`
- `login.png`
