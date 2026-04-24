export type BillingType = 'free' | 'monthly' | 'yearly' | 'lifetime' | 'onetime'
export type EntitlementStatus = 'active' | 'canceling' | 'past_due' | 'expired' | 'revoked'
export type UsagePeriodType = 'day' | 'month' | 'lifetime'

export type SessionSnapshot = {
  accessToken: string
  refreshToken: string
  expiresAt: number | null
  user: {
    id: string
    email: string | null
  }
}

export type UsageCounter = {
  featureKey: string
  periodType: UsagePeriodType
  periodStart: string
  usedCount: number
  limitValue: number
  remaining: number
}

export type SubscriptionSummary = {
  status: string
  billingPeriod: string | null
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  canceledAt: string | null
} | null

export type OrderSummary = {
  id: string
  status: string
  type: string
  amount: number | null
  currency: string
  createdAt: string
  planKey: string | null
}

export type EntitlementResponse = {
  user: {
    id: string
    email: string | null
  }
  product: {
    id: string
    productKey: string
  }
  plan: {
    id: string
    planKey: string
    billingType: BillingType
  }
  entitlement: {
    id: string | null
    status: EntitlementStatus
    expiresAt: string | null
  }
  features: Record<string, boolean>
  quotas: Record<string, { period: UsagePeriodType; limit: number }>
  maxInstallations: number
  usage: UsageCounter[]
  subscription: SubscriptionSummary
  orders: OrderSummary[]
}

export type ConsumeUsageResponse = {
  allowed: boolean
  errorCode?: string
  used?: number
  limit?: number
  remaining?: number
  planKey?: string
}

export type CheckoutSessionResponse = {
  checkoutUrl: string
  sessionId: string
  localOrderId: string
}

export type InstallationResponse = {
  registered: boolean
  errorCode?: string
  currentInstallations?: number
  maxInstallations?: number
  installation?: {
    id: string
    installation_id: string
    status: string
  }
}

export type ExtensionMessageRequest =
  | { type: 'GET_AUTH_STATE' }
  | { type: 'SEND_OTP'; email: string }
  | { type: 'VERIFY_OTP'; email: string; token: string }
  | { type: 'SIGN_OUT' }
  | { type: 'REFRESH_ENTITLEMENT'; productKey: string }
  | { type: 'REGISTER_INSTALLATION'; productKey: string; installationId: string; extensionId?: string; browser?: string; version?: string }
  | { type: 'CREATE_CHECKOUT'; productKey: string; planKey: string; installationId?: string; extensionId?: string; source?: 'web' | 'chrome_extension'; successUrl?: string; cancelUrl?: string }
  | { type: 'CONSUME_USAGE'; productKey: string; featureKey: string; amount?: number; installationId?: string }

export type ExtensionMessageResponse<T = unknown> = {
  ok: boolean
  data?: T
  error?: string
}
