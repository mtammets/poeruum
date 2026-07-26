type SeoMetadata = {
  title: string
  description: string
  socialTitle?: string
  socialDescription?: string
  canonicalUrl: string
  imageUrl?: string
  imageWidth?: number
  imageHeight?: number
  imageType?: string
  type?: 'website' | 'product'
  noIndex?: boolean
  structuredData?: Record<string, unknown>
}

const upsertMeta = (selector: string, attributes: Record<string, string>) => {
  let element = document.head.querySelector<HTMLMetaElement>(selector)
  if (!element) {
    element = document.createElement('meta')
    element.dataset.poeruumSeo = 'true'
    document.head.appendChild(element)
  }
  Object.entries(attributes).forEach(([name, value]) => element!.setAttribute(name, value))
}

const absoluteUrl = (value: string) => {
  try { return new URL(value, window.location.origin).toString() }
  catch { return value }
}

export const applySeoMetadata = ({
  title,
  description,
  socialTitle,
  socialDescription,
  canonicalUrl,
  imageUrl,
  imageWidth,
  imageHeight,
  imageType,
  type = 'website',
  noIndex = false,
  structuredData,
}: SeoMetadata) => {
  const resolvedSocialTitle = socialTitle || title
  const resolvedSocialDescription = socialDescription || description
  document.title = title
  upsertMeta('meta[name="description"]', { name: 'description', content: description })
  upsertMeta('meta[name="robots"]', {
    name: 'robots',
    content: noIndex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large',
  })
  upsertMeta('meta[property="og:title"]', { property: 'og:title', content: resolvedSocialTitle })
  upsertMeta('meta[property="og:description"]', { property: 'og:description', content: resolvedSocialDescription })
  upsertMeta('meta[property="og:type"]', { property: 'og:type', content: type })
  upsertMeta('meta[property="og:url"]', { property: 'og:url', content: canonicalUrl })
  upsertMeta('meta[property="og:locale"]', { property: 'og:locale', content: 'et_EE' })
  upsertMeta('meta[name="twitter:card"]', {
    name: 'twitter:card',
    content: imageUrl ? 'summary_large_image' : 'summary',
  })
  upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: resolvedSocialTitle })
  upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: resolvedSocialDescription })

  if (imageUrl) {
    const resolvedImageUrl = absoluteUrl(imageUrl)
    const resolvedImageType = imageType
      ?? (/\.png(?:[?#]|$)/i.test(resolvedImageUrl)
        ? 'image/png'
        : /\.jpe?g(?:[?#]|$)/i.test(resolvedImageUrl)
          ? 'image/jpeg'
          : /\.webp(?:[?#]|$)/i.test(resolvedImageUrl)
            ? 'image/webp'
            : undefined)
    upsertMeta('meta[property="og:image"]', { property: 'og:image', content: resolvedImageUrl })
    upsertMeta('meta[property="og:image:secure_url"]', { property: 'og:image:secure_url', content: resolvedImageUrl })
    upsertMeta('meta[property="og:image:alt"]', { property: 'og:image:alt', content: resolvedSocialTitle })
    upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: resolvedImageUrl })
    if (resolvedImageType) {
      upsertMeta('meta[property="og:image:type"]', { property: 'og:image:type', content: resolvedImageType })
    } else {
      document.head.querySelector('meta[property="og:image:type"]')?.remove()
    }
    if (imageWidth && imageHeight) {
      upsertMeta('meta[property="og:image:width"]', { property: 'og:image:width', content: String(imageWidth) })
      upsertMeta('meta[property="og:image:height"]', { property: 'og:image:height', content: String(imageHeight) })
    } else {
      document.head.querySelectorAll('meta[property="og:image:width"], meta[property="og:image:height"]')
        .forEach((element) => element.remove())
    }
  } else {
    document.head.querySelectorAll('meta[property="og:image"], meta[property="og:image:secure_url"], meta[property="og:image:alt"], meta[property="og:image:width"], meta[property="og:image:height"], meta[property="og:image:type"], meta[name="twitter:image"]')
      .forEach((element) => element.remove())
  }

  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!canonical) {
    canonical = document.createElement('link')
    canonical.rel = 'canonical'
    canonical.dataset.poeruumSeo = 'true'
    document.head.appendChild(canonical)
  }
  canonical.href = canonicalUrl

  document.head.querySelectorAll('script[data-poeruum-structured-data]').forEach((element) => element.remove())
  if (structuredData) {
    const script = document.createElement('script')
    script.type = 'application/ld+json'
    script.dataset.poeruumStructuredData = 'true'
    script.textContent = JSON.stringify(structuredData).replace(/</g, '\\u003c')
    document.head.appendChild(script)
  }
}

export const isLocalSeoPreview = () => ['localhost', '127.0.0.1'].includes(window.location.hostname)
