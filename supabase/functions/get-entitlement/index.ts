import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts'
import { requireUser } from '../_shared/supabase.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'GET' && req.method !== 'POST') return errorResponse(req, 'METHOD_NOT_ALLOWED', 405)

  const userResult = await requireUser(req)
  if (!userResult.ok) {
    return errorResponse(req, userResult.error, userResult.status)
  }

  let productKey = new URL(req.url).searchParams.get('productKey')
  if (!productKey && req.method === 'POST') {
    try {
      const body = await req.json()
      productKey = body.productKey
    } catch {
      return errorResponse(req, 'INVALID_JSON', 400)
    }
  }

  if (!productKey) return errorResponse(req, 'MISSING_PRODUCT_KEY', 400)

  const admin = userResult.admin
  const { data: effective, error: effectiveError } = await admin.rpc('get_effective_plan', {
    p_user_id: userResult.user.id,
    p_product_key: productKey,
  })

  if (effectiveError) return errorResponse(req, 'ENTITLEMENT_LOOKUP_FAILED', 500, effectiveError.message)

  const plan = effective?.[0]
  if (!plan) return errorResponse(req, 'PRODUCT_NOT_FOUND', 404)

  const { data: rawUsage } = await admin
    .from('usage_counters')
    .select('*')
    .eq('user_id', userResult.user.id)
    .eq('product_id', plan.product_id)

  const { data: subscription } = await admin
    .from('subscriptions')
    .select('status,billing_period,current_period_start,current_period_end,canceled_at')
    .eq('user_id', userResult.user.id)
    .eq('product_id', plan.product_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: orders } = await admin
    .from('orders')
    .select('id,order_status,order_type,amount,currency,created_at,plans(plan_key)')
    .eq('user_id', userResult.user.id)
    .eq('product_id', plan.product_id)
    .order('created_at', { ascending: false })
    .limit(10)

  const usageLookup = new Map((rawUsage ?? []).map((item) => [item.feature_key as string, item]))
  const usage = Object.entries(plan.quotas ?? {}).map(([featureKey, quotaConfig]) => {
    const usageRow = usageLookup.get(featureKey)
    const quota = quotaConfig as { limit?: number; period?: string }
    const limit = Number(quota.limit ?? -1)
    const usedCount = Number(usageRow?.used_count ?? 0)

    return {
      featureKey,
      periodType: (quota.period ?? 'lifetime') as 'day' | 'month' | 'lifetime',
      periodStart: usageRow?.period_start ?? new Date(0).toISOString(),
      usedCount,
      limitValue: limit,
      remaining: limit === -1 ? -1 : Math.max(limit - usedCount, 0),
    }
  })

  return jsonResponse(req, {
    user: { id: userResult.user.id, email: userResult.user.email },
    product: { id: plan.product_id, productKey: plan.product_key },
    plan: { id: plan.plan_id, planKey: plan.plan_key, billingType: plan.billing_type },
    entitlement: {
      id: plan.entitlement_id,
      status: plan.entitlement_status,
      expiresAt: plan.expires_at,
    },
    features: plan.features,
    quotas: plan.quotas,
    maxInstallations: plan.max_installations,
    usage,
    subscription: subscription ? {
      status: subscription.status,
      billingPeriod: subscription.billing_period,
      currentPeriodStart: subscription.current_period_start,
      currentPeriodEnd: subscription.current_period_end,
      canceledAt: subscription.canceled_at,
    } : null,
    orders: (orders ?? []).map((order) => ({
      id: order.id,
      status: order.order_status,
      type: order.order_type,
      amount: order.amount,
      currency: order.currency,
      createdAt: order.created_at,
      planKey: order.plans?.plan_key ?? null,
    })),
  })
})
