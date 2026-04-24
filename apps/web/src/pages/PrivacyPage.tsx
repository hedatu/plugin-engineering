export function PrivacyPage() {
  return (
    <section className="page-grid legal-page">
      <div className="page-heading compact-heading">
        <p className="eyebrow">Privacy</p>
        <h1>Privacy policy</h1>
        <p className="muted">
          LeadFill is designed to keep profile data local to the browser while the backend handles
          account, payment, entitlement, installation, and usage records.
        </p>
      </div>

      <article className="card legal-document">
        <section className="legal-section">
          <h2>Summary</h2>
          <p>
            LeadFill is positioned as a local-only workflow tool. Saved profile data is intended to
            stay in the extension and browser environment rather than being uploaded for cloud sync.
          </p>
        </section>

        <section className="legal-section">
          <h2>Data used for account and payments</h2>
          <p>
            To operate sign-in, entitlement, installation limits, order history, and usage records,
            the service stores account and payment-related metadata that is necessary to run the
            commercial product.
          </p>
        </section>

        <section className="legal-section">
          <h2>What stays local</h2>
          <p>
            Profile values you save for form filling and the form content you apply with LeadFill
            are intended to remain local to the extension unless a future feature explicitly says
            otherwise.
          </p>
        </section>

        <section className="legal-section">
          <h2>Payments and security</h2>
          <p>
            Payment processing happens on a hosted checkout page. Frontend pages and the extension
            do not contain merchant secrets or privileged backend keys.
          </p>
        </section>
      </article>
    </section>
  )
}
