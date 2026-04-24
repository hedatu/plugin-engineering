# Payment Integration Contract

## Factory Responsibilities
- Generate `monetization_config.json` for each monetized extension build.
- Render the paywall UI inside the popup and the dedicated license page.
- Maintain a local free-usage counter.
- Show an `Upgrade` button that opens an external payment page.
- Show a license key input and restore-purchase flow.
- Send license verification requests to configured external endpoints only.
- Maintain entitlement state in local cache with an offline grace window.
- Keep the free happy path working until the configured free limit is reached.

## External Payment / License System Responsibilities
- Host the payment page and checkout flow.
- Manage the payment provider integration.
- Handle webhooks and payment reconciliation.
- Generate license records and license keys.
- Expose license activation and verification APIs.
- Handle refunds, revocation, and entitlement changes.
- Hold all provider secrets and signing keys.

## Explicitly Forbidden In The Extension
- Stripe secret keys in the extension bundle.
- Lemon Squeezy API keys in the extension bundle.
- Webhook secrets in the extension bundle.
- Private keys in the extension bundle.
- Trusting local storage alone as proof of a Pro unlock.

## Standard License API Endpoints
- `POST /license/verify`
- `POST /license/activate`
- `GET /license/status`
- Optional: `POST /usage/report`

## Standard Verify Request Body
The extension should only send:

```json
{
  "license_key": "user-pasted-license-key",
  "product_id": "leadfill-one-profile",
  "extension_id": "resolved-from-chrome-runtime-id",
  "anonymous_install_id": "uuid",
  "version": "0.2.0"
}
```

For the current commercial release revision, the expected placeholder contract is:

- Product: `LeadFill One Profile`
- Pricing model: `free_trial_then_lifetime`
- Free limit: `10 fills`
- Paid unlock: `$19 lifetime`
- Upgrade flow: external payment page only
- License flow: activate, verify, or restore inside the extension after purchase

## Standard Entitlement Response
The payment system should return the entitlement contract described in [entitlement_response_contract.md](/D:/code/ai插件优化工作流/docs/entitlement_response_contract.md).

## Trust Boundary
- The extension may cache the latest verified entitlement state locally.
- The extension must treat remote verification as the source of truth for paid unlocks.
- Local cache may only bridge short offline periods through `offline_grace_hours`.
- Refund or revoke actions must come from the external payment system.
