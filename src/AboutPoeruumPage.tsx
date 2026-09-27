import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { aboutPoeruumContent as content } from '../shared/about-poeruum-content.mjs'
import { renderAboutPoeruumContent } from '../shared/about-poeruum-markup.mjs'
import HomepageStorePhone from './HomepageStorePhone'
import { applySeoMetadata } from './lib/seo'
import { loadPublicShowcase } from './lib/showcase'
import { isSupabaseConfigured } from './lib/supabase'

const markup = { __html: renderAboutPoeruumContent() }
const canonicalUrl = 'https://poeruum.ee/mis-on-poeruum/'

export default function AboutPoeruumPage() {
  const [phoneTarget, setPhoneTarget] = useState<HTMLElement | null>(null)
  const [showcase, setShowcase] = useState<Awaited<ReturnType<typeof loadPublicShowcase>> | null>(null)
  const attachContent = useCallback((node: HTMLDivElement | null) => {
    setPhoneTarget(node?.querySelector<HTMLElement>('#about-poeruum-phone') ?? null)
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let active = true
    const load = (refresh = false) => loadPublicShowcase(refresh).then((value) => {
      if (active) setShowcase(value)
    }).catch(() => { /* Keep the last successful phone preview on a refresh failure. */ })
    void load()
    const refresh = () => { void load(true) }
    window.addEventListener('focus', refresh)
    return () => { active = false; window.removeEventListener('focus', refresh) }
  }, [])

  useEffect(() => {
    applySeoMetadata({
      title: content.title,
      description: content.seoDescription,
      canonicalUrl,
      structuredData: {
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'AboutPage',
            '@id': `${canonicalUrl}#page`,
            name: content.title,
            description: content.seoDescription,
            url: canonicalUrl,
            inLanguage: 'et',
            isPartOf: { '@type': 'WebSite', name: 'Poeruum', url: 'https://poeruum.ee/' },
            about: {
              '@type': 'SoftwareApplication',
              name: 'Poeruum',
              applicationCategory: 'BusinessApplication',
              operatingSystem: 'Web browser',
            },
          },
          {
            '@type': 'FAQPage',
            '@id': `${canonicalUrl}#faq`,
            mainEntity: content.faqs.map((faq) => ({
              '@type': 'Question',
              name: faq.question,
              acceptedAnswer: { '@type': 'Answer', text: faq.answer },
            })),
          },
        ],
      },
    })
  }, [])

  return <>
    <div ref={attachContent} dangerouslySetInnerHTML={markup} />
    {phoneTarget && showcase?.store && showcase.storefront && showcase.products.length > 0 && createPortal(
      <HomepageStorePhone store={showcase.storefront} products={showcase.products} url={showcase.store.url} />,
      phoneTarget,
    )}
  </>
}
