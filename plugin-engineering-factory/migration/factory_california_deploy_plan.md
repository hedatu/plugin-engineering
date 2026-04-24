# Factory California Deploy Plan

## Phase 1 Scope
Deploy only low-risk, read-mostly factory services on California first.

## Enable First
- `review-watch`
  - poll every 6 hours
  - read-only status checks
  - no upload
  - no publish
- `plugin-site static preview`
  - generated plugin pages
  - pricing pages
  - product index
- `product catalog`
  - `state/product_catalog.json`
- `release ledger and backlog snapshots`
  - `state/release_ledger.json`
  - `state/opportunity_backlog.json`

## Keep Disabled
- automatic Chrome Web Store upload
- automatic Chrome Web Store publish
- payment-driven public launch claims before California E2E passes
- heavy Remotion rendering on the 1 GB host by default

## Runtime Model
- Keep generated site assets static.
- Keep factory jobs scheduled and explicit.
- Keep write actions human-gated even after migration.

## Dependency On HWH Readiness
- Review-watch can go live before HWH migration finishes.
- Public plugin-site preview can go live before payment readiness.
- Full commercial payment messaging must stay truthful until SMTP, webhook, and entitlement are verified in California.
