# LeadFill Paid Upgrade Local Candidate

Date: 2026-04-27

## Scope

This is a local paid candidate for LeadFill One Profile. It is prepared for manual local testing only.

- Candidate path: `extensions/leadfill-one-profile-paid-local`
- Source run: `commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2`
- Manifest version: `0.2.1`
- Chrome Web Store upload: not executed
- Chrome Web Store publish: not executed
- Production payment: not enabled

## Upgrade Button Contract

The popup Upgrade button is labeled `View Upgrade Plans` and opens the LeadFill website pricing page instead of creating checkout directly inside the extension. Specific prices are shown on the website pricing page, not hard-coded in the extension.

Base URL:

```text
https://pay.915500.xyz/products/leadfill-one-profile/pricing
```

Runtime query parameters:

```text
source=chrome_extension
productKey=leadfill-one-profile
planKey=lifetime
installationId=<extension installation id when available>
extensionId=<runtime extension id>
```

The website remains responsible for starting checkout. The extension does not open a fixed Waffo checkout URL.
The extension-side `CREATE_CHECKOUT` message path is disabled in this local candidate and returns `CHECKOUT_STARTS_ON_WEBSITE`.

## Payment Boundary

- The extension contains no service role key.
- The extension contains no Waffo private key.
- The extension contains no merchant secret.
- The success page does not unlock Pro locally.
- Paid access remains gated by refreshed backend entitlement.
- `REFRESH_ENTITLEMENT` and `CONSUME_USAGE` remain the extension-side membership checks.

## Local Test Steps

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click `Load unpacked`.
4. Select `extensions/leadfill-one-profile-paid-local`.
5. Open the popup and click `Unlock Lifetime - $19`.
6. Confirm the opened URL is under `/products/leadfill-one-profile/pricing`.
7. Confirm the URL includes `source=chrome_extension`, `productKey`, `planKey`, and `extensionId`.

## Next Step

After manual testing, this candidate can be used as the basis for a Chrome Web Store update package. Do not upload until a separate human approval is given.
