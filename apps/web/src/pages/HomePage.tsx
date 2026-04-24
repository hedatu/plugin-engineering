import { useEffect, useState } from 'react'
import { ProductLanding } from '../components/ProductLanding'
import { leadfillFallbackProduct, leadfillProductKey } from '../content/productCatalog'
import type { ProductWithPlans } from '../lib/catalog'
import { getProductWithPlans } from '../lib/catalog'

export function HomePage() {
  const [product, setProduct] = useState<ProductWithPlans | null>(leadfillFallbackProduct)

  useEffect(() => {
    let active = true

    void getProductWithPlans(leadfillProductKey)
      .then((result) => {
        if (!active) {
          return
        }

        if (!result) {
          setProduct(leadfillFallbackProduct)
          return
        }

        setProduct(result)
      })
      .catch((fetchError) => {
        if (active) {
          setProduct(leadfillFallbackProduct)
          console.warn(fetchError)
        }
      })

    return () => {
      active = false
    }
  }, [])

  return product ? <ProductLanding product={product} mode="home" /> : null
}
