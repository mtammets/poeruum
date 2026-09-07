import { useEffect } from 'react'
import { directoryStoryPath, directoryStoryReadingMinutes, directoryStorySchema, type DirectoryStory } from '../shared/directory-stories.mjs'
import { StoryArrow } from './DirectoryStories'
import StoreDirectoryLayout from './StoreDirectoryLayout'
import { applySeoMetadata } from './lib/seo'

export default function DirectoryStoryPage({ story }: { story?: DirectoryStory }) {
  useEffect(() => {
    if (!story) {
      applySeoMetadata({
        title: 'Lugu ei leitud — Poeruumi lood',
        description: 'Sellel aadressil lugu ei ole. Avasta Poeruumi lugusid Kaubamaja avalehel.',
        canonicalUrl: `https://kaubamaja.poeruum.ee${window.location.pathname}`,
        noIndex: true,
      })
      return
    }
    applySeoMetadata({
      title: `${story.title} — Poeruumi lood`,
      description: story.intro,
      canonicalUrl: `https://kaubamaja.poeruum.ee${directoryStoryPath(story)}`,
      imageUrl: `https://kaubamaja.poeruum.ee${story.image}`,
      imageWidth: 1536,
      imageHeight: 1024,
      type: 'article',
      structuredData: directoryStorySchema(story),
    })
  }, [story])

  return <StoreDirectoryLayout isStory>
    <div className="directory-story-page">
      <a className="directory-story-page__back" href="/#poeruumi-lood"><StoryArrow /> Tagasi Poeruumi lugude juurde</a>
      {story ? <article>
        <header className="directory-story-page__header">
          <div className="directory-stories__meta"><span>{story.category}</span><span>{directoryStoryReadingMinutes(story)} min lugemist</span></div>
          <h1>{story.title}</h1>
          <p className="directory-story-page__intro">{story.intro}</p>
          <p className="directory-story-page__byline">Poeruumi lood <span aria-hidden="true">/</span> {story.author}</p>
        </header>
        <figure className="directory-story-page__figure">
          <img src={story.image} alt={story.imageAlt} width="1536" height="1024" fetchPriority="high" decoding="async" />
          <figcaption>{story.imageCaption}</figcaption>
        </figure>
        <div className="directory-story-page__body">
          {story.opening.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          <blockquote>{story.quote}</blockquote>
          {story.sections.map((section) => <section key={section.title}>
            <h2>{section.title}</h2>
            {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </section>)}
          <aside className="directory-story-page__discover" aria-labelledby="story-discover-heading">
            <span className="directory-story-page__end-mark" aria-hidden="true">✳</span>
            <h2 id="story-discover-heading">Igal lemmikul on oma algus.</h2>
            <p>Avasta Poeruumis loodud Eesti e-poode ja tutvu nende tegijatega.</p>
            <a className="directory-stories__read" href="/#store-directory-heading">Avasta poode <StoryArrow /></a>
          </aside>
        </div>
      </article> : <header className="directory-story-page__header">
        <h1>Seda lugu ei leitud.</h1>
        <p className="directory-story-page__intro">Vaata Kaubamaja avalehelt, mida meil praegu lugeda on.</p>
      </header>}
    </div>
  </StoreDirectoryLayout>
}
