import { leadfillSupportEmail } from '../content/leadfill'

export function PrivacyPage() {
  return (
    <section className="page-grid legal-page">
      <div className="page-heading compact-heading">
        <p className="eyebrow">Privacy</p>
        <h1>Privacy policy</h1>
        <p className="muted">
          LeadFill is designed to keep saved profile data local in the browser while the website
          and backend operate account, payment, entitlement, installation, and usage records.
        </p>
      </div>

      <article className="legal-document">
        <section className="legal-section">
          <h2>Summary</h2>
          <p>
            LeadFill One Profile is a local-only Chrome extension. Saved profile data stays in the
            browser and is not uploaded for cloud sync.
          </p>
        </section>

        <section className="legal-section">
          <h2>Saved profile data</h2>
          <p>
            The profile values you save for filling forms are intended to remain local to the
            extension and browser environment.
          </p>
        </section>

        <section className="legal-section">
          <h2>Website and backend records</h2>
          <p>
            The website and backend may store account records, payment records, entitlement
            records, installation records, and usage records that are required to operate the
            product and membership system.
          </p>
        </section>

        <section className="legal-section">
          <h2>No cloud sync for saved profile data</h2>
          <p>
            LeadFill does not upload your saved profile data for cloud sync. If that changes in a
            future product version, the public product pages and policy will need to state it
            clearly.
          </p>
        </section>

        <section className="legal-section">
          <h2>Payments and support</h2>
          <p>
            Payment processing happens on a hosted checkout page. Frontend pages and the extension
            do not contain merchant secrets or privileged backend keys. Privacy questions can be
            sent to {leadfillSupportEmail}.
          </p>
        </section>
      </article>
    </section>
  )
}
