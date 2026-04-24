# California Bootstrap Plan

## Goal
Prepare `do-mini-sfo3-01` as the new primary server for the commercial extension factory and HWH pay-site stack without cutting DNS in this phase.

## Current SSH Doctor Summary
- Hostname: `do-mini-sfo3-01`
- Role: `primary_factory_server`
- Docker: installed
- Docker Compose: installed
- Node: not installed
- npm: not installed
- Reverse proxy: neither nginx nor Caddy installed
- Disk available: about `16G`
- RAM available: about `961M`

## Bootstrap Recommendation
- Proceed with California as the primary migration target because the old server is expiring.
- Treat this as a staged rebuild, not an in-place copy of every old-server behavior.
- Resize the droplet or split heavy workloads if HWH, Supabase, reverse proxy, and factory automation are all expected to coexist long-term on `1 GB` RAM.

## Planned Directory Layout
```text
/opt/commercial-extension-factory/
  apps/
    factory/
    hwh/
    plugin-site/
  packages/
  state/
  runs/
  generated/
  logs/
  backups/
  secrets/
```

## Bootstrap Steps Requiring User Approval
1. Create a non-root deploy user and group.
2. Create the directory tree under `/opt/commercial-extension-factory/`.
3. Install Node.js and npm or pnpm for the factory app path.
4. Install a reverse proxy such as Caddy or nginx.
5. Create systemd services or Docker Compose stacks for:
   - factory read-only jobs
   - plugin-site static hosting
   - HWH pay-site
   - pay-api / Supabase services
6. Configure firewall and SSH hardening.
7. Mount backup targets and define retention.

## Phase 1 Services To Enable First
- `review-watch`
- product catalog and ledger sync
- plugin-site static preview

## Services To Delay Until Env Is Ready
- pay-site frontend with real auth
- pay-api and Supabase services
- Waffo webhook receiver
- SMTP-backed OTP login

## Security Boundaries
- Secrets stay out of git and out of extension bundles.
- `SUPABASE_SERVICE_ROLE_KEY`, `WAFFO_PRIVATE_KEY`, `WAFFO_WEBHOOK_SECRET`, and `SMTP_PASSWORD` stay server-side only.
- Chrome extension bundles only receive:
  - `PUBLIC_SUPABASE_URL`
  - `PUBLIC_SUPABASE_ANON_KEY`
  - `PRODUCT_KEY`
  - `PLAN_KEY`
  - `SITE_URL`

## Risks
- `1 GB` RAM is enough for bootstrap and light services, but not comfortable for a full combined build/render/payment stack.
- Remotion rendering should stay off-box or run as an on-demand job, not a permanent service on California.
- DNS must not move until SMTP/OTP and Waffo webhook are re-verified in the new environment.
