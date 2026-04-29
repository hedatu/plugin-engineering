import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { BrandMark } from '../components/BrandMark'
import {
  formatPlanHeadline,
  getFreePlan,
  getPaidPlan,
  getPlanBullets,
  leadfillSupportEmail,
} from '../content/leadfill'
import {
  buildCheckoutStartPath,
  getDefaultPricingPath,
  getProductCheckoutMode,
  getProductPath,
  isProductPendingReview,
  fallbackProductsWithPlans,
  leadfillFallbackProduct,
  leadfillProductKey,
} from '../content/productCatalog'
import type { ProductWithPlans } from '../lib/catalog'
import { getProductWithPlansBySlug } from '../lib/catalog'

function getFallbackProductBySlug(slug?: string) {
  return fallbackProductsWithPlans.find((product) => product.slug === slug) ?? null
}

export function PricingPage() {
  const { slug } = useParams()
  const { user } = useAuth()
  const [params] = useSearchParams()
  const [product, setProduct] = useState<ProductWithPlans | null>(leadfillFallbackProduct)
  const [notFound, setNotFound] = useState(false)

  const source = params.get('source') === 'chrome_extension' ? 'chrome_extension' : 'web'
  const installationId = params.get('installationId')
  const extensionId = params.get('extensionId')

  useEffect(() => {
    let active = true

    if (!slug) {
      setNotFound(true)
      return () => {
        active = false
      }
    }

    void getProductWithPlansBySlug(slug)
      .then((result) => {
        if (!active) {
          return
        }

        if (result) {
          setProduct(result)
          setNotFound(false)
          return
        }

        const fallbackProduct = getFallbackProductBySlug(slug)
        if (fallbackProduct) {
          setProduct(fallbackProduct)
          setNotFound(false)
          return
        }

        setNotFound(true)
      })
      .catch((fetchError) => {
        if (active) {
          console.warn(fetchError)
          const fallbackProduct = getFallbackProductBySlug(slug)
          if (fallbackProduct) {
            setProduct(fallbackProduct)
            setNotFound(false)
          } else {
            setNotFound(true)
          }
        }
      })

    return () => {
      active = false
    }
  }, [slug])

  const freePlan = useMemo(() => getFreePlan(product), [product])
  const paidPlan = useMemo(() => getPaidPlan(product), [product])
  const paidPlans = useMemo(() => product?.plans.filter((plan) => plan.billing_type !== 'free') ?? [], [product])
  const productPath = getProductPath(product)
  const checkoutMode = getProductCheckoutMode(product)
  const pendingReview = isProductPendingReview(product)
  const isLeadFill = product?.product_key === leadfillProductKey
  const pricingPlans = isLeadFill ? (paidPlan ? [paidPlan] : []) : paidPlans

  if (!slug) {
    return <Navigate to={getDefaultPricingPath()} replace />
  }

  if (notFound || !product) {
    return <Navigate to="/products" replace />
  }

  return (
    <section className="page-grid">
      <div className="page-heading compact-heading">
        <div className="brand-inline">
          <BrandMark size="sm" />
          <p className="eyebrow">Pricing</p>
        </div>
        <h1>{isLeadFill ? 'Simple pricing for LeadFill One Profile' : `${product.name} pricing`}</h1>
        <p className="muted">
          {pendingReview
            ? 'This plugin is waiting for Google review. Plans are visible now, but checkout will open after approval.'
            : 'Start with 10 free fills. Unlock lifetime access when LeadFill becomes part of your workflow.'}
        </p>
        <div className="hero-meta">
          {pendingReview ? <span>Pending launch</span> : <span>10 free fills</span>}
          <span>{isLeadFill ? '$19 one-time' : 'Monthly / annual / lifetime'}</span>
          <span>Local-first</span>
          <span>{pendingReview ? 'Checkout paused' : 'No subscription'}</span>
        </div>
      </div>

      <div className="compare-grid">
        {isLeadFill ? (
          <article className="soft-card pricing-card">
            <p className="plan-tag">Free</p>
            <h2>10 free fills</h2>
            <p className="muted">Use the free tier first, then decide later if the lifetime unlock is worth it.</p>
            <ul className="compact-list">
              {getPlanBullets(freePlan).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <div className="pricing-actions">
              <Link className="button subtle" to={productPath}>View product</Link>
            </div>
          </article>
        ) : null}

        {pricingPlans.map((plan) => (
          <article key={plan.id} className="surface-card pricing-card pricing-card-strong">
            <p className="plan-tag">{plan.name}</p>
            <h2>{plan.amount === 39.9 ? '$39.90 lifetime' : plan.amount === 29 ? '$29 annual' : plan.amount === 9 ? '$9 monthly' : formatPlanHeadline(plan)}</h2>
            <p className="muted">
              {pendingReview
                ? 'Purchase opens after Google approves the Chrome Web Store listing.'
                : 'Unlimited fills with one payment. No subscription and no recurring bill.'}
            </p>
            <ul className="compact-list">
              {(isLeadFill ? getPlanBullets(plan) : ['Markdown export', 'Local archive workflow', 'Multi-platform support', 'No cloud sync']).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <div className="pricing-actions">
              {pendingReview || checkoutMode === 'disabled' ? (
                <span className="button primary disabled" aria-disabled="true">
                  Pending Google review
                </span>
              ) : (
                <Link
                  className="button primary"
                  to={buildCheckoutStartPath({
                    productKey: product.product_key,
                    planKey: plan.plan_key,
                    source,
                    installationId,
                    extensionId,
                  })}
                >
                  {user ? 'Continue to secure checkout' : 'Sign in and continue'}
                </Link>
              )}
            </div>
          </article>
        ))}
      </div>

      <div className="note-grid">
        <section className="soft-card">
          <p className="eyebrow">How payment works</p>
          <h2>Checkout starts on the site, not inside the extension.</h2>
          <p className="muted">
            Sign in with email, start checkout from this pricing page, complete payment on the
            hosted checkout page, then return to the extension or account page.
          </p>
          <p className="muted">
            Payment is handled securely. Need help before buying? Contact {leadfillSupportEmail}.
          </p>
        </section>

        <section className="soft-card">
          <p className="eyebrow">What happens after payment</p>
          <h2>Membership appears after backend confirmation.</h2>
          <p className="muted">
            Paid access is activated after backend confirmation. The success page does not unlock
            Pro locally. Your account and extension both read refreshed entitlement instead.
          </p>
          <div className="action-row">
            <Link className="button subtle" to={`/account?productKey=${product.product_key}`}>Open account</Link>
            <Link className="button subtle" to="/login">Sign in</Link>
          </div>
        </section>
      </div>

      {checkoutMode === 'test' ? (
        <p className="muted">Current checkout path remains in internal test mode.</p>
      ) : null}
    </section>
  )
}
