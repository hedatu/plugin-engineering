# Deployment Phases

## Phase 0: Inventory Only

- inspect local server资料
- write redacted inventory
- write planning docs
- do not connect
- do not deploy

## Phase 1: SSH Doctor

- test SSH connectivity only
- run hostname / system info checks
- do not install packages
- do not edit server files

## Phase 2: Bootstrap California

Requires explicit user approval.

- create base directories
- install Node / pnpm / Docker / Caddy or Nginx
- create non-root deploy user
- configure firewall
- set log and backup paths

## Phase 3: Deploy Factory Read-Only Services

- review-watch
- discovery jobs
- product catalog maintenance
- packaging workers
- no upload
- no publish

## Phase 4: Deploy Plugin-Site Static Pages

- generated plugin detail pages
- pricing pages
- product catalog index
- static assets

## Phase 5: HWH Migration Preparation

- SMTP design for the California host
- Supabase Auth redirect / callback review
- Waffo webhook endpoint plan
- checkout contract revalidation
- no production DNS cutover

## Phase 6: Cutover

Requires explicit human confirmation.

- DNS changes
- health checks
- staged rollout
- rollback plan ready before switch

