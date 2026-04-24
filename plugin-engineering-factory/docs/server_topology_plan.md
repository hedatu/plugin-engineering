# Server Topology Plan

## Role Mapping

| Server | Region | Planned role | Deployment status now | Recommended use |
| --- | --- | --- | --- | --- |
| `do-mini-sfo3-01` | California | `primary_factory_server` | inventory only | Plugin factory main host, read-only automation, artifact generation, future hwh migration candidate |
| `do-mini-sgp1-01` | Singapore | `backup_or_staging` | inventory only | Backup target, staging candidate, disaster recovery |

## California Server

Primary role:

- Run plugin factory scheduled jobs.
- Run review-watch on a 6-hour cadence.
- Store `state/`, `runs/`, `generated/`, and release audit artifacts.
- Render plugin detail pages, pricing pages, and Remotion still assets.
- Serve as a future self-hosted runner or worker candidate.
- Remain the first migration candidate for `hwh` / `plugin-site`, but only after the payment stack is re-validated on the new host.

Do not run in phase 0 or phase 1:

- Automatic Chrome Web Store upload.
- Automatic Chrome Web Store publish.
- Production Waffo checkout cutover.
- Production webhook cutover.

## Singapore Server

Primary role:

- Receive replicated backups from California.
- Hold `state/`, `runs/`, `generated/`, `release_ledger`, and product catalog snapshots.
- Act as future staging / DR candidate.
- Stay available for restore testing and emergency failover drills.

Do not run by default:

- Production write actions.
- Chrome Web Store upload or publish.
- Real Waffo webhook handling.
- Final commercial payment traffic.

## Services To Run

California first:

- `factory-worker`
- `review-watch`
- static `plugin-site`
- backup export jobs

Singapore later:

- backup receiver / object-storage sync helper
- restore drill tooling
- optional staging clone after explicit approval

## Services Not To Run Yet

- production `sandbox_upload`
- production `sandbox_publish`
- automatic `final_publish`
- live `hwh-pay-api` cutover
- real payment processing

## Data Directories

Recommended split:

- application code under `/opt/...`
- mutable factory data under `/var/lib/...`
- logs under `/var/log/...`
- secrets under `/etc/...` or `/opt/.../secrets` outside the repo checkout

## Secrets Policy

- Secrets do not live inside the repo.
- Service account JSON does not live under the project checkout.
- `SUPABASE_SERVICE_ROLE_KEY`, `WAFFO_PRIVATE_KEY`, `WAFFO_WEBHOOK_SECRET`, `SMTP_PASSWORD`, and database credentials stay server-side only.
- The extension bundle only consumes public config.

## Backup Policy

- California is the writable primary for factory artifacts.
- Singapore is the first backup target.
- Object storage is the second backup target when enabled.
- Backups must include `state/`, `runs/`, `generated/`, product catalog, and release ledger.
- Secrets are backed up through a separate secret-management workflow, not in artifact snapshots.

## Migration Policy

- No DNS change during inventory and planning.
- No live traffic cutover until California bootstrap and read-only services are stable.
- Every migration step must have a rollback path to the current environment.

## Rollout Phases

1. Inventory only.
2. SSH doctor.
3. California bootstrap with user approval.
4. Factory read-only services.
5. Plugin-site static deployment.
6. HWH migration preparation.
7. Explicit cutover.

## HWH Readiness Note

Historical blocker snapshot recorded in earlier HWH artifacts on `2026-04-22`:

- `SEND_OTP` had returned HTTP `500`.
- Auth was pointed at `supabase-mail:2500`.
- SMTP / OTP were not verified.
- Waffo test payment, webhook writes, and payment-derived entitlement were not verified.

Current planning note:

- SMTP / OTP were later repaired on the existing HWH host on `2026-04-22`.
- HWH is still not migration-ready for California because real Waffo payment, webhook, order/payment rows, and payment-derived entitlement activation still need full end-to-end verification.
- If HWH is moved to California later, SMTP must be designed again for the new host instead of assuming the old fix transfers automatically.
- `LeadFill` must keep `productKey=leadfill-one-profile`.
- `未忘 / weiwang` stays free-only and must remain isolated from LeadFill paid entitlement logic.

