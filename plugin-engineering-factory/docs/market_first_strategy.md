# Market-First Micro Launch Strategy

## Why This Exists

The goal is fast, defensible revenue testing. That means the factory does not need a long interview loop for every candidate before it writes code. Some wedges are narrow, low-risk, cheap to build, and better validated by real installs, real usage, and real upgrade intent.

This strategy is for those cases.

## Why Not Large Interview Queues

- interviews are slow and expensive relative to a 1-day or 2-day MVP
- some low-risk workflow helpers are easier to validate with actual behavior than with speculative answers
- the factory still needs evidence, but it can accept medium evidence when the market test is tightly scoped and low downside

## What Can Enter Market-Test Build

A candidate may enter market-test planning when it is:

- single-purpose and explainable in one sentence
- low permission or medium-low permission only
- low policy risk
- not a clone
- low maintenance
- buildable within a strict time box, normally `<= 16` hours
- priceable with a clear free tier and a lifetime unlock
- measurable with minimal product events

## What Cannot Enter Market-Test Build

- high-permission products
- high-policy-risk products
- obvious same-experience clones
- scraping-heavy or login-heavy tools
- broad workflow suites instead of one-job wedges
- products that need a large new builder before the first test

## Price Strategy

Default lifetime ladder:

- `$9`
- `$19`
- `$29`

Default pricing model:

- `free_with_lifetime_unlock`

Default free tier:

- fixed action count, typically `10` actions

The first market test should prefer one-time purchase over subscription unless recurring value is obvious.

## External Payment Strategy

- the extension opens an external payment page
- the extension does not process cards
- no payment secret lives in the extension
- a manual or lightweight license flow is acceptable for MVP
- the listing must disclose paid features clearly
- the market-test landing, pricing stills, and fake-door materials should come from the premium release package once it exists

## Minimal Metrics

The first market test only needs a small schema:

- install
- first_open
- core_action_completed
- free_action_used
- free_limit_reached
- upgrade_clicked
- payment_page_opened
- license_entered
- license_activated
- uninstall_feedback_manual

Defaults:

- local-only counters first
- no page content collection
- no personal sensitive data collection

## Success, Iterate, Kill

Suggested first thresholds:

- `>= 100` landing or listing visits
- `>= 10` installs or signups
- `>= 3` upgrade clicks
- `>= 1` payment intent or explicit would-pay signal

Iterate when:

- users reach the core action but onboarding is weak
- users get value but pricing copy is weak
- the wedge is right but the surface needs simplification

Kill when:

- traffic appears but installs or signups do not
- installs happen but core action usage stays flat
- upgrade intent is absent after meaningful use
- policy or review blockers make the wedge too costly

`no_build` and `kill` are normal outcomes. They are not factory failures.

## Asset Readiness Before Market Test

Passing `115_listing_quality_gate.json` is still not the same as being ready to touch the dashboard or run a higher-trust market test.

Use these gates in order:

1. Render premium assets with Remotion and pass `118_asset_quality_report.json`.
2. Pass `115_listing_quality_gate.json` with `premium_feel_score >= 85`.
3. Generate `120_store_listing_release_package/` so the team has a single local package of screenshots, promo assets, copy, review JSON, and dashboard instructions.
4. Record `121_human_visual_review.json` before any upload or publish path may use those assets.

This matters because the current `0.1.2` pending-review item may not include the newest premium assets. Any future use of the new assets requires a later manual dashboard update or a later asset-update flow. Old draft assets must not be reused once the new release package exists.

## Current Preferred Experiment

The current market-first favorite is:

- `Page Context to Markdown`

Why:

- narrow one-job value
- low permission
- low policy risk
- low overlap
- measurable free-to-paid path
- small estimated build cost

## Hard Safety Rule

Wanting faster revenue does not justify:

- bypassing policy gates
- shipping clone-like experiences
- inflating permissions
- ignoring maintenance cost
- uploading or publishing without later human approval
