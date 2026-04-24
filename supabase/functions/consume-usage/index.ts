import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts'
import { requireUser } from '../_shared/supabase.ts'

type Body = {
  productKey: string
  featureKey: string
  amount?: number
  installationId?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return errorResponse(req, 'METHOD_NOT_ALLOWED', 405)

  const userResult = await requireUser(req)
  if (!userResult.ok) {
    return jsonResponse(req, { allowed: false, errorCode: userResult.error }, userResult.status)
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return jsonResponse(req, { allowed: false, errorCode: 'INVALID_JSON' }, 400)
  }

  if (!body.productKey || !body.featureKey) return jsonResponse(req, { allowed: false, errorCode: 'MISSING_PRODUCT_OR_FEATURE' }, 400)

  const admin = userResult.admin

  if (body.installationId) {
    const { data: product } = await admin
      .from('products')
      .select('id')
      .eq('product_key', body.productKey)
      .single()

    if (product) {
      const { data: installation } = await admin
        .from('installations')
        .select('id,status')
        .eq('user_id', userResult.user.id)
        .eq('product_id', product.id)
        .eq('installation_id', body.installationId)
        .maybeSingle()

      if (!installation || installation.status !== 'active') {
        return jsonResponse(req, { allowed: false, errorCode: 'INSTALLATION_NOT_REGISTERED' }, 403)
      }
    }
  }

  const { data, error } = await admin.rpc('consume_feature_usage', {
    p_user_id: userResult.user.id,
    p_product_key: body.productKey,
    p_feature_key: body.featureKey,
    p_amount: body.amount || 1,
  })

  if (error) return jsonResponse(req, { allowed: false, errorCode: 'CONSUME_FAILED', detail: error.message }, 500)

  const status = data?.allowed ? 200 : (data?.errorCode === 'QUOTA_EXCEEDED' ? 429 : 403)
  return jsonResponse(req, data, status)
})
