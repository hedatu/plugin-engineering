import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts'
import { requireUser } from '../_shared/supabase.ts'

type Body = {
  productKey: string
  installationId: string
  extensionId?: string
  browser?: string
  version?: string
  deviceLabel?: string
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

  if (!body.productKey || !body.installationId) return errorResponse(req, 'MISSING_PRODUCT_OR_INSTALLATION', 400)

  const admin = userResult.admin
  const { data: effective, error: effectiveError } = await admin.rpc('get_effective_plan', {
    p_user_id: userResult.user.id,
    p_product_key: body.productKey,
  })

  if (effectiveError || !effective?.[0]) return errorResponse(req, 'PRODUCT_NOT_FOUND', 404)
  const plan = effective[0]

  const { count } = await admin
    .from('installations')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userResult.user.id)
    .eq('product_id', plan.product_id)
    .eq('status', 'active')

  const { data: existing } = await admin
    .from('installations')
    .select('id,status')
    .eq('user_id', userResult.user.id)
    .eq('product_id', plan.product_id)
    .eq('installation_id', body.installationId)
    .maybeSingle()

  if (!existing && (count || 0) >= plan.max_installations) {
    return jsonResponse(req, {
      registered: false,
      errorCode: 'MAX_INSTALLATIONS_EXCEEDED',
      currentInstallations: count || 0,
      maxInstallations: plan.max_installations,
    }, 403)
  }

  const { data: installation, error } = await admin
    .from('installations')
    .upsert({
      user_id: userResult.user.id,
      product_id: plan.product_id,
      installation_id: body.installationId,
      extension_id: body.extensionId || null,
      browser: body.browser || 'chrome',
      version: body.version || null,
      device_label: body.deviceLabel || null,
      status: 'active',
      last_seen_at: new Date().toISOString(),
    }, { onConflict: 'user_id,product_id,installation_id' })
    .select('*')
    .single()

  if (error) return jsonResponse(req, { registered: false, errorCode: 'REGISTER_FAILED', detail: error.message }, 500)

  return jsonResponse(req, {
    registered: true,
    installation,
    currentInstallations: existing ? count || 1 : (count || 0) + 1,
    maxInstallations: plan.max_installations,
  })
})
