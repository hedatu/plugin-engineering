import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { Shell } from './components/Shell'
import { AccountPage } from './pages/AccountPage'
import { CancelPage } from './pages/CancelPage'
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
import { env } from './lib/env'

const router = createBrowserRouter([
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'products', element: <ProductsPage /> },
      { path: 'products/:productKey', element: <ProductPage /> },
      { path: 'pricing', element: <PricingPage /> },
      { path: 'pay/pay-for-batch-chatgpt2obsidian', element: <Navigate to="/" replace /> },
      { path: 'pay/pay-for-batch-chatgpt2obsidian.html', element: <Navigate to="/" replace /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'account', element: <AccountPage /> },
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
