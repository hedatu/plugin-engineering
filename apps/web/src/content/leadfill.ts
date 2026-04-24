import type { PlanRecord, ProductRecord, ProductWithPlans } from '../lib/catalog'
import { env } from '../lib/env'

export const leadfillBenefits = [
  {
    title: 'One-click form filling',
    description: 'Save one clean profile and fill common lead-form fields in a single action.',
  },
  {
    title: 'Less repetitive typing',
    description: 'Stop re-entering the same name, email, phone, company, and notes on every page.',
  },
  {
    title: 'Local-only by default',
    description: 'Profile data stays inside the extension. No upload. No cloud sync. No shared workspace.',
  },
  {
    title: 'Upgrade only when it earns it',
    description: 'Start with 10 free fills, then unlock unlimited usage with a single lifetime payment.',
  },
] as const

export const leadfillSteps = [
  {
    title: 'Save your profile',
    description: 'Create one reusable profile with your basic lead or contact details.',
  },
  {
    title: 'Open any lead form',
    description: 'Open the page you want to fill inside Chrome.',
  },
  {
    title: 'Click Fill Current Page',
    description: 'LeadFill fills common text, email, phone, textarea, and select fields.',
  },
  {
    title: 'Upgrade for unlimited use',
    description: 'After the free tier, unlock the lifetime plan if LeadFill saves you time.',
  },
] as const

export const leadfillFeatureBreakdown = [
  {
    title: 'Common field support',
    description: 'Works best with text, email, phone, textarea, and select inputs found on lead and contact forms.',
  },
  {
    title: 'Safer default behavior',
    description: 'Does not overwrite existing values by default and skips readonly or disabled fields.',
  },
  {
    title: 'Single-profile simplicity',
    description: 'The current product is intentionally focused: one saved profile, one click, one clear job.',
  },
  {
    title: 'Private local storage',
    description: 'The extension keeps form profile data in the browser instead of sending form content to a server.',
  },
] as const

export const leadfillFaqs = [
  {
    question: 'Does LeadFill upload my form data?',
    answer: 'No. LeadFill is designed for local-only profile storage and does not sync your form content to a cloud account.',
  },
  {
    question: 'Is the paid plan a subscription?',
    answer: 'No. The current paid offer is a one-time lifetime unlock for unlimited fills.',
  },
  {
    question: 'What happens after the 10 free fills?',
    answer: 'You will hit the paywall for additional fills until you unlock the lifetime plan.',
  },
  {
    question: 'How does payment activate membership?',
    answer: 'Payment is confirmed on the backend, and membership becomes active only after the payment event is verified and written server-side.',
  },
  {
    question: 'Can I restore my purchase?',
    answer: 'Yes. Sign in with the same email used for checkout, then refresh membership in the extension or account page.',
  },
] as const

export const leadfillTrustPoints = [
  '10 free fills',
  '$19 lifetime unlock',
  'Local-only storage',
  'No upload',
  'No cloud sync',
] as const

export const leadfillFallbackProduct: ProductWithPlans = {
  id: 'leadfill-fallback',
  product_key: env.productKey,
  slug: 'leadfill-one-profile',
  name: 'LeadFill One Profile',
  description: 'Save one local profile and fill repetitive lead forms in one click.',
  website_url: null,
  chrome_extension_id: 'dnnpkaefmlhacigijccbhemgaenjbcpk',
  metadata: {},
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
        product_key: env.productKey,
        name: 'LeadFill One Profile',
        slug: 'leadfill-one-profile',
      },
    },
    {
      id: 'leadfill-lifetime',
      product_id: 'leadfill-fallback',
      plan_key: 'lifetime',
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
        product_key: env.productKey,
        name: 'LeadFill One Profile',
        slug: 'leadfill-one-profile',
      },
    },
  ],
}

export function getFreePlan(product?: ProductWithPlans | null) {
  return product?.plans.find((plan) => plan.billing_type === 'free') ?? null
}

export function getPaidPlan(product?: ProductWithPlans | null) {
  return product?.plans.find((plan) => plan.billing_type !== 'free') ?? null
}

function formatUsd(amount: number) {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`
}

export function formatPlanPrice(plan?: PlanRecord | null) {
  if (!plan) {
    return '$19'
  }

  if (plan.amount === 0) {
    return 'Free'
  }

  if (plan.currency.toUpperCase() === 'USD') {
    return formatUsd(plan.amount)
  }

  return `${plan.currency.toUpperCase()} ${plan.amount.toFixed(2)}`
}

export function formatPlanHeadline(plan?: PlanRecord | null) {
  if (!plan) {
    return '$19 lifetime'
  }

  if (plan.amount === 0) {
    return 'Free'
  }

  if (plan.billing_type === 'lifetime' || plan.billing_type === 'onetime') {
    return `${formatPlanPrice(plan)} lifetime`
  }

  return `${formatPlanPrice(plan)} ${plan.billing_type}`
}

export function getPlanBullets(plan?: PlanRecord | null) {
  if (!plan || plan.billing_type === 'free') {
    return [
      '10 fills included',
      '1 saved profile',
      'Local-only',
      'No overwrite by default',
    ]
  }

  const items = [
    'Unlimited fills',
    'Save, edit, and delete profiles',
    'Advanced field support',
    'Local-only',
    'No subscription',
  ]

  if (plan.max_installations > 1) {
    items.push(`Use on up to ${plan.max_installations} Chrome installations`)
  }

  return items
}

const featureLabelMap: Record<string, string> = {
  advanced_field_support: 'Advanced field support',
  leadfill_fill_action: 'Form filling',
  profile_delete: 'Delete profile',
  profile_edit: 'Edit profile',
  saved_profile: 'Saved profile',
}

export function describeFeature(featureKey: string, enabled: boolean) {
  const label = featureLabelMap[featureKey] ?? featureKey.replace(/_/g, ' ')
  return `${label}: ${enabled ? 'Included' : 'Not included'}`
}

export function formatMoney(amount: number | null | undefined, currency: string | null | undefined) {
  if (amount === null || amount === undefined) {
    return '-'
  }

  if ((currency ?? '').toUpperCase() === 'USD') {
    return formatUsd(amount)
  }

  return `${(currency ?? 'USD').toUpperCase()} ${amount.toFixed(2)}`
}

export function getChromeStoreUrl(product?: Pick<ProductRecord, 'chrome_extension_id' | 'website_url'> | null) {
  if (product?.website_url && product.website_url.includes('chromewebstore.google.com')) {
    return product.website_url
  }

  if (product?.chrome_extension_id) {
    return `https://chromewebstore.google.com/detail/${product.chrome_extension_id}`
  }

  return null
}

export function getDefaultProductPath() {
  return '/'
}
