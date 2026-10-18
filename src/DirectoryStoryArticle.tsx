import type { DirectoryStory } from '../shared/directory-stories.mjs'
import DirectoryStoryBody from './DirectoryStoryBody'

export default function DirectoryStoryArticle({ story, preview = false }: { story: DirectoryStory; preview?: boolean }) {
  return <article>
    <header className="directory-story-page__header">
      <h1>{story.title}</h1>
      <p className="directory-story-page__intro">{story.intro}</p>
      <p className="directory-story-page__byline">Poeruumi lood <span aria-hidden="true">/</span> {story.author}</p>
    </header>
    <figure className="directory-story-page__figure">
      <img src={story.image} alt={story.imageAlt} width="1536" height="2048" fetchPriority="high" decoding="async" />
      {story.imageCaption && <figcaption>{story.imageCaption}</figcaption>}
    </figure>
    <DirectoryStoryBody story={story} preview={preview} />
  </article>
}
