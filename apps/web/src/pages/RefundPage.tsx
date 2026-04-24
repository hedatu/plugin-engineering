import { leadfillSupportEmail } from '../content/leadfill'

export function RefundPage() {
  return (
    <section className="page-grid legal-page">
      <div className="page-heading compact-heading">
        <p className="eyebrow">Refund</p>
        <h1>Refund policy</h1>
        <p className="muted">
          Refund review is handled against the payment record, account email, and resulting
          membership state for LeadFill One Profile.
        </p>
      </div>

      <article className="legal-document">
        <section className="legal-section">
          <h2>How to request a refund</h2>
          <p>
            Contact {leadfillSupportEmail} and include the account email, product name, and payment
            timestamp so the order can be located accurately.
          </p>
        </section>

        <section className="legal-section">
          <h2>Payment processing</h2>
          <p>
            Payment processing is handled by the hosted payment provider. Refund review still
            depends on the matching account and order record on the service side.
          </p>
        </section>

        <section className="legal-section">
          <h2>After approval</h2>
          <p>
            If a refund is approved, the related entitlement may be downgraded or revoked after the
            refund state is recorded by the backend.
          </p>
        </section>

        <section className="legal-section">
          <h2>Important expectation</h2>
          <p>
            A refund request does not instantly change access in the browser. Membership continues
            to be enforced from the backend record until the refund state is processed.
          </p>
        </section>
      </article>
    </section>
  )
}
