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

      <article className="card legal-document">
        <section className="legal-section">
          <h2>Product scope</h2>
          <p>
            LeadFill One Profile is intended for saving one local profile and filling compatible
            form fields. It is not sold as a multi-user platform or cloud workspace.
          </p>
        </section>

        <section className="legal-section">
          <h2>Accounts and membership</h2>
          <p>
            Account access is handled with email OTP. Paid access is determined by the backend
            membership record rather than by local browser state or success-page redirects.
          </p>
        </section>

        <section className="legal-section">
          <h2>Payments</h2>
          <p>
            Checkout is handled on a hosted payment page. After payment, the service verifies the
            payment event and updates membership before paid access appears in the extension or
            account page.
          </p>
        </section>

        <section className="legal-section">
          <h2>Availability and changes</h2>
          <p>
            The product may evolve over time, but public pages should not be interpreted as a
            promise of features that are not already implemented in the extension.
          </p>
        </section>
      </article>
    </section>
  )
}
