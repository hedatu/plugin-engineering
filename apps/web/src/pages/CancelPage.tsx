import { Link } from 'react-router-dom'
import { getDefaultPricingPath, getDefaultProductPath } from '../content/productCatalog'

export function CancelPage() {
  return (
    <section className="page-grid narrow-page">
      <div className="surface-card status-card status-minimal">
        <p className="eyebrow">Checkout cancelled</p>
        <h1>No payment was completed.</h1>
        <p className="muted">
          You can continue with the free plan or try again later. Paid access only changes after a
          verified payment event reaches the backend.
        </p>
        <div className="action-row">
          <Link className="button primary" to={getDefaultPricingPath()}>Back to pricing</Link>
          <Link className="button subtle" to={getDefaultProductPath()}>Back to product</Link>
        </div>
      </div>

      <div className="soft-card">
        <p className="eyebrow">Next step</p>
        <h2>Use the same email if you return later.</h2>
        <p className="muted">
          Reopen checkout when you are ready. If you already completed payment elsewhere, sign in
          with the purchase email and refresh membership from Account or from the extension.
        </p>
      </div>
    </section>
  )
}
