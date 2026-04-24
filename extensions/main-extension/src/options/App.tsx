import { useEffect, useState } from 'react'
import type {
  EntitlementResponse,
  InstallationResponse,
  SessionSnapshot,
} from '@membership/extension-sdk'
import { getRemainingText } from '@membership/extension-sdk'
import { config } from '../config'
import { getProductPricingPortalPath, openPortal, sendRuntimeMessage } from '../shared/runtime'

type AuthState = {
  session: SessionSnapshot | null
  installationId: string
  entitlement: EntitlementResponse | null
}

export function App() {
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [authState, setAuthState] = useState<AuthState | null>(null)
  const [status, setStatus] = useState<string>('background ready')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const entitlement = authState?.entitlement ?? null
  const featureEnabled = Boolean(entitlement?.features?.[config.featureKey])

  useEffect(() => {
    void hydrate()
  }, [])

  async function hydrate() {
    const response = await sendRuntimeMessage<AuthState>({ type: 'GET_AUTH_STATE' })
    if (!response.ok || !response.data) {
      setError(response.error ?? 'GET_AUTH_STATE_FAILED')
      return
    }

    setAuthState(response.data)
  }

  async function runAction(action: string, task: () => Promise<void>) {
    setPending(action)
    setError(null)

    try {
      await task()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'REQUEST_FAILED')
    } finally {
      setPending(null)
    }
  }

  async function sendOtp() {
    await runAction('send-otp', async () => {
      const response = await sendRuntimeMessage({ type: 'SEND_OTP', email })
      if (!response.ok) {
        throw new Error(response.error)
      }
      setStatus('OTP email sent')
    })
  }

  async function verifyOtp() {
    await runAction('verify-otp', async () => {
      const response = await sendRuntimeMessage<SessionSnapshot>({ type: 'VERIFY_OTP', email, token })
      if (!response.ok || !response.data) {
        throw new Error(response.error)
      }

      setStatus(`Logged in as ${response.data.user.email ?? 'unknown'}`)
      await refreshEntitlement()
      await registerInstallation()
      await hydrate()
    })
  }

  async function refreshEntitlement() {
    const response = await sendRuntimeMessage<EntitlementResponse>({
      type: 'REFRESH_ENTITLEMENT',
      productKey: config.productKey,
    })
    if (!response.ok || !response.data) {
      throw new Error(response.error)
    }
    setStatus(`Entitlement refreshed: ${response.data.plan.planKey}`)
    setAuthState((current) => current ? { ...current, entitlement: response.data ?? null } : current)
  }

  async function registerInstallation() {
    const response = await sendRuntimeMessage<InstallationResponse>({
      type: 'REGISTER_INSTALLATION',
      productKey: config.productKey,
      installationId: authState?.installationId ?? crypto.randomUUID(),
      extensionId: chrome.runtime.id,
      browser: 'chrome',
      version: chrome.runtime.getManifest().version,
    })

    if (!response.ok || !response.data?.registered) {
      throw new Error(response.error ?? response.data?.errorCode ?? 'REGISTER_INSTALLATION_FAILED')
    }

    setStatus(`Installation registered: ${response.data.currentInstallations}/${response.data.maxInstallations}`)
  }

  async function signOut() {
    await runAction('sign-out', async () => {
      const response = await sendRuntimeMessage({ type: 'SIGN_OUT' })
      if (!response.ok) {
        throw new Error(response.error)
      }

      setStatus('Signed out')
      await hydrate()
    })
  }

  return (
    <div className="surface stack">
      <section className="card stack">
        <div>
          <p className="eyebrow">Options</p>
          <h2>Membership Control Panel</h2>
          <p className="muted">The background service worker stores tokens. The page only sends runtime messages.</p>
        </div>

        <label className="field">
          <span>Email</span>
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" type="email" />
        </label>

        <div className="button-row">
          <button className="button primary" type="button" onClick={() => void sendOtp()} disabled={pending !== null}>
            {pending === 'send-otp' ? 'Sending...' : 'Send OTP'}
          </button>
          <button className="button secondary" type="button" onClick={() => openPortal('/login')}>
            Open website login
          </button>
        </div>

        <label className="field">
          <span>OTP code</span>
          <input value={token} onChange={(event) => setToken(event.target.value)} placeholder="6-digit code" />
        </label>

        <button className="button full primary" type="button" onClick={() => void verifyOtp()} disabled={pending !== null}>
          {pending === 'verify-otp' ? 'Verifying...' : 'Verify and sign in'}
        </button>
      </section>

      <section className="card stack">
        <div>
          <p className="eyebrow">Current State</p>
          <h3>User and entitlement</h3>
        </div>

        <ul className="list">
          <li>user: {authState?.session?.user.email ?? 'not logged in'}</li>
          <li>productKey: {config.productKey}</li>
          <li>featureKey: {config.featureKey}</li>
          <li>installationId: {authState?.installationId ?? '-'}</li>
          <li>plan: {entitlement?.plan.planKey ?? 'free / not refreshed'}</li>
          <li>status: {entitlement?.entitlement.status ?? '-'}</li>
          <li>{config.featureKey}: {getRemainingText(entitlement, config.featureKey)}</li>
          <li>feature_access: {featureEnabled ? 'enabled' : 'disabled'}</li>
        </ul>

        <div className="button-row">
          <button className="button primary" type="button" onClick={() => void runAction('refresh', refreshEntitlement)} disabled={pending !== null}>
            Refresh entitlement
          </button>
          <button className="button secondary" type="button" onClick={() => void runAction('register', registerInstallation)} disabled={pending !== null}>
            Register installation
          </button>
        </div>

        <div className="action-line">
          <button className="button subtle" type="button" onClick={() => openPortal('/account')}>Open account</button>
          <button
            className="button subtle"
            type="button"
            onClick={() =>
              openPortal(
                getProductPricingPortalPath({
                  installationId: authState?.installationId,
                  extensionId: chrome.runtime.id || config.extensionId,
                }),
              )
            }
          >
            Open pricing
          </button>
          <button className="button subtle" type="button" onClick={() => void signOut()}>Sign out</button>
        </div>

        <p className={error ? 'status error' : 'status'}>{error ?? status}</p>
      </section>
    </div>
  )
}
