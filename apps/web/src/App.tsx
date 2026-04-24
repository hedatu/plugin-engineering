import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { Shell } from './components/Shell'
import { getDefaultPricingPath } from './content/productCatalog'
import { AccountPage } from './pages/AccountPage'
import { CancelPage } from './pages/CancelPage'
import { CheckoutStartPage } from './pages/CheckoutStartPage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { LegacyAliasPage } from './pages/LegacyAliasPage'
import { ProductPage } from './pages/ProductPage'
import { ProductsPage } from './pages/ProductsPage'
import { PricingPage } from './pages/PricingPage'
import { PrivacyPage } from './pages/PrivacyPage'
import { RefundPage } from './pages/RefundPage'
import { SuccessPage } from './pages/SuccessPage'
import { TermsPage } from './pages/TermsPage'

const router = createBrowserRouter([
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'products', element: <ProductsPage /> },
      { path: 'products/:slug', element: <ProductPage /> },
      { path: 'products/:slug/pricing', element: <PricingPage /> },
      { path: 'pricing', element: <Navigate to={getDefaultPricingPath()} replace /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'account', element: <AccountPage /> },
      { path: 'checkout/start', element: <CheckoutStartPage /> },
      { path: 'checkout/success', element: <SuccessPage /> },
      { path: 'checkout/cancel', element: <CancelPage /> },
      { path: 'privacy', element: <PrivacyPage /> },
      { path: 'terms', element: <TermsPage /> },
      { path: 'refund', element: <RefundPage /> },
      { path: '*', element: <LegacyAliasPage /> },
    ],
  },
])

export function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  )
}
