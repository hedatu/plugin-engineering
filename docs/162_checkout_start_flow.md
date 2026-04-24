# 162 Checkout Start Flow

## Route

- `/checkout/start`

## Accepted Query Parameters

- `productKey`
- `planKey`
- `source`
- `installationId`
- `extensionId`

## Flow

1. Read the route query parameters.
2. Resolve the product from the active product catalog.
3. If the user is not logged in, redirect to OTP login with `next=/checkout/start?...`.
4. After login, call `create-checkout-session`.
5. Include:
   - `productKey`
   - `planKey`
   - `source`
   - `installationId`
   - `extensionId`
   - `successUrl`
   - `cancelUrl`
6. Receive hosted `checkoutUrl`.
7. Redirect the browser to the hosted checkout page.

## Rules

- do not embed a fixed bare Waffo URL in the site or extension
- do not activate membership on the success page
- treat test mode as explicit UI state when active
- keep webhook as the only paid activation source of truth
