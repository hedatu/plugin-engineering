# TODO

## Current Blockers

- Fix self-hosted Supabase Auth SMTP on `/opt/supabase-project/.env`.
  Required server-side variables:
  `SMTP_HOST`
  `SMTP_PORT`
  `SMTP_USER`
  `SMTP_PASS`
  `SMTP_ADMIN_EMAIL`
  `SMTP_SENDER_NAME`
- Align shared Auth public URLs for this project before OTP retest:
  `SITE_URL=https://hwh.915500.xyz`
  `API_EXTERNAL_URL=https://hwh-api.915500.xyz`
  `ADDITIONAL_REDIRECT_URLS=https://hwh.915500.xyz/*,https://pay.915500.xyz/*,chrome-extension://<your-extension-id>/*`
- Confirm whether the shared `supabase-auth` service also needs `GOTRUE_MAILER_EXTERNAL_HOSTS` for `hwh.915500.xyz` and `hwh-api.915500.xyz`.
- Recreate only the `auth` service after real SMTP values are present:
  `docker compose up -d --force-recreate --no-deps auth`

## Current Deployment State

- `https://hwh.915500.xyz` is live.
- `https://hwh-api.915500.xyz` is live and reverse-proxied to the self-hosted Supabase gateway.
- Self-hosted Supabase gateway and Edge Functions runtime are restored.
- Membership migrations and seed have been applied safely without `db reset`.
- `waffo-webhook` is deployed and now rejects unsigned or invalid requests with `401 INVALID_SIGNATURE` before any membership-table writes.
- `create-checkout-session` anonymous access is correctly blocked with `401 LOGIN_REQUIRED`.

## Unverified Runtime Paths

- Real OTP email delivery through the self-hosted Supabase Auth SMTP path.
- Frontend login completion at `https://hwh.915500.xyz/login`.
- Real JWT acquisition from self-hosted Supabase Auth.
- Real `create-checkout-session` returning a Waffo checkout URL for a logged-in user.
- Waffo Dashboard test webhook delivery to `https://hwh-api.915500.xyz/functions/v1/waffo-webhook`.
- Real Waffo Test payment completion and entitlement activation through webhook.
- Chrome extension upgrade flow after the real web checkout path is verified.

## Security Constraints

- Do not expose `WAFFO_PRIVATE_KEY` or `WAFFO_PRIVATE_KEY_BASE64` outside server-only function environment files.
- Do not expose `SUPABASE_SERVICE_ROLE_KEY` to web or extension code.
- Do not run `db reset`, `docker compose down -v`, `docker volume prune`, or delete `/opt/supabase-project/volumes/db`.
- Keep this payment/membership system isolated from the long-term `weiwang.915500.xyz` project entrypoints and domains.`r`n- Shared self-hosted Auth globals were not switched in this step to avoid breaking `weiwang` before OTP redirect behavior is re-verified.


