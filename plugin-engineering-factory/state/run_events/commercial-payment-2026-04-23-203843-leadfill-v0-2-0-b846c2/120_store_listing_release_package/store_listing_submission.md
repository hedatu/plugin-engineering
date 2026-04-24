# Store Listing Submission

- Product: LeadFill One Profile
- Run: commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2
- Item ID: dnnpkaefmlhacigijccbhemgaenjbcpk
- Version: 0.2.0
- Listing quality gate: passed
- Asset QA: passed
- Premium feel score: 100

## Title

LeadFill One Profile

## Short Description

Save one local profile and fill visible form fields on the current page. Includes 10 free fills.

## Detailed Description

Save one local profile and fill visible lead form fields on the current page in one click.
Built for: Sales reps, recruiters, and operators repeatedly entering the same contact details into web forms.
Key workflow: Open popup -> Save one reusable profile locally -> Navigate to a target form -> Click Fill Current Page
Supports common text, email, phone, textarea, and select fields when labels or descriptors match the saved profile.
Stores one profile locally in chrome.storage.local. No cloud sync or remote transfer of form data.
Email OTP is used only for membership and entitlement checks; form data stays local.
Does not overwrite fields that already contain values unless the user explicitly enables overwrite in the popup.
Free plan includes 10 fills.
Unlock Lifetime - $19 lifetime through the external HWH checkout page.
Login with email and refresh membership after payment; Pro unlock depends on webhook-confirmed entitlement, not successUrl.
This revision stays in test or controlled payment mode. Production payment is not verified yet.
Non-goals: No CRM sync; No multi-profile team workspace; No cloud account

## Privacy Disclosure

Stores one profile locally in Chrome storage and injects a fill script into the active tab only when the user clicks fill. Membership login uses email OTP and public Supabase endpoints. Upgrade opens the external HWH checkout page; the extension does not process card data. Pro access is read from webhook-confirmed entitlement via the public API. The extension does not ship service-role, Waffo, merchant, or webhook secrets. Form data remains local-only. No upload. No cloud sync.

# Paid Features Disclosure

- Free limit: [object Object]
- Unlock price: $19 lifetime
- Upgrade flow: external payment page
- Activation flow: email OTP login, external HWH checkout, webhook-derived entitlement refresh
- Upgrade link: https://pay.915500.xyz

Paid features must stay clearly disclosed in both the listing and the extension UI.

## Manual Review Reminder

- Do not upload or publish with old draft assets.
- Confirm screenshots still match real browser-smoke output.
- Confirm support, homepage, privacy, and paid disclosure text before any dashboard action.
