# Monetization Strategy

## Current Commercial Target

- Product: `LeadFill One Profile`
- Commercial candidate version: `0.2.0`
- Pricing model: `free_trial_then_lifetime`
- Free limit: `10 fills`
- Paid unlock: `$19 lifetime`
- Upgrade flow: external payment page only
- License flow: user pastes a license key into the extension and the extension calls external activation or verify endpoints

## Why This Model

- The core value is easy to try without asking users to create an account first.
- The extension stays low-risk because checkout, provider secrets, webhook handling, and refunds stay outside the bundle.
- A lifetime unlock keeps the first commercial offer simple enough for a narrow single-purpose extension.

## Extension Responsibilities

- Show the free usage counter in the popup.
- Keep the free path usable until the limit is exhausted.
- Show `Unlock Lifetime - $19`, `Enter License Key`, and `Restore / Verify License`.
- Cache the latest verified entitlement locally for a short offline grace window only.
- Degrade stale paid cache back to free after offline grace expires.

## External Payment System Responsibilities

- Host the Stripe Payment Link or Checkout page.
- Generate and manage license records.
- Expose `POST /license/activate`, `POST /license/verify`, and optionally `GET /license/status`.
- Handle refunds, revoke actions, and any provider secret.

## Safety Rules

- Do not embed Stripe secrets, webhook secrets, refresh tokens, client secrets, or private keys in the extension.
- Do not trust local storage alone as proof of a permanent Pro unlock.
- Do not claim live payment is active if the build still uses placeholder payment or license URLs.
- Keep `local-only`, `no upload`, and `no cloud sync` claims literally true.

## Release Readiness

The commercial revision should only move toward sandbox upload approval after all of these are true:

- monetization security scan passed
- premium packaging passed
- asset QA passed
- listing quality gate passed
- store release package passed
- human visual review passed

If the payment link and license endpoints are still placeholders, the package may still be useful for internal review or sandbox planning, but it is not ready for real payment collection.
