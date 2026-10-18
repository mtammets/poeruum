import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DirectoryStory } from '../shared/directory-stories.mjs'
import DirectoryStoryBody from './DirectoryStoryBody'

export default function DirectoryStoryHero({ story, isOnlyStory = false, preview = false }: {
  story: DirectoryStory; isOnlyStory?: boolean; preview?: boolean
}) {
  const [opened, setOpened] = useState(false)
  const expanded = preview || opened
  const canCollapse = expanded && !preview
  const hero = useRef<HTMLElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const restoreFocus = useRef(false)
  useLayoutEffect(() => {
    if (preview) return
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
    const section = body.current
    if (expanded && section) {
      section.focus({ preventScroll: true })
      let cancelled = false
      // Wait until the article has its full height before positioning it for reading.
      void Promise.allSettled(section.getAnimations().map(animation => animation.finished)).then(() => {
        if (!cancelled) section.scrollIntoView({ block: 'start', behavior })
      })
      return () => { cancelled = true }
    }
    else if (restoreFocus.current) {
      restoreFocus.current = false
      toggle.current?.focus({ preventScroll: true })
      hero.current?.scrollIntoView({ block: 'start', behavior })
    }
  }, [expanded, preview])
  const close = () => {
    restoreFocus.current = true
    setOpened(false)
  }
  useEffect(() => {
    if (!canCollapse) return
    const closeOutside = (event: MouseEvent) => {
      const target = event.target as Element
      const readingMargin = target.matches('.directory-story-hero, .directory-story-hero__expansion, .directory-story-hero__overflow, .directory-story-hero__full-story')
      if ((event.composedPath().includes(hero.current!) && !readingMargin) || window.getSelection()?.toString()) return
      // Keep focus on a link or form control the reader has chosen outside the story.
      restoreFocus.current = !target.closest('a, button, input, textarea, select, [contenteditable], [role="button"]')
      setOpened(false)
    }
    document.addEventListener('click', closeOutside)
    return () => document.removeEventListener('click', closeOutside)
  }, [canCollapse])

  return <article ref={hero} id={isOnlyStory ? 'poeruumi-lood' : undefined}
    className={`store-directory__hero directory-story-hero${expanded ? ' is-expanded' : ''}`} aria-labelledby="featured-story-title">
    <div className="directory-story-hero__preview" data-collapsible={canCollapse || undefined}
      onClick={canCollapse ? event => {
        if ((event.target as Element).closest('button, a') || window.getSelection()?.toString()) return
        close()
      } : undefined}>
      {canCollapse && <button type="button" className="directory-story-hero__header-close" aria-label="Tagasi"
        aria-controls="featured-story-body" aria-expanded={expanded} onClick={close} />}
      <header className="directory-story-hero__intro">
        {story.storeName && <p className="directory-story-hero__byline">{story.storeName}</p>}
        <h1 id="featured-story-title">{story.title}</h1>
        <p className="directory-story-hero__excerpt">{story.intro}</p>
        <button ref={toggle} className="store-directory__browse directory-story-hero__toggle" type="button"
          aria-expanded={expanded} aria-hidden={expanded} inert={expanded} aria-controls="featured-story-body" onClick={() => setOpened(true)}>
          Loe edasi
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 4v12m-5-5 5 5 5-5" /></svg>
        </button>
      </header>
      <figure className="directory-story-hero__figure">
        <img src={story.image} alt={story.imageAlt} width="1536" height="2048" fetchPriority="high" decoding="async" />
        {story.imageCaption && <figcaption>{story.imageCaption}</figcaption>}
      </figure>
    </div>
    <div ref={body} id="featured-story-body" className="directory-story-hero__expansion" tabIndex={-1} aria-hidden={!expanded} inert={!expanded}>
      <div className="directory-story-hero__overflow">
        <div className="directory-story-hero__full-story">
          <DirectoryStoryBody story={story} preview={preview} />
          {!preview && <div className="directory-story-hero__end">
            <button type="button" className="directory-story-hero__close" onClick={close}>Tagasi <span aria-hidden="true">↑</span></button>
          </div>}
        </div>
      </div>
    </div>
  </article>
}
