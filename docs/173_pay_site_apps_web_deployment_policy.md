# Pay Site Deployment Policy

Date: 2026-04-29

## Decision

`pay.915500.xyz` must be built and deployed from `apps/web`.

The production source of truth is:

- source: `apps/web`
- build command: `npm run build:web`
- build output: `apps/web/dist`
- deploy command: `npm run deploy:pay-site:web`
- live host: `pay.915500.xyz`
- server target directory: `/opt/commercial-extension-factory/apps/hwh/dist`

The remote directory name still contains `hwh` for historical reasons. It is the serving directory in the Caddy config, not the source-of-truth app name.

## Deprecated Production Source

Do not use these as the future production source for `pay.915500.xyz`:

- `generated/plugin-pages/leadfill-one-profile`
- `plugin-engineering-factory/generated/plugin-pages`
- old static marketplace tarballs under `migration/`

Those files remain valid as history, screenshots, migration evidence, or temporary rollback references, but they are no longer the deployment source of truth.

## Required Deployment Flow

1. Change website source under `apps/web`.
2. Run `npm run build:web`.
3. Run `npm run site:smoke`.
4. Run `npm run security:scan`.
5. Deploy with `npm run deploy:pay-site:web`.
6. Verify live routes on `https://pay.915500.xyz`.
7. Commit and push the source change plus any deployment report.

## Deployment Safeguards

The deploy script must:

- build `apps/web` before packaging
- require `apps/web/dist/index.html`
- require GA4 measurement ID `G-V93ET05FSR` in the built HTML
- upload only the built `apps/web/dist` output
- create a timestamped server backup before replacing production files
- use `rsync --delete` so production matches the build output
- avoid printing secrets

## Current Boundaries

This deployment policy does not authorize:

- Chrome Web Store upload
- Chrome Web Store publish
- production payment activation
- Waffo live mode cutover
- changing webhook source-of-truth rules

Webhook-confirmed entitlement remains the only paid activation source.
