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
  opening: string[]
  quote: string
  sections: { title: string; paragraphs: string[] }[]
}

export const directoryStories: DirectoryStory[]
export const featuredDirectoryStory: DirectoryStory
export const directoryStoryPath: (story: DirectoryStory) => string
export const getDirectoryStory: (pathname: string) => DirectoryStory | undefined
export const directoryStoryReadingMinutes: (story: DirectoryStory) => number
export const directoryStorySchema: (story: DirectoryStory, origin?: string) => Record<string, unknown>
