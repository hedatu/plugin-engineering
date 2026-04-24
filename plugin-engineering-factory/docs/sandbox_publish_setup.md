# Sandbox Publish Setup

This document covers the local-only setup for `EXECUTE_PUBLISH_PLAN` sandbox validation.

## Goal

The current supported validation path is:

- `execution_mode = sandbox_validate`
- `publish_validation_phase = fetch_status_only`

`upload_only` and `publish_optional` stay disabled by default and must remain behind explicit environment flags.

## Required Environment Variables

Set these in your local shell profile or an untracked `.env` file. Do not commit real values.

### 1. Publisher Id

```powershell
$env:CHROME_WEB_STORE_PUBLISHER_ID = "your-publisher-id"
```

This must match the Chrome Web Store publisher that owns the sandbox item.

### 2. Sandbox Item Id

```powershell
$env:CHROME_WEB_STORE_SANDBOX_ITEM_ID = "your-sandbox-item-id"
```

This is the only item id that `sandbox_validate` is allowed to target.

### 3. Service Account Credentials

Preferred setup:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "D:\path\to\local-service-account.json"
```

Notes:

- Keep the real service account key on disk locally only.
- Do not commit the JSON file into the repository.
- The local path `D:\code\ai插件优化工作流\docs\chrome-493801-4208a6ac069d.json` is acceptable only as an untracked local file.
- The repository `.gitignore` blocks that filename so it stays local-only.

Optional alternative credential sources that are already supported by the codebase:

- `CHROME_WEB_STORE_SERVICE_ACCOUNT_JSON`
- `CHROME_WEB_STORE_SERVICE_ACCOUNT_FILE`
- OAuth refresh-token variables instead of service account

## Safety Flags

For the current workflow target, keep both flags disabled:

```powershell
$env:CWS_ALLOW_SANDBOX_UPLOAD = "false"
$env:CWS_ALLOW_SANDBOX_PUBLISH = "false"
```

Rules:

- `fetch_status_only`: default and safe for current validation
- `upload_only`: requires `execution_mode=sandbox_validate`, sandbox item match, and `CWS_ALLOW_SANDBOX_UPLOAD=true`
- `publish_optional`: additionally requires `CWS_ALLOW_SANDBOX_PUBLISH=true`

## Commands

Planned preflight:

```powershell
npm run publish:preflight -- --run runs/<run_id>
```

Sandbox fetch-status validation:

```powershell
npm run publish:sandbox-fetch-status -- --run runs/<run_id>
```

Repair publish stage from an existing run:

```powershell
npm run repair:from-run -- --run runs/<run_id> --from EXECUTE_PUBLISH_PLAN
```

## Expected Behavior

### Missing credentials

If the local credential configuration is missing, `EXECUTE_PUBLISH_PLAN` must:

- fail cleanly
- write a clear `failure_reason`
- avoid real API calls
- avoid writing secrets into logs or artifacts

### Artifact expectations

`90_publish_execution.json` should always include:

- `credential_present`
- `credential_type`
- `publish_validation_phase`
- `api_calls_attempted`
- `api_calls_skipped`
- `fetch_status_response_summary`
- `failure_reason`

## Secret Handling Rules

The following must never appear in artifacts or normal logs:

- `private_key`
- `refresh_token`
- `client_secret`
- bearer tokens

If secret-like content is detected during publish artifact generation, the stage must fail with a redaction-guard failure and only write a sanitized failure artifact.
