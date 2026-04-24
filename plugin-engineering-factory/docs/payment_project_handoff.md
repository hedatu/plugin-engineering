# Payment Project Handoff

## Required Endpoints
- `POST /license/verify`
- `POST /license/activate`
- `GET /license/status`
- Optional: `POST /usage/report`

## Expected Environment Variables In The Payment Project
- `PAYMENT_PROVIDER_MODE` with `dev`, `test`, or `live`
- `PAYMENT_PUBLIC_CHECKOUT_URL`
- `LICENSE_SIGNING_SECRET` or equivalent server-side verifier secret
- `PAYMENT_WEBHOOK_SECRET`
- Provider-specific secret values such as Stripe or Lemon Squeezy secrets
- `SUPPORT_EMAIL`

## How The Factory Consumes The Payment Project
- The factory writes public endpoint URLs into `monetization_config.json`.
- The extension only calls public verification endpoints.
- The extension never receives provider secrets.
- The extension caches entitlement state locally for offline grace only.
- The current commercial placeholder release expects:
  - `product_id=leadfill-one-profile`
  - `pricing_model=free_trial_then_lifetime`
  - `free_limit=10 fills`
  - `price_label=$19 lifetime`
  - external checkout only, no card entry inside the extension

## Environment Switching
- `checkout_mode=disabled`: no upgrade flow, local free plan only
- `checkout_mode=test`: placeholder or test checkout URLs plus mock entitlement support
- `checkout_mode=live`: public live checkout URL, but still no secrets in the extension

## License Verify Testing
- Use fixture entitlement payloads from `fixtures/monetization/`.
- In `checkout_mode=test`, the extension may use a mock active entitlement stored in `chrome.storage.local`.
- Before a live launch, verify that revoke, invalid, and expired responses are handled correctly.
- For the `0.2.0` commercial candidate, also verify offline grace expiry and that stale paid cache degrades back to free until reverified.

## Secret Leak Prevention Before Launch
- Run `npm run monetization:security-scan -- --run runs/<run_id>`.
- Confirm the generated `110_monetization_security_scan.json` has no secret findings.
- Confirm `checkout_mode=live` is not used without explicit human approval.

## Refund / Revoke Handling
- Refund and revoke actions must invalidate or downgrade entitlements through the payment project.
- The next `license/status` or `license/verify` response must reflect the revoked state.
- The extension should clear the paid unlock locally after a revoked or expired response.

## Multi-Extension Reuse
- Use one payment project with multiple `product_id` values.
- Keep per-extension `upgrade_url`, `license_verify_url`, and feature entitlements in each extension's `monetization_config.json`.
- Reuse the same verifier and refund workflow across products.

## LeadFill One Profile Placeholder Endpoints

The commercial revision in this repository expects the payment project to eventually provide:

- `POST /license/activate`
- `POST /license/verify`
- `GET /license/status`

Expected request body:

```json
{
  "license_key": "user-pasted-license-key",
  "product_id": "leadfill-one-profile",
  "extension_id": "runtime extension id",
  "anonymous_install_id": "anonymous install id",
  "version": "0.2.0"
}
```

Until live payment is ready, keep public placeholder URLs in `monetization_config.json` and do not enable real collection.
