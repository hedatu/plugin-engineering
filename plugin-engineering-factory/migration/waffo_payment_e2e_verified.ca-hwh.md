# Waffo Payment E2E Verified (ca-hwh)

- generated_at: 2026-04-23T14:37:25.1685899+08:00
- source: web_and_chrome_extension
- checkout_session_created: true
- paid_order_webhook_received: true
- webhook_signature_verified: true
- localOrderId_matched: true
- orders_written: true
- payments_written: true
- entitlement_active_from_webhook: true
- get_entitlement_active: true
- consume_usage_pro_passed: true
- remaining_followup: none

The California staging stack completed the real Waffo sandbox payment flow end to end for both `source=web` and a real plugin-created `source=chrome_extension` checkout. The active entitlement was written by the verified paid webhook, not by a manual override, and Pro usage passed against that paid state.
