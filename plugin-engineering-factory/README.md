# Chrome Extension Opportunity Factory

This repository runs the Chrome Extension Opportunity Factory as an auditable file-producing workflow. The factory is allowed to end with `no_build_today` when discovery quality, overlap, evidence, testability, or compliance gates do not justify a build.

## Stage Order

`INGEST_TASK -> DISCOVER_CANDIDATES -> ENRICH_FEEDBACK -> CLUSTER_PAIN_POINTS -> SCORE_OPPORTUNITIES -> BUILD_GATE -> DISCOVERY_QUALITY_REVIEW -> RESEARCH_MORE_RESOLUTION -> TARGETED_RESEARCH_BATCH -> TARGETED_RESEARCH_ROUND_2 -> QUERY_EXPANSION -> DISCOVERY_STRATEGY_V2 -> RUN_STRATEGY_V2 -> DISCOVERY_STRATEGY_REVIEW -> WRITE_BRIEF -> PLAN_IMPLEMENTATION -> BUILD_EXTENSION -> RUN_QA -> BROWSER_SMOKE_AND_CAPTURE -> GENERATE_ASSETS -> RUN_POLICY_GATE -> DECIDE_PUBLISH_INTENT -> PREPARE_LISTING_PACKAGE -> HUMAN_APPROVAL_GATE -> EXECUTE_PUBLISH_PLAN -> REVIEW_STATUS -> MONITOR_POST_RELEASE -> CLOSE_RUN`

## Core Rules

- The factory is not required to build every day.
- Discovery evidence, wedge clarity, testability, overlap, compliance, and product-acceptance forecast must pass together before a build is allowed.
- `state/opportunity_backlog.json` tracks discovered opportunities. `state/portfolio_registry.json` tracks wedges the factory already built, validated, revised, or published.
- Promotion is the only valid entry into sandbox upload or publish.
- Sandbox and production writes remain human-gated.

## Main Commands

```powershell
npm run smoke
npm run daily
npm run daily:live
npm run daily:no-go
npm run discovery:benchmark

npm run backlog:inspect
npm run backlog:validate
npm run registry:inspect
npm run registry:validate
npm run ledger:inspect
npm run ledger:validate

npm run discovery:live-queue -- --queries-from runs/<daily_run_id>/34_demand_discovery_improvement_plan.json --limit 10 --max-candidates 50
npm run discovery:score-queue -- --queue runs/<live_queue_run>/41_live_candidate_queue.json
npm run discovery:select-next-build-candidate -- --scores runs/<live_queue_run>/43_batch_opportunity_scores.json
npm run discovery:targeted-research-batch -- --run runs/<live_queue_run> --top 10
npm run discovery:targeted-research-round2 -- --run runs/<live_queue_run> --top 5
npm run discovery:expand-queries -- --from-run runs/<live_queue_run>
npm run discovery:live-queue-round2 -- --queries runs/<live_queue_run>/50_query_expansion_plan.json --limit 20 --max-candidates 80
npm run discovery:strategy-v2 -- --from-run runs/<live_queue_round2_run>
npm run discovery:run-strategy-v2 -- --strategy runs/<strategy_run>/57_low_overlap_search_map.json --limit 30 --max-candidates 120
npm run discovery:strategy-review -- --from-run runs/<live_queue_round2_run>
npm run discovery:record-strategy-decision -- --run runs/<strategy_review_run> --decision manual_vertical_seed|continue_strategy_v2|prioritize_builder|pause_category|adjust_thresholds --note "human note"
npm run discovery:create-next-task-from-strategy -- --strategy-run runs/<strategy_review_run> --decision-file state/discovery_strategy_reviews/<decision_file>.json
npm run discovery:run-seed-task -- --task runs/<strategy_review_run>/67_next_discovery_task.json
npm run discovery:support-qa-deep-dive -- --run runs/<seed_discovery_run_id>
npm run discovery:support-qa-evidence-sprint -- --run runs/<seed_discovery_run_id> --candidate Jam
npm run discovery:create-demand-validation-plan -- --candidate Jam --wedge page-context-to-markdown
npm run discovery:rescore-candidate-with-manual-evidence -- --candidate Jam
npm run discovery:money-wedge-generator
npm run discovery:create-fake-door-test -- --candidate page-context-to-markdown
npm run monetization:security-scan -- --run runs/<run_id>
npm run market:select-micro-mvp
npm run monetization:create-fake-door -- --candidate Jam
npm run experiment:score-paid-interest -- --experiment page-context-to-markdown
npm run market:approve-micro-mvp -- --candidate "Page Context to Markdown" --note "approve micro MVP build scope"
npm run packaging:premium -- --run runs/<run_id>
npm run site:premium-web-redesign -- --product leadfill-one-profile
npm run commercial:public-launch-prep -- --run runs/<run_id> --product leadfill-one-profile
npm run packaging:store-release-package -- --run runs/<run_id>
npm run packaging:record-human-visual-review -- --run runs/<run_id> --decision passed|revise|blocked --note "human note"
npm run assets:remotion:stills -- --run runs/<run_id>
npm run assets:remotion:video -- --run runs/<run_id>
npm run assets:remotion:all -- --run runs/<run_id>
npm run assets:qa -- --run runs/<run_id>
npm run packaging:listing-quality-gate -- --run runs/<run_id>
npm run commercial:create-release-revision -- --from-run runs/<sandbox_validation_run_id> --target-version 0.2.0 --note "commercial release with payment and premium packaging"
npm run discovery:record-manual-evidence -- --candidate <candidate_id> --source "customer interview" --note "user voice" --supports-wedge "local_bug_report_context_copier"
npm run discovery:record-human-candidate-review -- --candidate <candidate_id> --decision approve_build|research_more|skip --note "human note"

npm run factory:promote-to-sandbox -- --from-run runs/<daily_run_id> --publisher <publisher_id> --item <sandbox_item_id> --note "promotion note"
npm run sandbox:inspect -- --run runs/<sandbox_validation_run_id>
npm run sandbox:validate -- --run runs/<sandbox_validation_run_id>
npm run publish:review-status -- --run runs/<sandbox_validation_run_id>
npm run review-watch:credentials-doctor
npm run review-watch:inspect
npm run review-watch:validate
npm run review-watch:all
```

## Discovery Ladder

The factory now resolves discovery in ordered passes:

1. Live queue discovery and scoring.
2. `TARGETED_RESEARCH_BATCH` for top `research_more` candidates.
3. `TARGETED_RESEARCH_ROUND_2` as the last allowed targeted research pass.
4. `QUERY_EXPANSION` to widen the search surface when round 2 still finds no build-ready candidate.
5. `DISCOVERY_STRATEGY_V2` plus `RUN_STRATEGY_V2` when the factory needs a search-space shift instead of deeper loops on the same candidate family.
6. `DISCOVERY_STRATEGY_REVIEW` after repeated `no_build_today`, so a human can choose manual seeds, pause categories, or roadmap-only builder options.

`research_more` is not a soft yes. After round 2 there must be no residual `research_more`; candidates must resolve to `build_ready`, `skip`, or a backlog waiting state.

## Build-Ready Rules

High installs alone are not enough. A candidate is only build-worthy when all of these are true:

- user pain converts into a narrow single-purpose wedge
- happy path is clearly testable
- evidence quality is strong enough
- permission and compliance posture is low-risk
- portfolio overlap is low enough
- the candidate fits an existing builder, or future-builder status is explicitly kept as roadmap only

For tab/export opportunities, overlap with `tab_csv_window_export` is a hard check. For form-fill opportunities, generic overlap with LeadFill One Profile is a hard check.

The current example is intentional:

- `cand-tab-001 / Window Tabs Exporter` stays `skip`
- `portfolio_overlap_score=74`
- strong wedge clarity and testability still did not justify another same-family build

## Strategy V2

When round 2 still ends with `no_build_today`, the next move is strategy shift, not another research loop:

```powershell
npm run discovery:strategy-v2 -- --from-run runs/<live_queue_round2_run>
npm run discovery:run-strategy-v2 -- --strategy runs/<strategy_run>/57_low_overlap_search_map.json --limit 30 --max-candidates 120
```

Strategy V2 writes:

- `55_discovery_strategy_v2.json`
- `56_builder_fit_map.json`
- `57_low_overlap_search_map.json`
- `58_source_priority_model.json`

The runner writes:

- `59_strategy_v2_query_results.json`
- `60_strategy_v2_candidate_scores.json`
- `61_strategy_v2_next_candidate.json`
- `62_no_build_today_report.json` when no candidate clears the stricter Strategy V2 gate

Strategy V2 uses stricter gates than the generic live queue. A candidate is not build-ready unless it clears:

- stronger evidence quality
- stronger wedge clarity
- stronger testability
- lower portfolio overlap
- low enough permission and compliance risk
- at least two independent evidence source types
- no weak pain clusters blocking a clear happy path
- an expected functional test matrix for the current builder family

`future_builder_candidate` is roadmap evidence only. It does not authorize building a new builder immediately.

## Strategy Review

When Strategy V2 still ends in `no_build_today`, the next move is a strategy review, not automatic threshold loosening and not another same-family search loop:

```powershell
npm run discovery:strategy-review -- --from-run runs/<live_queue_round2_run>
npm run discovery:record-strategy-decision -- --run runs/<strategy_review_run> --decision manual_vertical_seed|continue_strategy_v2|prioritize_builder|pause_category|adjust_thresholds --note "human note"
npm run discovery:create-next-task-from-strategy -- --strategy-run runs/<strategy_review_run> --decision-file state/discovery_strategy_reviews/<decision_file>.json
```

This stage writes:

- `63_discovery_strategy_review.json`
- `64_builder_roadmap_evaluation.json`
- `65_manual_seed_plan.json`
- `66_threshold_calibration_review.json`
- `67_next_discovery_task.json` after a human strategy decision is recorded

The default posture is:

- quality over throughput
- manual seeds are preferred over repeating high-overlap searches
- future builder ideas stay roadmap-only until repeated low-overlap evidence justifies them
- thresholds should not auto-loosen just because no candidate was build-ready

## Current Manual Seeds

The current approved manual seed set is:

- `seed-support-qa-handoff`
- `seed-saas-admin-cleanup`
- `seed-developer-payload`

Why these seeds:

- support and QA handoff looks lower-overlap than generic tab or autofill families and keeps the workflow local-only
- SaaS admin cleanup targets copy-paste friction instead of another tab/export variant
- developer payload utility is useful as a monitor-only signal for a future builder category, not for immediate builder expansion

`seed-developer-payload` stays monitor-only. It can produce future-builder evidence, but it must not trigger builder implementation in the current round.

## Seed Discovery

After recording a manual strategy decision, generate the next seed task and run the seed discovery loop:

```powershell
npm run discovery:create-next-task-from-strategy -- --strategy-run runs/<strategy_review_run> --decision-file state/discovery_strategy_reviews/<decision_file>.json
npm run discovery:run-seed-task -- --task runs/<strategy_review_run>/67_next_discovery_task.json
```

This writes:

- `68_seed_query_plan.json`
- `69_seed_discovery_results.json`
- `70_seed_candidate_queue.json`
- `71_seed_opportunity_scores.json`
- `72_seed_next_candidate.json`
- `73_seed_discovery_ops_report.md`
- `74_seed_performance_report.json`
- `75_seed_human_candidate_review_queue.json`

## Support/QA Handoff Deep Dive

`seed-support-qa-handoff` is the current priority seed because it produced the best lower-overlap follow-up candidate set, even though it still did not clear build-ready gates. The focused deep dive exists to answer one narrower question: can support or QA handoff collapse into a local-only, low-permission micro-wedge that is meaningfully different from the current portfolio and realistic to test?

Run it explicitly:

```powershell
npm run discovery:support-qa-deep-dive -- --run runs/<seed_discovery_run_id>
```

Rules for this deep dive:

- keep the wedge local-only
- no automatic sending
- no remote upload
- no external issue creation
- prefer copy-ready Markdown or a local download over screenshots or integrations
- Jam is only an evidence source, not a product to clone

The preferred shape is a micro-wedge such as a bug handoff context copier, repro steps helper, or environment packet. Generic screenshot tools, generic bug reporters, and anything that drifts into a hosted workflow should stay `research_more`, `backlog_waiting_for_evidence`, or `skip`.

## Support/QA Evidence Sprint

`Jam` is still not build-ready. The blocker is not engineering feasibility or overlap. The blocker is external user voice proving that people want a local-only, text-first support or QA handoff helper instead of a screenshot, recording, or upload workflow.

Run the final signal check explicitly:

```powershell
npm run discovery:support-qa-evidence-sprint -- --run runs/<seed_discovery_run_id> --candidate Jam
```

This stage does not build anything. It only resolves the candidate to one of:

- `human_candidate_review_ready`
- `backlog_waiting_for_evidence`
- `skip`

Rules for this sprint:

- Jam is an evidence source, not a product to clone
- the wedge must stay local-only and low-permission
- no automatic sending
- no automatic Jira, Linear, or GitHub issue creation
- no remote upload
- no screenshot-first requirement

The current preferred wedge is `Page Context to Markdown`: a local-only handoff note with page URL, title, browser info, timestamp, and user-entered repro steps.

Use manual evidence when a real customer, support workflow, or interview proves the pain:

```powershell
npm run discovery:record-manual-evidence -- --candidate <candidate_id> --source "customer interview" --note "user voice" --supports-wedge "local_bug_report_context_copier"
```

Manual evidence is the intended bridge from `backlog_waiting_for_evidence` to human candidate review. It does not bypass the build gate.

## Premium Packaging

Build-ready or market-test candidates should not look like temporary generator output. The premium packaging system produces a truthful brand system, screenshot storyboard, landing-page package, and asset-quality gate before any publish decision is allowed.

Use:

```powershell
npm run packaging:premium -- --run runs/<run_id>
npm run packaging:store-release-package -- --run runs/<run_id>
npm run packaging:record-human-visual-review -- --run runs/<run_id> --decision passed|revise|blocked --note "human note"
npm run assets:remotion:stills -- --run runs/<run_id>
npm run assets:qa -- --run runs/<run_id>
npm run packaging:listing-quality-gate -- --run runs/<run_id>
```

Install Remotion locally when the still pipeline is expected to render for real:

```powershell
cd remotion
npm install
```

Rules:

- Store screenshots must stay traceable to real browser-smoke captures.
- Promo art may be branded, but must not invent unsupported UI or claims.
- The still renderer reads props from `state/run_events/<run_id>/80_remotion_assets/props/<product>.json` and uses the real screenshot manifest as the proof layer.
- On Windows, the render bridge reuses the Chrome executable recorded in `61_browser_smoke.json` instead of downloading a separate browser.
- Chrome Web Store screenshot dimensions must be `1280x800`, small promo must be `440x280`, marquee must be `1400x560`, and landing hero and pricing images must be `1600x900`.
- If Remotion is not installed locally or the still render has not completed, the listing quality gate must block publish until premium assets exist.
- The landing package is generated locally under `landing/<product_slug>/`.
- The premium asset sidecars for immutable sandbox runs live under `state/run_events/<run_id>/80_remotion_assets/`.
- Premium assets are not dashboard-ready until they are assembled into `120_store_listing_release_package/`.
- `listing-quality-gate` passing does not mean anything was uploaded to the Chrome Web Store dashboard.
- Human visual review is a separate commercial-quality gate. Until `121_human_visual_review.json` is `passed`, sandbox upload or publish must stay blocked.
- The current `0.1.2` pending-review item may not include the newest premium assets. Reusing those assets requires a later manual dashboard update or a later automated listing-asset update flow.
- Old draft assets must not be reused once the release package exists.
- `premium_feel_score` must reach at least `85` before the listing package can be considered publish-ready.

## Premium Web Redesign

The plugin website has a separate premium redesign stage for payment-configured commercial candidates:

```powershell
npm run site:premium-web-redesign -- --product leadfill-one-profile
```

This stage regenerates `generated/plugin-pages/<product>/` and writes these web quality artifacts to the run event sidecars:

- `141_web_redesign_plan.json` and `.md`
- `142_web_design_system.json`
- `143_product_page_quality_review.json`
- `144_checkout_page_quality_review.json`
- `145_site_visual_consistency_report.json`

Rules:

- Keep production payment status truthful when checkout mode is still test or controlled.
- Do not let success pages unlock membership locally; entitlement remains webhook-confirmed.
- Do not include service-role keys, Waffo private keys, merchant secrets, or webhook secrets in generated pages.
- Do not mention legacy product keys as a LeadFill configuration source.
- Passing web quality does not authorize Chrome upload, Chrome publish, or production payment.

## Market-First Micro Launch

The factory now supports a market-first path for low-risk, low-cost wedges that are easier to validate with real installs, core action usage, and upgrade intent than with a long interview loop.

Use:

```powershell
npm run market:select-micro-mvp
npm run monetization:create-fake-door -- --candidate Jam
npm run experiment:score-paid-interest -- --experiment page-context-to-markdown
npm run market:approve-micro-mvp -- --candidate "Page Context to Markdown" --note "approve micro MVP build scope"
```

This path writes:

- `103_market_test_plan.json`
- `104_market_first_build_gate.json`
- `105_micro_mvp_selection.json`
- `106_market_test_metrics_spec.json`
- `107_market_test_launch_plan.json`
- `108_page_context_market_test_plan.json`

Payment and upgrade planning stays external-first:

- `96_payment_link_flow_plan.json`
- `97_license_activation_spec.json`
- `98_value_first_paywall_rules.json`

The current default model is:

- `free_with_lifetime_unlock`
- free limit of `10` actions
- lifetime price testing at `$9`, `$19`, or `$29`
- external payment link plus manual or lightweight license handling

Market-first does not bypass safety rules:

- no high-permission or high-policy-risk MVPs
- no clone launches
- no upload or publish without later human approval
- no build unless a human explicitly approves the micro MVP scope
- `no_build` and `kill` are normal outcomes

## Demand Validation Loop

When `Jam / Page Context to Markdown` remains blocked on user voice, the next step is demand validation, not a forced build:

```powershell
npm run discovery:create-demand-validation-plan -- --candidate Jam --wedge page-context-to-markdown
npm run discovery:rescore-candidate-with-manual-evidence -- --candidate Jam
```

This loop exists for candidates parked in `backlog_waiting_for_evidence`.

- `backlog_waiting_for_evidence` is not failure. It means the wedge still looks plausible, but outside user voice is missing.
- Strong manual evidence requires at least two independent sources beyond self-observation.
- A candidate should stay parked if the only new input is our own speculation.
- A candidate should be skipped if manual evidence shows users really want screenshot, video, or upload-heavy workflows instead.
- `Page Context to Markdown` is not build-ready until manual evidence proves that people want a local-only, text-first, clipboard-first handoff helper.

The expected promotion path is:

1. Record real user voice with `discovery:record-manual-evidence`.
2. Re-run `discovery:rescore-candidate-with-manual-evidence`.
3. Move to `human_candidate_review_ready` only if evidence, overlap, testability, and compliance still clear the gate.

Manual evidence examples live in [docs/examples/manual_evidence_examples.md](/D:/code/ai插件优化工作流/docs/examples/manual_evidence_examples.md).

## Money-First Opportunity Engine

The factory is allowed to optimize for fast monetization instead of daily output volume. The money-first loop exists to answer a narrower question: is there a tiny, low-permission, low-maintenance wedge that users are likely to pay for quickly?

Run:

```powershell
npm run discovery:money-wedge-generator
npm run discovery:create-fake-door-test -- --candidate page-context-to-markdown
```

The money-first engine writes:

- `87_money_first_opportunity_scores.json`
- `88_competitor_price_value_map.json`
- `89_money_micro_wedge_candidates.json`
- `90_pricing_experiment_plan.json`
- `91_payment_license_architecture_plan.json`
- `92_money_first_build_gate.json`
- `94_money_first_ops_report.json`

Its default posture is:

- real paid pain over generic discovery volume
- mature demand with a narrow micro-wedge over same-experience clones
- low-permission, local-only, lifetime-friendly utilities over fragile automation
- fake-door or demand validation before build when buying intent is still weak

`money_build_ready` still does not bypass human review, and `no_build_today` is still a valid outcome.

Use `74_seed_performance_report.json` to choose the next direction:

- `continue_seed` when a seed surfaces a real build-ready candidate
- `refine_seed` when the seed has signal but still suffers from overlap, wedge clarity, or evidence gaps
- `pause_seed` when the seed mostly produces risky, low-evidence, or low-fit candidates

## Daily Workflow Behavior

`daily` can end with `build`, `research_more`, `skip`, or `no_build_today`.

If live discovery is configured with `discovery.run_strategy_v2=true`, daily can auto-generate Strategy V2 artifacts after query expansion still finds no build-ready candidate. If Strategy V2 still ends in `no_build_today`, daily can also auto-generate a strategy review package. This still does not force a build.

Human review can approve or reject a candidate, but it cannot bypass Opportunity Score V2, Build Gate V2, or the stricter Strategy V2 gate.

## Sandbox Promotion And Review Watch

Promotion is the only supported path into sandbox lifecycle work:

```powershell
npm run factory:promote-to-sandbox -- --from-run runs/<daily_run_id> --publisher <publisher_id> --item <sandbox_item_id> --note "promotion note"
```

For immutable sandbox runs, later lifecycle events are written under `state/run_events/<run_id>/` instead of mutating the frozen run in place.

Review watching is read-only:

- `publish:review-status` refreshes `91_review_status.json`
- `review-watch:credentials-doctor` shows whether the current Node process can actually see Chrome Web Store credentials, whether `.env.local` was loaded, whether GitHub Actions secrets are wired, and whether OAuth or fetchStatus probes can run
- `review-watch:all` polls all active pending sandbox runs
- repeated checks must not append duplicate review-state ledger entries when the state did not change

Local credential setup guidance lives in [review_watch_credentials_setup.md](/D:/code/ai插件优化工作流/docs/review_watch_credentials_setup.md).

## Safety

- Never fabricate evidence.
- Never silently fall back from live discovery to fixtures.
- Never upload, publish, or write production state without the correct approval path.
- Never force a build just to keep daily output volume high.

## Payment Integration Contract

The factory now supports extension-side monetization without embedding a payment backend in this repository.

- The factory owns `monetization_config.json`, paywall UI wiring, free-usage counters, upgrade buttons, license-key entry, entitlement cache, and offline grace behavior.
- The external payment project owns checkout, provider secrets, webhooks, license generation, refund or revoke logic, and license verification endpoints.
- The extension must never ship Stripe secrets, Lemon Squeezy secrets, webhook secrets, or private keys.
- The first monetized flow stays simple: free usage limit, external payment page, license-key activation, and lifetime unlock.

Supporting docs:

- [payment_integration_contract.md](/D:/code/ai插件优化工作流/docs/payment_integration_contract.md)
- [entitlement_response_contract.md](/D:/code/ai插件优化工作流/docs/entitlement_response_contract.md)
- [paywall_ux_rules.md](/D:/code/ai插件优化工作流/docs/paywall_ux_rules.md)
- [payment_project_handoff.md](/D:/code/ai插件优化工作流/docs/payment_project_handoff.md)
- [monetization_strategy.md](/D:/code/ai插件优化工作流/docs/monetization_strategy.md)

## Commercial Release Revision

Use the commercial revision flow when a sandbox-validated technical build proved the review path, but the next submission needs payment entry, license activation, and premium packaging before any new upload:

```powershell
npm run commercial:create-release-revision -- --from-run runs/<sandbox_validation_run_id> --target-version 0.2.0 --note "commercial release with payment and premium packaging"
npm run monetization:security-scan -- --run runs/<commercial_run_id>
npm run packaging:premium -- --run runs/<commercial_run_id>
npm run assets:remotion:stills -- --run runs/<commercial_run_id>
npm run assets:qa -- --run runs/<commercial_run_id>
npm run packaging:listing-quality-gate -- --run runs/<commercial_run_id>
npm run packaging:store-release-package -- --run runs/<commercial_run_id>
```

Rules:

- The commercial revision creates a new immutable sandbox-validation run. It does not mutate the old STAGED run.
- The extension only gets public or placeholder payment URLs plus extension-side license handling. No payment secret goes into the bundle.
- `129_commercial_release_gate.json` must pass before any later sandbox upload approval is allowed for the commercial run.
- Human visual review still remains mandatory before any upload or publish decision.
