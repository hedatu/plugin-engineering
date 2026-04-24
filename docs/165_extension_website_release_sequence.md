# 165 Extension Website Release Sequence

## Current Sequence

1. Product page is prepared for LeadFill.
2. Pricing page is prepared for LeadFill.
3. Extension Upgrade button points to the LeadFill pricing page.
4. Website `/checkout/start` creates hosted checkout server-side.
5. Payment success returns to the website success page.
6. Webhook verifies payment and writes entitlement.
7. Account page and extension refresh entitlement.
8. Extension consumes usage against refreshed entitlement state.

## Non-Negotiable Rules

- no direct bare Waffo link as the extension upgrade target
- no local success-page unlock
- no secret in extension or frontend
- webhook remains source of truth

## Current Release Posture

- internal controlled mode
- checkout mode test
- no production payment in this step
- no Chrome upload or publish in this step
