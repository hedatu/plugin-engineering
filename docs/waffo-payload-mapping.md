# Waffo Payload Mapping

## Source Of Truth

Webhook verification now uses the official SDK:

- `@waffo/pancake-ts`
- `verifyWebhook(...)`

Target dashboard webhook URL for this project:

- `https://hwh-api.915500.xyz/functions/v1/waffo-webhook`

Current deployment note:

- This URL is the intended long-term endpoint for the plugin membership system.
- It is separate from `weiwang.915500.xyz`.
- Real external delivery target is now `https://hwh-api.915500.xyz/functions/v1/waffo-webhook`.

The SDK returns:

- `event.id` -> delivery record UUID, recommended for idempotent dedupe
- `event.eventId` -> business event ID
- `event.eventType` -> event type string
- `event.mode` -> `test` or `prod`
- `event.data` -> normalized webhook data

## Dedupe Strategy

Official SDK guidance says to deduplicate with `event.id`.

Current project behavior:

- `processed_webhooks.event_type` stores `event.eventType`
- `processed_webhooks.event_id` stores SDK delivery record ID `event.id`
- `processed_webhooks.entity_id` stores `orderId` when available, otherwise business `event.eventId`

The effective unique key remains:

```text
mode + event_type + event_id
```

But `event_id` now represents the SDK delivery record ID, not the business event ID.

## Verified Field Usage In Code

### Event envelope

| SDK field | Local use | Status |
| --- | --- | --- |
| `event.id` | webhook dedupe key | verified from SDK docs |
| `event.eventId` | business event reference for logs and fallback linking | verified from SDK docs |
| `event.eventType` | routing into payment / subscription / refund handlers | verified from SDK docs |
| `event.mode` | choose test / prod verification path | verified from SDK docs |

### `event.data` fields used by the project

| SDK field | Local use | Target |
| --- | --- | --- |
| `orderId` | Waffo order identity | `orders.waffo_order_id` |
| `buyerEmail` | buyer email | `orders.buyer_email` |
| `merchantProvidedBuyerIdentity` | user binding fallback | `orders.merchant_provided_buyer_identity` |
| `orderMetadata` | billing context resolution | `orders.order_metadata`, entitlement linking |
| `currency` | money currency | `orders.currency`, `payments.currency` |
| `amount` | gross amount | `orders.amount`, `payments.amount` |
| `taxAmount` | tax amount | `orders.tax_amount` |
| `subtotal` | subtotal | `orders.subtotal` |
| `total` | total | `orders.total` |
| `productName` | product display name | `orders.product_name` |
| `paymentId` | payment identity | `payments.waffo_payment_id` |
| `paymentStatus` | payment status | `payments.payment_status` |
| `paymentMethod` | payment method | `payments.payment_method` |
| `paymentLast4` | last four digits | `payments.payment_last4` |
| `paymentDate` | payment date | `payments.payment_date` |
| `billingPeriod` | subscription period | `subscriptions.billing_period` |
| `currentPeriodStart` | subscription period start | `subscriptions.current_period_start` |
| `currentPeriodEnd` | subscription period end | `subscriptions.current_period_end`, `entitlements.expires_at` |
| `canceledAt` | cancellation timestamp | `subscriptions.canceled_at` |

## Metadata Written At Checkout

`create-checkout-session` currently writes these metadata fields before sending the request to Waffo:

| Field | Purpose |
| --- | --- |
| `userId` | Supabase user ID |
| `productKey` | local product key |
| `planKey` | local plan key |
| `localOrderId` | local order correlation key |
| `source` | `web` or `chrome_extension` |
| `localCheckoutSessionId` | lookup back into `checkout_sessions` |
| `installationId` | optional extension installation ID |
| `environment` | `test` or `prod` |

## Context Resolution Order

When a webhook arrives, the project resolves the local billing context in this order:

1. `orderMetadata.localCheckoutSessionId`
2. `orderMetadata.localOrderId`
3. `orderMetadata.productKey + orderMetadata.planKey`
4. local `orders` lookup by Waffo order ID
5. plan mapping by `waffo_plan_id_*`
6. plan mapping by `waffo_price_id_*`
7. user binding from:
   - `orderMetadata.userId`
   - `merchantProvidedBuyerIdentity`
   - checkout session row
   - existing order row

## Event Handling

### Paid / activation events

- `order.completed`
- `subscription.activated`
- `subscription.payment_succeeded`

Current write behavior:

- upsert `orders`
- upsert `payments`
- upsert `subscriptions` for subscription events
- upsert `entitlements`

### Status change events

- `subscription.canceling`
- `subscription.uncanceled`
- `subscription.updated`
- `subscription.past_due`
- `subscription.canceled`
- `refund.succeeded`
- `refund.failed`

## Remaining Unverified Areas

- Real payload presence of `planId` and `priceId`
- Real payload presence of `paymentLast4`
- Real payload presence of `paymentMethod`
- Real refund payload structure
- Real subscription event payload structure
- Whether Waffo sends any extra cancel redirect information when using SDK checkout


