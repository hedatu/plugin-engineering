import { leadfillSupportEmail } from '../content/leadfill'

export function TermsPage() {
  return (
    <section className="page-grid legal-page">
      <div className="page-heading compact-heading">
        <p className="eyebrow">Terms</p>
        <h1>Terms of service</h1>
        <p className="muted">
          LeadFill is sold as a focused Chrome extension with free usage limits and a lifetime
          unlock.
        </p>
      </div>

      <article className="legal-document">
        <section className="legal-section">
          <h2>Product scope</h2>
          <p>
            LeadFill One Profile is intended for saving one local profile and filling compatible
            form fields. It is not sold as a multi-user platform or cloud workspace.
          </p>
        </section>

        <section className="legal-section">
          <h2>Free and paid access</h2>
          <p>
            The free plan includes a limited number of fills. The paid offer is a lifetime unlock
            for the current product scope. Paid access is determined by the backend membership
            record rather than by local browser state or success-page redirects.
          </p>
        </section>

        <section className="legal-section">
          <h2>License scope</h2>
          <p>
            The product is licensed for the purchaser's use under the product rules and installation
            limits attached to the purchased plan.
          </p>
        </section>

        <section className="legal-section">
          <h2>Acceptable use</h2>
          <p>
            You may not use the product in a way that breaks websites, interferes with service
            operations, or violates applicable law or third-party terms.
          </p>
        </section>

        <section className="legal-section">
          <h2>Service availability</h2>
          <p>
            The product and related website may evolve over time. Public pages should not be read
            as a promise of features that are not already implemented.
          </p>
        </section>

        <section className="legal-section">
          <h2>Payments and contact</h2>
          <p>
            Checkout is handled on a hosted payment page. After payment, the service verifies the
            payment event and updates membership before paid access appears in the extension or
            account page. Questions can be sent to {leadfillSupportEmail}.
          </p>
        </section>
      </article>
    </section>
  )
}
