# Security Secret Cleanup Report

Date: 2026-04-24
Repository: plugin-engineering
Scope: emergency secret cleanup only

## Incident Summary

- A private key file existed at `supabase/WAFFO_PRIVATE_KEY.txt`.
- `.gitignore` already listed the file, but the file still appeared in the GitHub repository tree, which means it had already been committed into repository history on the remote side.
- This must be treated as a credential leak if the repository was exposed outside a strictly trusted boundary.

## Actions Completed

1. Deleted the local working-tree file:
   - `supabase/WAFFO_PRIVATE_KEY.txt`
2. Expanded `.gitignore` to block:
   - `supabase/WAFFO_PRIVATE_KEY.txt`
   - `*WAFFO_PRIVATE_KEY*`
   - `*.pem`
   - `*.key`
   - `.env`
   - `.env.local`
   - `.env.production`
   - `secrets/`
3. Added a repository scan script:
   - `scripts/secret_scan.mjs`
4. Re-ran a local secret scan after removal.

## Current Tree Status

- Local working tree: `supabase/WAFFO_PRIVATE_KEY.txt` removed
- Ignore rules: strengthened
- Local scan result after removal:
  - high-confidence secret findings: `0`
  - review-only findings: variable-name references and operational docs only

## Remaining Risk

The key must be considered compromised if it was ever pushed to GitHub.

Deleting the file from the current tree is not sufficient because:

- git history still retains the earlier commit that contained the file
- GitHub commit history can still reveal that earlier object unless history is rewritten and the credential is rotated

Known history evidence:

- remote commit containing the leaked file path:
  - `914aeb1942914fb61281e369a597b7cc351d377f`

## Review-Only Findings

The post-removal scan still found review-only references to secret variable names. These are not the same as confirmed leaked credential values, but they should be reviewed to keep the repo clean and reduce future risk.

Main categories still referenced in docs or example files:

- `SUPABASE_SERVICE_ROLE_KEY`
- `WAFFO_PRIVATE_KEY`
- `WEBHOOK_SECRET`
- `SMTP_PASSWORD`
- `RESEND_API_KEY`
- `CF_API_TOKEN`

Representative paths that should be reviewed for wording and exposure hygiene:

- `docs/leadfill_hwh_integration_handoff.json`
- `docs/env-matrix.md`
- `plugin-engineering-factory/.env.server.example`
- `plugin-engineering-factory/docs/server_env_matrix.md`
- `plugin-engineering-factory/docs/server_topology_plan.md`
- `plugin-engineering-factory/migration/hwh_california_env.example`
- `plugin-engineering-factory/migration/california_env_matrix.md`
- `server_migration_readiness.md`

These were flagged because they mention secret variable names or operational secret concepts. The scan did not identify a remaining high-confidence inline secret value after the private key file was removed.

## Required Credential Rotation

The following credential must be rotated immediately:

1. Waffo private key

Required response:

- revoke or rotate the exposed Waffo private key in the Waffo backend
- replace it everywhere it was used
- verify webhook signing and checkout signing against the new key only

Recommended additional review:

- confirm that no copied backup, env export, or deployment note contains the old key
- confirm no operator machine or server still uses the leaked key file

## Recommended Next Security Step

1. Rotate the Waffo private key immediately.
2. Remove the file from the current remote tree.
3. Decide whether to rewrite git history for the leaked path.
4. Re-run `node scripts/secret_scan.mjs .` after any additional cleanup.
