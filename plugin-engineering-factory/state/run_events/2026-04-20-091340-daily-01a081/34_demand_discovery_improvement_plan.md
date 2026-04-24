# Demand Discovery Improvement Plan

- Run: 2026-04-20-091340-daily-01a081
- Selected candidate: cand-tab-001
- Next step: improve_discovery_inputs_before_next_build_attempt

## Better Sources

- Chrome Web Store review samples across recent time windows.
- Support sites or help centers with reproducible complaint text.
- GitHub issues only when the project is active and user-facing.
- Reddit or forum corroboration for practitioner workflow pain.

## Category Strategy

- Bias toward low-permission, local-only productivity wedges.
- Do not build same-family variants unless differentiation is explicit and testable.
- Allow no-go days when evidence stays weak.

## Keyword Strategy

- Start from the user job, then add failure words such as skip, miss, overwrite, noisy, manual.
- Prefer keywords that imply a narrow, testable happy path over broad category terms.

## Minimum Thresholds

- evidence_quality_score >= 60 before build
- testability_score >= 60 before build
- At least one non-store source before repeated same-family builds
- At least three meaningful pain clusters before build

## Negative Review Mining Strategy

- Mine 1-star to 3-star reviews for repeated verbs such as skip, overwrite, fail, noisy, manual.
- Separate workflow friction from field coverage and privacy complaints.

## Support Site Strategy

- Prefer support pages with exact field or workflow failures.
- Capture dated excerpts and URLs instead of paraphrasing.

## GitHub Issue Strategy

- Use GitHub issues as corroboration when they include reproducible steps.
- Down-rank stale trackers older than 180 days.

## Reddit Or Forum Strategy

- Treat Reddit/forum evidence as corroboration, not the primary decision source.
- Look for operator and recruiter communities where repetitive browser tasks are discussed.

## Recency Strategy

- Bias toward evidence from the last 90 days.
- Require newer corroboration when all evidence is older than 180 days.

## Anti-Copycat Policy

- Do not build just because a category is large.
- Require a narrower user story or a lower-permission posture than existing tools.

## Portfolio Differentiation Strategy

- Treat portfolio overlap as a real penalty, not just a warning.
- When overlap is high, research more or skip instead of forcing a build.

## Next 10 Search Queries

- site:chromewebstore.google.com form filler one profile visible fields review | form automation | single_profile_form_fill | exclude if: Evidence stays store-only or pain remains vague.
- site:reddit.com recruiter intake form autofill local-only chrome extension | form automation | single_profile_form_fill | exclude if: Support site and forum evidence disagree on the core flow.
- site:chromewebstore.google.com current window tab export csv pinned tabs review | tab/workflow export | tab_csv_window_export | exclude if: User pain is mostly about advanced enterprise features.
- site:github.com browser tab export extension issue current window csv | tab/workflow export | tab_csv_window_export | exclude if: Issue tracker is stale beyond 180 days.
- site:chromewebstore.google.com gmail snippet quick insert compose review | email snippet / template | gmail_snippet | exclude if: Required permissions imply mailbox-wide access.
- site:reddit.com canned reply chrome extension keyboard shortcut pain | email snippet / template | gmail_snippet | exclude if: Pain cannot be converted into a deterministic happy path.
- site:chromewebstore.google.com small saas browser extension copy paste workflow review | small SaaS productivity gaps | single_profile_form_fill | exclude if: The wedge implies multi-page automation or background sync.
- site:github.com browser extension one-click data cleanup issue | data cleanup / copy-paste automation | tab_csv_window_export | exclude if: The solution requires complex parsing across arbitrary sites.
- site:chromewebstore.google.com browser workflow friction local-only productivity review | browser workflow friction | tab_csv_window_export | exclude if: The user need depends on cloud sync or collaboration.
- site:chromewebstore.google.com developer utility chrome extension local-only review | developer or operator utilities | tab_csv_window_export | exclude if: The happy path cannot be validated in controlled fixtures.