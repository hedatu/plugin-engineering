# LeadFill One Profile

## Purpose
Save one local profile and fill visible lead form fields on the current page in one click.

## Local Paid Candidate
This directory is the local paid candidate for LeadFill One Profile `0.2.1`.
It is not uploaded or published to Chrome Web Store.

The Upgrade button label is `View Upgrade Plans` and opens:
`https://pay.915500.xyz/products/leadfill-one-profile/pricing?source=chrome_extension&productKey=leadfill-one-profile&planKey=lifetime&installationId=<installationId>&extensionId=<extensionId>`

Checkout is still created by the website, not directly by the extension.
The success page does not unlock Pro locally; Pro remains gated by refreshed backend entitlement.

## Load Unpacked
1. Open Chrome extension management.
2. Enable Developer mode.
3. Choose Load unpacked and select this directory.

## Permissions
- storage: keep one local profile and overwrite preference
- activeTab: act only on the current page after the user clicks
- scripting: inject the form fill helper when needed

## Supported Fill Behavior
- Matches common text, email, phone, textarea, and select fields when descriptors align with the saved profile
- Skips readonly or disabled fields safely
- Preserves existing values by default unless the user enables overwrite
- Stores profile data locally only


## Membership
- Free usage limit: 10 fills
- Price: shown on the LeadFill pricing page
- Login: email OTP through the external pay site stack
- Upgrade flow: extension opens the LeadFill pricing page; the website starts checkout
- Unlock rule: webhook-confirmed entitlement only
