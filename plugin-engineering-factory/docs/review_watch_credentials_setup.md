# Review Watch Credentials Setup

This guide explains how to make `publish:review-status`, `review-watch:all`, and `review-watch:credentials-doctor` see Chrome Web Store credentials reliably in local shells, the current terminal session, and GitHub Actions.

## Recommended Local Setup

Use an untracked `.env.local` file in the repository root.

Why:

- Node only sees environment variables that were inherited by the current process.
- Windows User or Machine environment changes often do not appear in already-open terminals.
- `.env.local` gives the repo a deterministic local source without committing secrets.

The loader uses this precedence:

1. `process.env`
2. `.env.local`
3. persisted Windows User or Machine environment values as a local fallback

## `.env.local` Example

Start from [`.env.example`](/D:/code/ai插件优化工作流/.env.example) and create `.env.local` next to it.

Example:

```dotenv
CHROME_WEB_STORE_PUBLISHER_ID=your-publisher-id
CHROME_WEB_STORE_SANDBOX_ITEM_ID=your-sandbox-item-id
GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\service-account.json
CWS_HTTPS_PROXY=http://127.0.0.1:10110
CWS_HTTP_PROXY=http://127.0.0.1:10110
```

Do not commit `.env.local`.
Do not store service-account JSON files inside the repository unless they are fixtures with fake values.

## Supported Local Credential Modes

The review watcher supports:

1. `service_account_file`
   Use `GOOGLE_APPLICATION_CREDENTIALS` or `CHROME_WEB_STORE_SERVICE_ACCOUNT_FILE`.
2. `service_account_json`
   Use `CHROME_WEB_STORE_SERVICE_ACCOUNT_JSON`.
3. `oauth_refresh_token`
   Use `CHROME_WEB_STORE_CLIENT_ID`, `CHROME_WEB_STORE_CLIENT_SECRET`, and `CHROME_WEB_STORE_REFRESH_TOKEN`.

The recommended mode for review watching is `service_account_file`.

## Why The Current Terminal Might Not See Credentials

Common reasons:

- the variable was added to Windows User or Machine environment after the terminal started
- the variable was configured in another shell profile, not the current one
- the variable exists in PowerShell profile logic but was not exported into the Node child process
- a path variable exists, but the referenced file no longer exists

`review-watch:credentials-doctor` now distinguishes these cases:

- missing credentials
- service-account path missing
- current Node process did not inherit persisted environment values
- proxy configured but not working
- token exchange failure
- `fetchStatus` permission or item mismatch such as `403` or `404`
- successful live fetch with `status_source=live_fetch_status`

## GitHub Actions Setup

Configure these repository or environment secrets for `.github/workflows/review-watch.yml`:

- `CHROME_WEB_STORE_PUBLISHER_ID`
- `CHROME_WEB_STORE_SANDBOX_ITEM_ID`
- `CHROME_WEB_STORE_SERVICE_ACCOUNT_JSON` or `GOOGLE_APPLICATION_CREDENTIALS_PATH`
- optional `CWS_HTTPS_PROXY`
- optional `CWS_HTTP_PROXY`

Supported service-account inputs in Actions:

1. `CHROME_WEB_STORE_SERVICE_ACCOUNT_JSON`
   The workflow writes it to `$RUNNER_TEMP/cws-service-account.json` and sets `GOOGLE_APPLICATION_CREDENTIALS`.
2. `GOOGLE_APPLICATION_CREDENTIALS_PATH`
   Use this when the runner already has a credential file on disk.

Never upload the service-account JSON file as an artifact.
Never commit the service-account JSON file.

## Proxy Setup

If Node requests time out or are blocked by the network, set:

- `CWS_HTTPS_PROXY`
- `CWS_HTTP_PROXY`

Fallback standard proxy variables are also supported:

- `HTTPS_PROXY`
- `HTTP_PROXY`
- `NO_PROXY`

The doctor and diagnostics artifacts only record a redacted proxy URL such as `http://proxy-host:10110`.

## Commands

Check credential state:

```powershell
npm run review-watch:credentials-doctor
```

Refresh a single run:

```powershell
npm run publish:review-status -- --run runs/<sandbox_validation_run_id>
```

Poll all active watches:

```powershell
npm run review-watch:all
```

## How To Confirm Live Review Polling Works

Look for these conditions:

- `status_source=live_fetch_status`
- `fetch_status_attempted=true`
- `fetch_status_succeeded=true`
- `credentials_present=true`

If those are not true, the watcher is still preserving last known state instead of reading the dashboard status live.

## Approved, Rejected, Cancelled Branches

When live fetch succeeds:

- `approved` or `available_to_testers`
  The watch should move to terminal, `next_step=prepare_manual_install_verification`, and `92_install_verification_plan.json` should become active.
- `rejected`
  The watch should move to terminal and the next step becomes review repair planning.
- `cancelled` or `draft`
  The watch should move to terminal only when the dashboard state confirms the cancellation or draft state.
