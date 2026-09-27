import { useEffect } from 'react'
import { aboutPoeruumContent as content } from '../shared/about-poeruum-content.mjs'
import { renderAboutPoeruumContent } from '../shared/about-poeruum-markup.mjs'
import { applySeoMetadata } from './lib/seo'

const markup = renderAboutPoeruumContent()
const canonicalUrl = 'https://poeruum.ee/mis-on-poeruum/'

export default function AboutPoeruumPage() {
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

  return <div dangerouslySetInnerHTML={{ __html: markup }} />
}
