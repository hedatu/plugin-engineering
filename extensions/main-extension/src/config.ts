export const config = {
  supabaseUrl: import.meta.env.PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? '',
  productKey: import.meta.env.PRODUCT_KEY ?? 'leadfill-one-profile',
  productSlug: import.meta.env.PRODUCT_SLUG ?? 'leadfill-one-profile',
  defaultPlanKey: import.meta.env.PLAN_KEY ?? 'lifetime',
  featureKey: import.meta.env.FEATURE_KEY ?? 'leadfill_fill_action',
  siteUrl: import.meta.env.SITE_URL ?? 'https://pay.915500.xyz',
  extensionId: import.meta.env.CHROME_EXTENSION_ID ?? '',
  checkoutMode: import.meta.env.PUBLIC_CHECKOUT_MODE ?? import.meta.env.VITE_CHECKOUT_MODE ?? 'test',
}
