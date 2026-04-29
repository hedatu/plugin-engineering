# ChatGPT Obsidian Pending Review Site Update

Date: 2026-04-29

## Decision

`ChatGPT Obsidian Local Exporter` must stay marked as pending until Google Chrome Web Store review is approved.

## Website Changes

- Added the plugin to the `apps/web` fallback product catalog.
- Set its launch status to `pending_review`.
- Set its Chrome Web Store status to `pending_review`.
- Disabled Add to Chrome for this plugin.
- Disabled checkout buttons for monthly, annual, and lifetime plans.
- Kept pricing visible as planned packages only:
  - monthly: `$9`
  - annual: `$29`
  - lifetime: `$39.90`
- Added legacy route aliases:
  - `/chatgpt-obsidian-local-exporter.html`
  - `/chatgpt-obsidian-local-exporter-pricing.html`
- Updated site shell branding from LeadFill-specific copy to `HWH Extensions`.

## Live Verification

Verified after deployment:

- `/products` shows `ChatGPT Obsidian Local Exporter` first with `Pending Google review`.
- `/products/chatgpt-obsidian-local-exporter` says the plugin is waiting for Google review.
- `/products/chatgpt-obsidian-local-exporter/pricing` shows plans but all checkout buttons remain disabled.
- `/chatgpt-obsidian-local-exporter.html` redirects to the canonical product page.
- LeadFill remains published with its Chrome Web Store install link.

## Deployment

Built and deployed from `apps/web` according to the pay-site deployment policy.

Server backups created during this update:

- `/opt/commercial-extension-factory/backups/apps-web-dist-pre-deploy-20260429-145028`
- `/opt/commercial-extension-factory/backups/apps-web-dist-pre-deploy-20260429-145231`
- `/opt/commercial-extension-factory/backups/apps-web-dist-pre-deploy-20260429-145518`
- `/opt/commercial-extension-factory/backups/apps-web-dist-pre-deploy-20260429-145746`
- `/opt/commercial-extension-factory/backups/apps-web-dist-pre-deploy-20260429-145912`

## Safety

- No Chrome Web Store upload.
- No Chrome Web Store publish.
- No production payment activation.
- No Waffo live checkout.
- No secret was added to frontend source.
