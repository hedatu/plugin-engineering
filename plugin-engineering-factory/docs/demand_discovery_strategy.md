# Demand Discovery Strategy

## Core Rule

The factory is not required to build a Chrome extension every day. It is required to search for credible, testable opportunities every day and only build when the discovery gates pass.

## Discovery Engine V1

Discovery now evaluates candidates in four steps:

1. Candidate shortlist quality
2. Pain cluster quality
3. Opportunity Score V2
4. Build Gate V2

If the result is `research_more` or `skip`, the run should not force a build. `research_more` must first go through the formal `RESEARCH_MORE_RESOLUTION` loop.

The main operational entry is now the live queue:

1. Generate `next_10_search_queries`
2. Run `discovery:live-queue`
3. Run `discovery:score-queue`
4. Run `discovery:select-next-build-candidate`
5. Stop at `build_ready`, `research_more`, or `skip`

The factory is allowed to end the day with no build.

## Evidence Rules

- Evidence must preserve provenance.
- Each evidence item should record source type, source URL, captured time, excerpt, reliability weight, recency weight, and pain signal type.
- Live vs fixture mode must be explicit in artifacts.
- If live collection fails, the fallback reason must be written. Never silently hide the failure.
- Chrome Web Store reviews can be useful, but store-only evidence is not strong enough for repeated same-family builds.

## What Makes A Candidate Build-Worthy

- The pain is specific enough to convert into a single-purpose wedge.
- The happy path is testable in controlled fixtures or browser smoke.
- The permission posture is still low-risk.
- The portfolio overlap is not too high.
- The evidence quality score and testability score clear the configured thresholds.
- The candidate also clears differentiation checks against the existing portfolio backlog and registry.

## What Should Not Build

- High-user candidates with weak or vague pain
- High-testability candidates that are still too similar to what already exists in the portfolio
- Candidates that require risky permissions without strong justification
- Candidates whose pain cannot be reproduced or tested
- Candidates that mostly duplicate the current portfolio
- Candidates with only stale or single-source evidence

## Opportunity Score V2

Opportunity Score V2 considers:

- demand score
- pain score
- evidence quality score
- wedge clarity score
- feasibility score
- testability score
- compliance score
- differentiation score
- portfolio overlap penalty
- maintenance risk score
- confidence score

High user count is only one input. It cannot override weak evidence, weak testability, or high compliance risk.

## Build Gate V2

Build Gate V2 must check:

- evidence quality gate
- single-purpose gate
- testability gate
- permissions risk gate
- portfolio overlap gate
- product acceptance forecast gate

If any required gate fails, the run must not build.

## Research More Resolution

`research_more` is not a soft yes. It is a quality-control state.

The resolution loop must:

- generate targeted research questions for the selected candidate
- propose at least three narrower wedge hypotheses
- refine generic pain clusters into specific user actions
- re-score the best wedge with portfolio differentiation included
- re-run a build gate that can end in `build`, `skip`, or `still_research_more`

The factory still does not auto-build after resolution unless the task explicitly opts in with `allow_build_after_research_resolution=true`.

For tab/export candidates, portfolio overlap is a hard filter. A wedge can become clearer and still be skipped because it is too similar to existing `tab_csv_window_export` portfolio items.

The current example is `cand-tab-001 / Window Tabs Exporter`:

- updated wedge clarity reached `87.8`
- product acceptance forecast passed
- the candidate still resolves to `skip`
- the decisive blocker is `portfolio_overlap_score=74`

## Targeted Research Batch

When live queue scoring still yields no build-ready candidate, the next step is a targeted research batch instead of a forced build.

Use:

```powershell
npm run discovery:targeted-research-batch -- --run runs/<live_queue_run> --top 10
```

This batch:

- revisits the top `research_more` candidates
- collects extra live evidence when available
- proposes narrower wedge hypotheses
- re-checks overlap against the current portfolio
- evaluates build-ready criteria with stricter thresholds
- updates `state/opportunity_backlog.json`
- generates `47_wedge_decision_board.json` and `48_human_candidate_review_queue.json`

Possible outcomes:

- `build_ready`: strong enough for human candidate review, but still not an automatic build
- `research_more`: worth another evidence loop
- `skip`: too repetitive, too risky, or still too vague

The factory is allowed to conclude `no_build_today` after this batch. That is quality control, not failure.

## Targeted Research Round 2

The factory is not allowed to spin forever on `research_more`. After the batch pass, there is one final targeted research round:

```powershell
npm run discovery:targeted-research-round2 -- --run runs/<live_queue_run> --top 5
```

Round 2 is the last research loop. After it finishes:

- `final_decision` must be `build_ready`, `skip`, or `backlog_waiting_for_evidence`
- no residual `research_more` state is allowed
- `build_ready` still requires human candidate review before any build
- weak but plausible candidates can move into backlog waiting states such as builder or policy review
- high-overlap, high-risk, or low-clarity candidates should be skipped rather than kept alive indefinitely

The stricter round-2 build-ready criteria are:

- evidence quality >= 80
- wedge clarity >= 82
- testability >= 75
- portfolio overlap <= 45
- compliance risk not high
- product acceptance forecast passed
- at least two independent evidence sources
- a clear happy path
- an expected functional test matrix
- builder support already exists or is explicitly judged small enough

If those gates still do not pass, the factory should prefer `skip` or a backlog waiting state over another research loop.

## Query Expansion

If round 2 still finds no build-ready candidate, the next move is query expansion rather than another pass over the same ideas:

```powershell
npm run discovery:expand-queries -- --from-run runs/<live_queue_run>
npm run discovery:live-queue-round2 -- --queries runs/<live_queue_run>/50_query_expansion_plan.json --limit 20 --max-candidates 80
```

The query expansion plan should bias toward lower-overlap wedges and explicitly exclude:

- generic autofill
- generic tab export
- Amazon review scraping
- high-permission security scanners
- broad SEO or agent automation

The preferred search surface is:

- vertical form workflows that are clearly narrower than LeadFill One Profile
- non-tab-export browser workflow pain
- local-only developer or operator utilities
- low-permission copy-paste or cleanup helpers
- QA, screenshot, support, or debug handoff workflows
- insert-only email or template helpers that do not auto-send

`no_build_today` is an expected output when even the expanded queries do not clear the evidence, overlap, and compliance gates.

## Discovery Strategy V2

If round 2 plus query expansion still do not produce a build-ready candidate, the next step is strategy shift:

```powershell
npm run discovery:strategy-v2 -- --from-run runs/<live_queue_round2_run>
npm run discovery:run-strategy-v2 -- --strategy runs/<strategy_run>/57_low_overlap_search_map.json --limit 30 --max-candidates 120
```

Strategy V2 should produce:

- `55_discovery_strategy_v2.json`
- `56_builder_fit_map.json`
- `57_low_overlap_search_map.json`
- `58_source_priority_model.json`

The runner should then produce:

- `59_strategy_v2_query_results.json`
- `60_strategy_v2_candidate_scores.json`
- `61_strategy_v2_next_candidate.json`
- `62_no_build_today_report.json` when no candidate clears the stricter gate

This stage exists to answer a different question than targeted research: not "can the current shortlist be rescued?" but "what should the factory search next to find lower-overlap, higher-quality opportunities?"

Strategy V2 must:

- summarize repeated discovery failure modes
- identify where current builders fit or do not fit
- keep future-builder categories as roadmap evidence, not immediate implementation work
- design lower-overlap search seeds
- define which evidence sources should be prioritized next

The stricter Strategy V2 gate should reject candidates that still fail any of these:

- evidence quality strong enough to justify a build
- wedge clarity strong enough to define a narrow happy path
- testability strong enough for deterministic verification
- portfolio overlap low enough to avoid another same-family build
- low enough permission and compliance risk
- at least two independent evidence source types
- no weak pain clusters blocking product-acceptance confidence
- an expected functional test matrix for the current builder family

If Strategy V2 still finds no build-ready candidate, `62_no_build_today_report.json` is the correct output.

## Discovery Strategy Review

When Strategy V2 still produces `no_build_today`, the factory should stop widening the same search families and generate a human-readable strategy package:

```powershell
npm run discovery:strategy-review -- --from-run runs/<live_queue_round2_run>
```

This review should write:

- `63_discovery_strategy_review.json`
- `64_builder_roadmap_evaluation.json`
- `65_manual_seed_plan.json`
- `66_threshold_calibration_review.json`

Its purpose is to help a human choose the next move:

- continue Strategy V2 with better query families
- inject manual vertical seeds
- pause high-overlap categories
- keep a future builder on the roadmap without implementing it now
- keep thresholds unchanged unless benchmark or human review shows obvious false negatives

`no_build_today` is normal. The correct response is strategy shift, not forcing a weak build and not automatically loosening the gates.

The default recommendation should prefer:

- quality over throughput
- manual seeds over repeating generic search
- future builder ideas as roadmap only
- stable thresholds unless there is real evidence of miscalibration

## Current Manual Seed Decision

The current approved seed set is:

- `seed-support-qa-handoff`
- `seed-saas-admin-cleanup`
- `seed-developer-payload`

Why these were selected:

- support and QA handoff targets browser bug-report context and handoff friction without reopening generic tab/export search
- SaaS admin cleanup targets repetitive copy-paste cleanup and table normalization instead of another general productivity surface
- developer payload utility remains a monitor-only future-builder signal because it repeatedly appears with decent evidence and testability, but it still does not justify builder work now

`seed-developer-payload` must stay monitor-only in the current round. It can move candidates into backlog waiting or future-builder discussion, but it must not trigger builder implementation.

## Seed-Based Discovery

After the strategy decision is recorded, generate a seed task and run the seed loop:

```powershell
npm run discovery:create-next-task-from-strategy -- --strategy-run runs/<strategy_review_run> --decision-file state/discovery_strategy_reviews/<decision_file>.json
npm run discovery:run-seed-task -- --task runs/<strategy_review_run>/67_next_discovery_task.json
npm run discovery:support-qa-deep-dive -- --run runs/<seed_discovery_run_id>
npm run discovery:support-qa-evidence-sprint -- --run runs/<seed_discovery_run_id> --candidate Jam
```

The seed loop should write:

- `68_seed_query_plan.json`
- `69_seed_discovery_results.json`
- `70_seed_candidate_queue.json`
- `71_seed_opportunity_scores.json`
- `72_seed_next_candidate.json`
- `73_seed_discovery_ops_report.md`
- `74_seed_performance_report.json`
- `75_seed_human_candidate_review_queue.json`

Interpret `74_seed_performance_report.json` like this:

- `continue_seed` if a seed is producing a build-ready candidate or clearly differentiated high-quality pipeline
- `refine_seed` if the seed still has signal but overlap or wedge clarity remains weak
- `pause_seed` if the seed mostly yields low-evidence, high-risk, or poor-fit candidates

This keeps the factory from falling back into generic high-overlap discovery after a human has already chosen a more targeted search surface.

## Support/QA Evidence Sprint

The support and QA handoff branch is not allowed to loop forever. After the deep dive, the final manual branch is `SUPPORT_QA_EVIDENCE_SPRINT`.

Purpose:

- test whether the narrowed local-only support or QA handoff wedge has enough external user voice
- reject screenshot or upload-first expectations when they dominate
- stop at `human_candidate_review_ready`, `backlog_waiting_for_evidence`, or `skip`

Current state:

- Jam is still not build-ready
- the strongest wedge remains a local-only `Page Context to Markdown` style helper
- overlap is acceptable and permissions stay low
- the missing input is explicit user voice proving people want a text-first, clipboard-first handoff helper

This is why Jam remains parked instead of promoted:

- no direct external source explicitly asks for a local-only text-first support or QA handoff helper
- screenshot or upload-centric bug-report workflows remain more visible in public product messaging
- text-first demand is still inferred, not proven strongly enough for build

The evidence sprint should prefer:

- support docs and public issue trackers that mention manual handoff friction
- explicit requests for browser info, page context, repro steps, or copy-ready diagnostics
- public statements that privacy or no-upload behavior matters

The evidence sprint must reject:

- popularity alone
- generic screenshot demand
- generic bug-reporting demand without a narrowed handoff action
- our own speculation

If the sprint still ends in `backlog_waiting_for_evidence`, the correct next step is manual evidence input, not another automated `research_more` loop:

```powershell
npm run discovery:record-manual-evidence -- --candidate <candidate_id> --source "customer workflow" --note "real user voice" --supports-wedge "local_bug_report_context_copier"
```

This records a real customer or operator signal under `state/manual_evidence/` and allows the next sprint to re-evaluate the candidate without fabricating evidence.

## Demand Validation Loop

When a support or QA handoff candidate settles into `backlog_waiting_for_evidence`, the correct next move is a demand-validation loop, not indefinite `research_more`:

```powershell
npm run discovery:create-demand-validation-plan -- --candidate Jam --wedge page-context-to-markdown
npm run discovery:rescore-candidate-with-manual-evidence -- --candidate Jam
```

Purpose:

- give a human a structured interview, survey, and workflow test plan
- record real manual evidence without modifying discovery history
- re-score the candidate against explicit demand thresholds
- resolve the candidate to `human_candidate_review_ready`, `keep_waiting_for_evidence`, or `skip`

Manual evidence rules:

- `backlog_waiting_for_evidence` is not failure; it is a parking state for plausible wedges without enough outside user voice
- strong evidence requires at least two independent non-self-observation sources
- self-observation can help shape the hypothesis, but it cannot promote the candidate by itself
- if users clearly prefer screenshot, video, or upload workflows, the text-first local-only wedge should be skipped
- the build gate still applies after manual evidence; manual notes do not bypass overlap, compliance, or testability checks

For `Jam / Page Context to Markdown`, the missing proof is still:

- explicit user statements that copying URL, title, browser info, and repro steps is painful
- at least one explicit local-only / no-upload preference
- at least one explicit text-first or clipboard-first acceptance signal
- some install intent for a tiny one-button extension

Reference examples for weak, strong, and counter-signal manual evidence live in [docs/examples/manual_evidence_examples.md](/D:/code/ai插件优化工作流/docs/examples/manual_evidence_examples.md).

## Money-First Discovery

The factory can switch from "find anything buildable" to "find something users are likely to pay for quickly." That money-first mode should prefer:

- mature demand categories with clear paid alternatives
- tiny differentiating wedges instead of same-experience clones
- low-permission, local-only, low-maintenance helpers
- one-time lifetime pricing before recurring SaaS unless recurring value is obvious

Use:

```powershell
npm run discovery:money-wedge-generator
npm run discovery:create-fake-door-test -- --candidate <candidate_id_or_wedge_name>
```

The money-first gate should only pass a wedge when:

- the one-job value is very clear
- users save meaningful time
- buying intent is plausible
- clone risk and policy risk stay low enough
- trust and testability stay high
- pricing and distribution assumptions are explicit

If the wedge still looks commercially plausible but demand is not proven, run a fake-door test before building. It is better to record `validate_demand_first` or `no_build_today` than to build a weak clone that will not pay back.

## Benchmarking

Use:

```powershell
npm run discovery:benchmark
```

The benchmark set covers:

- strong need, good build
- high users, low pain
- vague pain
- high permission risk
- portfolio overlap
- low testability

Discovery changes are not stable until the benchmark still passes.

## Next Query Design

Each planned search query should explain:

- the query
- target category
- hypothesis
- expected user pain
- preferred archetype
- risk
- why now
- exclude-if condition

This keeps discovery explainable and auditable instead of improvisational.

## Backlog Versus Registry

- `state/opportunity_backlog.json` stores discovered opportunities, skip reasons, human candidate review, and next steps.
- `state/portfolio_registry.json` stores wedges the factory has already built, revised, validated, or published.
- A skipped backlog item should inform future filtering, but it does not become a portfolio item.
- `future_builder_candidate` belongs in backlog or strategy artifacts, not in the current build queue.

## Human Review

Human review is allowed to choose between `approve_build`, `research_more`, and `skip`.

- It can advance a `build_ready` candidate to the next stage.
- It can request more research on a promising candidate.
- It can mark a weak or repetitive candidate as skipped.
- It cannot bypass Opportunity Score V2 or Build Gate V2.

Human strategy review is also allowed after Strategy V2:

```powershell
npm run discovery:record-strategy-decision -- --run runs/<strategy_review_run> --decision manual_vertical_seed|continue_strategy_v2|prioritize_builder|pause_category|adjust_thresholds --note "<note>"
npm run discovery:create-next-task-from-strategy -- --strategy-run runs/<strategy_review_run> --decision-file state/discovery_strategy_reviews/<decision_file>.json
```

This review can shift query families, approve manual seeds, pause categories, or record roadmap exploration for a future builder, but it still cannot bypass any build gate.

## Focused Support/QA Deep Dive

`seed-support-qa-handoff` is the current priority manual seed because it produced the cleanest lower-overlap follow-up set. The deep-dive stage is intentionally narrow: it does not reopen broad discovery, and it does not auto-connect to every daily run. It only runs when the human strategy decision chose the support or QA seed or when `discovery:support-qa-deep-dive` is called directly.

The objective is not to clone Jam or any other existing product. The objective is to test whether a tighter wedge exists, for example:

- a local-only bug report context copier
- a QA handoff snapshot that outputs Markdown
- a support environment packet
- a repro steps helper

Guardrails for this stage:

- keep the experience local-only
- no automatic sending
- no uploads
- no external issue creation
- avoid host permissions unless a user-triggered `activeTab` path is clearly justified
- generic screenshot tools and generic bug reporters should fail unless they can be reduced to a narrower text-first handoff wedge

If the narrowed wedge still lacks enough evidence, the correct output is `research_more` or `backlog_waiting_for_evidence`, not a forced build. If the wedge drifts toward screenshot capture or hosted bug-report pipelines, the correct output is `skip`.

## Market-First Micro Launch

The factory now supports a second validation path: market-first micro launch. This path exists for low-risk wedges that are easier to test with real installs, core-action usage, and upgrade clicks than with a long interview queue.

Use:

```powershell
npm run market:select-micro-mvp
npm run monetization:create-fake-door -- --candidate Jam
npm run experiment:score-paid-interest -- --experiment page-context-to-markdown
npm run market:approve-micro-mvp -- --candidate "Page Context to Markdown" --note "approve micro MVP build scope"
```

Artifacts:

- `103_market_test_plan.json`
- `104_market_first_build_gate.json`
- `105_micro_mvp_selection.json`
- `106_market_test_metrics_spec.json`
- `107_market_test_launch_plan.json`
- `108_page_context_market_test_plan.json`

Payment planning artifacts:

- `96_payment_link_flow_plan.json`
- `97_license_activation_spec.json`
- `98_value_first_paywall_rules.json`

This path is only for candidates that are:

- single-purpose and explainable in one sentence
- low permission or medium-low permission
- low policy risk
- not a clone
- low maintenance and not scraping-heavy
- cheap enough to build in `<= 16` hours
- easy to price with a free limit and a lifetime unlock
- measurable through install, open, core-action, and upgrade signals

This path is not for:

- high-permission or high-policy-risk candidates
- same-experience clones
- high-maintenance DOM automation
- large new builder bets
- risky scraping or login-heavy flows

Pricing defaults:

- price ladder: `$9 / $19 / $29`
- default model: `free_with_lifetime_unlock`
- default free tier: fixed action limit such as `10` actions
- external checkout page instead of in-extension card handling
- manual or lightweight license key flow is acceptable for the first test

Rules:

- market-first does not bypass policy or clone-risk gates
- market-first does not bypass human approval
- market-first does not authorize upload or publish
- low buying intent is allowed only when the launch stays small and kill criteria are explicit
- `kill` and `no_build` are normal outcomes

## Payment Integration Contract

Market-first wedges can now prepare extension-side monetization without binding the factory to a single payment backend.

- The factory generates `monetization_config.json`, paywall UI wiring, free-usage metering, upgrade buttons, license-entry UI, local entitlement cache, and offline grace handling.
- The external payment project provides checkout, webhook handling, license generation, `POST /license/verify`, `POST /license/activate`, `GET /license/status`, and optional `POST /usage/report`.
- Provider secrets remain outside the extension.
- The extension must never trust local storage alone as the source of truth for paid unlocks.
- Before any later upload or publish decision, run:

```powershell
npm run monetization:security-scan -- --run runs/<run_id>
```

Supporting docs:

- [payment_integration_contract.md](/D:/code/ai插件优化工作流/docs/payment_integration_contract.md)
- [entitlement_response_contract.md](/D:/code/ai插件优化工作流/docs/entitlement_response_contract.md)
- [paywall_ux_rules.md](/D:/code/ai插件优化工作流/docs/paywall_ux_rules.md)
- [payment_project_handoff.md](/D:/code/ai插件优化工作流/docs/payment_project_handoff.md)
