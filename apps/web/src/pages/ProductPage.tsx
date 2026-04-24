import { Navigate, useParams } from 'react-router-dom'
import { env } from '../lib/env'
import { HomePage } from './HomePage'

export function ProductPage() {
  const { productKey } = useParams()

  if (!productKey || productKey !== env.productKey) {
    return <Navigate to="/" replace />
  }

  return <HomePage />
}
