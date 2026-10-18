import { useEffect, useState } from 'react'
import { initialDirectoryStories, listDirectoryStories, STORY_PAGE_SIZE } from './lib/directoryStories'

export function useDirectoryStories() {
  const [published, setPublished] = useState(initialDirectoryStories)
  const [offset, setOffset] = useState(published.length)
  const [more, setMore] = useState(published.length === STORY_PAGE_SIZE)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    listDirectoryStories().then((stories) => {
      if (active) { setPublished(stories); setOffset(stories.length); setMore(stories.length === STORY_PAGE_SIZE) }
    }).catch(() => { /* Keep server-rendered stories available. */ })
    return () => { active = false }
  }, [])

  const loadMore = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const stories = await listDirectoryStories(offset)
      setPublished((current) => [...current, ...stories.filter((story) => !current.some((existing) => existing.slug === story.slug))])
      setOffset((current) => current + stories.length)
      setMore(stories.length === STORY_PAGE_SIZE)
    } catch { setError('Lugusid ei õnnestunud laadida. Proovi uuesti.') }
    finally { setBusy(false) }
  }

  return { published, more, busy, error, loadMore }
}
