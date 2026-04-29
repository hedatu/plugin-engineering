import { supabase } from './supabase'
import {
  fallbackPlanRecords,
  fallbackProductRecords,
  fallbackProductsWithPlans,
} from '../content/productCatalog'

export type ProductRecord = {
  id: string
  product_key: string
  slug: string
  name: string
  description: string | null
  website_url: string | null
  chrome_extension_id: string | null
  metadata: Record<string, unknown>
}

export type PlanRecord = {
  id: string
  product_id: string
  plan_key: string
  name: string
  description: string | null
  billing_type: 'free' | 'monthly' | 'yearly' | 'lifetime' | 'onetime'
  currency: string
  amount: number
  features: Record<string, boolean>
  max_installations: number
  sort_order: number
  products: {
    id: string
    product_key: string
    name: string
    slug: string
  } | null
}

export type ProductWithPlans = ProductRecord & {
  plans: PlanRecord[]
}

export async function listProducts() {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('id,product_key,slug,name,description,website_url,chrome_extension_id,metadata')
      .eq('status', 'active')
      .order('created_at', { ascending: true })

    if (error) {
      throw error
    }

    if (data?.length) {
      return data as ProductRecord[]
    }
  } catch (error) {
    console.warn(error)
  }

  return fallbackProductRecords
}

export async function listPublicPlans(productKey?: string) {
  try {
    let query = supabase
      .from('plans')
      .select('id,product_id,plan_key,name,description,billing_type,currency,amount,features,max_installations,sort_order,products!inner(id,product_key,name,slug)')
      .eq('status', 'active')
      .eq('is_public', true)
      .order('sort_order', { ascending: true })

    if (productKey) {
      query = query.eq('products.product_key', productKey)
    }

    const { data, error } = await query

    if (error) {
      throw error
    }

    if (data?.length) {
      return data as unknown as PlanRecord[]
    }
  } catch (error) {
    console.warn(error)
  }

  if (!productKey) {
    return fallbackPlanRecords
  }

  return fallbackPlanRecords.filter((plan) => plan.products?.product_key === productKey)
}

export async function listProductsWithPlans() {
  const [remoteProducts, remotePlans] = await Promise.all([listProducts(), listPublicPlans()])
  const productsByKey = new Map(remoteProducts.map((product) => [product.product_key, product]))
  for (const fallbackProduct of fallbackProductsWithPlans) {
    const remoteProduct = productsByKey.get(fallbackProduct.product_key)
    if (remoteProduct) {
      productsByKey.set(fallbackProduct.product_key, {
        ...remoteProduct,
        chrome_extension_id: remoteProduct.chrome_extension_id ?? fallbackProduct.chrome_extension_id,
        metadata: {
          ...fallbackProduct.metadata,
          ...remoteProduct.metadata,
        },
      })
    } else {
      productsByKey.set(fallbackProduct.product_key, fallbackProduct)
    }
  }

  const fallbackOrder = new Map(fallbackProductsWithPlans.map((product, index) => [product.product_key, index]))
  const products = Array.from(productsByKey.values()).sort((left, right) => {
    const leftOrder = fallbackOrder.get(left.product_key) ?? 999
    const rightOrder = fallbackOrder.get(right.product_key) ?? 999
    return leftOrder - rightOrder
  })
  const productKeys = new Set(products.map((product) => product.product_key))
  const planKeys = new Set(remotePlans.map((plan) => `${plan.products?.product_key ?? plan.product_id}:${plan.plan_key}`))
  const fallbackPlans = fallbackPlanRecords.filter((plan) => {
    const productKey = plan.products?.product_key
    return productKey && productKeys.has(productKey) && !planKeys.has(`${productKey}:${plan.plan_key}`)
  })
  const plans = [...remotePlans, ...fallbackPlans]
  const plansByProductId = new Map<string, PlanRecord[]>()

  for (const plan of plans) {
    const items = plansByProductId.get(plan.product_id) ?? []
    items.push(plan)
    plansByProductId.set(plan.product_id, items)
  }

  return products.map((product) => ({
    ...product,
    plans: (plansByProductId.get(product.id) ?? []).sort((left, right) => left.sort_order - right.sort_order),
  }))
}

export async function getProductWithPlans(productKey: string) {
  const products = await listProductsWithPlans()
  return products.find((product) => product.product_key === productKey) ?? null
}

export async function getProductWithPlansBySlug(slug: string) {
  const products = await listProductsWithPlans()
  return products.find((product) => product.slug === slug) ?? null
}

export function getFeaturedPaidPlan(product: ProductWithPlans) {
  return product.plans.find((plan) => plan.billing_type !== 'free') ?? null
}
