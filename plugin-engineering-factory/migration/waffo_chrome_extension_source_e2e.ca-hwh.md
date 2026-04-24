# California `source=chrome_extension` E2E

- Status: `verified_real_plugin_runtime`
- Plugin client used for the full login-payment loop: `true`
- Checkout source recorded in California DB: `chrome_extension`
- Checkout session id: `cs_bf992216-a5bf-470a-082a-ecf9f958c4ff`
- Local order id: `ord_1776925753540_e2e09b44`

## What Passed

- A fresh real plugin runtime was launched from the rebuilt ASCII-path unpacked extension on a clean Chrome profile.
- Real plugin `SEND_OTP` returned `ok=true`.
- Real plugin `VERIFY_OTP` returned a valid session and user.
- Real plugin `REGISTER_INSTALLATION` succeeded with a real `installationId`.
- Real plugin `CREATE_CHECKOUT` created a California checkout with `source=chrome_extension`.
- Waffo sandbox payment completed for that plugin-created checkout.
- California processed the corresponding `order.completed` webhook and verified its signature.
- California wrote the checkout row as `completed`, then wrote matching `orders` and `payments` rows.
- The fresh user moved from `plan=free` to `plan=lifetime` after webhook processing.
- Real plugin `REFRESH_ENTITLEMENT` returned `plan=lifetime`, `status=active`, and unlimited `leadfill_fill_action`.
- Real plugin `CONSUME_USAGE` returned `allowed=true` for the paid lifetime state.
- The popup UI showed `plan=lifetime`, `status=active`, `pro_access=enabled`, and unlimited remaining usage.

## Root Cause That Was Fixed

- The earlier plugin `Unauthorized` result was caused by a stale local California public anon key plus a stale cached debug profile.
- Rebuilding the local extension against the current California public anon key and relaunching it in a fresh Chrome profile cleared the plugin OTP failure.

## Remaining Cutover Blockers

- California SMTP still depends on the old relay.
- California remains a 1GB low-memory server.
- Formal DNS cutover still needs explicit user approval.
