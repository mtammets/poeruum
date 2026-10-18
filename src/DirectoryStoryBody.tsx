import { Fragment, useId } from 'react'
import type { DirectoryStory } from '../shared/directory-stories.mjs'
import { StoryArrow } from './StoryArrow'

export default function DirectoryStoryBody({ story, preview = false }: {
  story: DirectoryStory; preview?: boolean
}) {
  const discoverHeading = useId()
  const photo = story.bodyImage && <figure className="directory-story-page__body-image">
    <img src={story.bodyImage.src} alt={story.bodyImage.alt} loading="lazy" decoding="async" />
    {story.bodyImage.caption && <figcaption>{story.bodyImage.caption}</figcaption>}
  </figure>
  return <div className="directory-story-page__body">
    {story.opening.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
    {story.quote && <blockquote>{story.quote}</blockquote>}
    {!story.sections.length && photo}
    {story.sections.map((section, index) => <Fragment key={index}>
      {index === Math.floor(story.sections.length / 2) && photo}
      <section>
        <h2>{section.title}</h2>
        {section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      </section>
    </Fragment>)}
    {!preview && story.storeSlug && <aside className="directory-story-page__discover" aria-labelledby={story.storeName ? discoverHeading : undefined}>
      {story.storeName && <h2 id={discoverHeading}>{story.storeName}</h2>}
      <a className="directory-stories__read" href={`https://${story.storeSlug}.poeruum.ee/?from=kaubamaja`}>
        Külasta poodi <StoryArrow />
      </a>
    </aside>}
  </div>
}
