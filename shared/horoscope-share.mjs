import { zodiacSigns } from '../supabase/functions/_shared/zodiac.mjs'

export const getHoroscopeShareMetadata = (value) => {
  const sign = zodiacSigns.find((item) => item.id === value)
  if (!sign) return null
  return {
    title: `${sign.name} · tänane horoskoop — Poeruumi Kaubamaja`,
    description: 'Loe oma tänast horoskoopi Poeruumi Kaubamajas.',
    url: `https://kaubamaja.poeruum.ee/?horoskoop=${sign.id}`,
    image: `https://kaubamaja.poeruum.ee/images/horoscope/${sign.id}.png`,
    imageWidth: 1200,
    imageHeight: 630,
    imageType: 'image/png',
  }
}
