import { directoryStoryReadingMinutes, type DirectoryStory } from '../shared/directory-stories.mjs'
import { StoryArrow } from './StoryArrow'

export default function DirectoryStoryArticle({ story, preview = false, onDiscover }: { story: DirectoryStory; preview?: boolean; onDiscover?: () => void }) {
  return <article>
    <header className="directory-story-page__header">
      <div className="directory-stories__meta"><span>{story.category}</span><span>{directoryStoryReadingMinutes(story)} min lugemist</span></div>
      <h1>{story.title}</h1>
      <p className="directory-story-page__intro">{story.intro}</p>
      <p className="directory-story-page__byline">Poeruumi lood <span aria-hidden="true">/</span> {story.author}</p>
    </header>
    <figure className="directory-story-page__figure">
      <img src={story.image} alt={story.imageAlt} width="1536" height="2048" fetchPriority="high" decoding="async" />
      {story.imageCaption && <figcaption>{story.imageCaption}</figcaption>}
    </figure>
    <div className="directory-story-page__body">
      {story.opening.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      {story.quote && <blockquote>{story.quote}</blockquote>}
      {story.sections.map((section, index) => <section key={index}>
        <h2>{section.title}</h2>
        {section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      </section>)}
      {!preview && <aside className="directory-story-page__discover" aria-labelledby="story-discover-heading">
        <h2 id="story-discover-heading">{story.storeName || 'Igal lemmikul on oma algus.'}</h2>
        {!story.storeSlug && <p>Avasta Poeruumis loodud Eesti e-poode ja tutvu nende tegijatega.</p>}
        <a className="directory-stories__read" href={story.storeSlug ? `https://${story.storeSlug}.poeruum.ee/?from=kaubamaja` : '/#store-directory-heading'}
          onClick={(event) => {
            if (!story.storeSlug && onDiscover && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
              event.preventDefault()
              onDiscover()
            }
          }}>
          {story.storeSlug ? 'Külasta poodi' : 'Avasta poode'} <StoryArrow />
        </a>
      </aside>}
    </div>
  </article>
}
