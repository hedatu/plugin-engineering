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
  getProductStoreCtaLabel,
  isProductPendingReview,
  leadfillProductKey,
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
  const isLeadFill = product.product_key === leadfillProductKey
  const pendingReview = isProductPendingReview(product)
  const headline = isLeadFill
    ? 'Fill repetitive lead forms from one local profile.'
    : 'Export AI conversations into Obsidian-friendly Markdown.'
  const supportCopy = isLeadFill
    ? 'Save one browser-local profile and use it to fill common text, email, phone, textarea, and select fields.'
    : 'Turn ChatGPT and other AI conversations into local Markdown files for research notes, long-term archives, and Obsidian workflows.'
  const trustPoints = isLeadFill
    ? leadfillTrustPoints
    : ['Pending launch', 'Local-first', 'Markdown export', 'No cloud sync']
  const heroImage = isLeadFill ? '/images/leadfill/hero.png' : '/images/leadfill/pricing.png'
  const audience = isLeadFill ? leadfillAudience : [
    'Users who save AI conversations into Obsidian or local Markdown archives.',
    'Researchers and creators who want cleaner long-term notes from chat sessions.',
    'Local-first users who prefer export files over another cloud workspace.',
  ]
  const features = isLeadFill ? leadfillFeatureBreakdown : [
    {
      title: 'Markdown export',
      description: 'Convert AI conversations into Markdown that is easier to store, search, and maintain.',
    },
    {
      title: 'Local archive workflow',
      description: 'Designed around local files and Obsidian-friendly notes rather than a hosted knowledge base.',
    },
    {
      title: 'Multi-platform direction',
      description: 'The product is prepared for common AI chat sites, with compatibility added only after real testing.',
    },
  ]
  const steps = isLeadFill ? leadfillSteps : [
    {
      title: 'Open a supported chat',
      description: 'Use the extension on a compatible AI conversation page after the listing is approved.',
    },
    {
      title: 'Export to Markdown',
      description: 'Turn the current conversation into a cleaner local Markdown note.',
    },
    {
      title: 'Save into Obsidian',
      description: 'Move the file into your vault or local archive workflow.',
    },
    {
      title: 'Upgrade after launch',
      description: 'Paid plans will open after Google review and Chrome Web Store approval.',
    },
  ]
  const supportBoundaries = isLeadFill ? leadfillSupportBoundaries : [
    'Chrome extension listing is pending Google review.',
    'Install and checkout are paused until approval.',
    'Initial workflow focuses on Markdown export for local archives.',
  ]
  const limits = isLeadFill ? leadfillLimits : [
    'Not all AI chat sites are guaranteed before compatibility testing.',
    'No purchase is available before Chrome Web Store approval.',
    'Feature scope may be adjusted during review and launch preparation.',
  ]
  const faqs = isLeadFill ? leadfillFaqs : [
    {
      question: 'Can I install it now?',
      answer: 'Not yet. The plugin is waiting for Google Chrome Web Store review.',
    },
    {
      question: 'Can I buy a plan now?',
      answer: 'No. Pricing is prepared, but checkout opens only after the listing is approved.',
    },
    {
      question: 'Is it cloud sync?',
      answer: 'No. The product is designed around local Markdown export and local archive workflows.',
    },
  ]

  return (
    <section className="page-grid">
      <section className="hero-layout">
        <div className="hero-copy">
          <div className="brand-inline">
            <BrandMark size="sm" />
            <p className="eyebrow">{product.name}</p>
          </div>
          <h1>{headline}</h1>
          <p className="hero-support hero-primary-copy">
            {supportCopy}
          </p>

          <div className="hero-meta">
            {trustPoints.map((item) => (
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
                {getProductStoreCtaLabel(product)}
              </span>
            )}
            <Link className="button secondary" to={pricingPath}>See pricing</Link>
          </div>
          {pendingReview ? (
            <p className="muted">This plugin is waiting for Google review. It will open for install after approval.</p>
          ) : null}
        </div>

        <div className="visual-stack">
          <figure className="visual-frame hero-shot">
            <img src={heroImage} alt={`${product.name} preview`} />
          </figure>
          <div className="mini-card mini-card-inline">
            <div>
              <p className="eyebrow">What the product does</p>
              <p className="muted">
                {isLeadFill
                  ? 'One saved profile, one fill action, one focused workflow for repetitive lead forms.'
                  : 'One focused exporter for turning AI conversations into local Markdown notes.'}
              </p>
            </div>
            <div className="mini-stat-row">
              <span>{pendingReview ? 'Pending review' : isLeadFill ? '10 free fills' : 'Local export'}</span>
              <span>{formatPlanHeadline(paidPlan)}</span>
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
                  {audience.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>

              <article className="soft-card detail-summary-card">
                <p className="eyebrow">Free vs Pro</p>
                <h2>Simple commercial model.</h2>
                <ul className="compact-list">
                  {isLeadFill ? (
                    <>
                      <li>Free: 10 fills</li>
                      <li>Lifetime: $19 one-time, unlimited fills</li>
                      <li>Use the same email later to refresh membership</li>
                    </>
                  ) : (
                    <>
                      <li>Status: waiting for Google review</li>
                      <li>Plans: monthly, annual, and lifetime prepared</li>
                      <li>Checkout opens only after approval</li>
                    </>
                  )}
                </ul>
                <div className="action-row">
                  <Link className="button secondary" to={pricingPath}>View pricing</Link>
                  {chromeStoreUrl ? (
                    <a className="button subtle" href={chromeStoreUrl} rel="noreferrer" target="_blank">
                      Add to Chrome
                    </a>
                  ) : pendingReview ? (
                    <span className="button subtle disabled" aria-disabled="true">
                      Pending Google review
                    </span>
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
              {features.map((item) => (
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
                  {steps.map((item, index) => (
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
                <h2>{isLeadFill ? 'What LeadFill supports today.' : 'Current launch status.'}</h2>
                <ul className="compact-list">
                  {supportBoundaries.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>

              <article className="soft-card">
                <p className="eyebrow">Boundaries</p>
                <h2>What to expect.</h2>
                <ul className="compact-list">
                  {limits.map((item) => (
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
              {faqs.map((item) => (
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
          <p className="eyebrow">{product.name}</p>
          <h2>
            {isLeadFill
              ? 'Local-first form filling, with a small paid upgrade only when it earns it.'
              : 'Waiting for Google review before public launch.'}
          </h2>
          <p className="muted">
            {isLeadFill
              ? 'Keep the saved profile in Chrome, use free fills first, and open pricing only when you want unlimited usage.'
              : 'Install and checkout will open after the Chrome Web Store listing is approved.'}
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
              {getProductStoreCtaLabel(product)}
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
