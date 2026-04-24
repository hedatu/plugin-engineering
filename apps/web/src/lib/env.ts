const required = ['PUBLIC_SUPABASE_URL', 'PUBLIC_SUPABASE_ANON_KEY', 'SITE_URL'] as const

required.forEach((key) => {
  if (!import.meta.env[key]) {
    console.warn(`[env] Missing ${key}. Check your .env.local or deployed env vars.`)
  }
})

export const env = {
  supabaseUrl: import.meta.env.PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? '',
  siteUrl: import.meta.env.SITE_URL ?? 'https://pay.915500.xyz',
  productKey: import.meta.env.PRODUCT_KEY ?? 'leadfill-one-profile',
}
