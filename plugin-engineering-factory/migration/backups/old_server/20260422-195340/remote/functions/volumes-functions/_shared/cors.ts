export function corsHeaders(req?: Request) {
  const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') || '*')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)

  const origin = req?.headers.get('origin') || '*'
  const allowOrigin = allowedOrigins.includes('*') || allowedOrigins.includes(origin)
    ? origin
    : allowedOrigins[0] || '*'

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-waffo-signature, x-waffo-event',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  }
}

export function jsonResponse(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json',
    },
  })
}

export function errorResponse(req: Request, error: string, status = 400, detail?: string) {
  return jsonResponse(req, {
    error,
    ...(detail ? { detail } : {}),
  }, status)
}

export function textResponse(req: Request, body = 'OK', status = 200) {
  return new Response(body, {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'text/plain; charset=utf-8',
    },
  })
}
