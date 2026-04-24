import { corsHeaders, textResponse } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabase.ts'
import {
  getWebhookAmount,
  getWebhookBillingPeriod,
  getWebhookBuyerEmail,
  getWebhookBuyerIdentity,
  getWebhookCanceledAt,
  getWebhookCurrency,
  getWebhookCurrentPeriodEnd,
  getWebhookCurrentPeriodStart,
  getWebhookData,
  getWebhookEventId,
  getWebhookEventType,
  getWebhookMerchantProvidedBuyerIdentity,
  getWebhookMetadata,
  getWebhookMode,
  getWebhookOrderId,
  getWebhookPlanId,
  getWebhookPaymentDate,
  getWebhookPaymentId,
  getWebhookPaymentLast4,
  getWebhookPaymentMethod,
  getWebhookProductName,
  getWebhookPriceId,
  getWebhookStatus,
  getWebhookSubtotal,
  getWebhookTaxAmount,
  getWebhookTotal,
  isSubscriptionEvent,
} from '../_shared/waffo.ts'
import { verifyWaffoWebhookEvent } from '../_shared/waffo_sdk.ts'

type BillingContext = {
  userId: string
  productId: string
  planId: string
  checkoutSessionId: string | null
  localOrderId: string | null
  sourceType: 'purchase' | 'subscription'
}

async function upsertWebhookLog(
  admin: ReturnType<typeof createAdminClient>,
  table: 'processed_webhooks' | 'webhook_events',
  payload: {
    mode: 'test' | 'prod'
    eventType: string
    eventId: string
    entityId: string | null
    signatureValid: boolean
    rawPayload: Record<string, unknown>
    rawBody: string
    processingError: string | null
  },
) {
  return admin
    .from(table)
    .upsert({
      mode: payload.mode,
      event_type: payload.eventType,
      event_id: payload.eventId,
      entity_id: payload.entityId,
      signature_valid: payload.signatureValid,
      raw_payload: payload.rawPayload,
      raw_body: payload.rawBody,
      processing_error: payload.processingError,
    }, { onConflict: 'mode,event_type,event_id' })
    .select('*')
    .single()
}

function warnInvalidWebhook(params: {
  reason: string
  mode: 'test' | 'prod'
  eventType: string
  eventId: string
}) {
  console.warn('waffo_webhook_rejected', params)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return textResponse(req, 'METHOD_NOT_ALLOWED', 405)

  const rawBody = await req.text()
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return textResponse(req, 'INVALID_JSON', 400)
  }

  const mode = getWebhookMode(parsed)
  const signature = req.headers.get('x-waffo-signature')
  const parsedEventId = getWebhookEventId(parsed)
  const parsedEventType = getWebhookEventType(parsed)

  if (!signature || !signature.trim()) {
    warnInvalidWebhook({
      reason: 'MISSING_SIGNATURE',
      mode,
      eventType: parsedEventType,
      eventId: parsedEventId,
    })
    return textResponse(req, 'INVALID_SIGNATURE', 401)
  }

  let verifiedEvent: {
    eventId: string
    eventType: string
    mode: 'test' | 'prod'
  }

  try {
    const event = verifyWaffoWebhookEvent({
      rawBody,
      signatureHeader: signature,
      mode,
    })

    const eventId = event.eventId || parsedEventId
    const eventType = event.eventType || parsedEventType
    if (!eventId || !eventType) {
      console.warn('waffo_webhook_invalid_event', { mode, parsed })
      return textResponse(req, 'INVALID_WEBHOOK_EVENT', 400)
    }

    verifiedEvent = {
      eventId,
      eventType,
      mode: event.mode === 'prod' ? 'prod' : 'test',
    }
  } catch (error) {
    warnInvalidWebhook({
      reason: error instanceof Error ? error.message : 'INVALID_SIGNATURE',
      mode,
      eventType: parsedEventType,
      eventId: parsedEventId,
    })
    return textResponse(req, 'INVALID_SIGNATURE', 401)
  }

  const admin = createAdminClient()

  const logPayload = {
    mode: verifiedEvent.mode,
    eventType: verifiedEvent.eventType,
    eventId: verifiedEvent.eventId,
    entityId: getWebhookOrderId(parsed) ?? verifiedEvent.eventId,
    signatureValid: true,
    rawPayload: parsed,
    rawBody,
    processingError: null,
  }

  const { data: eventRow, error: eventError } = await upsertWebhookLog(admin, 'processed_webhooks', logPayload)
  const { error: webhookEventError } = await upsertWebhookLog(admin, 'webhook_events', logPayload)

  if (eventError || !eventRow || webhookEventError) {
    return textResponse(req, 'WEBHOOK_EVENT_STORE_FAILED', 500)
  }
  if (eventRow.processed_at) return textResponse(req, 'DUPLICATE_ALREADY_PROCESSED', 200)

  try {
    await processEvent(admin, verifiedEvent.mode, verifiedEvent.eventType, parsed)
    await admin
      .from('processed_webhooks')
      .update({
        processed_at: new Date().toISOString(),
        processing_error: null,
      })
      .eq('id', eventRow.id)

    await admin
      .from('webhook_events')
      .update({
        processed_at: new Date().toISOString(),
        processing_error: null,
      })
      .eq('mode', verifiedEvent.mode)
      .eq('event_type', verifiedEvent.eventType)
      .eq('event_id', verifiedEvent.eventId)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    await admin
      .from('processed_webhooks')
      .update({ processing_error: detail })
      .eq('id', eventRow.id)

    await admin
      .from('webhook_events')
      .update({ processing_error: detail })
      .eq('mode', verifiedEvent.mode)
      .eq('event_type', verifiedEvent.eventType)
      .eq('event_id', verifiedEvent.eventId)

    return textResponse(req, 'RECORDED_PROCESSING_ERROR', 200)
  }

  return textResponse(req, 'OK', 200)
})

async function processEvent(
  admin: ReturnType<typeof createAdminClient>,
  mode: 'test' | 'prod',
  eventType: string,
  payload: Record<string, unknown>,
) {
  const context = await resolveBillingContext(admin, mode, eventType, payload)
  const orderId = getWebhookOrderId(payload)

  if (eventType === 'order.completed' || eventType === 'subscription.activated' || eventType === 'subscription.payment_succeeded') {
    await upsertSuccessfulBilling(admin, mode, eventType, payload, context, orderId)
    return
  }

  if (!context) {
    return
  }

  if (eventType === 'subscription.canceling') {
    await admin.from('subscriptions').update({
      status: 'canceling',
      canceled_at: getWebhookCanceledAt(payload) ?? new Date().toISOString(),
      raw_payload: payload,
    }).eq('mode', mode).eq('waffo_order_id', orderId).throwOnError()

    await admin.from('entitlements').update({ status: 'canceling' })
      .eq('user_id', context.userId)
      .eq('product_id', context.productId)
      .eq('source_type', 'subscription')
      .throwOnError()
    return
  }

  if (eventType === 'subscription.uncanceled') {
    await admin.from('subscriptions').update({
      status: 'active',
      canceled_at: null,
      raw_payload: payload,
    }).eq('mode', mode).eq('waffo_order_id', orderId).throwOnError()

    await admin.from('entitlements').update({ status: 'active' })
      .eq('user_id', context.userId)
      .eq('product_id', context.productId)
      .eq('source_type', 'subscription')
      .throwOnError()
    return
  }

  if (eventType === 'subscription.updated') {
    await admin.from('subscriptions').update({
      plan_id: context.planId,
      current_period_start: getWebhookCurrentPeriodStart(payload),
      current_period_end: getWebhookCurrentPeriodEnd(payload),
      raw_payload: payload,
    }).eq('mode', mode).eq('waffo_order_id', orderId).throwOnError()

    await admin.from('entitlements').update({
      plan_id: context.planId,
      status: 'active',
      expires_at: getWebhookCurrentPeriodEnd(payload),
    }).eq('user_id', context.userId)
      .eq('product_id', context.productId)
      .eq('source_type', 'subscription')
      .throwOnError()
    return
  }

  if (eventType === 'subscription.past_due') {
    await admin.from('subscriptions').update({
      status: 'past_due',
      raw_payload: payload,
    }).eq('mode', mode).eq('waffo_order_id', orderId).throwOnError()

    await admin.from('entitlements').update({ status: 'past_due' })
      .eq('user_id', context.userId)
      .eq('product_id', context.productId)
      .eq('source_type', 'subscription')
      .throwOnError()
    return
  }

  if (eventType === 'subscription.canceled') {
    await admin.from('subscriptions').update({
      status: 'canceled',
      canceled_at: getWebhookCanceledAt(payload) ?? new Date().toISOString(),
      raw_payload: payload,
    }).eq('mode', mode).eq('waffo_order_id', orderId).throwOnError()

    await admin.from('entitlements').update({
      status: 'revoked',
      expires_at: new Date().toISOString(),
    }).eq('user_id', context.userId)
      .eq('product_id', context.productId)
      .eq('source_type', 'subscription')
      .throwOnError()
    return
  }

  if (eventType === 'refund.succeeded') {
    await admin.from('orders').update({
      order_status: 'refunded',
      raw_payload: payload,
    }).eq('mode', mode).eq('waffo_order_id', orderId).throwOnError()

    await admin.from('entitlements').update({
      status: 'revoked',
      expires_at: new Date().toISOString(),
    }).eq('user_id', context.userId)
      .eq('product_id', context.productId)
      .eq('source_type', context.sourceType)
      .throwOnError()
    return
  }

  if (eventType === 'refund.failed') {
    await admin.from('orders').update({
      raw_payload: payload,
    }).eq('mode', mode).eq('waffo_order_id', orderId).throwOnError()
  }
}

async function resolveBillingContext(
  admin: ReturnType<typeof createAdminClient>,
  mode: 'test' | 'prod',
  eventType: string,
  payload: Record<string, unknown>,
): Promise<BillingContext | null> {
  const metadata = getWebhookMetadata(payload)
  const localCheckoutSessionId = typeof metadata.localCheckoutSessionId === 'string'
    ? metadata.localCheckoutSessionId
    : null
  const localOrderId = typeof metadata.localOrderId === 'string'
    ? metadata.localOrderId
    : null
  const productKey = typeof metadata.productKey === 'string' ? metadata.productKey : null
  const planKey = typeof metadata.planKey === 'string' ? metadata.planKey : null
  const userId = typeof metadata.userId === 'string' ? metadata.userId : null
  const merchantProvidedBuyerIdentity = getWebhookMerchantProvidedBuyerIdentity(payload)
  const waffoPlanId = getWebhookPlanId(payload)
  const waffoPriceId = getWebhookPriceId(payload)
  const orderId = getWebhookOrderId(payload)

  let checkoutSession: Record<string, unknown> | null = null
  if (localCheckoutSessionId) {
    const { data } = await admin
      .from('checkout_sessions')
      .select('id,local_order_id,user_id,product_id,plan_id')
      .eq('id', localCheckoutSessionId)
      .maybeSingle()
    checkoutSession = data
  } else if (localOrderId) {
    const { data } = await admin
      .from('checkout_sessions')
      .select('id,local_order_id,user_id,product_id,plan_id')
      .eq('local_order_id', localOrderId)
      .maybeSingle()
    checkoutSession = data
  }

  let orderRecord: Record<string, unknown> | null = null
  if (orderId) {
    const { data } = await admin
      .from('orders')
      .select('id,user_id,product_id,plan_id,checkout_session_id')
      .eq('mode', mode)
      .eq('waffo_order_id', orderId)
      .maybeSingle()
    orderRecord = data
  }

  let resolvedPlanId = typeof checkoutSession?.plan_id === 'string'
    ? checkoutSession.plan_id
    : typeof orderRecord?.plan_id === 'string'
      ? orderRecord.plan_id
      : null
  let resolvedProductId = typeof checkoutSession?.product_id === 'string'
    ? checkoutSession.product_id
    : typeof orderRecord?.product_id === 'string'
      ? orderRecord.product_id
      : null

  if ((!resolvedPlanId || !resolvedProductId) && productKey && planKey) {
    const { data: plan } = await admin
      .from('plans')
      .select('id,product_id,products!inner(product_key)')
      .eq('plan_key', planKey)
      .eq('products.product_key', productKey)
      .single()

    resolvedPlanId = plan?.id ?? resolvedPlanId
    resolvedProductId = plan?.product_id ?? resolvedProductId
  }

  if ((!resolvedPlanId || !resolvedProductId) && (waffoPlanId || waffoPriceId)) {
    if (waffoPlanId) {
      const { data: plans } = await admin
        .from('plans')
        .select('id,product_id')
        .or(`waffo_plan_id_test.eq.${waffoPlanId},waffo_plan_id_prod.eq.${waffoPlanId}`)
        .limit(1)

      const plan = plans?.[0]
      resolvedPlanId = plan?.id ?? resolvedPlanId
      resolvedProductId = plan?.product_id ?? resolvedProductId
    }

    if ((!resolvedPlanId || !resolvedProductId) && waffoPriceId) {
      const { data: plans } = await admin
        .from('plans')
        .select('id,product_id')
        .or(`waffo_price_id_test.eq.${waffoPriceId},waffo_price_id_prod.eq.${waffoPriceId}`)
        .limit(1)

      const plan = plans?.[0]
      resolvedPlanId = plan?.id ?? resolvedPlanId
      resolvedProductId = plan?.product_id ?? resolvedProductId
    }
  }

  const resolvedUserId = userId
    ?? merchantProvidedBuyerIdentity
    ?? (typeof checkoutSession?.user_id === 'string' ? checkoutSession.user_id : null)
    ?? (typeof orderRecord?.user_id === 'string' ? orderRecord.user_id : null)

  if (!resolvedUserId || !resolvedProductId || !resolvedPlanId) {
    if (eventType === 'refund.failed') {
      return null
    }
    throw new Error(`Unable to resolve billing context for ${eventType}`)
  }

  return {
    userId: resolvedUserId,
    productId: resolvedProductId,
    planId: resolvedPlanId,
    checkoutSessionId: typeof checkoutSession?.id === 'string'
      ? checkoutSession.id
      : typeof orderRecord?.checkout_session_id === 'string'
        ? orderRecord.checkout_session_id
        : null,
    localOrderId: typeof checkoutSession?.local_order_id === 'string'
      ? checkoutSession.local_order_id
      : localOrderId,
    sourceType: isSubscriptionEvent(eventType) ? 'subscription' : 'purchase',
  }
}

async function upsertSuccessfulBilling(
  admin: ReturnType<typeof createAdminClient>,
  mode: 'test' | 'prod',
  eventType: string,
  payload: Record<string, unknown>,
  context: BillingContext | null,
  orderId: string | null,
) {
  if (!context || !orderId) {
    throw new Error(`Missing billing context or order id for ${eventType}`)
  }

  const metadata = getWebhookMetadata(payload)
  const orderStatus = getWebhookStatus(payload)
  const orderType = isSubscriptionEvent(eventType) ? 'subscription' : 'one_time'
  const buyerIdentity = getWebhookBuyerIdentity(payload)
  const merchantProvidedBuyerIdentity = getWebhookMerchantProvidedBuyerIdentity(payload)
  const waffoPlanId = getWebhookPlanId(payload)
  const waffoPriceId = getWebhookPriceId(payload)

  const { data: order } = await admin
    .from('orders')
    .upsert({
      user_id: context.userId,
      product_id: context.productId,
      plan_id: context.planId,
      checkout_session_id: context.checkoutSessionId,
      mode,
      waffo_order_id: orderId,
      order_type: orderType,
      order_status: orderStatus === 'unknown' ? (orderType === 'subscription' ? 'active' : 'completed') : orderStatus,
      buyer_email: getWebhookBuyerEmail(payload),
      buyer_identity: buyerIdentity,
      merchant_provided_buyer_identity: merchantProvidedBuyerIdentity,
      currency: getWebhookCurrency(payload),
      amount: getWebhookAmount(payload),
      tax_amount: getWebhookTaxAmount(payload),
      subtotal: getWebhookSubtotal(payload),
      total: getWebhookTotal(payload),
      product_name: getWebhookProductName(payload),
      waffo_plan_id: waffoPlanId,
      waffo_price_id: waffoPriceId,
      order_metadata: metadata,
      raw_payload: payload,
    }, { onConflict: 'mode,waffo_order_id' })
    .select('*')
    .single()
    .throwOnError()

  if (context.checkoutSessionId) {
    await admin
      .from('checkout_sessions')
      .update({ status: 'completed' })
      .eq('id', context.checkoutSessionId)
      .throwOnError()
  }

  const paymentId = getWebhookPaymentId(payload)
  if (paymentId) {
    await admin.from('payments').upsert({
      user_id: context.userId,
      order_id: order.id,
      product_id: context.productId,
      plan_id: context.planId,
      mode,
      waffo_payment_id: paymentId,
      waffo_order_id: orderId,
      payment_status: orderStatus,
      payment_method: getWebhookPaymentMethod(payload),
      payment_last4: getWebhookPaymentLast4(payload),
      payment_date: getWebhookPaymentDate(payload),
      currency: getWebhookCurrency(payload),
      amount: getWebhookAmount(payload),
      raw_payload: payload,
    }, { onConflict: 'mode,waffo_payment_id' }).throwOnError()
  }

  let subscriptionId: string | null = null
  if (orderType === 'subscription') {
    const { data: subscription } = await admin
      .from('subscriptions')
      .upsert({
        user_id: context.userId,
        product_id: context.productId,
        plan_id: context.planId,
        order_id: order.id,
        mode,
        waffo_order_id: orderId,
        status: 'active',
        billing_period: getWebhookBillingPeriod(payload),
        current_period_start: getWebhookCurrentPeriodStart(payload),
        current_period_end: getWebhookCurrentPeriodEnd(payload),
        raw_payload: payload,
      }, { onConflict: 'mode,waffo_order_id' })
      .select('*')
      .single()
      .throwOnError()

    subscriptionId = subscription.id
  }

  await admin.from('entitlements').upsert({
    user_id: context.userId,
    product_id: context.productId,
    plan_id: context.planId,
    subscription_id: subscriptionId,
    order_id: order.id,
    source_type: context.sourceType,
    status: 'active',
    starts_at: new Date().toISOString(),
    expires_at: orderType === 'subscription' ? getWebhookCurrentPeriodEnd(payload) : null,
    metadata: {
      waffoOrderId: orderId,
      eventType,
      merchantProvidedBuyerIdentity,
      buyerIdentity,
      payload: getWebhookData(payload),
    },
  }, { onConflict: 'user_id,product_id,source_type' }).throwOnError()
}
