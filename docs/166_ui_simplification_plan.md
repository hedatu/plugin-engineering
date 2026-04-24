# 166 UI Simplification Plan

## Goal

Keep the repo aligned to a single-product commercial launch.

## Simplifications Applied

- home behaves as the LeadFill product landing page
- pricing is product-scoped
- account is product-scoped
- checkout starts from one normalized route
- extension Upgrade opens product pricing instead of triggering direct checkout

## Simplifications Still Enforced

- no factory/discovery UX in the main website
- no second product UI in the active mainline
- no Google login surface
- no payment status claims stronger than webhook-confirmed truth

## Visual/Product Consequence

The user sees:

- what the product is
- free vs lifetime
- local-only positioning
- where to upgrade
- where to manage account

without being exposed to factory-history complexity.
