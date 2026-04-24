import type {
  CheckoutSessionResponse,
  ConsumeUsageResponse,
  EntitlementResponse,
  InstallationResponse,
} from '@membership/extension-sdk'
import { supabase } from './supabase'

async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

async function invoke<T>(functionName: string, body?: unknown, init?: RequestInit) {
  const token = await getAccessToken()
  if (!token) {
    throw new Error('LOGIN_REQUIRED')
  }

  const response = await fetch(`${import.meta.env.PUBLIC_SUPABASE_URL}/functions/v1/${functionName}`, {
    method: init?.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? '',
      ...init?.headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await response.text()
  const json = text ? JSON.parse(text) : {}

  if (!response.ok) {
    throw new Error(json.error ?? json.errorCode ?? 'REQUEST_FAILED')
  }

  return json as T
}

export function fetchEntitlement(productKey: string) {
  return invoke<EntitlementResponse>('get-entitlement', { productKey })
}

export function createCheckoutSession(input: {
  productKey: string
  planKey: string
  installationId?: string
  extensionId?: string
  successUrl?: string
  cancelUrl?: string
  source?: 'web' | 'chrome_extension'
}) {
  return invoke<CheckoutSessionResponse>('create-checkout-session', input)
}

export function registerInstallation(input: {
  productKey: string
  installationId: string
  extensionId?: string
  browser?: string
  version?: string
}) {
  return invoke<InstallationResponse>('register-installation', input)
}

export function consumeUsage(input: {
  productKey: string
  featureKey: string
  amount?: number
  installationId?: string
}) {
  return invoke<ConsumeUsageResponse>('consume-usage', input)
}
