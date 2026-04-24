# SMTP Root Cause Report

- Checked at: `2026-04-22T19:05:36.8297619+08:00`
- Historical broken SMTP target: `supabase-mail:2500`
- Current SMTP target: `172.18.0.1:2500`
- `supabase-mail` resolves from auth container now: `false`
- `supabase-mail:2500` reachable from auth container now: `false`
- Current sender: `support@915500.xyz`
- Current SMTP user present: `false`
- Current SMTP password present: `false`
- `SITE_URL`: `https://pay.915500.xyz`
- `API_EXTERNAL_URL`: `https://pay-api.915500.xyz`
- `GOTRUE_SITE_URL`: `https://pay.915500.xyz`
- `GOTRUE_URI_ALLOW_LIST`:
  - `https://pay.915500.xyz/*`
  - `https://hwh.915500.xyz/*`
  - `chrome-extension://*/*`
- `GOTRUE_MAILER_EXTERNAL_HOSTS` includes:
  - `pay.915500.xyz`
  - `pay-api.915500.xyz`
  - `hwh.915500.xyz`
  - `hwh-api.915500.xyz`
- Current magic link host: `pay-api.915500.xyz`
- `weiwang.915500.xyz` still used as default auth domain: `false`

## Historical Failure

The original live failure was:

`dial tcp: lookup supabase-mail on 127.0.0.11:53: server misbehaving`

That confirmed the problem was a nonexistent SMTP service target, not just a wrong password.

## Root Cause

The old HWH stack still had placeholder GoTrue SMTP config:

- `SMTP_HOST=supabase-mail`
- `SMTP_PORT=2500`
- fake sender credentials

No `supabase-mail` service existed on the Docker network, so `SEND_OTP` returned HTTP `500` before any real email could be sent.

## Current Diagnosis

- Auth is no longer using `supabase-mail:2500`.
- Auth now uses `172.18.0.1:2500`.
- Real OTP email delivery is working.
- Real `VERIFY_OTP` is working.
- Current magic link emails target `pay-api.915500.xyz`, not `weiwang.915500.xyz`.
- `pay.915500.xyz` is in the URI allow list.
- `pay-api.915500.xyz` is not in `GOTRUE_URI_ALLOW_LIST`, but it is present in `GOTRUE_MAILER_EXTERNAL_HOSTS`, which is the relevant host control for the generated API-hosted magic link.

## Implemented Repair

- Stopped using the nonexistent `supabase-mail:2500`
- Configured Auth to use `172.18.0.1:2500`
- Kept `SITE_URL`, `API_EXTERNAL_URL`, and `GOTRUE_SITE_URL` on the `pay.*` domains
- Verified real `SEND_OTP` and `VERIFY_OTP` both return `200`

## Recommendation

Do not migrate to California solely because of SMTP. The old environment has already been repaired enough to unblock OTP. The next blocker is Waffo payment/webhook E2E, not SMTP.
