import { FormEvent, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'

export function LoginPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { sendOtp, verifyOtp, user, signOut } = useAuth()
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [pending, setPending] = useState<'send' | 'verify' | null>(null)

  async function onSendOtp(event: FormEvent) {
    event.preventDefault()
    setPending('send')
    setStatus(null)

    try {
      await sendOtp(email)
      setStatus('Code sent. Check your email, then enter the 6-digit code to continue.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'SEND_OTP_FAILED')
    } finally {
      setPending(null)
    }
  }

  async function onVerifyOtp(event: FormEvent) {
    event.preventDefault()
    setPending('verify')
    setStatus(null)

    try {
      await verifyOtp(email, token)
      navigate(params.get('next') ?? '/account')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'VERIFY_OTP_FAILED')
    } finally {
      setPending(null)
    }
  }

  return (
    <section className="page-grid">
      <div className="page-heading compact-heading">
        <p className="eyebrow">Email OTP</p>
        <h1>Sign in to your LeadFill account.</h1>
        <p className="muted">
          Use the same email from checkout to restore a purchase, refresh membership, and manage
          usage.
        </p>
      </div>

      <div className="login-layout">
        <div className="card form-card">
          <form className="stack" onSubmit={onSendOtp}>
            <label className="field">
              <span>Email</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                type="email"
                required
              />
            </label>
            <button className="button primary" type="submit" disabled={pending !== null}>
              {pending === 'send' ? 'Sending...' : 'Send code'}
            </button>
          </form>

          <form className="stack" onSubmit={onVerifyOtp}>
            <label className="field">
              <span>Verification code</span>
              <input
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="6-digit code"
                required
              />
            </label>
            <button className="button secondary" type="submit" disabled={pending !== null}>
              {pending === 'verify' ? 'Verifying...' : 'Verify and sign in'}
            </button>
          </form>

          {status ? <p className="inline-status">{status}</p> : null}
        </div>

        <div className="card note-card">
          <p className="eyebrow">After sign in</p>
          <h2>Use Account or the extension to refresh membership.</h2>
          <p className="muted">
            Checkout does not unlock LeadFill locally on the success page. Sign in with the same
            email, then refresh membership from Account or from the extension.
          </p>
          <div className="session-box">
            <h3>Current session</h3>
            <p className="muted">Signed in user: {user?.email ?? 'Not signed in'}</p>
            <button className="button subtle" type="button" onClick={() => signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
