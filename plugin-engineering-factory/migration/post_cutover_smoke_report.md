# Post-Cutover Smoke Report

- DNS cutover executed: `true`
- Primary environment: `california`
- `pay.915500.xyz`: resolves to `134.199.226.198`, HTTPS `200`
- `pay-api.915500.xyz`: resolves to `134.199.226.198`, webhook GET `405`
- Unsigned webhook POST: `401 INVALID_SIGNATURE`
- OTP: `SEND_OTP` and `VERIFY_OTP` verified with Resend
- Email link hosts: `pay.915500.xyz`, `pay-api.915500.xyz`
- Entitlement/install/free quota: verified, including 11th-attempt `QUOTA_EXCEEDED`
- Checkout smoke: test-mode `create-checkout-session` verified; no payment completed
- Review-watch: California read-only fetch verified with `STAGED`
- Production payment: `not_verified`
- Chrome upload/publish: not executed

## Accepted Risk

- `low_memory_server`: the user accepted California `1GB RAM + 2GB swap` as a temporary risk. This is not an ideal production sizing claim.

## Safety Notes

- The checkout success URL does not unlock membership locally.
- Entitlement activation remains webhook-driven.
- Old server services and data were not stopped or deleted.
