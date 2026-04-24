# Functional Test Matrix

- Run: commercial-2026-04-21-195643-dnnpkaefmlha-v0-2-0-7836c9
- Archetype: single_profile_form_fill
- Coverage score: 100
- Next focus: Add label-variant coverage for alternate field descriptors such as mobile, organization, and region.; Add a multi-step form regression once the single-step smoke suite is stable.; Add manual tester verification on a real CRM page before another publish cycle.

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
- free usage counter: passed (Verify the free usage counter decreases on each core action.)
- free limit paywall: passed (Exhaust the free fills and verify the paywall appears with the upgrade CTA.)
- license activation and restore: passed (Verify activate, verify, restore, and invalid-license states in the license UI.)
- offline grace and trust boundary: passed (Verify offline grace expires and the extension falls back to free until reverified.)