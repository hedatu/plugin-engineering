import { Link } from 'react-router-dom'
import { BrandMark } from './BrandMark'
import {
  formatPlanHeadline,
  getFreePlan,
  getPaidPlan,
  getPlanBullets,
  leadfillAudience,
  leadfillBenefits,
  leadfillFaqs,
  leadfillFeatureBreakdown,
  leadfillLimits,
  leadfillSteps,
  leadfillSupportBoundaries,
  leadfillSupportEmail,
  leadfillTrustPoints,
} from '../content/leadfill'
import {
  getProductChromeStoreUrl,
  getProductPath,
  getProductPricingPath,
} from '../content/productCatalog'
import type { ProductWithPlans } from '../lib/catalog'

type ProductLandingMode = 'home' | 'product'

export function ProductLanding({
  product,
  mode,
}: {
  product: ProductWithPlans
  mode: ProductLandingMode
}) {
  const paidPlan = getPaidPlan(product)
  const freePlan = getFreePlan(product)
  const chromeStoreUrl = getProductChromeStoreUrl(product)
  const productPath = getProductPath(product)
  const pricingPath = getProductPricingPath(product)
  const isHome = mode === 'home'

  return (
    <section className="page-grid">
      <section className="hero-layout">
        <div className="hero-copy">
          <div className="brand-inline">
            <BrandMark size="sm" />
            <p className="eyebrow">{product.name}</p>
          </div>
          <h1>Fill repetitive lead forms from one local profile.</h1>
          <p className="hero-support hero-primary-copy">
            Save one browser-local profile and use it to fill common text, email, phone, textarea,
            and select fields.
          </p>

          <div className="hero-meta">
            {leadfillTrustPoints.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>

          <div className="action-row">
            {chromeStoreUrl ? (
              <a className="button primary" href={chromeStoreUrl} rel="noreferrer" target="_blank">
                Add to Chrome
              </a>
            ) : (
              <span className="button primary disabled" aria-disabled="true">
                Chrome Web Store link pending
              </span>
            )}
            <Link className="button secondary" to={pricingPath}>See pricing</Link>
          </div>
        </div>

        <div className="visual-stack">
          <figure className="visual-frame hero-shot">
            <img src="/images/leadfill/hero.png" alt="LeadFill extension popup beside a lead form" />
          </figure>
          <div className="mini-card mini-card-inline">
            <div>
              <p className="eyebrow">What the product does</p>
              <p className="muted">
                One saved profile, one fill action, one focused workflow for repetitive lead forms.
              </p>
            </div>
            <div className="mini-stat-row">
              <span>10 free fills</span>
              <span>$19 lifetime</span>
            </div>
          </div>
        </div>
      </section>

      {isHome ? (
        <>
          <section className="content-section">
            <div className="section-heading left-aligned">
              <div>
                <p className="eyebrow">Why LeadFill</p>
                <h2>Focused enough to understand immediately.</h2>
              </div>
            </div>
            <div className="benefit-grid">
              {leadfillBenefits.map((item) => (
                <article key={item.title} className="soft-card">
                  <h3>{item.title}</h3>
                  <p className="muted">{item.description}</p>
                </article>
              ))}
            </div>
          </section>

          <section id="how-it-works" className="content-section">
            <div className="section-heading left-aligned">
              <div>
                <p className="eyebrow">How it works</p>
                <h2>One profile in the browser, then a short repeatable flow.</h2>
              </div>
            </div>
            <div className="timeline-grid">
              {leadfillSteps.map((item, index) => (
                <article key={item.title} className="soft-card step-card">
                  <span className="step-index">0{index + 1}</span>
                  <h3>{item.title}</h3>
                  <p className="muted">{item.description}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="content-section">
            <div className="section-heading left-aligned">
              <div>
                <p className="eyebrow">Pricing snapshot</p>
                <h2>Try it first. Upgrade only when it earns a place in your workflow.</h2>
              </div>
            </div>
            <div className="compare-grid">
              <article className="soft-card pricing-card">
                <p className="plan-tag">Free</p>
                <h3>10 free fills</h3>
                <ul className="compact-list">
                  {getPlanBullets(freePlan).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>

              <article className="surface-card pricing-card pricing-card-strong">
                <p className="plan-tag">Lifetime</p>
                <h3>{formatPlanHeadline(paidPlan)}</h3>
                <ul className="compact-list">
                  {getPlanBullets(paidPlan).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            </div>
          </section>

          <section className="content-section faq-section">
            <div className="section-heading left-aligned">
              <div>
                <p className="eyebrow">FAQ</p>
                <h2>Short answers before you install or upgrade.</h2>
              </div>
            </div>
            <div className="faq-list">
              {leadfillFaqs.map((item) => (
                <details key={item.question} className="faq-item">
                  <summary>{item.question}</summary>
                  <p className="muted">{item.answer}</p>
                </details>
              ))}
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="content-section">
            <div className="section-heading left-aligned">
              <div>
                <p className="eyebrow">Product detail</p>
                <h2>Built for one plugin, one job, one clean workflow</h2>
              </div>
            </div>

            <div className="gallery-grid">
              <figure className="surface-card visual-frame">
                <img src="/images/leadfill/screenshot-1.png" alt="LeadFill popup with saved profile details" />
              </figure>
              <figure className="surface-card visual-frame">
                <img src="/images/leadfill/screenshot-2.png" alt="LeadFill filling compatible form fields" />
              </figure>
              <figure className="surface-card visual-frame">
                <img src="/images/leadfill/screenshot-3.png" alt="LeadFill usage and upgrade messaging" />
              </figure>
            </div>
          </section>

          <section className="content-section">
            <div className="split-grid">
              <article className="soft-card detail-summary-card">
                <p className="eyebrow">Who it is for</p>
                <h2>Useful when the same form work keeps coming back.</h2>
                <ul className="compact-list">
                  {leadfillAudience.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>

              <article className="soft-card detail-summary-card">
                <p className="eyebrow">Free vs Pro</p>
                <h2>Simple commercial model.</h2>
                <ul className="compact-list">
                  <li>Free: 10 fills</li>
                  <li>Lifetime: $19 one-time, unlimited fills</li>
                  <li>Use the same email later to refresh membership</li>
                </ul>
                <div className="action-row">
                  <Link className="button secondary" to={pricingPath}>View pricing</Link>
                  {chromeStoreUrl ? (
                    <a className="button subtle" href={chromeStoreUrl} rel="noreferrer" target="_blank">
                      Add to Chrome
                    </a>
                  ) : null}
                </div>
              </article>
            </div>
          </section>

          <section className="content-section">
            <div className="section-heading left-aligned">
              <div>
                <p className="eyebrow">Core features</p>
                <h2>Only real capabilities, no inflated promises.</h2>
              </div>
            </div>
            <div className="benefit-grid">
              {leadfillFeatureBreakdown.map((item) => (
                <article key={item.title} className="soft-card">
                  <h3>{item.title}</h3>
                  <p className="muted">{item.description}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="content-section">
            <div className="section-heading left-aligned">
              <div>
                <p className="eyebrow">How it works</p>
                <h2>From saved profile to filled page.</h2>
              </div>
            </div>
            <div className="timeline-grid">
              {leadfillSteps.map((item, index) => (
                <article key={item.title} className="soft-card step-card">
                  <span className="step-index">0{index + 1}</span>
                  <h3>{item.title}</h3>
                  <p className="muted">{item.description}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="content-section">
            <div className="split-grid">
              <article className="soft-card">
                <p className="eyebrow">Support and boundaries</p>
                <h2>What LeadFill supports today.</h2>
                <ul className="compact-list">
                  {leadfillSupportBoundaries.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>

              <article className="soft-card">
                <p className="eyebrow">Boundaries</p>
                <h2>What to expect.</h2>
                <ul className="compact-list">
                  {leadfillLimits.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            </div>
          </section>

          <section className="content-section faq-section">
            <div className="section-heading left-aligned">
              <div>
                <p className="eyebrow">FAQ</p>
                <h2>Questions people ask before buying.</h2>
              </div>
            </div>
            <div className="faq-list">
              {leadfillFaqs.map((item) => (
                <details key={item.question} className="faq-item">
                  <summary>{item.question}</summary>
                  <p className="muted">{item.answer}</p>
                </details>
              ))}
            </div>
          </section>
        </>
      )}

      <section className="cta-band">
        <div>
          <p className="eyebrow">LeadFill One Profile</p>
          <h2>Local-first form filling, with a small paid upgrade only when it earns it.</h2>
          <p className="muted">
            Keep the saved profile in Chrome, use free fills first, and open pricing only when you
            want unlimited usage.
          </p>
          <p className="muted cta-support">Support: {leadfillSupportEmail}</p>
        </div>
        <div className="action-row">
          {chromeStoreUrl ? (
            <a className="button primary" href={chromeStoreUrl} rel="noreferrer" target="_blank">
              Add to Chrome
            </a>
          ) : (
            <span className="button primary disabled" aria-disabled="true">
              Chrome Web Store link pending
            </span>
          )}
          <Link className="button secondary" to={isHome ? productPath : pricingPath}>
            {isHome ? 'View product details' : 'View pricing'}
          </Link>
        </div>
      </section>
    </section>
  )
}
