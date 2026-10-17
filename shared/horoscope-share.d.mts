import type { ZodiacSign } from '../supabase/functions/_shared/zodiac.mjs'

export const getHoroscopeSharePath: (value: unknown) => string | null
export const getHoroscopeSignFromLocation: (location: { pathname: string; search?: string }) => ZodiacSign | null
export const getHoroscopeShareMetadata: (value: unknown) => {
  title: string
  description: string
  url: string
  image: string
  imageWidth: number
  imageHeight: number
  imageType: string
} | null
