# Privacy Summary

Stores one profile locally in Chrome storage and injects a fill script into the active tab only when the user clicks fill. Membership login uses email OTP and public Supabase endpoints. Upgrade opens the external HWH checkout page; the extension does not process card data. Pro access is read from webhook-confirmed entitlement via the public API. The extension does not ship service-role, Waffo, merchant, or webhook secrets. Form data remains local-only. No upload. No cloud sync.

## Trust Claims

- Local-only claim: Uses local Chrome storage and only acts on the active tab after a user click.
- No-login claim: No account is required for local profile editing; email OTP is used only for membership and entitlement refresh.
- No-upload claim: Does not upload profile data or page content to a remote service.

These claims must stay consistent with the real bundle, browser smoke, and policy gate.
