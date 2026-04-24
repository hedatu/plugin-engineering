import { Link, useSearchParams } from 'react-router-dom'
import { env } from '../lib/env'

export function CancelPage() {
  const [params] = useSearchParams()
  const productKey = params.get('productKey') ?? env.productKey

  return (
    <section className="page-grid narrow-page">
      <div className="card status-card">
        <p className="eyebrow">Checkout canceled</p>
        <h1>No payment was completed.</h1>
        <p className="muted">
          If you closed checkout or canceled payment, your membership stays where it was. Paid
          access only changes after a verified payment event reaches the backend.
        </p>
        <div className="action-row">
          <Link className="button primary" to={`/pricing?productKey=${productKey}`}>Try checkout again</Link>
          <Link className="button subtle" to="/">Back to product</Link>
        </div>
      </div>

      <div className="card note-card">
        <p className="eyebrow">Next step</p>
        <h2>Use the same email if you come back later.</h2>
        <p className="muted">
          Reopen checkout when you are ready. If you already completed payment elsewhere, sign in
          with the purchase email and refresh membership from Account or from the extension.
        </p>
      </div>
    </section>
  )
}
