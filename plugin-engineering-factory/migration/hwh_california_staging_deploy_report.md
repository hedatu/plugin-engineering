# HWH California Staging Deploy Report

- Generated at: `2026-04-22T21:14:46.1861567+08:00`
- Deployment mode: `staging_only`
- Result: `deployed_not_production_ready`

## What Was Deployed

- Supabase Auth / DB / REST / Kong on the existing California `supabase-core`
- Edge Functions service at `/opt/supabase-core/volumes/functions`
- LeadFill web frontend at `/opt/commercial-extension-factory/apps/hwh/dist`
- Caddy staging routes for:
  - `ca-pay.915500.xyz`
  - `ca-pay-api.915500.xyz`

## Verified

- Local HTTPS access works with `curl --resolve ... -k`
- LeadFill schema and seed migrations applied
- `create-checkout-session` on California returns a real Waffo test checkout session
- OTP login works on California staging
- Free usage and quota exhaustion work on California staging

## Important Temporary Compromise

- California staging SMTP is currently relayed through the old server bridge at `45.62.xxx.xxx:2500`
- This was enough to verify OTP in staging
- This is not sufficient for final DNS cutover because the old server is expiring

## Remaining Production Blockers

- Staging DNS not configured yet
- Waffo webhook not verified against California
- Payment-derived entitlement activation not verified against California
- California is still a `low_memory_server`
