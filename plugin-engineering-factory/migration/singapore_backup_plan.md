# Singapore Backup Plan

## Role
`do-mini-sgp1-01` remains backup and staging, not primary production.

## Backup Targets
- `state/product_catalog.json`
- `state/release_ledger.json`
- `state/opportunity_backlog.json`
- `runs/`
- `generated/plugin-pages/`
- Remotion assets
- store listing release packages
- old-server and California database dumps

## Policy
- Secrets are not part of ordinary backup bundles.
- Secret migration happens separately through protected server-side secret handling.
- Backup archives should be encrypted or at minimum access-restricted.
- Singapore must not run production Waffo webhook or production Chrome Web Store publish by default.

## Suggested Backup Flow
1. California produces dated backup archives.
2. Backup archives are copied to Singapore on a schedule.
3. Integrity hashes are stored alongside backup manifests.
4. Periodic restore tests are performed in staging only.
