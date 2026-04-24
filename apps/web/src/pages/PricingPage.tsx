import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import {
  formatPlanHeadline,
  getDefaultProductPath,
  getFreePlan,
  getPaidPlan,
  getPlanBullets,
  leadfillFallbackProduct,
} from '../content/leadfill'
import { createCheckoutSession } from '../lib/api'
import type { ProductWithPlans } from '../lib/catalog'
import { getProductWithPlans } from '../lib/catalog'
import { env } from '../lib/env'

export function PricingPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [params] = useSearchParams()
  const [product, setProduct] = useState<ProductWithPlans | null>(leadfillFallbackProduct)
  const [error, setError] = useState<string | null>(null)
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null)

  const selectedProductKey = params.get('productKey') ?? env.productKey

  useEffect(() => {
    let active = true

    void getProductWithPlans(selectedProductKey)
      .then((result) => {
        if (!active) {
          return
        }

        if (result) {
          setProduct(result)
          return
        }

        setProduct(leadfillFallbackProduct)
      })
      .catch((fetchError) => {
        if (active) {
          setProduct(leadfillFallbackProduct)
          console.warn(fetchError)
        }
      })

    return () => {
      active = false
    }
  }, [selectedProductKey])

  const freePlan = useMemo(() => getFreePlan(product), [product])
  const paidPlan = useMemo(() => getPaidPlan(product), [product])
  const productPath = getDefaultProductPath()

  async function handleCheckout(planKey: string) {
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`/pricing?productKey=${selectedProductKey}`)}&plan=${planKey}`)
      return
    }

    setCheckoutPlan(planKey)
    setError(null)

    try {
      const result = await createCheckoutSession({
        productKey: selectedProductKey,
        planKey,
        source: 'web',
      })
      window.location.href = result.checkoutUrl
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : 'CREATE_CHECKOUT_FAILED')
    } finally {
      setCheckoutPlan(null)
    }
  }

  return (
    <section className="page-grid">
      <div className="page-heading compact-heading">
        <p className="eyebrow">Pricing</p>
        <h1>Two options. One product. No subscription.</h1>
        <p className="muted">
          Try LeadFill for free, then unlock unlimited usage with a single payment if it saves you
          time.
        </p>
        <div className="hero-meta">
          <span>10 free fills</span>
          <span>{formatPlanHeadline(paidPlan)}</span>
          <span>Local-only</span>
        </div>
      </div>

      {error ? <div className="card error-card">{error}</div> : null}

      <div className="compare-grid">
        <article className="card pricing-card pricing-card-soft">
          <p className="plan-tag">Free</p>
          <h2>{formatPlanHeadline(freePlan) === 'Free' ? '10 free fills' : formatPlanHeadline(freePlan)}</h2>
          <p className="muted">A clean way to test the product before you pay.</p>
          <ul className="compact-list">
            {getPlanBullets(freePlan).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="pricing-actions">
            <Link className="button subtle" to={productPath}>View product</Link>
          </div>
        </article>

        <article className="card pricing-card pricing-card-strong">
          <p className="plan-tag">Lifetime Unlock</p>
          <h2>{formatPlanHeadline(paidPlan)}</h2>
          <p className="muted">Unlimited fills with a one-time payment. No recurring bill.</p>
          <ul className="compact-list">
            {getPlanBullets(paidPlan).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="pricing-actions">
            {paidPlan ? (
              <button
                type="button"
                className="button primary"
                onClick={() => handleCheckout(paidPlan.plan_key)}
                disabled={checkoutPlan === paidPlan.plan_key}
              >
                {checkoutPlan === paidPlan.plan_key ? 'Creating checkout...' : 'Unlock Lifetime'}
              </button>
            ) : null}
          </div>
        </article>
      </div>

      <div className="note-grid">
        <section className="card note-card">
          <p className="eyebrow">How payment works</p>
          <h2>Checkout stays outside the extension.</h2>
          <p className="muted">
            Sign in with email OTP, open checkout from LeadFill, and complete payment on the hosted
            payment page.
          </p>
        </section>

        <section className="card note-card">
          <p className="eyebrow">After you pay</p>
          <h2>Refresh membership with the same email.</h2>
          <p className="muted">
            Your account and extension read the refreshed membership after the backend verifies the
            payment event and records the entitlement update.
          </p>
          <div className="action-row">
            <Link className="button subtle" to="/account">Open account</Link>
            <Link className="button subtle" to="/login">Sign in</Link>
          </div>
        </section>
      </div>
    </section>
  )
}
