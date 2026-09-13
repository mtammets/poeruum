export type DispatchTime = {
  enabled: boolean
  min: number | null
  max: number | null
  unit: 'business_days' | 'weeks'
}

export function getDispatchTimeError(value: unknown): string | null {
  if (value == null) return null
  if (typeof value !== 'object') return 'Kontrolli väljasaatmise aja seadistust.'
  const time = value as Partial<DispatchTime>
  if (typeof time.enabled !== 'boolean' || (time.unit !== 'business_days' && time.unit !== 'weeks')) {
    return 'Kontrolli väljasaatmise aja seadistust.'
  }
  if (!time.enabled) return null
  if (typeof time.min !== 'number' || typeof time.max !== 'number'
    || !Number.isSafeInteger(time.min) || !Number.isSafeInteger(time.max)
    || time.min < 1 || time.max < 1) {
    return 'Sisesta algus ja lõpp positiivsete täisarvudena.'
  }
  if (time.min > time.max) return 'Ajavahemiku lõpp ei tohi olla algusest väiksem.'
  return null
}

export function formatDispatchTime(value: unknown): string {
  if (getDispatchTimeError(value)) return ''
  const time = value as DispatchTime | null | undefined
  if (!time?.enabled) return ''
  const range = time.min === time.max ? String(time.min) : `${time.min}–${time.max}`
  return `Saadame ${range} ${time.unit === 'weeks' ? 'nädalaga' : 'tööpäevaga'}`
}
