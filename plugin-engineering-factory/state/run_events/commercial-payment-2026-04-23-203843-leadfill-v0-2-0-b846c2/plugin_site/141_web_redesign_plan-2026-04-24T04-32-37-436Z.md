# Premium Web Redesign Plan

Product: leadfill-one-profile
Run: commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2
Payment mode: test
Production payment status: not_verified

## Objectives

- Make LeadFill look like a maintained commercial Chrome extension product.
- Clarify the one-profile value proposition within the first viewport.
- Make Free vs Lifetime pricing obvious without adding extra plans.
- Keep local-only, no upload, and no cloud sync trust language prominent.
- Explain that paid access comes from webhook-confirmed entitlement, not successUrl.

## Redesigned Pages

- LeadFill product-first homepage
- Dedicated product detail page
- Pricing and checkout guidance page
- Account and membership page
- Refund, privacy, and terms pages
- Checkout success guidance page
- Checkout cancelled / failed guidance page
- Product catalog index
- Localized site variants for zh-cn, ja, and es

## Information Architecture

- Hero with product name, value proposition, free tier, lifetime price, and trust notes.
- Navigation centered on Home, Product, Pricing, and Account.
- Core benefits limited to a small set of stronger sales points.
- How it works as a four-step flow with real screenshots.
- Feature breakdown tied to implemented field behavior on a separate product page.
- Two-plan pricing only: Free and Lifetime.
- Payment safety and membership guidance moved into pricing, account, and checkout pages.
- Refund, privacy, and terms moved to footer-level legal pages.

## Guardrails

- No Chrome upload.
- No Chrome publish.
- No production payment.
- No Google login.
- No backend payment logic change.
- No unimplemented feature claims.

## Next Step

human_visual_review
