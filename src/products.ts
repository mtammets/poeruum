export type ProductImageTransform = {
  x: number
  y: number
  scale: number
}

export type ProductImageVariant = {
  url: string
  width: number
  height: number
  bytes: number
}

export type ProductImageAsset = {
  mimeType: string
  variants: {
    thumb: ProductImageVariant
    medium: ProductImageVariant
    large: ProductImageVariant
    master: ProductImageVariant
  }
}

export type Product = {
  id: string
  categoryId?: string
  name: string
  image: string
  gallery?: string[]
  alt: string
  description?: string
  price?: number
  salePrice?: number
  objectPosition?: string
  imageTransforms?: Record<string, ProductImageTransform>
  imageVariants?: Record<string, ProductImageAsset>
  slug?: string
  seoTitle?: string
  searchVisible?: boolean
  stock?: number
  oneOfAKind?: boolean
  options?: Array<{
    name: string
    values: string[]
  }>
}

// Product content is loaded from Supabase. Keep the bundled fallback empty so
// local assets can never silently appear in a real or preview storefront.
export const products: Product[] = []
