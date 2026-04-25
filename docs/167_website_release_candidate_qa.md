# Website Release Candidate QA - 2026-04-25

## Scope

This QA pass reviews the current LeadFill single-product website release candidate on `main`.

Checked areas:

- `/products`
- `/products/leadfill-one-profile`
- `/products/leadfill-one-profile/pricing`
- `/checkout/start`
- `/account`
- `/checkout/success`
- `/checkout/cancel`
- `/privacy`
- `/refund`
- `/terms`
- `docs/waffo_merchant_review_checklist.md`
- `docs/161_product_catalog_contract.json`
- `npm run security:scan`

## Findings

### Fixed during QA

1. Chrome Web Store link logic was too permissive.
   - Previous behavior: the site could guess a public Chrome Web Store URL from `chrome_extension_id` alone.
   - Required behavior: only show `Add to Chrome` when `chromeWebStoreStatus=published` and a real public store URL exists.
   - Fix:
     - added `chromeWebStoreStatus` to fallback metadata
     - stopped generating a guessed public store URL from `chrome_extension_id`
     - standardized unpublished CTA copy to `Chrome Web Store link pending`

2. Pricing page copy needed tighter release-candidate wording.
   - Updated the pricing cards to read more directly as:
     - `Free: 10 free fills`
     - `Lifetime: $19 one-time`
   - Kept `No subscription` explicit.
   - Kept `success page does not unlock Pro locally` explicit.

3. Root repository wording still referenced a private-repository framing.
   - Updated `README.md` to use public-safe wording.

## Route and content QA summary

### `/products`

- Renders LeadFill as a formal product card.
- Shows `Chrome Web Store link pending` when the product is not published.
- Does not guess a public store URL from extension ID alone.

### `/products/leadfill-one-profile`

- Renders as a product detail page, not a membership hub.
- Shows `Chrome Web Store link pending` when unpublished.
- Keeps real capability boundaries only.

### `/products/leadfill-one-profile/pricing`

- Uses plain-language pricing copy.
- Clearly shows:
  - `10 free fills`
  - `$19 one-time`
  - `No subscription`
- States that the success page does not unlock Pro locally.

### `/checkout/start`

- Uses `productKey` and `planKey`.
- Accepts extension-side query context:
  - `source=chrome_extension`
  - `installationId`
  - `extensionId`
- Creates checkout through backend `create-checkout-session`.
- Passes `successUrl` and `cancelUrl`.
- Does not use a fixed bare Waffo link.

### `/account`

- Stays product-scoped through `productKey`.
- Keeps the UI centered on:
  - current access
  - usage
  - orders / payments

### `/checkout/success` and `/checkout/cancel`

- Both remain minimal state pages.
- Success copy states that Pro does not unlock locally.
- Cancel copy states that paid access only changes after verified backend payment events.

### Legal pages

- `Privacy`, `Refund`, and `Terms` read as formal policy pages rather than placeholders.
- Support email is present.
- Refund copy states that entitlement may be downgraded or revoked after refund processing.
- Privacy copy keeps the local-only / no cloud sync boundary explicit.

### Waffo merchant review checklist

- Updated to include:
  - Chrome Web Store CTA gating
  - unpublished store-link pending behavior
  - explicit local activation wording
  - refund entitlement handling check

## Security scan summary

Command run:

- `npm run security:scan`

Result:

- `high` findings: `0`
- `review` findings: `132`

Interpretation:

- No high-severity secret exposure was found by the scan.
- The remaining review-level hits are keyword references in docs, examples, archived factory material, and environment templates.
- No actual secret values were surfaced in frontend source, extension source, or active product pages during this QA pass.

## Validation run

Commands run successfully:

- `npm run site:smoke`
- `npm run catalog:validate`
- `npm run security:scan`
- `npm run typecheck`
- `npm run build:web`

Additional browser-text QA was run against a local preview build to confirm:

- unpublished Chrome Web Store CTA behavior
- pricing text
- legal-page support email and policy wording
- rendered pages do not show `chatgpt2obsidian`

## Notes and limitations

- Local preview QA used placeholder public Supabase values to render the built site locally.
- Because of that local placeholder setup, the full live OTP/auth redirect path for `/checkout/start` was not exercised against a real backend session in this pass.
- The release-candidate conclusion still treats `/checkout/start` as acceptable because:
  - code path inspection passed
  - smoke checks passed
  - backend checkout bootstrap contract remains intact

## QA conclusion

- QA result: passed
- Waffo merchant review blockers from the website side: none found in this pass
- Security blockers from this pass: none at high severity
- Chrome upload/publish: not executed
- Production payment: not executed
