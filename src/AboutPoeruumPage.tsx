import { useEffect } from 'react'
import { aboutPoeruumContent as content } from '../shared/about-poeruum-content.mjs'
import { Brand } from './Brand'
import { applySeoMetadata } from './lib/seo'

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

  return <main className="about-poeruum">
    <nav className="about-poeruum__nav" aria-label="Põhinavigatsioon">
      <a href="/" aria-label="Poeruumi avaleht"><Brand /></a>
      <a className="about-poeruum__nav-cta" href="/#hind">Loo oma pood <span aria-hidden="true">↗</span></a>
    </nav>

    <header className="about-poeruum__hero">
      <h1>{content.title}</h1>
      <p>{content.definition}</p>
      <div className="about-poeruum__hero-links">
        <a href="/#hind">Loo oma pood <span aria-hidden="true">→</span></a>
        <a href="https://kaubamaja.poeruum.ee/">Vaata Kaubamaja</a>
      </div>
    </header>

    <section className="about-poeruum__workflow" aria-labelledby="about-workflow-title">
      <header>
        <h2 id="about-workflow-title">{content.workflowHeading}</h2>
        <p>{content.workflowIntro}</p>
      </header>
      <div className="about-poeruum__capabilities">
        {content.capabilities.map((item, index) => <article key={item.title}>
          <span aria-hidden="true">0{index + 1}</span>
          <h3>{item.title}</h3>
          <p>{item.text}</p>
        </article>)}
      </div>
    </section>

    <section className="about-poeruum__audience" aria-labelledby="about-audience-title">
      <header>
        <h2 id="about-audience-title">{content.audienceHeading}</h2>
        <p>{content.audienceIntro}</p>
      </header>
      <div>
        {content.audiences.map((item) => <article key={item.title}>
          <h3>{item.title}</h3>
          <p>{item.text}</p>
        </article>)}
      </div>
    </section>

    <aside className="about-poeruum__alternative" aria-labelledby="about-alternative-title">
      <h2 id="about-alternative-title">{content.alternativeHeading}</h2>
      <p>{content.alternativeText}</p>
    </aside>

    <section className="about-poeruum__steps" aria-labelledby="about-steps-title">
      <h2 id="about-steps-title">{content.stepsHeading}</h2>
      <ol>
        {content.steps.map((step, index) => <li key={step.title}>
          <span>{index + 1}</span>
          <div><h3>{step.title}</h3><p>{step.text}</p></div>
        </li>)}
      </ol>
    </section>

    <section className="about-poeruum__faq" aria-labelledby="about-faq-title">
      <h2 id="about-faq-title">{content.faqHeading}</h2>
      <div>
        {content.faqs.map((faq, index) => <details key={faq.question} open={index === 0}>
          <summary>{faq.question}<span aria-hidden="true">+</span></summary>
          <p>{faq.answer}</p>
        </details>)}
      </div>
    </section>

    <section className="about-poeruum__closing">
      <p>Valmis alustama?</p>
      <h2>Sinu pood võib olla järgmine.</h2>
      <div><a href="/#hind">Loo oma pood <span aria-hidden="true">→</span></a><a href="https://kaubamaja.poeruum.ee/">Vaata poode</a></div>
    </section>

    <footer className="about-poeruum__footer">
      <a href="/"><Brand /></a>
      <div><a href="/kasutustingimused">Kasutustingimused</a><a href="/privaatsus">Privaatsus</a><span>© 2026 Poeruum</span></div>
    </footer>
  </main>
}
