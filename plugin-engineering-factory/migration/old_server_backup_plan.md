# Old Server Backup Plan

## Scope
- Source server alias: `bwg-166`
- Source hostname: `neon-drum-2.localdomain`
- Source IP redacted: `45.62.xxx.xxx`
- Access mode used so far: read-only SSH inspection
- Backup status in this phase: planned and inventoried, not yet copied off-host

## Current Runtime Detected
- Supabase stack containers present:
  - `supabase-analytics`
  - `supabase-auth`
  - `supabase-db`
  - `supabase-edge-functions`
  - `supabase-kong`
  - `supabase-pooler`
  - `supabase-rest`
  - `supabase-studio`
- Web roots present:
  - `/var/www/pay.915500.xyz`
  - `/var/www/pay-api.915500.xyz`
  - `/var/www/hwh.915500.xyz`
  - `/var/www/hwh-api.915500.xyz`
- Supabase project root present: `/opt/supabase-project`
- Systemd unit present: `/etc/systemd/system/leadfill-smtp-bridge.service`
- Existing local backup directory present on old server: `/opt/supabase-project/backups`

## Backup Targets
### Database
- Logical dump or verified existing dump for:
  - `public.products`
  - `public.plans`
  - `public.entitlements`
  - `public.usage_counters`
  - `public.installations`
  - `public.checkout_sessions`
  - `public.orders`
  - `public.payments`
  - `public.processed_webhooks`
  - `public.webhook_events`
  - `auth.users`
  - `auth.sessions`
  - `auth.refresh_tokens`
  - `auth.identities`
  - `auth.audit_log_entries`
  - `auth.mfa_factors`

### Application And Infra Files
- `/opt/supabase-project/docker-compose.yml`
- `/opt/supabase-project/.env`
- `/opt/supabase-project/.env.functions`
- `/opt/supabase-project/docker-compose.nginx.bwg.yml`
- `/var/www/pay.915500.xyz/index.html`
- `/etc/nginx/sites-available/pay.915500.xyz`
- `/etc/nginx/sites-available/pay-api.915500.xyz`
- `/etc/nginx/sites-available/hwh.915500.xyz`
- `/etc/nginx/sites-available/hwh-api.915500.xyz`
- `/etc/systemd/system/leadfill-smtp-bridge.service`

### Factory-Side State To Copy From Workspace
- `state/product_catalog.json`
- `state/release_ledger.json`
- `state/opportunity_backlog.json`
- `generated/plugin-pages/`
- `runs/`

## Backup Procedure
1. Freeze old server writes at the application level during the final backup window.
2. Copy the latest Supabase dump from `/opt/supabase-project/backups` to California and Singapore encrypted backup storage.
3. Export a fresh logical dump if the latest dump predates the final cutover window.
4. Copy redacted infra manifests and full non-repo deployment files into a protected migration bundle on California.
5. Copy pay-site static assets and reverse-proxy configs.
6. Copy Edge Functions source and deployment config.
7. Capture SHA-256 for each copied file and append it to `migration/backup_manifest.json`.
8. Leave the old server online until DNS cutover succeeds and the rollback window expires.

## Integrity Notes
- Existing old-server dump detected:
  - `/opt/supabase-project/backups/pre_membership_migration_20260422002810.dump`
  - `/opt/supabase-project/backups/pre_waffo_product_id_update_20260422062827.dump`
- Config file hashes have already been captured in the manifest for planning.
- Secrets must not be written into repo artifacts. Only redacted presence and file hashes belong here.

## Rollback Readiness
- Keep old server serving current traffic until all California cutover gates pass.
- Do not delete old containers, nginx configs, or backup dumps before a successful 24-hour post-cutover observation window.
- If California fails health checks after cutover, revert DNS to old endpoints and resume traffic there.

## Current Blockers
- Old server expiry date still needs the user to confirm.
- California bootstrap has not been approved yet.
- California runtime is only 1 GB RAM; final production shape may require droplet resize or moving heavy build/render jobs off-box.
- Waffo test payment and webhook-derived entitlement are not yet verified in the new environment.
