import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { ProductLanding } from '../components/ProductLanding'
import { fallbackProductsWithPlans, leadfillFallbackProduct } from '../content/productCatalog'
import type { ProductWithPlans } from '../lib/catalog'
import { getProductWithPlansBySlug } from '../lib/catalog'

function getFallbackProductBySlug(slug?: string) {
  return fallbackProductsWithPlans.find((product) => product.slug === slug) ?? null
}

export function ProductPage() {
  const { slug } = useParams()
  const [product, setProduct] = useState<ProductWithPlans | null>(leadfillFallbackProduct)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let active = true

    if (!slug) {
      setNotFound(true)
      return () => {
        active = false
      }
    }

    void getProductWithPlansBySlug(slug)
      .then((result) => {
        if (!active) {
          return
        }

        if (!result) {
          const fallbackProduct = getFallbackProductBySlug(slug)
          setProduct(fallbackProduct)
          setNotFound(!fallbackProduct)
          return
        }

        setProduct(result)
        setNotFound(false)
      })
      .catch((error) => {
        if (!active) {
          return
        }

        console.warn(error)
        setNotFound(false)
        setProduct(getFallbackProductBySlug(slug))
      })

    return () => {
      active = false
    }
  }, [slug])

  if (notFound || !product) {
    return <Navigate to="/products" replace />
  }

  return <ProductLanding product={product} mode="product" />
}
