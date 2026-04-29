# 插件工程 / Plugin Engineering

This repository acts as a consolidated archive for the current LeadFill One Profile commercial launch work and the broader Chrome extension engineering workflow that produced it.

Current mainline:

- LeadFill One Profile is the only active product launch track.
- External checkout plus webhook-driven entitlement remains the payment model.
- Email OTP remains the auth model.
- No Chrome upload or publish automation is being used as the active launch path.

## Repo Structure

### 1. LeadFill product stack at repo root

The root directories hold the concrete product implementation and payment-site stack:

- `apps/` web app source retained for membership-site experiments, but it is not the current production website source.
- `extensions/` Chrome extension source
- `packages/` shared packages
- `supabase/` schema, migrations, edge functions, and config
- `docs/` LeadFill and HWH integration docs
- root `*.json` and `*.md` reports for payment, SMTP, OTP, entitlement, and migration work

This is the codebase for the current single-product commercial launch path.

Production website source of truth:

- current source: `plugin-engineering-factory/src/site/pluginPages.mjs`
- current output: `plugin-engineering-factory/generated/plugin-pages/leadfill-one-profile`
- live host: `https://pay.915500.xyz`
- policy note: `docs/173_pay_site_apps_web_deployment_policy.md`
- status: restored to the previous bilingual HWH Extensions static marketplace after rejecting the `apps/web` SPA deployment

### 2. `plugin-engineering-factory/`

This directory is a merged snapshot of the Chrome Extension Opportunity Factory repository, including:

- factory PRD and execution rules
- scripts, schemas, source, templates, fixtures, and config
- discovery, packaging, monetization, and launch-support docs
- state snapshots, release ledger, backlog, and review-watch artifacts
- run artifacts for the commercial LeadFill candidate and related workflow history
- Remotion asset-generation source

This is preserved here so the product implementation and the factory-side planning, packaging, and release evidence live in one engineering repository.

### 3. `supplemental_docs/`

This directory contains screenshots, visual review captures, redesign evidence, and project reports collected during the LeadFill website and launch work.

## Current Focus

The project has been reset from broad factory expansion to a narrower execution track:

- build and polish one commercial candidate
- complete human visual review
- prepare production payment readiness
- prepare commercial resubmission materials
- keep launch metrics and release gates explicit

The reset plan and backlog are included under:

- `plugin-engineering-factory/docs/leadfill_project_reset_plan_2026-04-24.md`
- `plugin-engineering-factory/state/leadfill_launch_backlog_2026-04-24.json`

## Naming

The repository is now organized under the broader concept of `插件工程 / Plugin Engineering` rather than only the earlier LeadFill payment-site package name.

The reason is structural:

- LeadFill is the active launch product
- the factory workflow, packaging system, release gates, and audit history are still important project assets
- both need to live together in a coherent private engineering archive

## Secret Handling

This repository is intentionally packaged without local secret files.

Excluded or redacted items include:

- local env secrets
- service-role keys
- Waffo private credentials
- SMTP secrets
- Git metadata from the original source repos
- dependency folders such as `node_modules/`

## Recommended Entry Points

If you are orienting yourself quickly, start here:

1. `PACKAGE_CONTENTS.md`
2. `PLUGIN_ENGINEERING_INDEX.md`
3. `docs/leadfill_hwh_integration_handoff.md`
4. `plugin-engineering-factory/README.md`
5. `plugin-engineering-factory/AGENTS.md`
6. `plugin-engineering-factory/codex_chrome_extension_factory_prd_zh.md`
