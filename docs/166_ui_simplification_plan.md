# 166 UI Simplification Plan

## Goal

Keep the public-facing site aligned to a single-product commercial launch for LeadFill One Profile.

## Round 3 design direction

Round 3 moves the site from "clean but still system-like" to "quiet product website":

- the brand shown to users is `LeadFill`, not the infrastructure domain
- the home page reads as the product landing page, not a membership hub
- pricing explains one offer clearly instead of exposing internal system framing
- account, success, and cancel pages behave like product support surfaces instead of debug panels
- legal pages stay formal and document-like

## Simplifications Applied

- home behaves as the LeadFill landing page
- `/products` behaves as a lightweight product catalog, even with one active product
- product detail and pricing remain product-scoped
- account remains product-scoped
- checkout still starts from one normalized route
- extension Upgrade opens product pricing instead of triggering direct checkout
- header uses a minimal LeadFill mark and tighter navigation
- footer keeps legal and host information low priority

## Visual system

- background: warm off-white with very light depth
- surfaces: white or near-white cards only where separation is useful
- emphasis: one restrained green accent
- typography: one modern sans-serif family with stronger heading scale
- spacing: larger vertical gaps to create clearer hierarchy
- controls: pill buttons, softer borders, fewer visual treatments
- badges: reduced count and lower contrast

## Simplifications Still Enforced

- no factory/discovery UX in the main website
- no second product UI in the active mainline
- no Google login surface
- no production-payment implication beyond the current mode
- no payment status claims stronger than webhook-confirmed truth
- no success-page local unlock behavior

## User-facing consequence

The user sees:

- what LeadFill is
- what is free and what is paid
- why local-only matters
- where to install
- where to buy
- where to manage membership

without being exposed to infrastructure-first language or factory-history complexity.
