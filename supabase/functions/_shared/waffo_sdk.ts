import {
  WaffoPancake,
  verifyWebhook,
  type AuthenticatedCheckoutResult,
  type WebhookEvent,
  type WebhookEventData,
} from 'npm:@waffo/pancake-ts@0.5.0'
import {
  getOptionalEnv,
  getOptionalWaffoWebhookPublicKey,
  getRequiredEnv,
  getWaffoPrivateKey,
  type WaffoMode,
} from './env.ts'

function toCheckoutMetadata(metadata: Record<string, unknown>) {
  const entries = Object.entries(metadata)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => {
      if (typeof value === 'string') return [key, value]
      if (typeof value === 'number' || typeof value === 'boolean') return [key, String(value)]
      return [key, JSON.stringify(value)]
    })

  return Object.fromEntries(entries) as Record<string, string>
}

function createClient() {
  const baseUrl = getOptionalEnv('WAFFO_API_BASE_URL') ?? undefined

  return new WaffoPancake({
    merchantId: getRequiredEnv('WAFFO_MERCHANT_ID'),
    privateKey: getWaffoPrivateKey(),
    ...(baseUrl ? { baseUrl } : {}),
  })
}

export async function createAuthenticatedCheckout(params: {
  productId: string
  currency: string
  buyerIdentity: string
  buyerEmail?: string | null
  successUrl: string
  metadata: Record<string, unknown>
}) {
  const client = createClient()
  const result: AuthenticatedCheckoutResult = await client.checkout.authenticated.create({
    productId: params.productId,
    currency: params.currency,
    buyerIdentity: params.buyerIdentity,
    ...(params.buyerEmail ? { buyerEmail: params.buyerEmail } : {}),
    successUrl: params.successUrl,
    metadata: toCheckoutMetadata(params.metadata),
  })

  return {
    sessionId: result.sessionId,
    checkoutUrl: result.checkoutUrl,
    expiresAt: result.expiresAt,
  }
}

export function verifyWaffoWebhookEvent(params: {
  rawBody: string
  signatureHeader: string | null
  mode: WaffoMode
  toleranceMs?: number
}) {
  const publicKey = getOptionalWaffoWebhookPublicKey(params.mode) ?? undefined

  const event = verifyWebhook<WebhookEventData>(params.rawBody, params.signatureHeader, {
    environment: params.mode,
    toleranceMs: params.toleranceMs ?? 5 * 60 * 1000,
    ...(publicKey ? { publicKey } : {}),
  })

  return event as WebhookEvent<WebhookEventData>
}
