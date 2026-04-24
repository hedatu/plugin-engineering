import { useEffect, useState } from 'react'
import type { ConsumeUsageResponse, EntitlementResponse, SessionSnapshot } from '@membership/extension-sdk'
import { getRemainingText, getUsageErrorMessage, isFeatureEnabled } from '@membership/extension-sdk'
import { config } from '../config'
import { getProductPricingPortalPath, openPortal, sendRuntimeMessage } from '../shared/runtime'

type AuthState = {
  session: SessionSnapshot | null
  installationId: string
  entitlement: EntitlementResponse | null
}

export function App() {
  const [authState, setAuthState] = useState<AuthState | null>(null)
  const [status, setStatus] = useState('Loading background state...')
  const featureKey = config.featureKey

  useEffect(() => {
    void hydrate()
  }, [])

  async function hydrate() {
    const response = await sendRuntimeMessage<AuthState>({ type: 'GET_AUTH_STATE' })
    if (!response.ok || !response.data) {
      setStatus(response.error ?? 'GET_AUTH_STATE_FAILED')
      return
    }

    setAuthState(response.data)
    setStatus(response.data.session ? 'Logged in and ready to verify usage.' : 'Not logged in. Open options to sign in.')
  }

  async function refreshEntitlement() {
    const response = await sendRuntimeMessage<EntitlementResponse>({
      type: 'REFRESH_ENTITLEMENT',
      productKey: config.productKey,
    })

    if (!response.ok || !response.data) {
      setStatus(response.error ?? 'REFRESH_FAILED')
      return
    }

    setAuthState((current) => current ? { ...current, entitlement: response.data ?? null } : current)
    setStatus(`Refreshed: ${response.data.plan.planKey}`)
  }

  async function runFeature() {
    const response = await sendRuntimeMessage<ConsumeUsageResponse>({
      type: 'CONSUME_USAGE',
      productKey: config.productKey,
      featureKey,
      amount: 1,
      installationId: authState?.installationId,
    })

    if (!response.ok || !response.data) {
      setStatus(response.error ?? 'CONSUME_USAGE_FAILED')
      return
    }

    if (!response.data.allowed) {
      setStatus(getUsageErrorMessage(response.data))
      return
    }

    setStatus(`${featureKey} verified by the server, remaining ${response.data.remaining ?? -1}`)
    await refreshEntitlement()
  }

  const entitlement = authState?.entitlement ?? null
  const featureEnabled = isFeatureEnabled(entitlement, featureKey)

  return (
    <div className="surface stack">
      <section className="card stack">
        <div>
          <p className="eyebrow">Popup</p>
          <h3>Membership state</h3>
        </div>
        <ul className="list">
          <li>user: {authState?.session?.user.email ?? 'not logged in'}</li>
          <li>plan: {entitlement?.plan.planKey ?? 'free'}</li>
          <li>status: {entitlement?.entitlement.status ?? '-'}</li>
          <li>featureKey: {featureKey}</li>
          <li>{featureKey} remaining: {getRemainingText(entitlement, featureKey)}</li>
          <li>pro_access: {featureEnabled ? 'enabled' : 'upgrade required'}</li>
        </ul>
      </section>

      <section className="card stack">
        <div className="button-row">
          <button className="button primary" type="button" onClick={() => void runFeature()}>
            Use {featureKey}
          </button>
        </div>

        <div className="button-row">
          <button className="button subtle" type="button" onClick={() => void refreshEntitlement()}>
            Refresh entitlement
          </button>
          <button className="button subtle" type="button" onClick={() => chrome.runtime.openOptionsPage()}>
            Open options
          </button>
        </div>

        {!featureEnabled ? (
          <button
            className="button full subtle"
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
            Upgrade {featureKey}
          </button>
        ) : null}

        <p className="status">{status}</p>
      </section>
    </div>
  )
}
