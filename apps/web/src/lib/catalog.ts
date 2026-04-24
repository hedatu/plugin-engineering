import { supabase } from './supabase'

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
  const { data, error } = await supabase
    .from('products')
    .select('id,product_key,slug,name,description,website_url,chrome_extension_id,metadata')
    .eq('status', 'active')
    .order('created_at', { ascending: true })

  if (error) {
    throw error
  }

  return (data ?? []) as ProductRecord[]
}

export async function listPublicPlans(productKey?: string) {
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

  return (data ?? []) as unknown as PlanRecord[]
}

export async function listProductsWithPlans() {
  const [products, plans] = await Promise.all([listProducts(), listPublicPlans()])
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

export function getFeaturedPaidPlan(product: ProductWithPlans) {
  return product.plans.find((plan) => plan.billing_type !== 'free') ?? null
}
