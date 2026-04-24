# Premium Product Packaging

## Why This Stage Exists

Users pay more readily for Chrome extensions that look deliberate, credible, and maintained. A narrow wedge can still look cheap if the screenshots, promo art, landing copy, and upgrade visuals feel like a temporary generator output. The premium packaging stage exists to close that gap without inventing features the product does not have.

## Core Rules

- Store screenshots must come from real browser-smoke or real extension UI captures.
- Promo art may be designed, but it must not impersonate unsupported UI.
- Do not use fake trust badges, fake rankings, or fake editorial endorsements.
- Do not use competitor names, logos, or copied UI.
- If the product is monetized, free versus paid must be disclosed in both listing copy and product UI.
- If the product claims local-only, no-login, or no-upload, the bundle and QA evidence must prove it.
- `premium_feel_score` must reach at least `85` before a listing package can be treated as publish-ready.

## Outputs

The premium packaging commands generate:

- `111_premium_packaging_brief.json` and `.md`
- `112_brand_system.json` and `.md`
- `113_store_asset_spec.json` and `.md`
- `114_screenshot_storyboard.json` and `.md`
- `116_product_polish_checklist.json` and `.md`
- `117_landing_page_package.json` and `.md`
- `118_asset_quality_report.json`
- `115_listing_quality_gate.json`
- `120_store_listing_release_package/`
- `120_store_listing_release_package_report.json`
- `121_human_visual_review.json`
- `122_market_test_asset_package.json` and `.md`

For immutable sandbox runs, these are written as sidecar artifacts under `state/run_events/<run_id>/`.

## Stage Logic

1. Build a product packaging brief from the product brief, implementation plan, QA, browser smoke, listing copy, and product acceptance review.
2. Generate a brand system that feels clean, modern, professional, minimal, and trustworthy.
3. Define the store asset spec and screenshot storyboard around real user questions.
4. Generate a landing page package with truthful copy, privacy language, and support placeholders.
5. Run asset QA against premium stills and required dimensions.
6. Run a listing quality gate that blocks publish if the premium feel score is too low or if the assets are misleading or missing.
7. Assemble the approved assets, copy, review JSON, and landing references into a local store release package.
8. Require a human visual review before any upload or publish path may use the packaged assets.

## Asset Dimensions

- Store icon: `128x128`
- Chrome Web Store screenshots: `1280x800`
- Small promo tile: `440x280`
- Marquee: `1400x560`
- Landing hero: `1600x900`
- Pricing visual: `1600x900`

## Store Screenshots Versus Promo Art

Store screenshots:

- must be traceable to real UI captures
- should answer one user question each
- should use restrained overlays only
- should keep the screenshot as the proof layer, with the overlay acting only as framing

Promo art:

- may be composed or branded
- must still reflect real product scope
- should not be a raw screenshot
- should not imply unsupported workflows, integrations, or team features

The relationship is strict:

- real UI screenshots prove the product
- Remotion stills package those screenshots into store-ready layouts
- the packaging layer must not invent buttons, views, or payment states that do not exist

## Premium Feel

The target is not decoration. The target is trustworthy clarity:

- one-sentence value that is easy to repeat
- quiet, professional visual direction
- real proof from screenshots
- literal trust copy
- visible product-maintenance signals such as support, changelog, and pricing disclosure
- crisp composition, short overlay copy, and consistent brand tokens across store and landing assets

## Remotion Dependency Rule

Remotion is the preferred renderer for premium stills and optional promo video. If the local Remotion environment is not installed, the render commands must write a clean skipped report instead of silently faking premium assets. In that case:

- packaging artifacts should still be generated
- landing package should still be generated
- asset QA should fail
- listing quality gate should block publish until the premium assets exist

Local setup:

```powershell
cd remotion
npm install
```

Windows note:

- the still pipeline should reuse the Chrome executable already proven by `61_browser_smoke.json`
- props should be written to JSON files, not passed as inline shell JSON
- renders should land under `state/run_events/<run_id>/80_remotion_assets/`

## Human Review

Before any upload or publish decision, a human should verify:

- screenshot truthfulness
- disclosure accuracy
- premium feel
- support and homepage plans
- pricing honesty if monetized

## Store Release Package

After premium assets render and pass QA, they still need a release-package layer:

- `120_store_listing_release_package/assets/` holds the actual screenshots, promo assets, landing stills, and icon files.
- `120_store_listing_release_package/copy/` holds title, short description, detailed description, privacy summary, paid disclosure, support copy, and changelog copy.
- `120_store_listing_release_package/review/` holds the packaging brief, brand system, storyboard, QA, listing gate, polish checklist, and monetization review inputs.
- `120_store_listing_release_package/asset_gallery.html` is the local offline review page for fast manual inspection.
- `120_store_listing_release_package/dashboard_upload_checklist.md` is the manual dashboard checklist. It is not an upload action.

`115_listing_quality_gate.json` passing is necessary but not sufficient. The release package must also exist, asset QA must stay passed, `premium_feel_score` must stay `>= 85`, paid disclosure must stay truthful, and `121_human_visual_review.json` must be `passed` before any upload or publish path can continue.
