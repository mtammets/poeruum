export type DirectoryStory = {
  slug: string
  title: string
  category: string
  intro: string
  image: string
  imageWidth?: number
  imageHeight?: number
  imageType?: string
  imageAlt: string
  imageCaption: string
  bodyImage?: { src: string; alt: string; caption: string }
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
