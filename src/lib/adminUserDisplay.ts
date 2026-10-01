import type { AdminUserRow } from './adminUserOverview'
import { getStorefrontCanonicalUrl } from './storefrontUrl'

export const date = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('et-EE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Tallinn' }).format(new Date(value)) : 'Andmed puuduvad'
export const relative = (value: string | null | undefined) => {
  if (!value) return '—'
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000))
  if (minutes < 2) return 'just nüüd'
  if (minutes < 60) return `${minutes} min tagasi`
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h tagasi`
  if (minutes < 43200) return `${Math.floor(minutes / 1440)} p tagasi`
  return new Intl.DateTimeFormat('et-EE', { day: 'numeric', month: 'short' }).format(new Date(value))
}
export const money = (cents: number | undefined) => cents == null ? '—' : new Intl.NumberFormat('et-EE', { style: 'currency', currency: 'EUR', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100)
export const storeUrl = (row: AdminUserRow) => row.is_published && row.store_slug ? getStorefrontCanonicalUrl(row.store_slug, undefined, row.custom_hostname ?? undefined) : null
export const supportUrl = (row: AdminUserRow) => row.awaiting_admin_conversation_id ? `/admin/support?conversation=${encodeURIComponent(row.awaiting_admin_conversation_id)}` : '/admin/support'
export const storeState = (row: AdminUserRow) => row.is_published ? 'Avalik' : row.store_id ? 'Seadistab' : 'Poodi pole'
export const presenceViews: Record<string, string> = { landing: 'Avaleht', login: 'Sisselogimine', 'forgot-password': 'Parooli taastamine', 'reset-password': 'Parooli taastamine', account: 'Konto', store: 'Poe nimi', payments: 'Maksed', shipping: 'Tarne', business: 'Müüja andmed', product: 'Esimene toode', publish: 'Avaldamine', storefront: 'Poe haldus' }
export const emailStates = { delivered: 'Kohale toimetatud', sent: 'Saatmine vastu võetud', failed: 'Saatmine ebaõnnestus', bounced: 'Ei jõudnud kohale', complained: 'Märgiti rämpspostiks', delivery_delayed: 'Kohaletoimetamine viibib', suppressed: 'Saatmine blokeeritud' }
