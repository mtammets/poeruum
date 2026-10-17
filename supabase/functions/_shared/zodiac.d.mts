export type ZodiacSign = 'aries' | 'taurus' | 'gemini' | 'cancer' | 'leo' | 'virgo' | 'libra' | 'scorpio' | 'sagittarius' | 'capricorn' | 'aquarius' | 'pisces'
export const zodiacSigns: readonly { id: ZodiacSign; name: string }[]
export const zodiacPaths: Record<ZodiacSign, string>
