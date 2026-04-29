import type { PlanRecord, ProductRecord, ProductWithPlans } from '../lib/catalog'

export const leadfillProductKey = 'leadfill-one-profile'
export const leadfillProductSlug = 'leadfill-one-profile'
export const leadfillDefaultPlanKey = 'lifetime'
export const leadfillFeatureKey = 'leadfill_fill_action'
export const defaultCheckoutMode = 'test'
export const obsidianProductKey = 'chatgpt-obsidian-local-exporter'
export const obsidianProductSlug = 'chatgpt-obsidian-local-exporter'

const leadfillProductMetadata = {
  checkoutMode: defaultCheckoutMode,
  localOnly: true,
  noUpload: true,
  noCloudSync: true,
  chromeWebStoreStatus: 'published',
  chromeWebStoreUrl: 'https://chromewebstore.google.com/detail/leadfill-one-profile/dnnpkaefmlhacigijccbhemgaenjbcpk',
} as const

const obsidianProductMetadata = {
  checkoutMode: 'disabled',
  localOnly: true,
  noUpload: true,
  noCloudSync: true,
  launchStatus: 'pending_review',
  chromeWebStoreStatus: 'pending_review',
} as const

export const leadfillFallbackProduct: ProductWithPlans = {
  id: 'leadfill-fallback',
  product_key: leadfillProductKey,
  slug: leadfillProductSlug,
  name: 'LeadFill One Profile',
  description: 'Save one local profile and fill repetitive lead forms in one click.',
  website_url: null,
  chrome_extension_id: 'dnnpkaefmlhacigijccbhemgaenjbcpk',
  metadata: { ...leadfillProductMetadata },
  plans: [
    {
      id: 'leadfill-free',
      product_id: 'leadfill-fallback',
      plan_key: 'free',
      name: 'Free',
      description: '10 free fills with one saved profile.',
      billing_type: 'free',
      currency: 'USD',
      amount: 0,
      features: {
        profile_edit: false,
        saved_profile: true,
        profile_delete: false,
        leadfill_fill_action: true,
        advanced_field_support: false,
      },
      max_installations: 1,
      sort_order: 0,
      products: {
        id: 'leadfill-fallback',
        product_key: leadfillProductKey,
        name: 'LeadFill One Profile',
        slug: leadfillProductSlug,
      },
    },
    {
      id: 'leadfill-lifetime',
      product_id: 'leadfill-fallback',
      plan_key: leadfillDefaultPlanKey,
      name: 'Lifetime Unlock',
      description: 'Unlimited LeadFill usage with a one-time payment.',
      billing_type: 'lifetime',
      currency: 'USD',
      amount: 19,
      features: {
        profile_edit: true,
        saved_profile: true,
        profile_delete: true,
        leadfill_fill_action: true,
        advanced_field_support: true,
      },
      max_installations: 3,
      sort_order: 1,
      products: {
        id: 'leadfill-fallback',
        product_key: leadfillProductKey,
        name: 'LeadFill One Profile',
        slug: leadfillProductSlug,
      },
    },
  ],
}

export const obsidianFallbackProduct: ProductWithPlans = {
  id: 'obsidian-fallback',
  product_key: obsidianProductKey,
  slug: obsidianProductSlug,
  name: 'ChatGPT Obsidian Local Exporter',
  description: 'Export AI conversations into Obsidian-friendly Markdown for local archives.',
  website_url: null,
  chrome_extension_id: null,
  metadata: { ...obsidianProductMetadata },
  plans: [
    {
      id: 'obsidian-monthly',
      product_id: 'obsidian-fallback',
      plan_key: 'monthly',
      name: 'Monthly',
      description: 'Monthly access after Chrome Web Store approval.',
      billing_type: 'monthly',
      currency: 'USD',
      amount: 9,
      features: {
        markdown_export: true,
        local_archive: true,
        multi_platform_support: true,
      },
      max_installations: 1,
      sort_order: 0,
      products: {
        id: 'obsidian-fallback',
        product_key: obsidianProductKey,
        name: 'ChatGPT Obsidian Local Exporter',
        slug: obsidianProductSlug,
      },
    },
    {
      id: 'obsidian-yearly',
      product_id: 'obsidian-fallback',
      plan_key: 'annual',
      name: 'Annual',
      description: 'Discounted annual access after Chrome Web Store approval.',
      billing_type: 'yearly',
      currency: 'USD',
      amount: 29,
      features: {
        markdown_export: true,
        local_archive: true,
        multi_platform_support: true,
      },
      max_installations: 2,
      sort_order: 1,
      products: {
        id: 'obsidian-fallback',
        product_key: obsidianProductKey,
        name: 'ChatGPT Obsidian Local Exporter',
        slug: obsidianProductSlug,
      },
    },
    {
      id: 'obsidian-lifetime',
      product_id: 'obsidian-fallback',
      plan_key: 'lifetime',
      name: 'Lifetime',
      description: 'Lifetime access after Chrome Web Store approval.',
      billing_type: 'lifetime',
      currency: 'USD',
      amount: 39.9,
      features: {
        markdown_export: true,
        local_archive: true,
        multi_platform_support: true,
      },
      max_installations: 3,
      sort_order: 2,
      products: {
        id: 'obsidian-fallback',
        product_key: obsidianProductKey,
        name: 'ChatGPT Obsidian Local Exporter',
        slug: obsidianProductSlug,
      },
    },
  ],
}

export const fallbackProductsWithPlans = [obsidianFallbackProduct, leadfillFallbackProduct]

export const fallbackProductRecords: ProductRecord[] = fallbackProductsWithPlans.map((product) => ({
  id: product.id,
  product_key: product.product_key,
  slug: product.slug,
  name: product.name,
  description: product.description,
  website_url: product.website_url,
  chrome_extension_id: product.chrome_extension_id,
  metadata: product.metadata,
}))

export const fallbackPlanRecords: PlanRecord[] = fallbackProductsWithPlans.flatMap((product) =>
  product.plans.map((plan) => ({
    ...plan,
    products: {
      id: product.id,
      product_key: product.product_key,
      name: product.name,
      slug: product.slug,
    },
  })),
)

export function getProductPathBySlug(slug: string) {
  return `/products/${slug}`
}

export function getProductPricingPathBySlug(slug: string) {
  return `/products/${slug}/pricing`
}

export function getDefaultProductPath() {
  return getProductPathBySlug(leadfillProductSlug)
}

export function getDefaultPricingPath() {
  return getProductPricingPathBySlug(leadfillProductSlug)
}

export function getProductPath(product?: Pick<ProductRecord, 'slug'> | null) {
  return getProductPathBySlug(product?.slug ?? leadfillProductSlug)
}

export function getProductPricingPath(product?: Pick<ProductRecord, 'slug'> | null) {
  return getProductPricingPathBySlug(product?.slug ?? leadfillProductSlug)
}

export function buildCheckoutStartPath(input: {
  productKey: string
  planKey: string
  source?: 'web' | 'chrome_extension'
  installationId?: string | null
  extensionId?: string | null
}) {
  const params = new URLSearchParams({
    productKey: input.productKey,
    planKey: input.planKey,
    source: input.source ?? 'web',
  })

  if (input.installationId) {
    params.set('installationId', input.installationId)
  }

  if (input.extensionId) {
    params.set('extensionId', input.extensionId)
  }

  return `/checkout/start?${params.toString()}`
}

export function getProductChromeStoreStatus(product?: Pick<ProductRecord, 'metadata'> | null) {
  return typeof product?.metadata?.chromeWebStoreStatus === 'string'
    ? product.metadata.chromeWebStoreStatus
    : 'pending'
}

export function getProductLaunchStatus(product?: Pick<ProductRecord, 'metadata'> | null) {
  return typeof product?.metadata?.launchStatus === 'string'
    ? product.metadata.launchStatus
    : getProductChromeStoreStatus(product)
}

export function isProductPendingReview(product?: Pick<ProductRecord, 'metadata'> | null) {
  return getProductLaunchStatus(product) === 'pending_review'
}

export function getProductStoreCtaLabel(product?: Pick<ProductRecord, 'metadata'> | null) {
  if (getProductChromeStoreStatus(product) === 'published') {
    return 'Add to Chrome'
  }

  if (isProductPendingReview(product)) {
    return 'Pending Google review'
  }

  return 'Chrome Web Store link pending'
}

export function getProductChromeStoreUrl(product?: Pick<ProductRecord, 'chrome_extension_id' | 'website_url' | 'metadata'> | null) {
  const status = getProductChromeStoreStatus(product)
  if (status !== 'published') {
    return null
  }

  const metadataUrl = typeof product?.metadata?.chromeWebStoreUrl === 'string'
    ? product.metadata.chromeWebStoreUrl
    : null

  if (metadataUrl) {
    return metadataUrl
  }

  if (product?.website_url && product.website_url.includes('chromewebstore.google.com')) {
    return product.website_url
  }

  return null
}

export function getProductCheckoutMode(product?: Pick<ProductRecord, 'metadata'> | null) {
  return typeof product?.metadata?.checkoutMode === 'string'
    ? product.metadata.checkoutMode
    : defaultCheckoutMode
}
