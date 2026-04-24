import type {
  CheckoutSessionResponse,
  ConsumeUsageResponse,
  EntitlementResponse,
  ExtensionMessageRequest,
  ExtensionMessageResponse,
  InstallationResponse,
  SessionSnapshot,
} from '@membership/extension-sdk'
import { isSessionExpired } from '@membership/extension-sdk'
import { config } from '../config'

const STORAGE_KEYS = {
  installationId: 'membership.installationId',
  session: 'membership.session',
  entitlement: `membership.entitlement.${config.productKey}`,
} as const

type AuthResponseUser = {
  id: string
  email?: string | null
}

type AuthSessionPayload = {
  access_token?: string
  refresh_token?: string
  expires_at?: number | null
  user?: AuthResponseUser | null
  error?: string
  error_description?: string
  msg?: string
}

async function getStorageValue<T>(key: string): Promise<T | null> {
  const result = await chrome.storage.local.get(key)
  return (result[key] as T | undefined) ?? null
}

async function setStorageValue<T>(key: string, value: T) {
  await chrome.storage.local.set({ [key]: value })
}

async function removeStorageValue(key: string) {
  await chrome.storage.local.remove(key)
}

async function getStoredSession() {
  return getStorageValue<SessionSnapshot>(STORAGE_KEYS.session)
}

async function saveSession(session: SessionSnapshot) {
  await setStorageValue(STORAGE_KEYS.session, session)
}

async function clearSession() {
  await removeStorageValue(STORAGE_KEYS.session)
  await removeStorageValue(STORAGE_KEYS.entitlement)
}

async function ensureInstallationId() {
  const existing = await getStorageValue<string>(STORAGE_KEYS.installationId)
  if (existing) {
    return existing
  }

  const nextValue = crypto.randomUUID()
  await setStorageValue(STORAGE_KEYS.installationId, nextValue)
  return nextValue
}

function buildAuthHeaders() {
  const siteUrl = config.siteUrl.replace(/\/+$/, '')
  return {
    'Content-Type': 'application/json',
    apikey: config.supabaseAnonKey,
    Origin: siteUrl,
    Referer: `${siteUrl}/login`,
  }
}

async function callAuthEndpoint<T>(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${config.supabaseUrl}/auth/v1${path}`, {
    method: 'POST',
    headers: buildAuthHeaders(),
    body: JSON.stringify(body),
  })

  const text = await response.text()
  const json = text ? JSON.parse(text) : {}

  if (!response.ok) {
    throw new Error(json.error_description ?? json.msg ?? json.error ?? 'AUTH_REQUEST_FAILED')
  }

  return json as T
}

function toSessionSnapshot(payload: AuthSessionPayload): SessionSnapshot {
  if (!payload.access_token || !payload.refresh_token || !payload.user?.id) {
    throw new Error('INVALID_AUTH_SESSION')
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: typeof payload.expires_at === 'number' ? payload.expires_at * 1000 : null,
    user: {
      id: payload.user.id,
      email: payload.user.email ?? null,
    },
  }
}

async function refreshSession(refreshToken: string) {
  const payload = await callAuthEndpoint<AuthSessionPayload>('/token?grant_type=refresh_token', {
    refresh_token: refreshToken,
  })
  return toSessionSnapshot(payload)
}

async function ensureValidSession() {
  const current = await getStoredSession()
  if (!current) {
    throw new Error('LOGIN_REQUIRED')
  }

  if (!isSessionExpired(current)) {
    return current
  }

  try {
    const refreshed = await refreshSession(current.refreshToken)
    await saveSession(refreshed)
    return refreshed
  } catch {
    await clearSession()
    throw new Error('LOGIN_REQUIRED')
  }
}

async function invokeFunction<T>(functionName: string, body: unknown) {
  const session = await ensureValidSession()

  const response = await fetch(`${config.supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
      apikey: config.supabaseAnonKey,
    },
    body: JSON.stringify(body),
  })

  const text = await response.text()
  const json = text ? JSON.parse(text) : {}

  if (!response.ok) {
    throw new Error(json.error ?? json.errorCode ?? 'REQUEST_FAILED')
  }

  return json as T
}

async function sendOtp(email: string) {
  await callAuthEndpoint('/otp', {
    email,
    create_user: true,
  })
}

async function verifyOtp(email: string, token: string) {
  const payload = await callAuthEndpoint<AuthSessionPayload>('/verify', {
    email,
    token,
    type: 'email',
  })

  const snapshot = toSessionSnapshot(payload)
  await saveSession(snapshot)
  return snapshot
}

async function getAuthState() {
  const session = await getStoredSession()
  const installationId = await ensureInstallationId()
  const entitlement = await getStorageValue<EntitlementResponse>(STORAGE_KEYS.entitlement)

  return {
    session,
    installationId,
    entitlement,
  }
}

async function refreshEntitlement(productKey: string) {
  const entitlement = await invokeFunction<EntitlementResponse>('get-entitlement', { productKey })
  await setStorageValue(STORAGE_KEYS.entitlement, entitlement)
  return entitlement
}

async function registerInstallation(payload: Extract<ExtensionMessageRequest, { type: 'REGISTER_INSTALLATION' }>) {
  const installationId = payload.installationId || await ensureInstallationId()
  return invokeFunction<InstallationResponse>('register-installation', {
    productKey: payload.productKey,
    installationId,
    extensionId: payload.extensionId || chrome.runtime.id || config.extensionId,
    browser: payload.browser || 'chrome',
    version: payload.version || chrome.runtime.getManifest().version,
  })
}

async function createCheckout(payload: Extract<ExtensionMessageRequest, { type: 'CREATE_CHECKOUT' }>) {
  return invokeFunction<CheckoutSessionResponse>('create-checkout-session', {
    productKey: payload.productKey,
    planKey: payload.planKey,
    installationId: payload.installationId ?? await ensureInstallationId(),
    extensionId: payload.extensionId || chrome.runtime.id || config.extensionId,
    successUrl: payload.successUrl,
    cancelUrl: payload.cancelUrl,
    source: payload.source ?? 'chrome_extension',
  })
}

async function consumeUsage(payload: Extract<ExtensionMessageRequest, { type: 'CONSUME_USAGE' }>) {
  return invokeFunction<ConsumeUsageResponse>('consume-usage', {
    productKey: payload.productKey,
    featureKey: payload.featureKey,
    amount: payload.amount ?? 1,
    installationId: payload.installationId ?? await ensureInstallationId(),
  })
}

async function handleMessage(message: ExtensionMessageRequest): Promise<ExtensionMessageResponse> {
  switch (message.type) {
    case 'GET_AUTH_STATE':
      return { ok: true, data: await getAuthState() }
    case 'SEND_OTP':
      await sendOtp(message.email)
      return { ok: true, data: { sent: true } }
    case 'VERIFY_OTP':
      return { ok: true, data: await verifyOtp(message.email, message.token) }
    case 'SIGN_OUT':
      await clearSession()
      return { ok: true, data: { signedOut: true } }
    case 'REFRESH_ENTITLEMENT':
      return { ok: true, data: await refreshEntitlement(message.productKey) }
    case 'REGISTER_INSTALLATION':
      return { ok: true, data: await registerInstallation(message) }
    case 'CREATE_CHECKOUT':
      return { ok: true, data: await createCheckout(message) }
    case 'CONSUME_USAGE':
      return { ok: true, data: await consumeUsage(message) }
    default:
      return { ok: false, error: 'UNSUPPORTED_MESSAGE' }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureInstallationId()
})

chrome.runtime.onStartup.addListener(() => {
  void ensureInstallationId()
})

chrome.runtime.onMessage.addListener((message: ExtensionMessageRequest, _sender, sendResponse) => {
  void handleMessage(message)
    .then((result) => sendResponse(result))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
      })
    })

  return true
})
