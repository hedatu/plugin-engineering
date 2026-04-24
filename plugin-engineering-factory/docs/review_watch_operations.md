# Review Watch Operations

## Purpose

`review-watch` exists to keep sandbox validation runs in a read-only review-monitoring lane after `sandbox_publish_optional` returns `PENDING_REVIEW`. It does not upload, publish, cancel review, or write to production.

## Expected Wait Time

This workflow uses operational wait buckets instead of claiming a Chrome Web Store SLA:

- `<24h`: normal waiting window
- `1-3 days`: normal waiting window
- `4-14 days`: continue observing
- `15-21 days`: recommend a manual dashboard check
- `>21 days`: recommend contacting Chrome Web Store developer support

The registry stores these as `pending_duration_hours`, `pending_duration_days`, `review_age_bucket`, and `escalation_recommended`.

## Why Poll Automatically

- `PENDING_REVIEW` is a long-lived state and should not require manual memory.
- State changes need durable audit output in `91_review_status.json` and `state/release_ledger.json`.
- Unchanged states should refresh timestamps without spamming duplicate review-state ledger entries.
- Approved runs should immediately become ready for trusted-tester install verification.

## Commands

- Inspect registry: `npm run review-watch:inspect`
- Validate registry: `npm run review-watch:validate`
- Poll all active watches: `npm run review-watch:all`
- Poll one sandbox run through the same path: `npm run review-watch:all -- --run runs/<run_id>`
- Refresh one sandbox run directly: `npm run publish:review-status -- --run runs/<run_id>`

`review-watch:all` only processes watches where `enabled=true` and `terminal=false`. It can also backfill pending sandbox runs from existing publish/review artifacts when the registry starts empty.

## Active Review Watch Registry

`state/active_review_watches.json` tracks the sandbox validation runs that are still being watched. Each watch records:

- run identity: `watch_id`, `run_id`, `item_id`, `publisher_id`
- version context: `manifest_version`, `uploaded_crx_version`
- review timing: `submitted_at`, `latest_checked_at`, `next_check_after`
- review status: `latest_review_state`, `status_source`, `next_step`
- health counters: `check_count`, `consecutive_failures`
- lifecycle state: `enabled`, `terminal`, `terminal_reason`
- wait-age metadata: `pending_duration_hours`, `pending_duration_days`, `review_age_bucket`, `escalation_recommended`

The file is lock-protected so concurrent review-watch runs do not corrupt it.

## Dedupe Rule

`publish:review-status` may refresh `91_review_status.json` repeatedly for the same `PENDING_REVIEW` state. When the observed review state has not changed:

- update `latest_checked_at`, `check_count`, and age metadata in the registry
- refresh the latest `91_review_status.json`
- do not append another `review_pending` ledger entry

This keeps the ledger append-only without turning it into heartbeat spam.

## Credentials

Live `fetchStatus` requires the same Chrome Web Store read credentials already used by sandbox review checks. In GitHub Actions, configure:

- `CHROME_WEB_STORE_SERVICE_ACCOUNT_JSON`
- `CHROME_WEB_STORE_PUBLISHER_ID`
- `CHROME_WEB_STORE_SANDBOX_ITEM_ID`
- optional proxy secrets: `CWS_HTTPS_PROXY`, `CWS_HTTP_PROXY`

If credentials are missing, review watch preserves the last known review state and writes `status_source=preserved_last_known_state` instead of downgrading the run.

## GitHub Actions

`.github/workflows/review-watch.yml` supports:

- `workflow_dispatch` for one run or all active watches
- a 6-hour schedule for `review-watch:all`
- artifact upload for:
  - `state/review_watch_summary.json`
  - `state/active_review_watches.json`
  - `state/run_events/**/91_review_status*.json`

The workflow is read-only. It must not upload, publish, cancel review, or touch production items.

## Approved Branch

When review status changes from pending to approved or equivalent tester-available state:

- next step becomes `prepare_manual_install_verification`
- `review-watch:all` refreshes `92_install_verification_plan.json`
- trusted-tester install remains manual

Run manually if needed:

`npm run sandbox:prepare-install-verification -- --run runs/<run_id>`

## Rejected Branch

When review status changes to rejected:

- next step becomes `prepare_review_repair_plan`
- no automatic resubmission happens
- a human must copy the dashboard rejection reason before creating the repair plan

Then run:

`npm run sandbox:prepare-review-repair -- --run runs/<run_id> --reason "<dashboard rejection reason>"`

## Manual Cancel Branch

Review watch never cancels review automatically.

If a user manually cancels review in the dashboard, record it with:

`npm run publish:record-manual-review-action -- --run runs/<run_id> --action manual_cancel_review --note "<note>"`

If `fetchStatus` later confirms `CANCELLED` or `DRAFT`, the watch becomes terminal. If credentials are missing at record time, keep the watch and preserve the last known state until a later read-only confirmation is possible.

## Hard Prohibitions

- Do not auto-cancel review.
- Do not auto-repeat publish.
- Do not upload from review-watch.
- Do not publish from review-watch.
- Do not write to production from review-watch.
