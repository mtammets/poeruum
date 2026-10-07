export const trafficNumber = new Intl.NumberFormat('et-EE', { maximumFractionDigits: 1 })
export const trafficPercent = (value: number, total: number) => total > 0 ? `${trafficNumber.format(value / total * 100)}%` : '—'
export const trafficDuration = (value: number) => {
  const seconds = Math.max(0, Math.round(value))
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min${seconds % 60 ? ` ${seconds % 60} s` : ''}`
}
export const trafficDate = (value: string) => new Intl.DateTimeFormat('et-EE', { day: 'numeric', month: 'short', timeZone: 'Europe/Tallinn' }).format(new Date(`${value}T12:00:00Z`))
export const ctaLabels: Record<string, string> = { hero: 'Avalehe algus', nav: 'Menüü', mobile_nav: 'Mobiilimenüü', pricing_flexible: 'Paindlik', pricing_fixed: 'Kindel' }
export const faqLabels: Record<string, string> = {
  pricing: 'Hind', plan_features: 'Paketid', requirements: 'Poe avamine', payments: 'Maksed', shipping: 'Tarne', custom_domain: 'Domeen', google: 'Google', mobile_setup: 'Telefonis seadistamine', buyer_account: 'Ostja konto', order_notice: 'Tellimuste teated', refunds: 'Tagastused', design: 'Kujundus', change_plan: 'Paketi vahetamine', support: 'Klienditugi',
}
export const deviceLabels = { mobile: 'Mobiil', tablet: 'Tahvel', desktop: 'Arvuti' }
export const durationBuckets = [
  { key: 'under_10', label: '<10 s', color: '#64765e' },
  { key: '10_29', label: '10–29 s', color: '#b7a5df' },
  { key: '30_119', label: '30–119 s', color: '#d0f578' },
  { key: '120_plus', label: '2+ min', color: '#9ed8e4' },
] as const
