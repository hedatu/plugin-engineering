import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts'
import { requireUser } from '../_shared/supabase.ts'
import {
  getConfiguredCheckoutUrl,
  getConfiguredWaffoMode,
} from '../_shared/waffo.ts'
import { createAuthenticatedCheckout } from '../_shared/waffo_sdk.ts'

type Body = {
  productKey: string
  planKey: string
  installationId?: string
  successUrl?: string
  cancelUrl?: string
  source?: 'web' | 'chrome_extension'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return errorResponse(req, 'METHOD_NOT_ALLOWED', 405)

  const userResult = await requireUser(req)
  if (!userResult.ok) {
    return errorResponse(req, userResult.error, userResult.status)
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return errorResponse(req, 'INVALID_JSON', 400)
  }

  if (!body.productKey || !body.planKey) return errorResponse(req, 'MISSING_PRODUCT_OR_PLAN', 400)

  const successUrl = getConfiguredCheckoutUrl('success') || 'https://pay.915500.xyz/checkout/success'
  const cancelUrl = getConfiguredCheckoutUrl('cancel') || body.cancelUrl || 'https://pay.915500.xyz/checkout/cancel'
  if (!successUrl) return errorResponse(req, 'MISSING_SUCCESS_URL', 400)

  const admin = userResult.admin
  const mode = getConfiguredWaffoMode()

  const { data: plan, error: planError } = await admin
    .from('plans')
    .select('id, product_id, plan_key, name, billing_type, currency, amount, waffo_product_id_test, waffo_product_id_prod, waffo_product_type_test, waffo_product_type_prod, products!inner(id, product_key, name)')
    .eq('plan_key', body.planKey)
    .eq('products.product_key', body.productKey)
    .eq('status', 'active')
    .single()

  if (planError || !plan) return errorResponse(req, 'PLAN_NOT_FOUND', 404)
  if (plan.billing_type === 'free') return errorResponse(req, 'FREE_PLAN_NOT_PURCHASABLE', 400)

  const waffoProductId = mode === 'prod' ? plan.waffo_product_id_prod : plan.waffo_product_id_test
  const waffoProductType = mode === 'prod' ? plan.waffo_product_type_prod : plan.waffo_product_type_test

  if (!waffoProductId) {
    return errorResponse(req, 'WAFFO_PRODUCT_ID_NOT_CONFIGURED', 500)
  }

  if (!waffoProductType) {
    return errorResponse(req, 'WAFFO_PRODUCT_TYPE_NOT_CONFIGURED', 500)
  }

  const localOrderId = `ord_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`
  const source = body.source || 'web'
  const metadata = {
    userId: userResult.user.id,
    productKey: body.productKey,
    planKey: body.planKey,
    localOrderId,
    source,
    localCheckoutSessionId: '',
    installationId: body.installationId || null,
    environment: mode,
  }

  const { data: checkout, error: checkoutError } = await admin
    .from('checkout_sessions')
    .insert({
      local_order_id: localOrderId,
      user_id: userResult.user.id,
      product_id: plan.product_id,
      plan_id: plan.id,
      installation_id: body.installationId || null,
      source,
      mode,
      currency: plan.currency,
      amount: plan.amount,
      status: 'created',
      metadata,
    })
    .select('*')
    .single()

  if (checkoutError || !checkout) {
    return errorResponse(req, 'CHECKOUT_CREATE_FAILED', 500, checkoutError?.message)
  }

  const nextMetadata = {
    ...metadata,
    localCheckoutSessionId: checkout.id,
  }

  try {
    const session = await createAuthenticatedCheckout({
      productId: waffoProductId,
      currency: plan.currency,
      buyerIdentity: userResult.user.id,
      buyerEmail: userResult.user.email ?? '',
      successUrl,
      metadata: nextMetadata,
    })

    await admin
      .from('checkout_sessions')
      .update({
        waffo_session_id: session.sessionId,
        checkout_url: session.checkoutUrl,
        expires_at: session.expiresAt,
        status: 'opened',
        metadata: {
          ...nextMetadata,
          waffoProductId,
          waffoProductType,
          successUrl,
          cancelUrl,
          requestedSuccessUrl: body.successUrl || null,
          requestedCancelUrl: body.cancelUrl || null,
          sdk: '@waffo/pancake-ts',
        },
      })
      .eq('id', checkout.id)

    return jsonResponse(req, {
      checkoutUrl: session.checkoutUrl,
      sessionId: session.sessionId,
      localOrderId,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'WAFFO_CREATE_SESSION_FAILED'

    await admin
      .from('checkout_sessions')
      .update({
        status: 'failed',
        metadata: {
          ...nextMetadata,
          error: detail,
          waffoProductId,
          waffoProductType,
          successUrl,
          cancelUrl,
          requestedSuccessUrl: body.successUrl || null,
          requestedCancelUrl: body.cancelUrl || null,
          sdk: '@waffo/pancake-ts',
        },
      })
      .eq('id', checkout.id)

    return errorResponse(req, 'WAFFO_CREATE_SESSION_FAILED', 502, detail)
  }
})
