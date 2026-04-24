# Privacy Summary

Stores one profile locally in Chrome storage and injects a fill script into the active tab only when the user clicks fill.

## Trust Claims

- Local-only claim: Uses local Chrome storage and only acts on the active tab after a user click.
- No-login claim: No account, login, or workspace setup is required for the core flow.
- No-upload claim: Does not upload profile data or page content to a remote service.

These claims must stay consistent with the real bundle, browser smoke, and policy gate.
