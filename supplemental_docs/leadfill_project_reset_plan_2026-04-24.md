# LeadFill Project Reset Plan

Updated: 2026-04-24
Project focus: LeadFill One Profile only
Reset mode: single-product commercial launch
Time horizon: next 2 weeks

## 1. Reset Decision

The project mainline is now reset from a broad "plugin factory platform" narrative to a narrower and more executable "LeadFill One Profile commercial launch" narrative.

This means the active goal for the next two weeks is no longer platform expansion. The active goal is to take one product, one SKU, one payment flow, and one launch package to the point where it is commercially launch-ready, subject to final human gates.

This reset preserves the existing technical safety rules:

- External checkout remains the payment model.
- Webhook-confirmed entitlement remains the only paid activation source of truth.
- The extension must not hold `SUPABASE_SERVICE_ROLE_KEY`, `WAFFO_PRIVATE_KEY`, merchant secrets, or equivalent server-only credentials.
- `successUrl` must not unlock paid membership locally.
- Email OTP remains the auth path.
- Google login is out of scope.
- `chatgpt2obsidian` remains legacy protocol reference only and must not re-enter active LeadFill configuration.

## 2. Stop Doing Now

The following work is explicitly paused or stopped for the current mainline:

### 2.1 Discovery

Stop:

- new discovery runs for new extension ideas
- new candidate scoring for unrelated products
- new backlog expansion for non-LeadFill wedges

Why:

- none of this helps LeadFill launch in the next two weeks
- it creates scope drift and planning noise

### 2.2 New Builder Work

Stop:

- adding new builder families
- expanding the factory to support a second product archetype
- generic builder/platform abstractions that do not directly improve LeadFill launch

Why:

- builder expansion is platform work
- the current launch path only needs the existing `single_profile_form_fill` capability

### 2.3 Google Login

Stop:

- Google login planning
- OAuth migration
- any auth redesign away from the current email OTP flow

Why:

- it is not required for launch
- it would introduce new auth, consent, and UX complexity
- the current OTP path is already verified

### 2.4 SMTP Automation Platform

Stop:

- building a generalized SMTP automation platform
- over-automating provider provisioning
- broad email infrastructure tooling beyond what LeadFill needs

Why:

- Resend SMTP independence is already verified for LeadFill
- more abstraction here is not launch-critical

### 2.5 Second Plugin

Stop:

- starting a second commercial plugin
- parallel product ideation for another Chrome extension
- cross-product launch planning

Why:

- this reset is explicitly single-product

### 2.6 Automatic Publish

Stop:

- any automatic Chrome upload
- any automatic Chrome publish
- any automation that bypasses human approval gates

Why:

- current release gating still intentionally requires manual review and approval

### 2.7 Over-Platformization

Stop:

- framing every problem as a factory or platform problem
- adding generalized orchestration, registry, or workflow layers unless they directly reduce LeadFill launch risk this cycle

Why:

- the mainline is execution, not platform ambition

## 3. Only Do Now

The active work surface is now limited to the following:

### 3.1 Payment-Configured Commercial Candidate

Keep improving and validating the current commercial candidate:

- `commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2`

This remains the current source of truth for the launch package.

### 3.2 Human Visual Review

Immediate next gate:

- complete human visual review on the website, store assets, and packaging

This is the first real blocker still sitting above a mostly working technical system.

### 3.3 Production Payment Readiness

Focus only on the live-payment path required for LeadFill:

- live checkout mode planning
- live Waffo product / price mapping
- live webhook target verification
- refund / revoke behavior
- final support email and disclosure review

### 3.4 Production Payment Live Config

Prepare, but do not prematurely enable:

- live payment configuration
- live callback URLs
- live webhook target and verification path

### 3.5 Commercial Resubmission Package

Prepare the package required for Chrome commercial resubmission:

- version strategy
- store assets
- listing copy
- payment disclosure alignment
- resubmission readiness package

### 3.6 Launch Metrics

Prepare a very small launch metrics layer for LeadFill only:

- page conversion signals
- checkout conversion signals
- OTP completion rate
- entitlement refresh success rate
- free-to-paid boundary visibility

Do not expand this into a generalized analytics platform.

## 4. Current Architecture Split

To keep scope clean, the current work should be mentally split into three layers:

### 4.1 billing-core

What it is:

- the minimum payment and entitlement system needed to sell LeadFill safely

Includes:

- HWH pay-site integration
- Waffo checkout and webhook flow
- Resend SMTP-backed email OTP
- entitlement read / refresh logic
- webhook-driven paid activation
- payment truthfulness rules

What matters now:

- production payment readiness
- live payment verification
- refund / revoke correctness

### 4.2 commercial-plugin-template

What it is:

- the concrete commercial product surface that users will see and install

Includes:

- LeadFill extension bundle
- popup paywall and quota logic
- membership restore flow
- product website
- pricing page
- account page
- commercial packaging
- listing assets

What matters now:

- polish
- visual review
- truthful pricing and commercial UX
- Chrome resubmission preparation

### 4.3 factory-later

What it is:

- everything reusable, platform-like, or future-oriented

Includes:

- discovery engine
- opportunity backlog expansion
- new builders
- second plugin support
- generalized platform abstractions

What matters now:

- not active
- preserve, do not expand
- revisit only after LeadFill launch

## 5. LeadFill Two-Week Launch Plan

## Week 1

Primary theme: polish and launch-package closure

### 5.1 Human Visual Review

Tasks:

- review homepage, product page, pricing page, account page, legal pages
- review store asset gallery
- review screenshots and promo assets
- review multilingual spot check at least on structure and truthfulness

Exit criteria:

- a recorded visual review decision exists
- any critical visual or copy defects are fixed

### 5.2 Legal / Pricing / Page Polish

Tasks:

- tighten pricing clarity
- tighten refund / privacy / terms copy where needed
- verify all payment-related wording remains truthful
- make sure no page implies local unlock from success page

Exit criteria:

- pricing and legal pages are ready for resubmission package review

### 5.3 Production Payment Checklist

Tasks:

- finalize missing live-payment checklist items
- define live checkout mapping
- define live webhook verification path
- define refund / revoke verification path
- define final support email usage

Exit criteria:

- production payment readiness checklist is complete and actionable

### 5.4 Resubmission Readiness

Tasks:

- verify store release package integrity
- verify listing quality gate remains passed
- verify current manifest/version strategy
- verify resubmission package contents are complete

Exit criteria:

- package is ready for re-review preparation once payment and human gates are cleared

## Week 2

Primary theme: controlled launch-readiness verification

### 5.5 Production Payment Verification

Tasks:

- enable live config in a controlled manner when approved
- run controlled live checkout
- verify live webhook reception
- verify live entitlement activation
- verify refund / revoke behavior

Exit criteria:

- `production_payment_verified=true`

### 5.6 Commercial Release Gate

Tasks:

- rerun launch-related gates after live payment verification
- confirm only human/public approval blockers remain, if any

Exit criteria:

- commercial release gate is current and truthful

### 5.7 Chrome Resubmission Preparation

Tasks:

- confirm final version target
- confirm listing package and assets
- confirm store submission notes
- confirm manual upload checklist

Exit criteria:

- resubmission package is ready for manual execution

### 5.8 Launch Metrics Plan

Tasks:

- define minimal post-launch metrics
- define where metrics come from
- define the first-week review cadence

Exit criteria:

- a LeadFill-specific launch metrics plan exists

## 6. Current Launch Backlog

The current launch backlog should contain only items that can materially block LeadFill commercial launch.

Priority order:

1. `human_visual_review_pending`
2. `pricing_legal_copy_final_polish`
3. `production_payment_live_config_defined`
4. `live_waffo_product_price_mapping_verified`
5. `live_webhook_verification_completed`
6. `live_refund_revoke_behavior_verified`
7. `support_email_finalized_for_launch`
8. `payment_disclosure_final_review`
9. `commercial_resubmission_package_finalized`
10. `user_public_launch_approval_missing`

Deliberately excluded from the active launch backlog:

- discovery
- new builder work
- second plugin
- Google login
- generalized SMTP platform
- generalized factory improvements

## 7. Current Answers

### 7.1 Should the project continue using HWH / Waffo now?

Answer: yes

Reason:

- it is already integrated
- test-mode flow is already verified
- the architecture matches the current safety model
- changing payment foundation now would create unnecessary launch risk

### 7.2 Should the project switch to Google login now?

Answer: no

Reason:

- email OTP is already verified
- Google login is not required for current launch
- switching auth now would delay launch and add risk

### 7.3 Should the project continue factory / discovery work now?

Answer: no

Reason:

- factory/discovery work does not help the next two weeks of LeadFill launch execution
- it should be treated as later-layer work only

### 7.4 Should the project do a single-SKU launch first?

Answer: yes

Reason:

- one product
- one SKU
- one payment flow
- one launch message

This is the cleanest commercial path and the lowest-risk launch shape.

## 8. Final Recommendation

The right mainline is:

- one product: LeadFill One Profile
- one payment model: external checkout with webhook-driven entitlement
- one auth path: email OTP
- one launch surface: Chrome commercial resubmission plus LeadFill product website
- one commercial scope: single-SKU launch first

The right management decision for the next two weeks is:

- freeze platform ambition
- stop discovery and second-product drift
- complete visual review
- complete production payment readiness
- verify live payment
- prepare resubmission
- then decide on launch

In short:

LeadFill is no longer a factory exploration project.
LeadFill is now a focused commercial launch project.
