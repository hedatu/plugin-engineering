# California Server Deployment Plan

## Recommended Layout

Use a split layout so code, mutable data, logs, and secrets are isolated:

```text
/opt/commercial-extension-factory/
  repo/
    apps/
      factory/
      hwh/
      plugin-site/
    packages/
    scripts/
    docs/
  deploy/
    compose/
    env/

/var/lib/commercial-extension-factory/
  state/
  runs/
  generated/
  backups/

/var/log/commercial-extension-factory/
  factory-worker/
  review-watch/
  plugin-site/
  backup-jobs/

/etc/commercial-extension-factory/
  env/
  secrets/
```

## Why This Layout

- Repo checkout stays replaceable.
- `state/` and `runs/` survive deploys.
- Logs stay under a standard system path.
- Secrets stay outside the repo and outside artifact snapshots.

## Alternative Layout

If a monorepo-centric layout is preferred later, keep the same separation principle:

```text
/opt/commercial-extension-factory/
  apps/
  packages/
  scripts/
  docs/
  generated/
  logs/
  backups/
  secrets/
  state/
  runs/
```

This is acceptable for a smaller setup, but it is less clean for backup, retention, and permissions.

## Directory Ownership Policy

- application code: deploy user
- mutable state: service account or deploy user
- logs: service user + log collector
- secrets: root or secret-management path with limited read access

## Secret Placement Rules

- Chrome Web Store service account JSON does not go in the project repo.
- HWH service role keys, Waffo private key, webhook secret, and SMTP password stay in server-side env or secret files only.
- The extension package must only receive public config such as `SITE_URL` or `PUBLIC_SUPABASE_URL`.

## Backup Targets

Back up these locations:

- `/var/lib/commercial-extension-factory/state`
- `/var/lib/commercial-extension-factory/runs`
- `/var/lib/commercial-extension-factory/generated`
- `/var/log/commercial-extension-factory` when operational for troubleshooting retention

Send copies to:

- Singapore server
- object storage when approved

## Not Doing In This Round

- No directory creation.
- No package install.
- No systemd/service creation.
- No reverse proxy setup.
- No DNS changes.

