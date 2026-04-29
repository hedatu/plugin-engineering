import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BrandMark } from '../components/BrandMark'
import { formatPlanHeadline, getPaidPlan } from '../content/leadfill'
import {
  fallbackProductsWithPlans,
  getProductChromeStoreUrl,
  getProductStoreCtaLabel,
  isProductPendingReview,
  getProductPath,
  getProductPricingPath,
} from '../content/productCatalog'
import type { ProductWithPlans } from '../lib/catalog'
import { listProductsWithPlans } from '../lib/catalog'

export function ProductsPage() {
  const [products, setProducts] = useState<ProductWithPlans[]>(fallbackProductsWithPlans)

  useEffect(() => {
    let active = true

    void listProductsWithPlans()
      .then((result) => {
        if (active && result.length) {
          setProducts(result)
        }
      })
      .catch((error) => {
        console.warn(error)
      })

    return () => {
      active = false
    }
  }, [])

  return (
    <section className="page-grid">
      <div className="page-heading compact-heading">
        <div className="brand-inline">
          <BrandMark size="sm" />
          <p className="eyebrow">Products</p>
        </div>
        <h1>Focused plugin products with clean product pages and pricing pages.</h1>
        <p className="muted">
          The current release candidate is intentionally narrow. LeadFill has its own product page,
          pricing page, account view, and checkout entry, all tied to the same catalog record.
        </p>
      </div>

      <div className="catalog-grid">
        {products.map((product) => {
          const paidPlan = getPaidPlan(product)
          const chromeStoreUrl = getProductChromeStoreUrl(product)
          const pendingReview = isProductPendingReview(product)

          return (
            <article key={product.product_key} className="catalog-card">
              <div className="catalog-title-row">
                <BrandMark size="md" className="catalog-icon" />
                <div className="stack-tight">
                  <p className="eyebrow">Chrome extension</p>
                  <h2>{product.name}</h2>
                </div>
              </div>
              <p className="muted">{product.description}</p>
              <div className="hero-meta">
                <span>{pendingReview ? 'Pending launch' : product.product_key === 'leadfill-one-profile' ? '10 free fills' : 'Free trial'}</span>
                <span>{formatPlanHeadline(paidPlan)}</span>
                <span>Local-only</span>
                <span>No upload</span>
              </div>
              <div className="action-row">
                <Link className="button primary" to={getProductPath(product)}>
                  View details
                </Link>
                <Link className="button secondary" to={getProductPricingPath(product)}>
                  View pricing
                </Link>
                {chromeStoreUrl ? (
                  <a className="button subtle" href={chromeStoreUrl} rel="noreferrer" target="_blank">
                    Add to Chrome
                  </a>
                ) : (
                  <span className="button subtle disabled" aria-disabled="true">
                    {getProductStoreCtaLabel(product)}
                  </span>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
