# 164 HWH Waffo Product Mapping Contract

## Product Mapping

LeadFill checkout must resolve from product catalog data plus backend plan mapping.

## Required Inputs

- `productKey=leadfill-one-profile`
- `planKey=lifetime`

## Backend Resolution

The backend `create-checkout-session` function must:

1. require authenticated user JWT
2. look up the plan by `productKey + planKey`
3. resolve the correct Waffo product id and product type for the active mode
4. create local checkout session state first
5. call the hosted Waffo checkout API
6. return only:
   - `checkoutUrl`
   - `sessionId`
   - `localOrderId`

## Metadata Requirements

Metadata should preserve:

- `userId`
- `productKey`
- `planKey`
- `localOrderId`
- `source`
- `installationId`
- `extensionId`
- `localCheckoutSessionId`
- `environment`

## Activation Rule

- entitlement active must come from webhook verification and server-side write
- success page polling is informational only
