import { zodiacSigns } from '../supabase/functions/_shared/zodiac.mjs'

const shareSigns = zodiacSigns.map((sign) => ({
  ...sign,
  path: `/horoskoop/${sign.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()}/`,
}))

export const getHoroscopeSharePath = (value) => shareSigns.find((sign) => sign.id === value)?.path || null

export const getHoroscopeSignFromLocation = ({ pathname, search = '' }) => {
  const pathSign = shareSigns.find((sign) => sign.path === pathname.replace(/\/?$/, '/'))
  if (pathSign) return pathSign.id
  if (pathname !== '/') return null
  const legacySign = new globalThis.URLSearchParams(search).get('horoskoop')
  return shareSigns.find((sign) => sign.id === legacySign)?.id || null
}

export const getHoroscopeShareMetadata = (value) => {
  const sign = shareSigns.find((item) => item.id === value)
  if (!sign) return null
  return {
    title: `${sign.name} · tänane horoskoop — Poeruumi Kaubamaja`,
    description: 'Loe oma tänast horoskoopi Poeruumi Kaubamajas.',
    url: `https://kaubamaja.poeruum.ee${sign.path}`,
    image: `https://kaubamaja.poeruum.ee/images/horoscope/${sign.id}.png`,
    imageWidth: 1200,
    imageHeight: 630,
    imageType: 'image/png',
  }
}
