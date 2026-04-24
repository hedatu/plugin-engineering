# Functional Test Matrix

- Run: commercial-payment-2026-04-23-203843-leadfill-v0-2-0-b846c2
- Archetype: single_profile_form_fill
- Coverage score: 100
- Next focus: Keep the source=chrome_extension HWH smoke artifact linked to this candidate before any upload decision.; Repeat manual visual review of the membership panel and payment CTA.; Do not switch checkoutMode to live until production payment is explicitly approved.

## Missing Tests

- none

## Release Blockers

- none

## Test Cases

- empty form: passed (Keep the empty-form smoke fixture in regression.)
- partially filled form: passed (Keep the partially-filled regression fixture.)
- readonly field: passed (Keep the readonly and disabled regression fixture.)
- textarea: passed (Keep textarea in the empty-form fixture.)
- select: passed (Keep the select fixture in smoke regression.)
- email field: passed (Keep the current browser smoke assertion.)
- phone field: passed (Keep the current browser smoke assertion and add alternate label variants.)
- name field: passed (Keep the current browser smoke assertion.)
- no matching fields: passed (Keep the no-match regression fixture.)
- activeTab permission path: passed (Retain the current smoke coverage.)
- local storage only: passed (Keep a static test that forbids network calls in popup code.)
- popup error display: passed (Keep feedback verification in smoke regression.)
- profile save / edit / delete: passed (Keep popup profile management in smoke regression.)
- field overwrite behavior: passed (Keep the overwrite-default-false regression fixture.)
- visual feedback after fill: passed (Keep popup feedback verification in smoke regression.)
- email OTP login UI and protocol: passed (Keep SEND_OTP and VERIFY_OTP exposed only through the background membership runtime.)
- source=chrome_extension checkout metadata: passed (Keep CREATE_CHECKOUT sending source=chrome_extension plus installationId.)
- successUrl is not a local unlock basis: passed (Keep Pro activation tied to webhook-derived entitlement refresh only.)
- webhook-derived entitlement refresh: passed (Keep REFRESH_ENTITLEMENT as the user-visible post-payment recovery path.)
- CONSUME_USAGE gate before fill: passed (Keep guardPaidFeatureUsage before every fill execution path.)
- free quota and quota exceeded path: passed (Keep the 10-fill meter and 11th QUOTA_EXCEEDED smoke in the HWH handoff.)
- background session token boundary: passed (Keep session handling in the background membership runtime.)
- public-only payment config: passed (Run monetization:security-scan before any upload approval.)
- test mode checkout guard: passed (Keep production payment blocked until explicit live checkout verification.)