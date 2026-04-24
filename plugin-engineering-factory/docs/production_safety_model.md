# Production Safety Model

## Scope

- `sandbox item` is the only allowed target for automated write validation.
- `production item` stays write-disabled by default.
- New item creation remains a manual Chrome Web Store Dashboard workflow.
- Chrome Web Store API v2 is only used for existing item status checks, uploads, and publish actions.

## Human Gate

- Every real write action requires a matching human approval artifact.
- Approved sandbox write actions are:
  - `sandbox_upload`
  - `sandbox_publish`
- Production approvals are blocked by default unless a task explicitly requests production and the approval artifact explicitly scopes to production.
- Approval artifacts can expire. Expired approvals must fail before any upload or publish call.
- For immutable sandbox runs, approval artifacts live under `state/run_events/<run_id>/82_human_approval.json`.
- Approval artifacts default to `approval_mode=test_artifact_only`.
- Only approvals created with explicit `--allow-write` may become `approval_mode=write_allowed`.
- `sandbox_upload` approvals must force `write_authorized=false` when notes contain `do not upload` or `artifact only`.
- `sandbox_publish` approvals must force `write_authorized=false` when notes contain `do not publish` or `artifact only`.

## Immutable Evidence Model

- Every successful `CLOSE_RUN` writes `99_close_run.json` and creates `runs/<run_id>/.immutable`.
- Immutable runs are audit snapshots. They must not be rewritten in place.
- Repairs on immutable runs must use `--repair-immutable-copy`, which copies the run to a new run id before repair.
- `state/release_ledger.json` is append-only and survives even if a run is later archived or copied.
- `factory:promote-to-sandbox` is the only supported way to create a `sandbox_validation` run from a daily run.
- `sandbox_prepare_upload_revision` and `sandbox_prepare_product_revision` are the only supported descendant lanes for creating new immutable sandbox revision runs from an existing promoted sandbox run.
- `sandbox_validation` runs freeze immediately after promotion.
- Sandbox upload or publish gates must reject descendant sandbox runs whose lineage has not been appended to `state/release_ledger.json`.
- Later lifecycle evidence for immutable sandbox runs lives under `state/run_events/<run_id>/`:
  - `82_human_approval.json`
  - `90_publish_execution.json`
  - `91_review_status.json`
  - `95_monitoring_snapshot.json`
  - `96_learning_update.json`

## Required Preconditions Before Production Publish

- `BROWSER_SMOKE_AND_CAPTURE` passed.
- `70_screenshot_manifest.json` passed.
- `72_policy_gate.json` passed.
- `81_listing_package_report.json` passed.
- `90_publish_execution.json` preflight passed.
- `82_human_approval.json` approved.
- Review watcher and release ledger flow are available.
- Rollback and cancel-review procedures are documented and human-operated.

## Review Tracking

- Chrome Web Store pending reviews may be cancelled from the Dashboard.
- Dashboard cancel-review actions must be recorded in `state/release_ledger.json`.
- `91_review_status.json` is the latest per-run review snapshot. For immutable sandbox runs it is written as a sidecar under `state/run_events/<run_id>/`.
- The ledger is the historical audit trail.
- Manual cancellation of a sandbox test submission is not treated as a product failure by itself.

## Secret Handling

- Secrets may only live in local environment variables or CI secrets.
- Never write `token`, `private_key`, `client_secret`, `refresh_token`, proxy passwords, or `Authorization` header values into artifacts, logs, README, or docs.
- Redaction guards must fail fast if secret-like content is about to be written.

## CI Safety

- CI workflows must use concurrency to avoid multiple jobs writing the same `runs/<run_id>` directory.
- `publish-sandbox.yml` must stay sandbox-only and must validate `state/run_events/<run_id>/82_human_approval.json` before upload or publish steps.
- `publish-sandbox.yml` must reject `test_artifact_only` approvals and any approval note that contains the write-block phrases above.
- `publish-sandbox.yml` must only target promoted `sandbox_validation` runs.
- `publish-sandbox.yml` defaults to `dry_run=true`; dry-run executes gates only and must not upload or publish.
- Daily factory CI must not upload or publish by default.
