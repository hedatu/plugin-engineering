# LeadFill HWH Integration Handoff

## Public Config

- SITE_URL: https://pay.915500.xyz
- PUBLIC_SUPABASE_URL: https://pay-api.915500.xyz
- PRODUCT_KEY: leadfill-one-profile
- PLAN_KEY: lifetime
- FEATURE_KEY: leadfill_fill_action
- SUCCESS_URL: https://pay.915500.xyz/checkout/success
- CANCEL_URL: https://pay.915500.xyz/checkout/cancel
- CHECKOUT_MODE: test

## Status

- current_primary_environment: california
- cutover_completed: true
- smtp_status: verified_independent
- otp_status: verified
- checkout_status: verified
- webhook_status: verified
- entitlement_status: verified_from_payment
- consume_usage_status: verified_free_quota_pro
- payment_e2e_status: verified_test_mode
- production_payment_status: not_verified
- source_chrome_extension_status: verified

## California Review-Watch

- deployed: true
- credentials_mode: service_account_file
- token_self_test: passed
- fetch_status: passed
- review_state: STAGED
- schedule: every 6 hours, read-only
- upload_publish_disabled: true

## Source `chrome_extension` Follow-Up

- A fresh real plugin runtime on a clean Chrome profile completed `SEND_OTP`, `VERIFY_OTP`, `REGISTER_INSTALLATION`, and `CREATE_CHECKOUT` with `source=chrome_extension`.
- California recorded that plugin-created checkout as `completed` in `checkout_sessions`.
- Waffo sandbox payment completed for the plugin-created checkout, California received the paid `order.completed` webhook, and signature verification passed.
- California wrote the matching `orders` and `payments` rows, then upgraded the fresh user from `plan=free` to `plan=lifetime`.
- Real popup/runtime `REFRESH_ENTITLEMENT` returned `active` with `plan=lifetime`, and real popup/runtime `CONSUME_USAGE` returned unlimited allowed usage for `leadfill_fill_action`.
- The popup UI showed `plan=lifetime`, `status=active`, `pro_access=enabled`, and unlimited remaining usage.
- The earlier plugin `Unauthorized` result came from a stale local California public anon key plus a stale cached debug profile, not from a live California Auth regression.

## Remaining Blockers

- California is still a 1GB low-memory server; the user accepts this as a temporary risk.
- Production payment remains not verified and not enabled.
- Chrome upload/publish remains disabled and was not executed.

## Production Domain Cutover

- DNS cutover completed for `pay.915500.xyz` and `pay-api.915500.xyz` to California `134.199.226.198`.
- `pay.915500.xyz` HTTPS returned `200`.
- `pay-api.915500.xyz/functions/v1/waffo-webhook` GET returned `405`.
- Unsigned webhook POST returned `401 INVALID_SIGNATURE`.
- Post-cutover Resend OTP, VERIFY_OTP, session, get-entitlement, register-installation, free quota, and 11th-attempt `QUOTA_EXCEEDED` passed.
- Test-mode `create-checkout-session` passed and returned a Waffo hosted checkout URL; no payment was completed in this cutover smoke.
- The active production frontend bundle was rebuilt against `pay-api.915500.xyz` and verified with a working public anon key; no `ca-hwh` residue was detected.

## SMTP

- Provider: Resend
- Domain: notify.915500.xyz
- Sender: no-reply@notify.915500.xyz
- Host: smtp.resend.com
- Port: 2587
- Old relay dependency: removed
- OTP/Auth/free quota E2E: verified
