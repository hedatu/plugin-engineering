# Functional Test Matrix

- Run: sandbox-2026-04-19-154400-dnnpkaefmlha-v0-1-1-6218cc
- Archetype: single_profile_form_fill
- Coverage score: 43.33
- Next focus: Add a negative browser smoke fixture with no matching fields and explicit error assertions.; Add a mixed fixture covering readonly inputs, select controls, and partially filled fields.; Decide overwrite semantics and add an automated regression for them.

## Missing Tests

- empty form
- partially filled form
- readonly field
- select
- no matching fields
- profile save / edit / delete
- field overwrite behavior

## Release Blockers

- select field support or truthful scope reduction
- readonly/locked field handling
- no matching fields feedback
- field overwrite behavior
- profile delete or reset path

## Test Cases

- empty form: missing (Add a smoke variant that attempts fill with an empty profile and checks the status message.)
- partially filled form: missing (Add a form fixture where some values already exist and assert non-destructive behavior.)
- readonly field: missing (Add readonly inputs to the browser smoke fixture and assert they are skipped safely.)
- textarea: partial (Add textarea coverage to the happy-path smoke fixture.)
- select: unsupported (Implement select matching or narrow the listing promise before tester rollout.)
- email field: passed (Keep the current browser smoke assertion.)
- phone field: passed (Keep the current browser smoke assertion and add alternate label variants.)
- name field: passed (Keep the current browser smoke assertion.)
- no matching fields: missing (Add a negative fixture with no matching descriptors and assert a clear zero-fill status.)
- activeTab permission path: passed (Retain the current smoke coverage.)
- local storage only: passed (Keep a static test that forbids network calls in popup code.)
- popup error display: partial (Automate a blocked-tab or missing-tab case and assert the visible error string.)
- profile save / edit / delete: missing (Add explicit edit/delete/reset UX or narrow the supported workflow in copy.)
- field overwrite behavior: missing (Add overwrite rules and a fixture that asserts whether existing values are preserved.)
- visual feedback after fill: partial (Capture a post-fill popup screenshot or toast state that confirms fill count.)