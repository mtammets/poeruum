import { directoryStoryPath, directoryStoryReadingMinutes, featuredDirectoryStory as story } from '../shared/directory-stories.mjs'

export const StoryArrow = () => <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M4 12h16m-6-6 6 6-6 6" />
</svg>

export default function DirectoryStories() {
  return <section className="directory-stories" id="poeruumi-lood" aria-labelledby="directory-stories-heading">
    <header className="directory-stories__heading">
      <h2 id="directory-stories-heading">Poeruumi lood</h2>
      <p>Lugemiseks ja kaasamõtlemiseks.</p>
    </header>
    <article className="directory-stories__feature">
      <a className="directory-stories__link" href={directoryStoryPath(story)} aria-labelledby="directory-story-title directory-story-read">
        <div className="directory-stories__image">
          <img src={story.image} alt={story.imageAlt} width="1536" height="1024" loading="lazy" decoding="async" />
        </div>
        <div className="directory-stories__copy">
          <div className="directory-stories__meta"><span>{story.category}</span><span>{directoryStoryReadingMinutes(story)} min lugemist</span></div>
          <h3 id="directory-story-title">{story.title}</h3>
          <p>{story.intro}</p>
          <span className="directory-stories__read" id="directory-story-read">Loe lugu <StoryArrow /></span>
        </div>
      </a>
    </article>
  </section>
}
