# Dashboard Upload Checklist

- Chrome Web Store item ID: dnnpkaefmlhacigijccbhemgaenjbcpk
- Current version: 0.2.0
- Asset gallery: asset_gallery.html

## Upload Files

- Screenshot: assets/screenshots/screenshot_1_1280x800.png
- Screenshot: assets/screenshots/screenshot_2_1280x800.png
- Screenshot: assets/screenshots/screenshot_3_1280x800.png
- Screenshot: assets/screenshots/screenshot_4_1280x800.png
- Screenshot: assets/screenshots/screenshot_5_1280x800.png
- Small promo: assets/promo/small_promo_440x280.png
- Marquee: assets/promo/marquee_1400x560.png

## Listing Copy

- Title: LeadFill One Profile
- Short description: Save one local profile and fill visible form fields on the current page. Includes 10 free fills.

### Detailed Description

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

### Privacy Disclosure

Stores one profile locally in Chrome storage and injects a fill script into the active tab only when the user clicks fill. Membership login uses email OTP and public Supabase endpoints. Upgrade opens the external HWH checkout page; the extension does not process card data. Pro access is read from webhook-confirmed entitlement via the public API. The extension does not ship service-role, Waffo, merchant, or webhook secrets. Form data remains local-only. No upload. No cloud sync.

### Paid Feature Disclosure

# Paid Features Disclosure

- Free limit: [object Object]
- Unlock price: $19 lifetime
- Upgrade flow: external payment page
- Activation flow: email OTP login, external HWH checkout, webhook-derived entitlement refresh
- Upgrade link: https://pay.915500.xyz

Paid features must stay clearly disclosed in both the listing and the extension UI.

## Support And Homepage

- Support URL or placeholder: D:\code\ai插件优化工作流\landing\leadfill-one-profile\support.md
- Homepage URL or placeholder: D:\code\ai插件优化工作流\landing\leadfill-one-profile\index.html

## Manual Checklist

- [ ] screenshots uploaded
- [ ] small promo uploaded
- [ ] marquee uploaded if desired
- [ ] title checked
- [ ] short description checked
- [ ] privacy checked
- [ ] pricing disclosed
- [ ] no misleading claims
- [ ] no competitor names
- [ ] no unimplemented features
- [ ] visual review passed
