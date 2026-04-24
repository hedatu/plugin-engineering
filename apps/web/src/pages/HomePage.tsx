import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  formatPlanHeadline,
  getChromeStoreUrl,
  getDefaultProductPath,
  getFreePlan,
  getPaidPlan,
  getPlanBullets,
  leadfillBenefits,
  leadfillFallbackProduct,
  leadfillFaqs,
  leadfillSteps,
} from '../content/leadfill'
import type { ProductWithPlans } from '../lib/catalog'
import { getProductWithPlans } from '../lib/catalog'
import { env } from '../lib/env'

export function HomePage() {
  const [product, setProduct] = useState<ProductWithPlans | null>(leadfillFallbackProduct)

  useEffect(() => {
    let active = true

    void getProductWithPlans(env.productKey)
      .then((result) => {
        if (!active) {
          return
        }

        if (!result) {
          setProduct(leadfillFallbackProduct)
          return
        }

        setProduct(result)
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
  }, [])

  const paidPlan = getPaidPlan(product)
  const freePlan = getFreePlan(product)
  const chromeStoreUrl = getChromeStoreUrl(product)
  const productPath = getDefaultProductPath()

  return (
    <section className="page-grid">
      <div className="hero-section">
        <div className="hero-copy">
          <p className="eyebrow">LeadFill One Profile</p>
          <h1>Fill repetitive lead forms with one saved profile.</h1>
          <p className="hero-lead">10 free fills, then a $19 lifetime unlock.</p>
          <p className="muted hero-support">
            LeadFill is a focused Chrome extension for people who keep typing the same name, email,
            phone, and company details into lead and intake forms. It stays local-only and keeps
            payment separate from the extension.
          </p>

          <div className="hero-meta">
            <span>10 free fills</span>
            <span>{formatPlanHeadline(paidPlan)}</span>
            <span>Local-only</span>
            <span>No upload or cloud sync</span>
          </div>

          <div className="action-row">
            {chromeStoreUrl ? (
              <a className="button primary" href={chromeStoreUrl} rel="noreferrer" target="_blank">
                Add to Chrome
              </a>
            ) : (
              <Link className="button primary" to={productPath}>Get started</Link>
            )}
            <Link className="button secondary" to="/pricing">Unlock Lifetime</Link>
            <a className="button subtle" href="#how-it-works">See how it works</a>
          </div>
        </div>

        <figure className="card hero-visual">
          <img src="/images/leadfill/hero.png" alt="LeadFill filling a sample lead intake form" />
          <figcaption className="hero-caption">
            One clean popup, one saved profile, one click to fill the current page.
          </figcaption>
        </figure>
      </div>

      <section className="content-section">
        <div className="section-heading left-aligned">
          <div>
            <p className="eyebrow">Why people use it</p>
            <h2>Built for one clear job</h2>
          </div>
        </div>
        <div className="feature-grid">
          {leadfillBenefits.map((item) => (
            <article key={item.title} className="card feature-card">
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
            <h2>From saved profile to filled page in four steps</h2>
          </div>
        </div>
        <div className="step-grid">
          {leadfillSteps.map((item, index) => (
            <article key={item.title} className="card step-card">
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
            <p className="eyebrow">Pricing preview</p>
            <h2>Free first. Lifetime if you want unlimited usage.</h2>
          </div>
        </div>

        <div className="compare-grid">
          <article className="card pricing-card pricing-card-soft">
            <p className="plan-tag">Free</p>
            <h3>{formatPlanHeadline(freePlan) === 'Free' ? '10 free fills' : formatPlanHeadline(freePlan)}</h3>
            <ul className="compact-list">
              {getPlanBullets(freePlan).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>

          <article className="card pricing-card pricing-card-strong">
            <p className="plan-tag">Lifetime Unlock</p>
            <h3>{formatPlanHeadline(paidPlan)}</h3>
            <ul className="compact-list">
              {getPlanBullets(paidPlan).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        </div>

        <div className="card note-card">
          <p className="muted">
            Payment runs on a secure external checkout page. Membership becomes active after the
            payment is verified and refreshed in your account or extension.
          </p>
          <div className="action-row">
            <Link className="button subtle" to="/pricing">See pricing</Link>
            <Link className="button subtle" to="/account">Manage account</Link>
          </div>
        </div>
      </section>

      <section className="content-section faq-section">
        <div className="section-heading left-aligned">
          <div>
            <p className="eyebrow">FAQ</p>
            <h2>Short answers before you install or upgrade</h2>
          </div>
        </div>
        <div className="faq-list">
          {leadfillFaqs.map((item) => (
            <details key={item.question} className="card faq-item">
              <summary>{item.question}</summary>
              <p className="muted">{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="card cta-band">
        <div>
          <p className="eyebrow">Ready to try LeadFill?</p>
          <h2>Start free, then unlock lifetime access only if it earns a place in your workflow.</h2>
          <p className="muted">
            Keep your profile local, manage membership from your account, and avoid subscription
            clutter.
          </p>
        </div>
        <div className="action-row">
          {chromeStoreUrl ? (
            <a className="button primary" href={chromeStoreUrl} rel="noreferrer" target="_blank">
              Add to Chrome
            </a>
          ) : (
            <Link className="button primary" to={productPath}>Get started</Link>
          )}
          <Link className="button secondary" to="/pricing">Unlock Lifetime</Link>
        </div>
      </section>
    </section>
  )
}
