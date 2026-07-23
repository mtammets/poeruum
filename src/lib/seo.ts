type SeoMetadata = {
  title: string
  description: string
  canonicalUrl: string
  imageUrl?: string
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
  canonicalUrl,
  imageUrl,
  type = 'website',
  noIndex = false,
  structuredData,
}: SeoMetadata) => {
  document.title = title
  upsertMeta('meta[name="description"]', { name: 'description', content: description })
  upsertMeta('meta[name="robots"]', {
    name: 'robots',
    content: noIndex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large',
  })
  upsertMeta('meta[property="og:title"]', { property: 'og:title', content: title })
  upsertMeta('meta[property="og:description"]', { property: 'og:description', content: description })
  upsertMeta('meta[property="og:type"]', { property: 'og:type', content: type })
  upsertMeta('meta[property="og:url"]', { property: 'og:url', content: canonicalUrl })
  upsertMeta('meta[property="og:locale"]', { property: 'og:locale', content: 'et_EE' })
  upsertMeta('meta[name="twitter:card"]', {
    name: 'twitter:card',
    content: imageUrl ? 'summary_large_image' : 'summary',
  })
  upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: title })
  upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: description })

  if (imageUrl) {
    const resolvedImageUrl = absoluteUrl(imageUrl)
    upsertMeta('meta[property="og:image"]', { property: 'og:image', content: resolvedImageUrl })
    upsertMeta('meta[property="og:image:alt"]', { property: 'og:image:alt', content: title })
    upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: resolvedImageUrl })
  } else {
    document.head.querySelectorAll('[data-poeruum-seo][property="og:image"], [data-poeruum-seo][property="og:image:alt"], [data-poeruum-seo][name="twitter:image"]')
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
