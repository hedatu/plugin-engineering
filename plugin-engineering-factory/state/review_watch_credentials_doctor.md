# Review Watch Credentials Doctor

- Checked at: 2026-04-23T10:57:11.355Z
- Credential mode: service_account_file
- Publisher id present: true
- Item id present: true
- Proxy configured: true
- Proxy source: CWS_HTTPS_PROXY
- Proxy url: http://127.0.0.1:10110
- Node can probe oauth2: true
- Node can probe CWS: true
- Token self test attempted: true
- Token self test status: failed
- Fetch status attempted: false
- Fetch status status: skipped
- Current review state: unknown

## Findings

- Token self-test failed during credentials_file_read.
- GOOGLE_APPLICATION_CREDENTIALS or CHROME_WEB_STORE_SERVICE_ACCOUNT_FILE is set, but the file does not exist.

## Required Fixes

- Fix the configured Chrome Web Store credential before relying on automatic review polling.
- Point GOOGLE_APPLICATION_CREDENTIALS at a valid local service-account JSON file.
