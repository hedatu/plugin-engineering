# Plugin Engineering Index

## What This Repository Is

This repository is a private engineering archive for one active launch product and the workflow system around it.

The active product is:

- LeadFill One Profile

The retained workflow system is:

- Chrome Extension Opportunity Factory

## How To Read The Repo

### Product-first layer

Use the repo root when you want the concrete commercial product:

- website and pricing flows
- Chrome extension source
- Supabase functions and schema
- HWH / Waffo integration docs
- OTP, entitlement, and SMTP reports

### Workflow and packaging layer

Use `plugin-engineering-factory/` when you want:

- the factory rules
- candidate and release workflow code
- packaging automation
- release gating
- visual review and launch-prep artifacts
- run history and state

## Current Mainline Decision

The current project is not pursuing general platform expansion as the mainline.

The current mainline is:

- single-product LeadFill commercial launch

The relevant reset artifacts are:

- `plugin-engineering-factory/docs/leadfill_project_reset_plan_2026-04-24.md`
- `plugin-engineering-factory/state/leadfill_launch_backlog_2026-04-24.json`

## Highest-Value Files

### Root

- `README.md`
- `docs/leadfill_hwh_integration_handoff.md`
- `docs/leadfill_hwh_integration_handoff.json`

### Factory

- `plugin-engineering-factory/README.md`
- `plugin-engineering-factory/AGENTS.md`
- `plugin-engineering-factory/codex_chrome_extension_factory_prd_zh.md`
- `plugin-engineering-factory/docs/development_audit.md`
- `plugin-engineering-factory/docs/leadfill_project_report_2026-04-24.md`
- `plugin-engineering-factory/docs/leadfill_full_lifecycle_report_2026-04-24.md`
- `plugin-engineering-factory/docs/leadfill_project_reset_plan_2026-04-24.md`

### Current commercial candidate

- `plugin-engineering-factory/runs/commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2/`
- `plugin-engineering-factory/state/run_events/commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2/`

## Current Naming Convention

Repository umbrella name:

- `插件工程 / Plugin Engineering`

Active product name:

- `LeadFill One Profile`
