import { Link, Navigate, useLocation } from 'react-router-dom'
import { getDefaultPricingPath, getDefaultProductPath } from '../content/productCatalog'

const localePrefixes = new Set(['en', 'es', 'ja', 'zh-cn'])

const canonicalPaths = new Set([
  '/',
  '/products',
  getDefaultProductPath(),
  getDefaultPricingPath(),
  '/pricing',
  '/account',
  '/login',
  '/privacy',
  '/refund',
  '/terms',
  '/checkout/start',
  '/checkout/success',
  '/checkout/cancel',
])

const directAliases: Record<string, string> = {
  '/account.html': '/account',
  '/checkout/cancel.html': '/checkout/cancel',
  '/checkout/success.html': '/checkout/success',
  '/entitlement': '/account?productKey=leadfill-one-profile',
  '/entitlement.html': '/account?productKey=leadfill-one-profile',
  '/pricing.html': '/pricing',
  '/privacy.html': '/privacy',
  '/product.html': getDefaultProductPath(),
  '/refund.html': '/refund',
  '/terms.html': '/terms',
}

function normalizePath(pathname: string) {
  const parts = pathname.split('/').filter(Boolean)
  const [first, ...rest] = parts

  if (first && localePrefixes.has(first.toLowerCase())) {
    return `/${rest.join('/')}`
  }

  return pathname
}

function mergeSearch(target: string, search: string) {
  if (!search) {
    return target
  }

  return target.includes('?') ? `${target}&${search.slice(1)}` : `${target}${search}`
}

function resolveLegacyRoute(pathname: string, search: string) {
  const withoutLocale = normalizePath(pathname)
  const withoutTrailingSlash =
    withoutLocale.length > 1 && withoutLocale.endsWith('/')
      ? withoutLocale.slice(0, -1)
      : withoutLocale
  const withoutHtml = withoutTrailingSlash.endsWith('.html')
    ? withoutTrailingSlash.slice(0, -5)
    : withoutTrailingSlash

  if (canonicalPaths.has(withoutTrailingSlash) && withoutTrailingSlash !== pathname) {
    return mergeSearch(withoutTrailingSlash, search)
  }

  if (canonicalPaths.has(withoutHtml) && withoutHtml !== pathname) {
    return mergeSearch(withoutHtml, search)
  }

  const directTarget = directAliases[withoutTrailingSlash] ?? directAliases[withoutHtml]
  if (directTarget) {
    return mergeSearch(directTarget, search)
  }

  if (withoutHtml.startsWith('/pay/')) {
    return mergeSearch(getDefaultProductPath(), search)
  }

  return null
}

export function LegacyAliasPage() {
  const location = useLocation()
  const target = resolveLegacyRoute(location.pathname, location.search)

  if (target) {
    return <Navigate to={target} replace />
  }

  return (
    <section className="page-grid narrow-page">
      <div className="card status-card">
        <p className="eyebrow">Page not found</p>
        <h2>This page moved when the site was rewritten around LeadFill.</h2>
        <p className="muted">
          Older links from the previous payment hub or legacy `.html` routes may no longer match
          the current product-first site structure.
        </p>
        <div className="action-row">
          <Link className="button primary" to={getDefaultProductPath()}>Open LeadFill product page</Link>
          <Link className="button subtle" to={getDefaultPricingPath()}>Open pricing</Link>
        </div>
      </div>
    </section>
  )
}
