import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { EntitlementResponse } from '@membership/extension-sdk'
import { useAuth } from '../auth/AuthProvider'
import { formatMoney } from '../content/leadfill'
import { fetchEntitlement } from '../lib/api'
import { env } from '../lib/env'

export function AccountPage() {
  const { user, signOut } = useAuth()
  const [params] = useSearchParams()
  const [entitlement, setEntitlement] = useState<EntitlementResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const selectedProductKey = params.get('productKey') ?? env.productKey

  useEffect(() => {
    if (!user) {
      return
    }

    void refreshEntitlement(selectedProductKey)
  }, [selectedProductKey, user])

  async function refreshEntitlement(productKey: string) {
    setRefreshing(true)
    setError(null)

    try {
      const result = await fetchEntitlement(productKey)
      setEntitlement(result)
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'ENTITLEMENT_LOOKUP_FAILED')
    } finally {
      setRefreshing(false)
    }
  }

  if (!user) {
    return (
      <section className="page-grid narrow-page">
        <div className="page-heading compact-heading">
          <p className="eyebrow">Account</p>
          <h1>Sign in with email OTP.</h1>
          <p className="muted">
            Use the same email you used for checkout to manage membership, orders, and usage.
          </p>
        </div>

        <div className="card auth-card">
          <h2>Email-only sign in</h2>
          <p className="muted">
            LeadFill uses email OTP for account access. After payment, come back here or open the
            extension and refresh membership.
          </p>
          <div className="action-row">
            <Link className="button primary" to={`/login?next=${encodeURIComponent(`/account?productKey=${selectedProductKey}`)}`}>
              Continue with email
            </Link>
            <Link className="button subtle" to="/pricing">View pricing</Link>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="page-grid">
      <div className="page-heading compact-heading">
        <p className="eyebrow">Account</p>
        <h1>Membership, usage, and orders</h1>
        <p className="muted">
          This is the operational page for LeadFill. Use it to refresh membership after checkout
          and review your current account state.
        </p>
      </div>

      <div className="action-row">
        <button
          className="button primary"
          type="button"
          onClick={() => refreshEntitlement(selectedProductKey)}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing membership...' : 'Refresh membership'}
        </button>
        <Link className="button subtle" to="/pricing">Open pricing</Link>
        <button className="button subtle" type="button" onClick={() => signOut()}>
          Sign out
        </button>
      </div>

      {error ? <div className="card error-card">{error}</div> : null}

      <div className="account-grid">
        <section className="card account-card">
          <p className="eyebrow">Membership</p>
          <h2>{entitlement?.plan.planKey ?? 'Loading plan...'}</h2>
          <ul className="compact-list">
            <li>Email: {user.email ?? '-'}</li>
            <li>Status: {entitlement?.entitlement.status ?? 'Loading'}</li>
            <li>Product: {selectedProductKey}</li>
            <li>Max installations: {entitlement?.maxInstallations ?? '-'}</li>
            <li>Expires: {entitlement?.entitlement.expiresAt ?? 'No expiry set'}</li>
          </ul>
        </section>

        <section className="card account-card">
          <p className="eyebrow">Usage</p>
          <h2>Current allowance</h2>
          {entitlement?.usage?.length ? (
            <ul className="compact-list">
              {entitlement.usage.map((item) => (
                <li key={`${item.featureKey}-${item.periodType}`}>
                  {item.featureKey}: used {item.usedCount}, remaining {item.remaining}, period {item.periodType}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              Usage details appear here after the API returns your current allowance.
            </p>
          )}
        </section>

        <section className="card account-card">
          <p className="eyebrow">Orders</p>
          <h2>Payment history</h2>
          {entitlement?.orders?.length ? (
            <ul className="compact-list">
              {entitlement.orders.map((order) => (
                <li key={order.id}>
                  {formatMoney(order.amount, order.currency)} / {order.status} /{' '}
                  {new Date(order.createdAt).toLocaleString()}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No orders are recorded for this account yet.</p>
          )}
        </section>
      </div>
    </section>
  )
}
