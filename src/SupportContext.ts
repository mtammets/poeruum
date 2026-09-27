import { createContext } from 'react'

export const SupportContext = createContext<{
  openSupport: () => void
  unread: number
} | null>(null)
