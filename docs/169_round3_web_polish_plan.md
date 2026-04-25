# Round 3 Web Polish Plan

Date: `2026-04-25`

## Goal

Polish the LeadFill website into a quieter, more product-first release candidate without changing checkout, webhook, entitlement, or extension payment contracts.

## Constraints kept in force

- no Chrome upload
- no Chrome publish
- no production payment
- no checkout architecture change
- no webhook source-of-truth change
- no entitlement-local-activation behavior

## Problems addressed

1. The site still felt too close to a membership or payment console.
2. The domain and infrastructure identity were still too visible.
3. The visual system had too many medium-weight cards and not enough calm hierarchy.
4. Success and cancel screens still read like test flow pages.
5. The account page still leaned too far toward internal-state presentation.

## Planned changes

### Brand

- add a minimal LeadFill mark for favicon and header identity
- switch header brand to `LeadFill / One Profile`
- keep branding restrained and product-like

### Home and product framing

- make the hero more product-first
- reduce explanatory noise in the first screen
- retitle mid-page sections to clearer product language:
  - `Why LeadFill`
  - `How it works`
  - `Pricing snapshot`
- keep only the highest-value CTA paths

### Pricing

- make the two offers readable in five seconds
- surface `10 free fills`, `$19 one-time`, and `No subscription`
- keep test-mode disclosure low priority
- keep secure payment and backend-confirmed activation language

### Account and status pages

- restyle account as a membership page
- add a cleaner summary section
- center and simplify success and cancel pages
- keep next-step actions obvious

### Visual system

- increase whitespace
- reduce border heaviness
- reduce decorative color usage
- unify radius, shadow, and button treatment
- keep legal and host information low prominence

## Deliverables

- updated web pages
- brand icon and favicon
- updated screenshot set under `docs/screenshots/leadfill-site`
- `docs/170_round3_visual_review.md`
- `docs/171_brand_icon_spec.json`
- updated `docs/166_ui_simplification_plan.md`

## Validation

After polish:

- `npm run site:smoke`
- `npm run catalog:validate`
- `npm run security:scan`
- `npm run typecheck`
- `npm run build:web`
