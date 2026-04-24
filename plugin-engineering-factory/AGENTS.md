# Chrome Extension Opportunity Factory - Codex Rules

## Project Goal
Build an auditable workflow that turns public Chrome extension feedback into a single-purpose MV3 extension draft package. The workflow must produce files, not just conversation output.

## Project Scope Lock
- The active project is always `Chrome Extension Opportunity Factory` unless the user explicitly switches projects.
- Do not switch to Remotion or any other project from stray context.
- Do not expand builders unless the user explicitly asks for builder work.

## Required Reading Order
1. `codex_chrome_extension_factory_prd_zh.md`
2. `AGENTS.md`
3. `docs/development_audit.md`
4. The latest `runs/<run_id>/` artifacts when continuing an existing run

## Stage Order
`INGEST_TASK -> DISCOVER_CANDIDATES -> ENRICH_FEEDBACK -> CLUSTER_PAIN_POINTS -> SCORE_OPPORTUNITIES -> BUILD_GATE -> DISCOVERY_QUALITY_REVIEW -> RESEARCH_MORE_RESOLUTION -> TARGETED_RESEARCH_BATCH -> TARGETED_RESEARCH_ROUND_2 -> QUERY_EXPANSION -> DISCOVERY_STRATEGY_V2 -> RUN_STRATEGY_V2 -> DISCOVERY_STRATEGY_REVIEW -> WRITE_BRIEF -> PLAN_IMPLEMENTATION -> BUILD_EXTENSION -> RUN_QA -> BROWSER_SMOKE_AND_CAPTURE -> GENERATE_ASSETS -> RUN_POLICY_GATE -> DECIDE_PUBLISH_INTENT -> PREPARE_LISTING_PACKAGE -> HUMAN_APPROVAL_GATE -> EXECUTE_PUBLISH_PLAN -> REVIEW_STATUS -> MONITOR_POST_RELEASE -> CLOSE_RUN`

## Commands
- Full offline workflow: `npm run smoke`
- Best-effort live discovery workflow: `npm run daily:live`
- Intentional no-go regression fixture: `npm run daily:no-go`
- Default daily fixture: `npm run daily`
- Discovery benchmark fixture set: `npm run discovery:benchmark`
- Inspect the discovery opportunity backlog: `npm run backlog:inspect`
- Validate the discovery opportunity backlog: `npm run backlog:validate`
- Run live discovery queue generation from the latest query plan: `npm run discovery:live-queue -- --queries-from runs/<daily_run_id>/34_demand_discovery_improvement_plan.json --limit 10 --max-candidates 50`
- Score a live discovery queue: `npm run discovery:score-queue -- --queue runs/<live_queue_run>/41_live_candidate_queue.json`
- Select the next build candidate from a scored queue: `npm run discovery:select-next-build-candidate -- --scores runs/<live_queue_run>/43_batch_opportunity_scores.json`
- Run targeted research across the top unresolved live-queue candidates: `npm run discovery:targeted-research-batch -- --run runs/<live_queue_run> --top 10`
- Run the final second-round targeted research pass across the top human-review candidates: `npm run discovery:targeted-research-round2 -- --run runs/<live_queue_run> --top 5`
- Generate a low-overlap query expansion plan after round 2 still finds no build-ready candidate: `npm run discovery:expand-queries -- --from-run runs/<live_queue_run>`
- Run a second live queue from the query expansion plan: `npm run discovery:live-queue-round2 -- --queries runs/<live_queue_run>/50_query_expansion_plan.json --limit 20 --max-candidates 80`
- Generate Strategy V2 artifacts after round 2 and query expansion still end in `no_build_today`: `npm run discovery:strategy-v2 -- --from-run runs/<live_queue_round2_run>`
- Execute the Strategy V2 low-overlap search map with stricter gating: `npm run discovery:run-strategy-v2 -- --strategy runs/<strategy_run>/57_low_overlap_search_map.json --limit 30 --max-candidates 120`
- Generate a strategy review package after repeated `no_build_today`: `npm run discovery:strategy-review -- --from-run runs/<live_queue_round2_run>`
- Record a human strategy decision without bypassing any build gates: `npm run discovery:record-strategy-decision -- --run runs/<strategy_review_run> --decision manual_vertical_seed|continue_strategy_v2|prioritize_builder|pause_category|adjust_thresholds --note "<note>"`
- Generate the next discovery task from a recorded strategy decision: `npm run discovery:create-next-task-from-strategy -- --strategy-run runs/<strategy_review_run> --decision-file state/discovery_strategy_reviews/<decision_file>.json`
- Run the focused support/QA handoff deep dive on the latest seed discovery run or an explicit run: `npm run discovery:support-qa-deep-dive -- --run runs/<seed_run_id>`
- Run the final support/QA evidence sprint against Jam or the top support handoff candidate: `npm run discovery:support-qa-evidence-sprint -- --run runs/<seed_run_id> --candidate Jam`
- Record manual discovery evidence without mutating candidate code or artifacts: `npm run discovery:record-manual-evidence -- --candidate <candidate_id> --source "<source>" --note "<note>" --supports-wedge "<wedge_id>"`
- Select a market-first micro MVP from the money-first wedge set: `npm run market:select-micro-mvp`
- Create a fake-door test plan for a market-first candidate or source candidate alias such as Jam: `npm run monetization:create-fake-door -- --candidate Jam`
- Score current paid-interest readiness for a market-first wedge: `npm run experiment:score-paid-interest -- --experiment page-context-to-markdown`
- Record a human approval that only allows a scoped market-test MVP build: `npm run market:approve-micro-mvp -- --candidate "Page Context to Markdown" --note "<note>"`
- Generate premium packaging artifacts for a sandbox or market-test run: `npm run packaging:premium -- --run runs/<run_id>`
- Regenerate the premium plugin website and web quality artifacts for a payment-configured product: `npm run site:premium-web-redesign -- --product leadfill-one-profile`
- Render premium still assets with the Remotion scaffold: `npm run assets:remotion:stills -- --run runs/<run_id>`
- Render premium video assets with the Remotion scaffold: `npm run assets:remotion:video -- --run runs/<run_id>`
- Render both still and video premium assets: `npm run assets:remotion:all -- --run runs/<run_id>`
- Run premium asset QA: `npm run assets:qa -- --run runs/<run_id>`
- Run the premium listing quality gate: `npm run packaging:listing-quality-gate -- --run runs/<run_id>`
- Run a monetization security scan against a run before any upload or publish decision: `npm run monetization:security-scan -- --run runs/<run_id>`
- Record a human candidate decision in the discovery backlog: `npm run discovery:record-human-candidate-review -- --candidate <candidate_id> --decision approve_build|research_more|skip --note "<note>"`
- Resolve a `research_more` candidate into `build`, `skip`, or `still_research_more`: `npm run discovery:resolve-research-more -- --run runs/<daily_run_id>`
- Execute the discovery improvement plan's next queries when live research is available: `npm run discovery:run-next-queries -- --run runs/<daily_run_id> --limit 10`
- Repair browser smoke plus downstream stages on a copied immutable run: `npm run repair:from-run -- --run runs/<run_id> --from BROWSER_SMOKE_AND_CAPTURE --repair-immutable-copy`
- Repair lifecycle close on a copied immutable run: `npm run repair:from-run -- --run runs/<run_id> --from CLOSE_RUN --repair-immutable-copy`
- Read-only review status refresh: `npm run publish:review-status -- --run runs/<run_id>`
- Inspect the active review-watch registry: `npm run review-watch:inspect`
- Validate the active review-watch registry: `npm run review-watch:validate`
- Run read-only review watch checks for all active pending sandbox runs: `npm run review-watch:all`
- Generate the functional test matrix for a promoted sandbox run: `npm run qa:functional-matrix -- --run runs/<run_id>`
- Generate the product acceptance review for a promoted sandbox run: `npm run product:acceptance-review -- --run runs/<run_id>`
- Create a revision plan after product acceptance returns `revise`: `npm run product:create-revision-plan -- --run runs/<run_id> --reason "<reason>"`
- Create a fresh immutable sandbox revision run after product acceptance returns `revise`: `npm run product:create-revision-run -- --from-run runs/<run_id> --note "<note>"`
- Record a human product review decision for a promoted sandbox run: `npm run product:record-human-review -- --run runs/<run_id> --decision passed|revise|blocked|kill --note "<note>"`
- Prepare public launch prep artifacts for a payment-configured commercial sandbox run: `npm run commercial:public-launch-prep -- --run runs/<run_id> --product leadfill-one-profile`
- Review discovery quality for the source daily run and emit a discovery improvement plan: `npm run discovery:quality-review -- --run runs/<source_daily_run_id>`
- Record a manual dashboard cancel-review action for a sandbox validation run: `npm run publish:record-manual-review-action -- --run runs/<run_id> --action manual_cancel_review --note "<note>"`
- Prepare the trusted-tester install verification plan after review approval: `npm run sandbox:prepare-install-verification -- --run runs/<run_id>`
- Prepare a repair plan after dashboard review rejection: `npm run sandbox:prepare-review-repair -- --run runs/<run_id> --reason "<dashboard rejection reason>"`
- Write only the sandbox upload approval artifact: `npm run approve:sandbox-upload -- --run runs/<run_id> --note "<note>"`
- Write only the sandbox publish approval artifact: `npm run approve:sandbox-publish -- --run runs/<run_id> --note "<note>"`
- Promote a completed daily run into an immutable sandbox validation run: `npm run factory:promote-to-sandbox -- --from-run runs/<daily_run_id> --publisher <publisher_id> --item <sandbox_item_id> --note "<note>"`
- Inspect a sandbox validation run and its sidecar events: `npm run sandbox:inspect -- --run runs/<run_id>`
- Run read-only sandbox preflight: `npm run sandbox:preflight -- --run runs/<run_id>`
- Run local CI dry-check without upload/publish: `npm run ci:publish-sandbox-dry-check -- --run runs/<run_id> --action sandbox_upload`
- Validate a sandbox validation run snapshot: `npm run sandbox:validate -- --run runs/<run_id>`
- Inspect portfolio registry: `npm run registry:inspect`
- Validate portfolio registry: `npm run registry:validate`
- Inspect release ledger: `npm run ledger:inspect`
- Record a missing product revision lineage entry for an existing immutable sandbox revision run: `npm run ledger:record-product-revision-lineage -- --run runs/<run_id>`
- Validate release ledger: `npm run ledger:validate`
- Recover overwritten sandbox publish evidence into the release ledger: `npm run ledger:recover-sandbox-event -- --item <item_id> --publisher <publisher_id> --event sandbox_publish_optional --status PENDING_REVIEW --note "<note>"`
- Record a manual review action into sidecars and the release ledger: `npm run publish:record-manual-review-action -- --run runs/<run_id> --action manual_cancel_review --note "<note>"`
- Publish preflight from an existing run: `npm run publish:preflight -- --run runs/<run_id>`
- Sandbox fetch-status validation: `npm run publish:sandbox-fetch-status -- --run runs/<run_id>`
- Sandbox upload validation: `npm run publish:sandbox-upload -- --run runs/<run_id>`
- Sandbox publish validation: `npm run publish:sandbox-publish -- --run runs/<run_id>`

## Run Identity Rules
- `daily` runs must default to unique run ids.
- Stable `task.run_id` values are only valid when `task.mode=test_fixture`.
- If `runs/<run_id>/` already exists, fail fast by default.
- `--allow-overwrite` is only valid with `task.mode=test_fixture`.
- `sandbox_validation` runs must not reuse ordinary daily ids.
- `sandbox_validation` runs must use the promotion lane; ordinary daily runs are never valid upload/publish targets.
- Approval artifacts default to `approval_mode=test_artifact_only`. Only explicit `--allow-write` approvals may authorize upload or publish.
- If sandbox upload is blocked by `same_or_lower_manifest_version`, create a new revision run with `npm run sandbox:prepare-upload-revision` instead of mutating the old immutable run.
- If product acceptance returns `revise`, create a fresh product revision sandbox run with `npm run product:create-revision-run` instead of mutating the old immutable run in place.
- Product revision sandbox runs must append `sandbox_prepare_product_revision` to `state/release_ledger.json` before they are valid sandbox upload or publish targets.
- Approval artifacts are bound to the current sandbox_validation plan package hash; after a version bump, old approvals must not be reused.

## Immutability Rules
- `CLOSE_RUN` must write `99_close_run.json` and create `runs/<run_id>/.immutable`.
- Immutable runs must not be modified in place by daily, repair, publish, approval, or review-status commands.
- Immutable runs must not be modified in place by product-review or discovery-review commands; these must write sidecars under `state/run_events/<run_id>/`.
- Product revision runs must copy the source sandbox run into a fresh run id, rerun build and verification artifacts, and freeze the new run before any new approval can be issued.
- Repairing an immutable run requires `--repair-immutable-copy`, which copies the run to a fresh run id first.
- Do not overwrite `90_publish_execution.json`, `91_review_status.json`, `95_monitoring_snapshot.json`, `96_learning_update.json`, or `99_close_run.json` inside an immutable run.
- `sandbox_validation` runs freeze immediately after promotion. Later approval, publish execution, review status, and monitoring updates must be written via `state/run_events/<run_id>/`.

## Write Boundaries
Allowed:
- `docs/`
- `schemas/`
- `scripts/`
- `src/`
- `fixtures/`
- `runs/`
- `state/`
- generated extension workspaces under `runs/<run_id>/workspace/`

Do not modify without explicit approval:
- source evidence content to fabricate stronger claims
- publication credentials
- generated artifacts from older immutable runs unless performing a copied repair run

## Safety Rules
- Never fabricate user feedback or source evidence.
- Never copy closed-source competitor code.
- Never hard-code secrets.
- Keep permissions limited to the implementation plan.
- Public release requires a human gate.
- If a stage fails, write `status=failed` and `failure_reason`; do not silently skip.
- All new artifacts must validate against a schema before write.
- All secret-like values must be redacted from artifacts and logs.
- Do not execute upload or publish unless an approved `82_human_approval.json` exists for the exact sandbox action.
- For immutable sandbox runs, the authoritative approval artifact is `state/run_events/<run_id>/82_human_approval.json`.
- For `sandbox_upload`, treat `do not upload` or `artifact only` as write blockers.
- For `sandbox_publish`, treat `do not publish` or `artifact only` as write blockers.
- Production write actions remain disabled by default.
- `EXECUTE_PUBLISH_PLAN` supports `publish.execution_mode = planned | sandbox_validate` and `publish.publish_validation_phase = fetch_status_only | upload_only | publish_optional`.
- `publish-sandbox.yml` may only target sandbox validation runs created by promotion and must not touch production items.
- `state/release_ledger.json` is append-only. Do not delete old ledger entries.
- Manual Dashboard actions such as cancel review must be recorded through the release ledger.
- Review watcher polls must stay read-only. Repeated `publish:review-status` checks may refresh `91_review_status.json`, but should not append duplicate review-state ledger entries when the observed state has not changed.
- Product acceptance review, functional test matrix, discovery quality review, and human product review are audit artifacts only. They must never trigger upload, publish, or production writes.
- Daily discovery is allowed to end in `build`, `research_more`, or `skip`. Do not force a build just because a daily run exists.
- `research_more` is not failure. It must flow through `RESEARCH_MORE_RESOLUTION` before the factory can conclude `build`, `skip`, or `still_research_more`.
- When live queue selection still returns `selected=false`, the next step is `TARGETED_RESEARCH_BATCH`, not a forced build.
- `TARGETED_RESEARCH_BATCH` is not allowed to loop forever. After `TARGETED_RESEARCH_ROUND_2`, the candidate must resolve to `build_ready`, `skip`, or a backlog waiting state.
- Round 2 is the last targeted research pass. Do not emit a third `research_more` state after `49_targeted_research_round2.json`.
- Discovery evidence must preserve provenance, make live-vs-fixture mode explicit, and record fallback reasons when live collection fails.
- Evidence quality and testability are build prerequisites. High install count alone is not enough to build.
- Low-evidence or low-testability candidates must be marked `research_more` or `skip`.
- `state/opportunity_backlog.json` is the queue of discovered opportunities; `state/portfolio_registry.json` is the memory of wedges already built or shipped. Do not treat them as interchangeable.
- `build_ready` requires evidence, wedge clarity, overlap, testability, compliance, and product-acceptance-forecast gates to pass together. Human candidate review is still required before any build.
- Do not auto-build after `RESEARCH_MORE_RESOLUTION` unless `task.allow_build_after_research_resolution=true`.
- The factory is allowed to end with `no_build_today` after targeted research if no candidate clears the stricter gates.
- `QUERY_EXPANSION` exists to find lower-overlap wedges after no-build days. It must exclude generic autofill, generic tab export, Amazon review scraping, broad SEO agents, and other high-risk repeats.
- After query expansion still ends in `no_build_today`, use `DISCOVERY_STRATEGY_V2` to shift the search space instead of adding a third research loop.
- `RUN_STRATEGY_V2` uses stricter gates than the generic live queue. It must reject candidates that still fail evidence quality, wedge clarity, testability, overlap, permission/compliance, source diversity, or happy-path clarity.
- Consecutive `no_build_today` outcomes should trigger `DISCOVERY_STRATEGY_REVIEW` rather than another same-family query loop.
- Tab/export opportunities must explicitly clear portfolio-differentiation checks; if the narrowed wedge is still too close to existing `tab_csv_window_export` items, mark it `skip`.
- `cand-tab-001 / Window Tabs Exporter` is the current example: despite strong wedge clarity and testability, it must stay `skip` because `portfolio_overlap_score=74`.
- `discovery:live-queue` is the primary entry for finding the next lower-overlap opportunity. Human candidate review may promote a `build_ready` candidate to the next stage, but it must not bypass the build gate.
- `future_builder_candidate` is roadmap evidence only. It must not be treated as approval to implement a new builder family unless the user explicitly asks for builder work.
- Human strategy review can shift query families, approve manual seeds, pause high-overlap categories, or record future-builder roadmap interest, but it cannot bypass discovery gates or force a build.
- `SUPPORT_QA_HANDOFF_DEEP_DIVE` is an explicit manual branch for the approved `seed-support-qa-handoff` seed. It must stay local-only, low-permission, and must not auto-send, upload, or create external issues.
- `SUPPORT_QA_EVIDENCE_SPRINT` is the final manual branch for the current support or QA handoff investigation. It must end in `human_candidate_review_ready`, `backlog_waiting_for_evidence`, or `skip`; it must not emit another indefinite `research_more`.
- Jam is still not build-ready after the evidence sprint. The missing proof is explicit external user voice for a local-only, text-first handoff helper, not engineering feasibility.
- `market_test.enabled=true` is allowed for low-risk, low-maintenance, low-clone candidates that can be explained in one sentence, built inside 16 hours, priced, and measured with a time-boxed market launch.
- Market-first mode does not waive policy, permission, clone-risk, or maintenance gates.
- Market-first mode also does not authorize upload or publish. It only authorizes a later human decision about whether a small MVP build is worth attempting.
- If `buying_intent_score` is low, the candidate may still become `market_test_build_ready`, but it must be marked high market-test risk and use a small launch with explicit kill criteria.
- `Page Context to Markdown` is the current preferred market-test wedge because it stays low-permission, low-overlap, and low-maintenance while still having a clear price and usage model.
- External payment stays out of the extension. Use an external checkout URL, show free usage left, show the lifetime unlock price, and allow manual or lightweight license entry.
- `task.monetization.enabled=true` only authorizes extension-side paywall wiring. This repository must not embed provider secrets or a full payment backend.
- Monetized builds must ship only public or placeholder URLs inside `monetization_config.json`.
- `checkout_mode=live` must be treated as approval-sensitive and blocked by `monetization:security-scan` until explicit human approval exists.
- Premium packaging is required for build-ready or market-test candidates before any publish path. Store screenshots must stay traceable to real browser-smoke captures.
- Promo images may be branded, but they must not invent unsupported UI, unsupported features, fake rankings, or false endorsements.
- If the local Remotion environment is unavailable, the asset render step must cleanly skip, and the listing quality gate must block publish until premium assets exist.
- Immutable sandbox runs must write premium packaging JSON sidecars under `state/run_events/<run_id>/`, store Remotion outputs under `state/run_events/<run_id>/80_remotion_assets/`, and keep landing packages outside the frozen run directory.
- Thresholds must not auto-loosen just because recent discovery runs found no build-ready candidates.
- Promotion is the only supported entry into sandbox upload/publish. Do not bypass `factory:promote-to-sandbox` or `HUMAN_APPROVAL_GATE`.
- Each new stage or lifecycle artifact must be wired into the main workflow, repair workflow, schema validation, and docs before it is considered complete.

## Current Implementation Status
- Offline workflow scaffold is implemented in Node.js ESM with no external dependencies.
- Three archetype builders are supported: `tab_csv_window_export`, `single_profile_form_fill`, and `gmail_snippet`.
- Browser smoke, screenshot capture, listing package generation, sandbox publish dry-run/write paths, review status, monitoring v1, portfolio registry, release ledger, and immutable close-run are wired into the factory lifecycle.
- Builder output can now optionally include extension-side monetization wiring: `monetization_config.json`, paywall UI, license templates, a monetization test matrix, and a secret-leak security scan contract.
- Discovery Engine V1 now emits shortlist quality, provenance-aware evidence, Opportunity Score V2, Build Gate V2, a research-more resolution loop, an opportunity backlog, and a live discovery queue with batch scoring and next-candidate selection.
- Production writes remain disabled by default.
