import { createContext, useContext } from 'react'

export type DirectoryTheme = 'default' | 'black-friday'

export function directoryPreviewTheme(search: string, development: boolean, verifiedAdmin: boolean): DirectoryTheme | null {
  if (!development && !verifiedAdmin) return null
  const requested = new URLSearchParams(search).get('theme')
  return requested === 'black-friday' || requested === 'default' ? requested : null
}

export const DirectoryThemeContext = createContext<{
  theme: DirectoryTheme; canPreview: boolean; preview: DirectoryTheme | null; keepCampaignVisible: () => () => void
}>({
  theme: 'default', canPreview: false, preview: null, keepCampaignVisible: () => () => {},
})
export const useDirectoryTheme = () => useContext(DirectoryThemeContext)
