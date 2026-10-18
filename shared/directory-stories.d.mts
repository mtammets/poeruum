export type DirectoryStory = {
  slug: string
  title: string
  category: string
  intro: string
  image: string
  imageAlt: string
  imageCaption: string
  author: string
  publishedAt: string
  storeName?: string
  storeSlug?: string
  opening: string[]
  quote: string
  sections: { title: string; paragraphs: string[] }[]
}

export const directoryStoryPath: (story: DirectoryStory) => string
export const directoryStoryReadingMinutes: (story: DirectoryStory) => number
export const directoryStorySchema: (story: DirectoryStory, origin?: string) => Record<string, unknown>
