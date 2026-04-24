# Demand Discovery Improvement Plan

- Run: 2026-04-19-145118-daily-4df0e2
- Selected candidate: cand-form-001
- Next step: improve_discovery_inputs_before_greenlighting_more_same-family_runs

## Better Sources

- Real Chrome Web Store reviews sampled from multiple recency windows.
- Support ticket archives or help-center pages with reproducible complaint text.
- GitHub issues only when the project is active and user-facing.
- Reddit or practitioner forums for non-store corroboration.

## Category Strategy

- Keep Workflow & Planning and Productivity as core families, but rate-limit single_profile_form_fill follow-ons.
- Prefer under-covered wedges where portfolio overlap is below 25.

## Keyword Strategy

- Anchor queries on the user job first: one profile, visible fields, local-only, recruiter intake, lead form.
- Add failure words: skips phone, misses company, hidden fields, too many templates, overkill.

## Minimum Thresholds

- At least 5 evidence items for the selected wedge.
- At least 3 distinct source types, with at least 1 non-store source.
- At least 3 pain clusters with 2+ evidence items in the top 2 clusters.
- At least 1 live-source pass before a similar family enters build again.

## Negative Review Mining Strategy

- Mine 1-star to 3-star reviews for repeated verbs like skip, break, overkill, sync, dashboard.
- Separate missing-feature complaints from trust, privacy, and field-coverage failures.

## Support Site Strategy

- Prioritize support tickets and FAQs where users describe the exact form or field failure.
- Capture quoted complaint text with dates and URLs, not just paraphrases.

## GitHub Issue Strategy

- Use GitHub issues only for active projects with recent user reproduction steps.
- Down-rank stale issues older than 180 days unless the bug remains clearly open.

## Reddit Or Forum Strategy

- Look for practitioner communities where users discuss repetitive intake or CRM-entry work.
- Treat forum anecdotes as corroboration, not as the primary decision source.

## Recency Strategy

- Bias toward complaints from the last 90 days.
- If evidence is older than 180 days, require a newer corroborating source before build.

## Anti-Copycat Policy

- Do not green-light a wedge when the differentiation is only minor UI simplification.
- Require a narrower job story or tighter permission posture than the portfolio already has.

## Portfolio Differentiation Strategy

- Before another single_profile_form_fill build, prove a sharper use case such as recruiter intake forms only or strict no-overwrite behavior.
- Track known bad patterns so rejected or low-utility wedges are not reintroduced as cosmetic variants.

## Next 10 Search Queries

- site:chromewebstore.google.com "lead form" "one profile" extension review
- site:reddit.com sales form filler chrome extension too many templates
- site:reddit.com recruiter form autofill chrome extension local profile
- site:github.com chrome extension form fill issue phone company fields
- site:*.help* form filler extension sync privacy concern
- site:*.support* lead form extension hidden fields issue
- chrome extension visible fields only autofill review
- chrome extension local profile form fill no account
- lead capture form filler extension company phone skipped
- recruiter intake form autofill chrome extension review