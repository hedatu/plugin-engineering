# Remotion Asset Factory

## Goal

Use Remotion as the long-term renderer for premium Chrome Web Store and landing-page marketing assets without turning this repository into a full design toolchain or a fake screenshot generator.

## Asset Targets

The Remotion layer is intended to produce:

- `80_remotion_assets/screenshots/screenshot_1_1280x800.png`
- `80_remotion_assets/screenshots/screenshot_2_1280x800.png`
- `80_remotion_assets/screenshots/screenshot_3_1280x800.png`
- `80_remotion_assets/screenshots/screenshot_4_1280x800.png`
- `80_remotion_assets/screenshots/screenshot_5_1280x800.png`
- `80_remotion_assets/promo/small_promo_440x280.png`
- `80_remotion_assets/promo/marquee_1400x560.png`
- `80_remotion_assets/landing/hero_1600x900.png`
- `80_remotion_assets/landing/pricing_1600x900.png`
- `80_remotion_assets/video/demo_15s.mp4`
- `80_remotion_assets/remotion_render_report.json`

For immutable sandbox runs, these outputs live under `state/run_events/<run_id>/80_remotion_assets/`.

## Source Of Truth

All Remotion props should be generated from:

- `111_premium_packaging_brief.json`
- `112_brand_system.json`
- `114_screenshot_storyboard.json`
- `70_screenshot_manifest.json`
- `61_browser_smoke.json`

This keeps the designed assets tied to the actual product proof and avoids drift between listing visuals and the tested workflow.

## Project Structure

The repository includes a scaffold under `remotion/`:

- `src/index.ts`
- `src/Root.tsx`
- `src/BrandTokens.ts`
- `src/components/`
- `src/compositions/`
- `props/sample.page-context-to-markdown.json`

The scaffold is meant to be reusable across product wedges and future paid experiments.

## Commands

```powershell
npm run assets:remotion:stills -- --run runs/<run_id>
npm run assets:remotion:video -- --run runs/<run_id>
npm run assets:remotion:all -- --run runs/<run_id>
```

## Local Setup

This repository does not assume Remotion is already installed. To enable actual rendering, install dependencies inside `./remotion`:

```powershell
cd remotion
npm install
```

The current Remotion subproject is expected to keep these packages on the same version line:

- `remotion`
- `@remotion/cli`
- `@remotion/player`
- `@remotion/bundler`
- `@remotion/renderer`

If the dependencies are missing, the CLI should:

- write a clean `remotion_render_report.json`
- mark the render status as `skipped`
- avoid fabricating final assets
- leave asset QA and the listing quality gate to block publish

## Windows Notes

- Use JSON props files written under `state/run_events/<run_id>/80_remotion_assets/props/`.
- Do not rely on inline shell JSON for render input.
- Reuse the Chrome executable already captured by browser smoke when available, instead of forcing a fresh browser download.
- Keep all rendered outputs inside the immutable run sidecar directory.

## Quality Rules

- The UI layer in store screenshots must come from a real screenshot manifest source.
- Overlay text must stay concise.
- Promo art should be branded, not a raw screenshot.
- Video should show the real happy path, not an invented team workflow or cloud feature.
- Do not use unlicensed font files.
- Do not call paid external generation APIs from this pipeline.

## Publish Gate

The Remotion pipeline is not optional for premium publish readiness:

- if still assets are missing, `assets:qa` must fail
- if `assets:qa` fails, `packaging:listing-quality-gate` must fail or conditional-fail
- publish stays blocked until the premium assets, dimensions, truthfulness checks, premium feel threshold, store release package, and human visual review are all satisfied

Current threshold:

- `premium_feel_score >= 85`

## Review Checklist

Before trusting the render output, verify:

- dimensions
- file existence
- screenshot traceability
- no misleading claims
- brand consistency
- pricing disclosure if monetized
- no competitor references

## Relationship To Real UI Screenshots

Remotion assets are packaging layers, not evidence on their own.

- The real proof still comes from `70_screenshot_manifest.json` and browser smoke.
- Remotion wraps those real screenshots into store-ready stills.
- `120_store_listing_release_package/` is the final handoff layer that combines those stills with copy, review JSON, and manual dashboard instructions.
- Without that release package, even a successful Remotion render is not enough for upload or publish.
