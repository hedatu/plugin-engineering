# SMTP Repair Options

## Decision Summary

Recommended option for the current blocker: **Option 1, keep the old HWH environment and use the repaired SMTP path now**.

Reason:

- SMTP / OTP is already live-fixed on the current environment.
- `SEND_OTP` and `VERIFY_OTP` now succeed.
- A real mailbox receives OTP.
- Immediate business blocker has moved from SMTP to Waffo payment / webhook E2E.

California rebuild remains a valid **later** migration path for cleaner long-term isolation, but it is not the fastest or lowest-risk way to clear the current OTP blocker.

## Option 1: Repair The Existing HWH Environment

Scope:

- stop using `supabase-mail:2500`
- use a reachable SMTP path
- keep `SITE_URL=https://pay.915500.xyz`
- keep `API_EXTERNAL_URL=https://pay-api.915500.xyz`
- keep `GOTRUE_SITE_URL=https://pay.915500.xyz`
- keep allow-lists and mailer hosts aligned with `pay.*`
- re-test OTP

Assessment:

- `time_cost`: low
- `risk`: medium-low
- `rollback`: easy, because no DNS migration is required
- `data_migration_need`: none
- `DNS_change_need`: none

Pros:

- clears the immediate blocker fastest
- no server migration required
- no data migration required
- no DNS switch required

Cons:

- old environment still carries historical mixed context with `weiwang` / `hwh`
- SMTP fix is host-specific and not a clean long-term commercial rebuild
- production hardening is still weaker than a fresh California deployment

## Option 2: Rebuild HWH On California

Scope:

- deploy pay-site, pay-api, Supabase Auth, webhook handling, and Edge Functions on California
- configure real SMTP from day one
- keep `pay.915500.xyz` / `pay-api.915500.xyz` as the canonical public endpoints
- keep `LeadFill` and `weiwang` isolated by product key and monetization rules
- reserve Singapore for backup / staging

Assessment:

- `time_cost`: medium-high
- `risk`: medium
- `rollback`: medium, because deployment and later DNS cutover need a controlled revert path
- `data_migration_need`: yes
- `DNS_change_need`: later yes, but not immediately

Pros:

- cleaner commercial architecture
- better long-term separation between LeadFill paid stack and `weiwang` free-only project
- better alignment with the new California primary server plan

Cons:

- slower than fixing the current OTP blocker in place
- more moving parts before SMTP is unblocked
- webhook, Auth, and payment E2E still need to be re-verified after rebuild

## Recommended Option

`recommended_option=repair_old_environment_now`

Interpretation:

- use the repaired old environment to finish OTP and then complete Waffo payment/webhook verification
- treat California as the planned future rebuild target, not the immediate SMTP fix path

## Practical Next Step

Next technical step after SMTP / OTP: **run Waffo test payment and verify webhook-driven entitlement activation**.
