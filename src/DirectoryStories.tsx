import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { directoryStoryPath, type DirectoryStory } from '../shared/directory-stories.mjs'
import { initialDirectoryStories, listDirectoryStories, STORY_PAGE_SIZE } from './lib/directoryStories'
import { StoryArrow } from './StoryArrow'
import DirectoryStoryDialog from './DirectoryStoryDialog'

type OpenStory = { key: string; story: DirectoryStory; opener: HTMLAnchorElement }

export default function DirectoryStories() {
  const [published, setPublished] = useState(initialDirectoryStories)
  const [offset, setOffset] = useState(published.length)
  const [more, setMore] = useState(published.length === STORY_PAGE_SIZE)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selection, setSelection] = useState<OpenStory | null>(null)
  const openedStories = useRef(new Map<string, OpenStory>())
  const closing = useRef(false)
  const discoverAfterClose = useRef(false)
  const initialAnchorHandled = useRef(false)
  useEffect(() => {
    if (!published.length || initialAnchorHandled.current) return
    initialAnchorHandled.current = true
    // The fragment can be resolved before asynchronously loaded stories exist.
    if (window.location.hash === '#poeruumi-lood') {
      document.getElementById('poeruumi-lood')?.scrollIntoView({ behavior: 'instant' })
    }
  }, [published.length])
  useEffect(() => {
    let frame = 0
    const syncStory = () => {
      const selected = openedStories.current.get(window.history.state?.poeruumDirectoryStory)
      setSelection(selected ?? null)
      closing.current = false
      if (!selected && discoverAfterClose.current) {
        discoverAfterClose.current = false
        frame = window.requestAnimationFrame(() => {
          const heading = document.getElementById('store-directory-heading')
          heading?.scrollIntoView({ block: 'start' })
          if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }) }
        })
      }
    }
    window.addEventListener('popstate', syncStory)
    return () => { window.removeEventListener('popstate', syncStory); window.cancelAnimationFrame(frame) }
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
  const closeStory = (discover = false) => {
    if (closing.current) return
    discoverAfterClose.current = discover
    if (selection && window.history.state?.poeruumDirectoryStory === selection.key) {
      closing.current = true
      window.history.back()
    } else setSelection(null)
  }
  useEffect(() => {
    let active = true
    listDirectoryStories().then((stories) => { if (active) { setPublished(stories); setOffset(stories.length); setMore(stories.length === STORY_PAGE_SIZE) } })
      .catch(() => { /* Keep server-rendered stories available. */ })
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
      onClose={() => closeStory()} onDiscover={() => closeStory(true)} />}
  </section>
}
