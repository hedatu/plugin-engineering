# Backup And Migration Plan

## Primary / Secondary Model

- California is the future writable primary for the plugin factory.
- Singapore is the first backup and staging target.
- Optional object storage becomes the second backup target when approved.

## Backup Scope

Back up these assets:

- `state/product_catalog.json`
- `state/release_ledger.json`
- `state/opportunity_backlog.json`
- `runs/`
- `generated/plugin-pages/`
- store release packages
- Remotion assets

Do not back up in the same artifact flow:

- service-account private keys
- `.env` files with secrets
- Waffo or Supabase secrets
- SMTP passwords

## Backup Scheduling

Recommended later schedule:

- nightly full snapshot
- 6-hour incremental sync for `state/`
- post-build sync for large generated assets

## California To Singapore Replication

Recommended replication order:

1. `state/`
2. `generated/`
3. `runs/`
4. logs required for current incident windows

## Server Replacement / Migration Steps

1. freeze write operations
2. take a final California snapshot
3. sync artifacts to Singapore or the new host
4. restore code checkout and mutable state paths
5. restore service env from secret management
6. run read-only health checks
7. re-run review-watch and plugin-site smoke checks
8. only then consider service cutover

## Rollback

1. stop new writes on the target host
2. point traffic back to the previous primary
3. restore the last known-good `state/` snapshot if needed
4. compare `release_ledger` and `product_catalog` before resuming jobs

## HWH Migration Caveat

- Do not assume the current HWH SMTP fix transfers automatically to California.
- Rebuild SMTP, Auth URL, webhook routing, and payment E2E checks on the new host.
- Keep `LeadFill` commercial billing isolated from `未忘 / weiwang` free-only logic.

