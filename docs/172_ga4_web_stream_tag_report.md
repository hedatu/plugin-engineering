# GA4 Web Stream Tag Report

Date: 2026-04-29

## GA4 Stream

- Property/account visible in GA4: `hwh插件`
- Web stream URL: `https://pay.915500.xyz`
- Stream ID: `14642611837`
- Measurement ID: `G-V93ET05FSR`

## Website Tag Install

- Added the Google tag snippet for `G-V93ET05FSR` to the web app HTML template.
- Installed the same tag on the currently deployed static HWH marketplace site.
- Server deployment target verified: `/opt/commercial-extension-factory/apps/hwh/dist`
- Pre-deploy server backup created: `/opt/commercial-extension-factory/backups/hwh-dist-pre-ga4-20260429-134200`

## Live Verification

Checked these live routes on `https://pay.915500.xyz`; all returned HTTP 200 and contained the GA4 tag:

- `/`
- `/products/index.html`
- `/products/leadfill-one-profile/`
- `/products/leadfill-one-profile/pricing/`
- `/account.html`
- `/checkout/success.html`
- `/checkout/cancel.html`
- `/privacy.html`
- `/terms.html`
- `/zh-cn/index.html`

## Notes

- GA4 may still show "no data received" for a short period after first install.
- This change does not alter checkout, webhook, entitlement, Chrome upload/publish, or production payment behavior.
