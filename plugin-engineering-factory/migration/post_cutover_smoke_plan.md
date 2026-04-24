# Post-Cutover Smoke Plan

Run this only after final user approval and DNS cutover. Keep payment in test mode.

## `pay.915500.xyz` Health

- Resolve `pay.915500.xyz` and confirm A record is `134.199.226.198`.
- Open `https://pay.915500.xyz`.
- Confirm the HWH frontend loads.
- Confirm LeadFill pages load and do not reference `ca-pay` / `ca-pay-api`.

## `pay-api.915500.xyz` Health

- Resolve `pay-api.915500.xyz` and confirm A record is `134.199.226.198`.
- Check `https://pay-api.915500.xyz/auth/v1/settings` with the public anon key.
- Check `GET https://pay-api.915500.xyz/functions/v1/waffo-webhook` returns 405.
- Check unsigned POST to `https://pay-api.915500.xyz/functions/v1/waffo-webhook` returns `INVALID_SIGNATURE`.

## OTP Login

- SEND_OTP to a real mailbox.
- Confirm email delivery from Resend sender `no-reply@notify.915500.xyz`.
- Confirm magic link / OTP link host is `pay.915500.xyz` or `pay-api.915500.xyz`.
- VERIFY_OTP.
- Confirm session creation.

## Create Checkout Session

- Use `productKey=leadfill-one-profile`.
- Use `planKey=lifetime`.
- Use test checkout mode only.
- Confirm `create-checkout-session` returns a Waffo sandbox checkout URL.
- Confirm metadata includes `productKey`, `planKey`, `userId`, `localOrderId`, and `installationId` when using plugin source.

## Waffo Test Webhook

- Use only Waffo test/sandbox mode.
- Confirm Waffo test webhook URL is `https://pay-api.915500.xyz/functions/v1/waffo-webhook` if testing production hostnames.
- Complete a sandbox test payment only.
- Confirm webhook received.
- Confirm signature verified.
- Confirm `processed_webhooks`, `webhook_events`, `orders`, and `payments` update.
- Confirm entitlement becomes active only from webhook processing, not from successUrl.

## Get Entitlement

- Call `get-entitlement` for `productKey=leadfill-one-profile`.
- Confirm active lifetime entitlement after webhook-derived payment.
- Confirm free entitlement for a fresh unpaid user.
- Confirm `weiwang` remains free-only and isolated from LeadFill entitlement.

## Consume Usage

- For an unpaid user, confirm 10 free `leadfill_fill_action` usages are allowed.
- Confirm the 11th unpaid usage returns `QUOTA_EXCEEDED`.
- For a paid webhook-derived active entitlement, confirm Pro usage is allowed.

## Monitoring Window

- Monitor HWH frontend, API, Auth, Edge Functions, Caddy, and Docker health for 24 hours.
- Monitor Resend delivery status.
- Monitor Waffo test webhook delivery if smoke testing payments.
- Keep rollback DNS values ready during the observation window.
- Do not enable production payment or Chrome upload/publish during smoke.
