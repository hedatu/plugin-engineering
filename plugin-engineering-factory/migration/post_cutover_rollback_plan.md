# Post-Cutover Rollback Plan

## Rollback Trigger

Rollback if any critical path stays unhealthy for 30 minutes after cutover:

- `pay.915500.xyz` HTTPS does not return frontend `200`.
- `pay-api.915500.xyz` cannot reach API or webhook route.
- OTP send or verify fails on the production hostnames.
- Waffo webhook route cannot return the expected invalid-signature response for unsigned POST.

## Before Rollback

- Preserve Caddy logs from California.
- Preserve Supabase Auth, Kong, Functions, and DB logs from California.
- Preserve the current Cloudflare DNS record values and TTLs.
- Preserve `migration/post_cutover_smoke_report.json` and this rollback plan.

## DNS Rollback

Change Cloudflare DNS A records back to the previous production server:

- `pay.915500.xyz -> <old_server_ip>`
- `pay-api.915500.xyz -> <old_server_ip>`

Use TTL `300` during rollback monitoring if Cloudflare allows it. Keep `ca-hwh.915500.xyz` and `ca-hwh-api.915500.xyz` pointing at California for investigation unless the user explicitly approves removing them.

## Service Rollback

- Do not delete California data.
- Do not stop old server services unless a separate user approval exists.
- Keep California Caddy and Supabase running so logs remain available.
- If needed, restore the previous California frontend dist from `/opt/commercial-extension-factory/apps/hwh/dist.backup-20260423110632`.

## Post-Rollback Validation

- Verify `pay.915500.xyz` frontend health.
- Verify `pay-api.915500.xyz` API reachability.
- Verify OTP send and verify.
- Verify unsigned webhook POST still reaches the expected environment.
- Verify `get-entitlement`, `register-installation`, and free `consume-usage`.

## Current Status

Rollback is prepared but not executed.
