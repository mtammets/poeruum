import { useEffect, useState } from 'react'
import { directoryStoryPath, directoryStorySchema, getDirectoryStory, type DirectoryStory } from '../shared/directory-stories.mjs'
import { StoryArrow } from './DirectoryStories'
import StoreDirectoryLayout from './StoreDirectoryLayout'
import { applySeoMetadata } from './lib/seo'
import DirectoryStoryArticle from './DirectoryStoryArticle'
import { initialDirectoryStories, loadDirectoryStory } from './lib/directoryStories'

export default function DirectoryStoryPage({ story: initialStory }: { story?: DirectoryStory }) {
  const [story, setStory] = useState(() => initialStory || getDirectoryStory(window.location.pathname)
    || initialDirectoryStories().find((story) => directoryStoryPath(story).replace(/\/$/, '') === window.location.pathname.replace(/\/$/, '')))
  const [loading, setLoading] = useState(!story)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    if (initialStory) return
    let active = true
    loadDirectoryStory(window.location.pathname).then((result) => { if (active) { setStory(result); setError('') } })
      .catch((error) => { if (active) setError(error.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [initialStory, reload])
  useEffect(() => {
    if (loading || error) return
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
      imageUrl: new URL(story.image, 'https://kaubamaja.poeruum.ee').href,
      imageWidth: story.storeSlug ? undefined : 1536,
      imageHeight: story.storeSlug ? undefined : 2048,
      type: 'article',
      structuredData: directoryStorySchema(story),
    })
  }, [story, loading, error])

  return <StoreDirectoryLayout isStory>
    <div className="directory-story-page">
      <a className="directory-story-page__back" href="/#poeruumi-lood"><StoryArrow /> Tagasi Poeruumi lugude juurde</a>
      {story ? <DirectoryStoryArticle story={story} /> : loading ? <p role="status">Laadin lugu…</p> : error ? <div>
        <p role="alert">{error}</p><button onClick={() => { setLoading(true); setReload((n) => n + 1) }}>Proovi uuesti</button>
      </div> : <header className="directory-story-page__header">
        <h1>Seda lugu ei leitud.</h1>
        <p className="directory-story-page__intro">Vaata Kaubamaja avalehelt, mida meil praegu lugeda on.</p>
      </header>}
    </div>
  </StoreDirectoryLayout>
}
