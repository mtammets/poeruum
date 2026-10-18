export const directoryStoryPath = (story) => `/lood/${story.slug}/`
export const directoryStoryReadingMinutes = (story) => Math.max(1, Math.ceil([
  story.intro, ...story.opening, story.quote,
  ...story.sections.flatMap((section) => [section.title, ...section.paragraphs]),
].join(' ').split(/\s+/).length / 180))

export const directoryStorySchema = (story, origin = 'https://kaubamaja.poeruum.ee') => ({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: story.title,
  description: story.intro,
  image: new globalThis.URL(story.image, origin).href,
  url: `${origin}${directoryStoryPath(story)}`,
  mainEntityOfPage: `${origin}${directoryStoryPath(story)}`,
  inLanguage: 'et',
  datePublished: story.publishedAt,
  author: { '@type': 'Organization', name: story.author, url: 'https://poeruum.ee/' },
  publisher: { '@type': 'Organization', name: 'Poeruum', url: 'https://poeruum.ee/' },
  isPartOf: { '@type': 'WebSite', name: 'Poeruumi Kaubamaja', url: `${origin}/` },
})
