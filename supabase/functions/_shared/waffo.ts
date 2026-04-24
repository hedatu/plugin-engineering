import { getOptionalEnv, normalizeWaffoMode, type WaffoMode } from './env.ts'

function getPathValue(record: unknown, path: string) {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') {
      return undefined
    }

    return (current as Record<string, unknown>)[key]
  }, record)
}

function readFirstString(record: unknown, paths: string[]) {
  for (const path of paths) {
    const value = getPathValue(record, path)
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }

  return null
}

function readFirstNumber(record: unknown, paths: string[]) {
  for (const path of paths) {
    const value = getPathValue(record, path)
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) {
        return parsed
      }
    }
  }

  return null
}

function readFirstObject(record: unknown, paths: string[]) {
  for (const path of paths) {
    const value = getPathValue(record, path)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
  }

  return null
}

function readFirstValue(record: unknown, paths: string[]) {
  for (const path of paths) {
    const value = getPathValue(record, path)
    if (value !== undefined && value !== null) {
      return value
    }
  }

  return null
}

function normalizeIsoish(value: string | null) {
  if (!value) {
    return null
  }

  if (value.includes('T')) {
    return value
  }

  return `${value}T23:59:59.999Z`
}

function getRootData(payload: Record<string, unknown>) {
  return readFirstObject(payload, ['data', 'object']) ?? {}
}

export function getConfiguredCheckoutUrl(kind: 'success' | 'cancel') {
  const key = kind === 'success' ? 'WAFFO_CHECKOUT_SUCCESS_URL' : 'WAFFO_CHECKOUT_CANCEL_URL'
  return getOptionalEnv(key)
}

export function getWebhookEventType(payload: Record<string, unknown>) {
  return readFirstString(payload, ['eventType', 'type', 'event_type']) ?? 'unknown'
}

export function getWebhookEventId(payload: Record<string, unknown>) {
  return readFirstString(payload, ['eventId', 'id', 'event_id']) ?? crypto.randomUUID()
}

export function getWebhookMode(payload: Record<string, unknown>): WaffoMode {
  return normalizeWaffoMode(readFirstString(payload, ['mode']))
}

export function getWebhookData(payload: Record<string, unknown>) {
  return getRootData(payload)
}

export function getWebhookOrder(payload: Record<string, unknown>) {
  const data = getRootData(payload)
  return readFirstObject(data, ['order'])
    ?? readFirstObject(payload, ['order'])
    ?? data
}

export function getWebhookPayment(payload: Record<string, unknown>) {
  const data = getRootData(payload)
  return readFirstObject(data, ['payment'])
    ?? readFirstObject(payload, ['payment'])
    ?? {}
}

export function getWebhookMetadata(payload: Record<string, unknown>) {
  const order = getWebhookOrder(payload)
  const data = getRootData(payload)
  return readFirstObject(order, ['metadata', 'orderMetadata'])
    ?? readFirstObject(data, ['metadata', 'orderMetadata'])
    ?? readFirstObject(payload, ['metadata', 'orderMetadata'])
    ?? {}
}

export function getWebhookOrderId(payload: Record<string, unknown>) {
  const order = getWebhookOrder(payload)
  return readFirstString(order, ['orderId', 'id', 'order_id'])
    ?? readFirstString(getRootData(payload), ['orderId', 'order_id', 'order.id', 'subscription.orderId', 'subscription.order.id'])
}

export function getWebhookPaymentId(payload: Record<string, unknown>) {
  const payment = getWebhookPayment(payload)
  return readFirstString(payment, ['paymentId', 'id', 'payment_id'])
    ?? readFirstString(getRootData(payload), ['paymentId', 'payment_id', 'payment.id'])
}

export function getWebhookAmount(payload: Record<string, unknown>) {
  return readFirstNumber(getWebhookPayment(payload), ['amount'])
    ?? readFirstNumber(getWebhookOrder(payload), ['amount'])
    ?? readFirstNumber(getRootData(payload), ['amount'])
}

export function getWebhookCurrency(payload: Record<string, unknown>) {
  return readFirstString(getWebhookPayment(payload), ['currency'])
    ?? readFirstString(getWebhookOrder(payload), ['currency'])
    ?? readFirstString(getRootData(payload), ['currency'])
    ?? 'USD'
}

export function getWebhookStatus(payload: Record<string, unknown>) {
  return readFirstString(getWebhookPayment(payload), ['status', 'paymentStatus'])
    ?? readFirstString(getWebhookOrder(payload), ['orderStatus', 'status'])
    ?? readFirstString(getRootData(payload), ['orderStatus', 'status', 'paymentStatus', 'subscription.status'])
    ?? 'unknown'
}

export function getWebhookBuyerEmail(payload: Record<string, unknown>) {
  return readFirstString(getWebhookOrder(payload), ['buyerEmail', 'buyer.email', 'email'])
    ?? readFirstString(getRootData(payload), ['buyerEmail', 'buyer.email', 'email'])
}

export function getWebhookBuyerIdentity(payload: Record<string, unknown>) {
  const direct = readFirstValue(getWebhookOrder(payload), ['buyerIdentity', 'buyer.identity'])
    ?? readFirstValue(getRootData(payload), ['buyerIdentity', 'buyer.identity'])

  if (typeof direct === 'string' && direct.trim().length > 0) {
    return direct.trim()
  }

  if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
    return direct as Record<string, unknown>
  }

  return null
}

export function getWebhookBuyerIdentityString(payload: Record<string, unknown>) {
  const identity = getWebhookBuyerIdentity(payload)
  if (typeof identity === 'string') {
    return identity
  }

  if (identity && typeof identity === 'object') {
    return readFirstString(identity, ['id', 'value', 'userId', 'user_id'])
  }

  return null
}

export function getWebhookMerchantProvidedBuyerIdentity(payload: Record<string, unknown>) {
  return readFirstString(getWebhookOrder(payload), ['merchantProvidedBuyerIdentity', 'buyer.merchantProvidedBuyerIdentity'])
    ?? readFirstString(getRootData(payload), ['merchantProvidedBuyerIdentity', 'buyer.merchantProvidedBuyerIdentity'])
    ?? readFirstString(getWebhookMetadata(payload), ['merchantProvidedBuyerIdentity'])
}

export function getWebhookBillingPeriod(payload: Record<string, unknown>) {
  return readFirstString(getRootData(payload), ['billingPeriod', 'subscription.billingPeriod', 'period'])
}

export function getWebhookCurrentPeriodStart(payload: Record<string, unknown>) {
  const value = readFirstString(getRootData(payload), ['currentPeriodStart', 'current_period_start', 'subscription.currentPeriodStart'])
  return normalizeIsoish(value)
}

export function getWebhookCurrentPeriodEnd(payload: Record<string, unknown>) {
  const value = readFirstString(getRootData(payload), ['currentPeriodEnd', 'current_period_end', 'subscription.currentPeriodEnd'])
  return normalizeIsoish(value)
}

export function getWebhookCanceledAt(payload: Record<string, unknown>) {
  return normalizeIsoish(readFirstString(getRootData(payload), ['canceledAt', 'canceled_at', 'subscription.canceledAt']))
}

export function getWebhookProductName(payload: Record<string, unknown>) {
  return readFirstString(getWebhookOrder(payload), ['productName', 'product.name', 'name'])
    ?? readFirstString(getRootData(payload), ['productName', 'product_name', 'product.name'])
}

export function getWebhookProductId(payload: Record<string, unknown>) {
  return readFirstString(getWebhookOrder(payload), [
    'productId',
    'product.id',
    'product.productId',
    'onetimeProduct.id',
    'subscriptionProduct.id',
    'productVersion.productId',
  ]) ?? readFirstString(getRootData(payload), [
    'productId',
    'product.id',
    'product.productId',
    'onetimeProduct.id',
    'subscriptionProduct.id',
    'productVersion.productId',
  ])
}

export function getWebhookTaxAmount(payload: Record<string, unknown>) {
  return readFirstNumber(getWebhookOrder(payload), ['taxAmount', 'tax_amount'])
    ?? readFirstNumber(getRootData(payload), ['taxAmount', 'tax_amount'])
}

export function getWebhookSubtotal(payload: Record<string, unknown>) {
  return readFirstNumber(getWebhookOrder(payload), ['subtotal', 'sub_total'])
    ?? readFirstNumber(getRootData(payload), ['subtotal', 'sub_total'])
}

export function getWebhookTotal(payload: Record<string, unknown>) {
  return readFirstNumber(getWebhookOrder(payload), ['total'])
    ?? readFirstNumber(getRootData(payload), ['total'])
}

export function getWebhookPaymentMethod(payload: Record<string, unknown>) {
  return readFirstString(getWebhookPayment(payload), ['paymentMethod', 'method'])
    ?? readFirstString(getRootData(payload), ['paymentMethod', 'payment.method'])
}

export function getWebhookPaymentLast4(payload: Record<string, unknown>) {
  return readFirstString(getWebhookPayment(payload), ['paymentLast4', 'last4'])
    ?? readFirstString(getRootData(payload), ['paymentLast4', 'payment.last4'])
}

export function getWebhookPaymentDate(payload: Record<string, unknown>) {
  return readFirstString(getWebhookPayment(payload), ['paymentDate', 'paidAt', 'createdAt'])
    ?? readFirstString(getRootData(payload), ['paymentDate', 'payment_date', 'payment.paidAt'])
}

export function getWebhookPlanId(payload: Record<string, unknown>) {
  return readFirstString(getWebhookOrder(payload), ['planId', 'plan.id'])
    ?? readFirstString(getRootData(payload), ['planId', 'plan.id'])
}

export function getWebhookPriceId(payload: Record<string, unknown>) {
  return readFirstString(getWebhookOrder(payload), ['priceId', 'price.id'])
    ?? readFirstString(getRootData(payload), ['priceId', 'price.id'])
}

export function isSubscriptionEvent(eventType: string) {
  return eventType.startsWith('subscription.')
}

export { getConfiguredWaffoMode } from './env.ts'
