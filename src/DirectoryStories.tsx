import { useEffect, useState } from 'react'
import { directoryStoryPath, directoryStoryReadingMinutes } from '../shared/directory-stories.mjs'
import { initialDirectoryStories, listDirectoryStories, mergeDirectoryStories, STORY_PAGE_SIZE } from './lib/directoryStories'

export const StoryArrow = () => <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M4 12h16m-6-6 6 6-6 6" />
</svg>

export default function DirectoryStories() {
  const [published, setPublished] = useState(initialDirectoryStories)
  const [offset, setOffset] = useState(published.length)
  const [more, setMore] = useState(published.length === STORY_PAGE_SIZE)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    listDirectoryStories().then((stories) => { if (active) { setPublished(stories); setOffset(stories.length); setMore(stories.length === STORY_PAGE_SIZE) } })
      .catch(() => { /* Keep server-rendered and editorial stories available. */ })
    return () => { active = false }
  }, [])
  const loadMore = async () => {
    setBusy(true); setError('')
    try {
      const stories = await listDirectoryStories(offset)
      setPublished((current) => [...current, ...stories.filter((story) => !current.some((existing) => existing.slug === story.slug))])
      setOffset((current) => current + stories.length)
      setMore(stories.length === STORY_PAGE_SIZE)
    } catch { setError('Lugusid ei õnnestunud laadida. Proovi uuesti.') }
    finally { setBusy(false) }
  }
  return <section className="directory-stories" id="poeruumi-lood" aria-labelledby="directory-stories-heading">
    <header className="directory-stories__heading">
      <h2 id="directory-stories-heading">Poeruumi lood</h2>
      <p>Lugemiseks ja kaasamõtlemiseks.</p>
    </header>
    {mergeDirectoryStories(published).map((story) => <article key={story.slug} className="directory-stories__feature">
      <a className="directory-stories__link" href={directoryStoryPath(story)} aria-labelledby={`story-title-${story.slug} story-read-${story.slug}`}>
        <div className="directory-stories__image">
          <img src={story.image} alt={story.imageAlt} width="1536" height="2048" loading="lazy" decoding="async" />
        </div>
        <div className="directory-stories__copy">
          <div className="directory-stories__meta"><span>{story.category}</span><span>{directoryStoryReadingMinutes(story)} min lugemist</span></div>
          <h3 id={`story-title-${story.slug}`}>{story.title}</h3>
          <p>{story.intro}</p>
          <span className="directory-stories__read" id={`story-read-${story.slug}`}>Loe lugu <StoryArrow /></span>
        </div>
      </a>
    </article>)}
    {more && <button className="directory-stories__more" disabled={busy} onClick={() => void loadMore()}>{busy ? 'Laadin…' : 'Veel lugusid'}</button>}
    {error && <p role="alert">{error}</p>}
  </section>
}
