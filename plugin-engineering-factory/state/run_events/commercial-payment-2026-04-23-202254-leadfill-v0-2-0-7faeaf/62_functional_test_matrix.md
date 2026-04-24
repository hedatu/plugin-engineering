# Functional Test Matrix

- Run: commercial-payment-2026-04-23-202254-leadfill-v0-2-0-7faeaf
- Archetype: single_profile_form_fill
- Coverage score: 78.95
- Next focus: Add label-variant coverage for alternate field descriptors such as mobile, organization, and region.; Add a multi-step form regression once the single-step smoke suite is stable.; Add manual tester verification on a real CRM page before another publish cycle.

## Missing Tests

- free usage counter
- free limit paywall
- license activation and restore
- offline grace and trust boundary

## Release Blockers

- monetization matrix has missing core checks

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
- free usage counter: missing (Verify the free usage counter decreases on each core action.)
- free limit paywall: missing (Exhaust the free fills and verify the paywall appears with the upgrade CTA.)
- license activation and restore: missing (Verify activate, verify, restore, and invalid-license states in the license UI.)
- offline grace and trust boundary: missing (Verify offline grace expires and the extension falls back to free until reverified.)