export type WaffoMode = 'test' | 'prod'

export function getRequiredEnv(key: string) {
  const value = Deno.env.get(key)
  if (!value) {
    throw new Error(`MISSING_ENV:${key}`)
  }
  return value
}

export function getSupabaseUrl() {
  return Deno.env.get('PUBLIC_SUPABASE_URL')
    || Deno.env.get('SUPABASE_URL')
    || getRequiredEnv('PUBLIC_SUPABASE_URL')
}

export function getSupabaseAnonKey() {
  return Deno.env.get('PUBLIC_SUPABASE_ANON_KEY')
    || Deno.env.get('SUPABASE_ANON_KEY')
    || getRequiredEnv('PUBLIC_SUPABASE_ANON_KEY')
}

export function getServiceRoleKey() {
  return getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY')
}

function decodeBase64Utf8(value: string) {
  const normalized = value.replace(/\s/g, '')
  return new TextDecoder().decode(Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0)))
}

export function getWaffoPrivateKey() {
  const inlineValue = getOptionalEnv('WAFFO_PRIVATE_KEY')
  if (inlineValue) {
    return inlineValue
  }

  const encodedValue = getOptionalEnv('WAFFO_PRIVATE_KEY_BASE64')
  if (encodedValue) {
    return decodeBase64Utf8(encodedValue)
  }

  throw new Error('MISSING_ENV:WAFFO_PRIVATE_KEY')
}

export function normalizeWaffoMode(value: unknown): WaffoMode {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'prod' || normalized === 'production' || normalized === 'live') {
    return 'prod'
  }
  return 'test'
}

export function getConfiguredWaffoMode() {
  return normalizeWaffoMode(Deno.env.get('WAFFO_ENVIRONMENT') ?? Deno.env.get('WAFFO_ENV') ?? 'test')
}

export function getWaffoWebhookPublicKey(mode: WaffoMode) {
  return getOptionalWaffoWebhookPublicKey(mode) ?? getRequiredEnv(
    mode === 'prod' ? 'WAFFO_WEBHOOK_PUBLIC_KEY_PROD' : 'WAFFO_WEBHOOK_PUBLIC_KEY_TEST',
  )
}

export function getOptionalEnv(key: string) {
  const value = Deno.env.get(key)
  if (!value || !value.trim()) {
    return null
  }

  return value.trim()
}

export function getOptionalWaffoWebhookPublicKey(mode: WaffoMode) {
  if (mode === 'prod') {
    return getOptionalEnv('WAFFO_WEBHOOK_PUBLIC_KEY_PROD')
      ?? getOptionalEnv('WAFFO_WEBHOOK_PROD_PUBLIC_KEY')
      ?? getOptionalEnv('WAFFO_WEBHOOK_PUBLIC_KEY')
  }

  return getOptionalEnv('WAFFO_WEBHOOK_PUBLIC_KEY_TEST')
    ?? getOptionalEnv('WAFFO_WEBHOOK_TEST_PUBLIC_KEY')
    ?? getOptionalEnv('WAFFO_WEBHOOK_PUBLIC_KEY')
}
