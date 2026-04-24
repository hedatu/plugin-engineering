export function RefundPage() {
  return (
    <section className="page-grid legal-page">
      <div className="page-heading compact-heading">
        <p className="eyebrow">Refund</p>
        <h1>Refund policy</h1>
        <p className="muted">
          Refund review is handled against the payment record, account email, and resulting
          membership state.
        </p>
      </div>

      <article className="card legal-document">
        <section className="legal-section">
          <h2>How to request a refund</h2>
          <p>
            Include the account email, product name, and payment timestamp when contacting support
            so the order can be located accurately.
          </p>
        </section>

        <section className="legal-section">
          <h2>Review basis</h2>
          <p>
            Refund decisions are reviewed against the payment record, account history, and the
            resulting membership state connected to the purchase.
          </p>
        </section>

        <section className="legal-section">
          <h2>After approval</h2>
          <p>
            If a refund is approved, the resulting entitlement downgrade or revocation is applied
            by the backend after the corresponding payment event is recorded.
          </p>
        </section>

        <section className="legal-section">
          <h2>Important expectation</h2>
          <p>
            A refund request does not instantly change access inside the browser. Membership
            continues to be enforced from the backend record until the refund state is processed.
          </p>
        </section>
      </article>
    </section>
  )
}
