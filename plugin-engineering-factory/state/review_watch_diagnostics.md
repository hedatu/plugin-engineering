# Review Watch Diagnostics

- Checked at: 2026-04-21T08:50:28.044Z
- Active watch count: 2
- Local credentials present: false
- Proxy configured: false
- Can live fetch status: false
- Last live fetch at: 2026-04-19T23:17:43.021Z
- Last status source: preserved_last_known_state
- Stale watch detected: true
- Expected next check UTC: 2026-04-21T14:50:21.767Z
- Workflow file exists: true
- Workflow has schedule: true
- Workflow schedule: 0 */6 * * *

## Active Watches

- sandbox-2026-04-19-154400-dnnpkaefmlha-v0-1-1-6218cc: state=MANUAL_CANCEL_RECORDED_UNCONFIRMED, source=preserved_last_known_state, checked_at=2026-04-21T08:50:21.767Z, next_check_after=2026-04-21T14:50:21.767Z, terminal=false
- sandbox-2026-04-19-215222-dnnpkaefmlha-v0-1-2-c64a39: state=PENDING_REVIEW, source=preserved_last_known_state, checked_at=2026-04-21T08:50:21.810Z, next_check_after=2026-04-21T14:50:21.810Z, terminal=false

## Latest Review Status Sidecars

- sandbox-2026-04-19-154400-dnnpkaefmlha-v0-1-1-6218cc: source=preserved_last_known_state, checked_at=2026-04-21T08:50:21.767Z, review_state=PENDING_REVIEW, path=state/run_events/sandbox-2026-04-19-154400-dnnpkaefmlha-v0-1-1-6218cc/91_review_status.json
- sandbox-2026-04-19-215222-dnnpkaefmlha-v0-1-2-c64a39: source=preserved_last_known_state, checked_at=2026-04-21T08:50:21.810Z, review_state=PENDING_REVIEW, path=state/run_events/sandbox-2026-04-19-215222-dnnpkaefmlha-v0-1-2-c64a39/91_review_status.json

## Findings

- Local Chrome Web Store credentials are not configured, so live fetchStatus cannot run from this environment.
- The latest observed review status for active watches came from preserved_last_known_state, not live_fetch_status.
- No successful live fetchStatus was recorded within the last 8 hours.

## Required Fixes

- Provide Chrome Web Store review-watch credentials or rely on GitHub Actions secrets for live polling.
- Run review-watch with valid credentials and verify the scheduled workflow is executing.
