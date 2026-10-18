import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { directoryStoryPath, type DirectoryStory } from '../shared/directory-stories.mjs'
import type { useDirectoryStories } from './useDirectoryStories'
import { StoryArrow } from './StoryArrow'
import DirectoryStoryDialog from './DirectoryStoryDialog'

type OpenStory = { key: string; story: DirectoryStory; opener: HTMLAnchorElement }

export default function DirectoryStories({ published, more, busy, error, loadMore }: ReturnType<typeof useDirectoryStories>) {
  const [selection, setSelection] = useState<OpenStory | null>(null)
  const openedStories = useRef(new Map<string, OpenStory>())
  const closing = useRef(false)
  useEffect(() => {
    const syncStory = () => {
      const selected = openedStories.current.get(window.history.state?.poeruumDirectoryStory)
      setSelection(selected ?? null)
      closing.current = false
    }
    window.addEventListener('popstate', syncStory)
    return () => window.removeEventListener('popstate', syncStory)
  }, [])
  const openStory = (event: MouseEvent<HTMLAnchorElement>, story: DirectoryStory) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    const selected = { key: crypto.randomUUID(), story, opener: event.currentTarget }
    openedStories.current.set(selected.key, selected)
    // Keep the directory mounted and let the browser Back button close the story.
    window.history.pushState({ ...window.history.state, poeruumDirectoryStory: selected.key }, '', window.location.href)
    setSelection(selected)
  }
  const closeStory = () => {
    if (closing.current) return
    if (selection && window.history.state?.poeruumDirectoryStory === selection.key) {
      closing.current = true
      window.history.back()
    } else setSelection(null)
  }
  if (!published.length) return null
  return <section className="directory-stories" id="poeruumi-lood" aria-labelledby="directory-stories-heading">
    <header className="directory-stories__heading">
      <h2 id="directory-stories-heading">Poeruumi lood</h2>
    </header>
    {published.map((story) => <article key={story.slug} className="directory-stories__feature">
      <a className="directory-stories__link" href={directoryStoryPath(story)} onClick={(event) => openStory(event, story)} aria-haspopup="dialog" aria-labelledby={`story-title-${story.slug} story-read-${story.slug}`}>
        <div className="directory-stories__image">
          <img src={story.image} alt={story.imageAlt} width="1536" height="2048" loading="lazy" decoding="async" />
        </div>
        <div className="directory-stories__copy">
          <h3 id={`story-title-${story.slug}`}>{story.title}</h3>
          <p>{story.intro}</p>
          <span className="directory-stories__read" id={`story-read-${story.slug}`}>Loe lugu <StoryArrow /></span>
        </div>
      </a>
    </article>)}
    {more && <button className="directory-stories__more" disabled={busy} onClick={() => void loadMore()}>{busy ? 'Laadin…' : 'Veel lugusid'}</button>}
    {error && <p role="alert">{error}</p>}
    {selection && <DirectoryStoryDialog story={selection.story} opener={selection.opener}
      onClose={closeStory} />}
  </section>
}
