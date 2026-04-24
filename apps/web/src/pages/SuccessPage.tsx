import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { EntitlementResponse } from '@membership/extension-sdk'
import { getDefaultProductPath } from '../content/productCatalog'
import { fetchEntitlement } from '../lib/api'
import { env } from '../lib/env'

const POLL_INTERVAL_MS = 5_000
const MAX_POLLS = 12

export function SuccessPage() {
  const [params] = useSearchParams()
  const [result, setResult] = useState<EntitlementResponse | null>(null)
  const [status, setStatus] = useState('Checking membership status...')
  const timerRef = useRef<number | null>(null)
  const productKey = useMemo(() => params.get('productKey') ?? env.productKey, [params])

  useEffect(() => {
    let disposed = false
    let polls = 0

    async function poll() {
      try {
        const entitlement = await fetchEntitlement(productKey)
        if (disposed) {
          return
        }

        setResult(entitlement)

        if (entitlement.plan.planKey !== 'free' && entitlement.entitlement.status === 'active') {
          setStatus(`Membership confirmed. Current plan: ${entitlement.plan.planKey}`)
          return
        }

        polls += 1
        if (polls >= MAX_POLLS) {
          setStatus('Payment completed. Membership is still syncing. Open Account and refresh membership.')
          return
        }

        setStatus('Checking membership status...')
        timerRef.current = window.setTimeout(poll, POLL_INTERVAL_MS)
      } catch {
        polls += 1
        if (polls >= MAX_POLLS) {
          setStatus('Unable to confirm membership yet. Return to Account and refresh membership there.')
          return
        }

        timerRef.current = window.setTimeout(poll, POLL_INTERVAL_MS)
      }
    }

    void poll()

    return () => {
      disposed = true
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [productKey])

  return (
    <section className="page-grid narrow-page">
      <div className="surface-card status-card status-minimal">
        <p className="eyebrow">Payment received</p>
        <h1>Payment received</h1>
        <p className="muted">
          Return to the extension or account page and refresh membership. Paid access appears after
          backend confirmation.
        </p>
        <div className="status-banner">
          <strong>Status:</strong> {status}
        </div>
        <p className="muted">
          This page does not unlock Pro locally.
        </p>
        <div className="action-row">
          <Link className="button primary" to={`/account?productKey=${productKey}`}>Open account</Link>
          <Link className="button subtle" to={getDefaultProductPath()}>Back to product</Link>
        </div>
      </div>

      {result ? (
        <div className="soft-card">
          <p className="eyebrow">Membership snapshot</p>
          <h2>Current account state</h2>
          <ul className="compact-list">
            <li>Product: {result.product.productKey}</li>
            <li>Plan: {result.plan.planKey}</li>
            <li>Status: {result.entitlement.status}</li>
            <li>Expires: {result.entitlement.expiresAt ?? 'No expiry set'}</li>
          </ul>
        </div>
      ) : null}
    </section>
  )
}
