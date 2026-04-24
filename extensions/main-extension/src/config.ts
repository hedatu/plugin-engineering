export const config = {
  supabaseUrl: import.meta.env.PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? '',
  productKey: import.meta.env.PRODUCT_KEY ?? 'leadfill-one-profile',
  featureKey: import.meta.env.FEATURE_KEY ?? 'leadfill_fill_action',
  siteUrl: import.meta.env.SITE_URL ?? 'https://pay.915500.xyz',
  extensionId: import.meta.env.CHROME_EXTENSION_ID ?? '',
}
