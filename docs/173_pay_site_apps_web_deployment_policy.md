# Pay Site Deployment Policy Correction

Date: 2026-04-29

## Corrected Decision

`pay.915500.xyz` must remain on the previous bilingual HWH Extensions static marketplace until the user explicitly approves another website source.

The current accepted production source is:

- source generator: `plugin-engineering-factory/src/site/pluginPages.mjs`
- generated output: `plugin-engineering-factory/generated/plugin-pages/leadfill-one-profile`
- live host: `pay.915500.xyz`
- server target directory: `/opt/commercial-extension-factory/apps/hwh/dist`
- GA4 measurement ID: `G-V93ET05FSR`

The attempted `apps/web` SPA deployment was rejected because it changed the accepted website design and content. It was rolled back on the server.

## Current Deployment Flow

1. Update the static marketplace generator only when the requested change belongs to the current website.
2. Regenerate the static pages.
3. Confirm English and Chinese pages still use the previous marketplace presentation.
4. Confirm GA4 remains installed.
5. Backup `/opt/commercial-extension-factory/apps/hwh/dist`.
6. Deploy the generated static output to `/opt/commercial-extension-factory/apps/hwh/dist`.
7. Verify live English and Chinese routes.
8. Commit and push the matching source and generated output.

## Not Current Production Source

The following must not be deployed to `pay.915500.xyz` without a new explicit approval:

- `apps/web`
- `apps/web/dist`
- React SPA builds that replace the static marketplace layout

## Safety Boundaries

This correction does not authorize:

- Chrome Web Store upload
- Chrome Web Store publish
- production payment activation
- Waffo live mode cutover
- changing webhook source-of-truth rules

Webhook-confirmed entitlement remains the only paid activation source.
