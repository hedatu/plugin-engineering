# 001 Current Mainline

## Current Project Reality

The current repository is not being advanced as a generalized plugin factory platform.

The only active mainline is:

- LeadFill One Profile single-product commercial launch

## What Counts As Active Work

Only the following work is in the mainline:

- LeadFill product website
- LeadFill pricing and account pages
- LeadFill extension login, entitlement, usage, and upgrade flow
- HWH / Waffo external checkout
- Supabase entitlement and webhook path
- commercial resubmission readiness
- human visual review readiness

## What Is Explicitly Paused

- discovery
- second plugin
- new builder families
- Google login
- automatic Chrome publish
- factory/platform expansion

## How To Treat `plugin-engineering-factory`

`plugin-engineering-factory/` is retained as:

- archived evidence
- historical workflow code
- packaging and release reference
- future factory layer

It is not the current product mainline.

## Mainline Safety Rules

- external checkout plus webhook-driven entitlement stays in place
- webhook remains the only source of truth for paid activation
- success page must not unlock Pro locally
- extension must not hold `SUPABASE_SERVICE_ROLE_KEY`
- extension must not hold `WAFFO_PRIVATE_KEY`
- extension must not hold merchant secrets
- email OTP remains the auth path

## Current Website Model

The website should behave as a plugin product center:

- `/products`
- `/products/:slug`
- `/products/:slug/pricing`
- `/checkout/start`
- `/account?productKey=<productKey>`

Each plugin gets:

- one product details page
- one pricing page
- one account context keyed by product

Right now the only active product is LeadFill.
