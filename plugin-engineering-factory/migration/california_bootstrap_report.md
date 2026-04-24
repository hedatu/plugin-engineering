# California Bootstrap Report

- bootstrap_started_at: 2026-04-22T19:48:00+08:00
- bootstrap_completed_at: $now
- deploy user: deploy (created)
- node/npm: 18.19.1 / 9.2.0
- docker/docker compose: vailable
- reverse proxy: caddy 2.6.2 active
- firewall: ufw active, allow inbound 22/80/443
- memory warning: low_memory_server
- swap: 2G present

## Created Directories
- /opt/commercial-extension-factory/apps
- /opt/commercial-extension-factory/apps/factory
- /opt/commercial-extension-factory/apps/hwh
- /opt/commercial-extension-factory/apps/plugin-site
- /opt/commercial-extension-factory/packages
- /opt/commercial-extension-factory/state
- /opt/commercial-extension-factory/runs
- /opt/commercial-extension-factory/generated
- /opt/commercial-extension-factory/logs
- /opt/commercial-extension-factory/backups
- /opt/commercial-extension-factory/secrets

## Warnings
- California is a 1 GB RAM / 1 vCPU droplet.
- Pre-existing Docker containers are already running on California.
- Host ports 5432 and 8000 are published by existing containers and must be audited before HWH staging deploy.

## Next Step
- Wait for user approval before deploying HWH staging onto California.