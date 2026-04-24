# California Service Plan

## Phase 1: Low-Risk Services
- `factory-review-watch`
  - enabled first
  - read-only Chrome Web Store status polling
  - no upload
  - no publish
- `plugin-site-static`
  - enabled first
  - serves generated plugin detail pages, pricing pages, and product index
- `factory-state-sync`
  - enabled first
  - hosts product catalog, release ledger, and backlog snapshots

## Phase 2: HWH Commercial Services
- `hwh-pay-site`
  - serve `pay.915500.xyz`
  - OTP login UI
  - pricing and checkout entry
- `hwh-pay-api`
  - serve `pay-api.915500.xyz`
  - Supabase gateway and Edge Functions
- `hwh-auth`
  - Supabase Auth / GoTrue
  - real SMTP provider only
- `hwh-webhook`
  - Waffo webhook receiver
  - entitlement writes

## Services Not To Enable Yet
- automatic Chrome Web Store upload
- automatic Chrome Web Store publish
- production DNS cutover
- production real-payment traffic before California E2E passes
- permanent Remotion render worker on the 1 GB host

## Recommended Runtime Shape
- Reverse proxy in front:
  - Caddy preferred for simpler HTTPS automation
  - nginx acceptable if team wants parity with old server
- HWH stack:
  - Docker Compose
  - clear separation between public frontend and API/auth/webhook services
- Factory stack:
  - read-only scheduled jobs only in phase 1

## Capacity Note
- Because California has about `961M` RAM, do not co-locate heavy build/render jobs with the full Supabase runtime without either:
  - droplet resize, or
  - moving build/render to a separate runner.
