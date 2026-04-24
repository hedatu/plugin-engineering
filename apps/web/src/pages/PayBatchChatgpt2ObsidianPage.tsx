import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { createCheckoutSession } from '../lib/api'
import { env } from '../lib/env'

const payPath = '/pay/pay-for-batch-chatgpt2obsidian.html'

const sellingPoints = [
  'Unlock batch export for ChatGPT to Obsidian workflows.',
  'Bind membership to your Supabase account and extension installation.',
  'Payment activation is webhook-driven, not success-page driven.',
]

const includedItems = [
  'Batch export enabled',
  'Unlimited single export quota',
  'Unlimited monthly batch export quota',
  'Up to 5 active installations',
]

export function PayBatchChatgpt2ObsidianPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [pendingPlan, setPendingPlan] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function startCheckout(planKey: 'one_time_test' | 'lifetime') {
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(payPath)}&plan=${planKey}`)
      return
    }

    setPendingPlan(planKey)
    setError(null)

    try {
      const result = await createCheckoutSession({
        productKey: env.productKey,
        planKey,
        source: 'web',
      })
      window.location.href = result.checkoutUrl
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : 'CREATE_CHECKOUT_FAILED')
    } finally {
      setPendingPlan(null)
    }
  }

  return (
    <section className="pay-page">
      <div className="pay-hero card">
        <div className="pay-hero-copy">
          <p className="eyebrow">Direct Checkout</p>
          <h2>Pay for Batch ChatGPT to Obsidian</h2>
          <p className="muted pay-lead">
            Single-purpose checkout landing page for the extension upgrade flow. This page opens a
            server-created Waffo checkout and leaves membership activation to the webhook.
          </p>

          <div className="pay-pill-row">
            <span className="pay-pill">Product: {env.productKey}</span>
            <span className="pay-pill">Mode: Waffo Test</span>
            <span className="pay-pill">Success URL: /checkout/success</span>
          </div>

          <ul className="compact-list pay-list">
            {sellingPoints.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>

          <div className="action-row">
            <button
              type="button"
              className="button primary"
              onClick={() => startCheckout('one_time_test')}
              disabled={pendingPlan !== null}
            >
              {pendingPlan === 'one_time_test' ? 'Creating test checkout...' : 'Buy Test Access'}
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => startCheckout('lifetime')}
              disabled={pendingPlan !== null}
            >
              {pendingPlan === 'lifetime' ? 'Creating lifetime checkout...' : 'Buy Lifetime'}
            </button>
          </div>

          <p className="pay-note">
            Not logged in yet? The checkout button will redirect you to login first. Returning to
            this page does not grant membership by itself.
          </p>

          {error ? <div className="card error-card">{error}</div> : null}
        </div>

        <aside className="pay-offer card">
          <p className="eyebrow">Offer</p>
          <h3>Batch export unlock</h3>
          <p className="pay-price">USD 49.00</p>
          <p className="muted">
            Current test product is mapped to both <code>one_time_test</code> and{' '}
            <code>lifetime</code> in the local billing model.
          </p>
          <ul className="compact-list">
            {includedItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="pay-meta">
            <span>Signed in user: {user?.email ?? 'Not signed in'}</span>
            <span>Webhook endpoint: hwh-api.915500.xyz</span>
          </div>
        </aside>
      </div>

      <div className="pay-sections">
        <article className="card pay-info-card">
          <p className="eyebrow">How it works</p>
          <h3>Checkout flow</h3>
          <ol className="pay-steps">
            <li>Login with Supabase email OTP.</li>
            <li>Click the checkout button on this page.</li>
            <li>The server creates a Waffo checkout session.</li>
            <li>Waffo redirects to success after payment.</li>
            <li>The webhook updates orders, payments, and entitlements.</li>
            <li>This site or the extension polls entitlement status.</li>
          </ol>
        </article>

        <article className="card pay-info-card">
          <p className="eyebrow">Guardrails</p>
          <h3>What this page does not do</h3>
          <ul className="compact-list">
            <li>It does not expose Waffo private keys.</li>
            <li>It does not create membership on the success page.</li>
            <li>It does not bypass login or JWT checks.</li>
            <li>It does not trust client-side payment state.</li>
          </ul>
        </article>

        <article className="card pay-info-card">
          <p className="eyebrow">Links</p>
          <h3>Open related pages</h3>
          <div className="action-row">
            <Link className="button subtle" to="/pricing">Open Pricing</Link>
            <Link className="button subtle" to="/account">Open Account</Link>
            <Link className="button subtle" to="/privacy">Privacy</Link>
            <Link className="button subtle" to="/terms">Terms</Link>
          </div>
        </article>
      </div>
    </section>
  )
}
