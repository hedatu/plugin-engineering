import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import {
  getDefaultPricingPath,
  getProductCheckoutMode,
  getProductPath,
  getProductPricingPath,
  leadfillFallbackProduct,
  leadfillProductKey,
} from '../content/productCatalog'
import { createCheckoutSession } from '../lib/api'
import type { ProductWithPlans } from '../lib/catalog'
import { getProductWithPlans } from '../lib/catalog'

export function CheckoutStartPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const { user, loading } = useAuth()
  const [product, setProduct] = useState<ProductWithPlans | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('Preparing checkout...')
  const startedRef = useRef(false)

  const productKey = params.get('productKey') ?? leadfillProductKey
  const planKey = params.get('planKey') ?? 'lifetime'
  const source = params.get('source') === 'chrome_extension' ? 'chrome_extension' : 'web'
  const installationId = params.get('installationId')
  const extensionId = params.get('extensionId')

  useEffect(() => {
    let active = true

    void getProductWithPlans(productKey)
      .then((result) => {
        if (!active) {
          return
        }

        if (result) {
          setProduct(result)
          setNotFound(false)
          return
        }

        if (productKey === leadfillFallbackProduct.product_key) {
          setProduct(leadfillFallbackProduct)
          setNotFound(false)
          return
        }

        setProduct(null)
        setNotFound(true)
      })
      .catch((fetchError) => {
        if (!active) {
          return
        }

        console.warn(fetchError)
        if (productKey === leadfillFallbackProduct.product_key) {
          setProduct(leadfillFallbackProduct)
          setNotFound(false)
        } else {
          setProduct(null)
          setNotFound(true)
        }
      })

    return () => {
      active = false
    }
  }, [productKey])

  useEffect(() => {
    if (loading || !product || startedRef.current) {
      return
    }

    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`, { replace: true })
      return
    }

    startedRef.current = true
    setStatus('Creating secure checkout...')

    const successUrl = `${window.location.origin}/checkout/success?productKey=${productKey}`
    const cancelUrl = `${window.location.origin}/checkout/cancel?productKey=${productKey}`

    void createCheckoutSession({
      productKey,
      planKey,
      source,
      installationId: installationId ?? undefined,
      extensionId: extensionId ?? undefined,
      successUrl,
      cancelUrl,
    })
      .then((result) => {
        setStatus('Redirecting to hosted checkout...')
        window.location.assign(result.checkoutUrl)
      })
      .catch((checkoutError) => {
        startedRef.current = false
        setError(checkoutError instanceof Error ? checkoutError.message : 'CREATE_CHECKOUT_FAILED')
        setStatus('Unable to start checkout.')
      })
  }, [extensionId, installationId, loading, location.pathname, location.search, navigate, planKey, product, productKey, source, user])

  if (notFound) {
    return (
      <section className="page-grid narrow-page">
        <div className="card status-card">
          <p className="eyebrow">Checkout</p>
          <h1>Product not found.</h1>
          <p className="muted">
            The checkout request did not match an active product in the current catalog.
          </p>
          <div className="action-row">
            <Link className="button primary" to="/products">Open products</Link>
          </div>
        </div>
      </section>
    )
  }

  if (product === null && !error) {
    return (
      <section className="page-grid narrow-page">
        <div className="card status-card">
          <p className="eyebrow">Checkout</p>
          <h1>Preparing product checkout...</h1>
          <p className="muted">Checking the product catalog before redirecting you to checkout.</p>
        </div>
      </section>
    )
  }

  const pricingPath = product ? getProductPricingPath(product) : getDefaultPricingPath()
  const productPath = product ? getProductPath(product) : getDefaultPricingPath()
  const checkoutMode = getProductCheckoutMode(product)

  return (
    <section className="page-grid narrow-page">
      <div className="card status-card">
        <p className="eyebrow">Checkout start</p>
        <h1>Secure checkout is prepared on the website, not in the extension.</h1>
        <p className="muted">
          The site validates the product and plan, confirms your login, asks the backend to create
          a checkout session, and then redirects to the hosted payment page.
        </p>
        <div className="hero-meta">
          <span>Product: {productKey}</span>
          <span>Plan: {planKey}</span>
          <span>Source: {source}</span>
          {checkoutMode === 'test' ? <span>Checkout mode: test</span> : null}
        </div>
        <div className="status-banner">
          <strong>Status:</strong> {error ?? status}
        </div>
        <div className="action-row">
          <Link className="button subtle" to={pricingPath}>Back to pricing</Link>
          <Link className="button subtle" to={productPath}>Back to product</Link>
        </div>
      </div>
    </section>
  )
}
