import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { BrandMark } from './BrandMark'
import { getDefaultPricingPath } from '../content/productCatalog'
import { env } from '../lib/env'

export function Shell() {
  const location = useLocation()

  const links = [
    {
      to: '/',
      label: 'Product',
      active: location.pathname === '/' || location.pathname.startsWith('/products'),
    },
    {
      to: getDefaultPricingPath(),
      label: 'Pricing',
      active: location.pathname.startsWith('/pricing')
        || location.pathname.startsWith('/checkout/')
        || location.pathname.includes('/pricing'),
    },
    {
      to: '/account',
      label: 'Account',
      active: location.pathname.startsWith('/account') || location.pathname.startsWith('/login'),
    },
  ]

  return (
    <div className="app-shell">
      <header className="site-header">
        <NavLink to="/" className="brand-link">
          <BrandMark size="md" />
          <span className="brand-stack">
            <strong>LeadFill</strong>
            <small>One Profile</small>
          </span>
        </NavLink>

        <div className="header-actions">
          <nav className="nav">
            {links.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={link.active ? 'nav-link active' : 'nav-link'}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <NavLink className="button primary header-cta" to={getDefaultPricingPath()}>
            Unlock Lifetime
          </NavLink>
        </div>
      </header>

      <main className="page-frame">
        <Outlet />
      </main>

      <footer className="site-footer">
        <div>
          <p className="eyebrow">LeadFill</p>
          <p className="footer-copy">
            LeadFill One Profile is a focused Chrome extension for repetitive lead forms.
          </p>
        </div>

        <nav className="footer-nav">
          <NavLink to="/refund" className="footer-link">Refund</NavLink>
          <NavLink to="/privacy" className="footer-link">Privacy</NavLink>
          <NavLink to="/terms" className="footer-link">Terms</NavLink>
        </nav>

        <p className="footer-copy footer-host">{new URL(env.siteUrl).host}</p>
      </footer>
    </div>
  )
}
