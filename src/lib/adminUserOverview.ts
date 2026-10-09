import type { PaymentDiagnostics } from '../../shared/paymentDiagnostics'

export type AdminUserRow = {
  user_id: string
  email: string
  user_created_at: string
  last_sign_in_at: string | null
  store_id: string | null
  store_name: string | null
  store_slug: string | null
  custom_hostname: string | null
  store_created_at: string | null
  is_published: boolean
  payment_status: 'idle' | 'pending' | 'connected'
  stripe_account_requirement_issues: unknown
  pricing_plan: 'flexible' | 'fixed'
  product_count: number
  order_count: number
  gross_sales: number
  last_activity_at: string | null
  has_store_details: boolean
  has_payments: boolean
  has_delivery: boolean
  has_product: boolean
  has_business_details: boolean
  has_published: boolean
  open_support_count: number
  last_support_at: string | null
  email_confirmed: boolean
  email_is_disposable: boolean
  email_review_required: boolean
  // Absent means unavailable, never zero or a fallback to legacy order totals.
  metrics_version?: 1
  payment_state?: 'not_connected' | 'test' | 'unknown' | 'active' | 'restricted' | 'pending'
  payment_checked_at?: string | null
  payment_diagnostics?: PaymentDiagnostics | null
  paid_orders_30d?: number
  net_sales_30d_cents?: number
  paid_orders_total?: number
  last_paid_order_at?: string | null
  awaiting_admin_count?: number
  waiting_user_count?: number
  awaiting_admin_conversation_id?: string | null
}

export type LatestEmailDelivery = {
  user_id: string
  resend_email_id: string
  subject: string
  email_type: string | null
  status: 'sent' | 'delivered' | 'failed' | 'bounced' | 'complained' | 'delivery_delayed' | 'suppressed'
  sent_at: string
  status_updated_at: string
}

export type UserFilter = 'all' | 'published' | 'selling' | 'payments' | 'reply' | 'setup' | 'temporary-email' | 'email-review'
export type UserSort = 'newest' | 'sales' | 'attention' | 'signin'

export const hasUserMetrics = (row: AdminUserRow) => row.metrics_version === 1

export function matchesUserFilter(row: AdminUserRow, filter: UserFilter) {
  switch (filter) {
    case 'published': return row.is_published
    case 'selling': return hasUserMetrics(row) && (row.paid_orders_30d ?? 0) > 0
    case 'payments': return hasUserMetrics(row) && row.payment_state === 'restricted'
    case 'reply': return hasUserMetrics(row) && (row.awaiting_admin_count ?? 0) > 0
    case 'setup': return !row.is_published
    case 'temporary-email': return row.email_is_disposable
    case 'email-review': return row.email_review_required
    default: return true
  }
}

export const userAttentionScore = (row: AdminUserRow) =>
  (hasUserMetrics(row) && (row.awaiting_admin_count ?? 0) > 0 ? 4 : 0)
  + (hasUserMetrics(row) && row.is_published && row.payment_state === 'restricted' ? 2 : 0)
  + (row.email_review_required ? 1 : 0)

export function sortUserRows(rows: AdminUserRow[], sort: UserSort, online: Set<string>) {
  return [...rows].sort((a, b) => {
    const newest = Date.parse(b.user_created_at) - Date.parse(a.user_created_at)
    if (sort === 'sales') {
      const known = Number(hasUserMetrics(b)) - Number(hasUserMetrics(a))
      return known || (b.net_sales_30d_cents ?? 0) - (a.net_sales_30d_cents ?? 0) || (b.paid_orders_30d ?? 0) - (a.paid_orders_30d ?? 0) || newest
    }
    if (sort === 'attention') return userAttentionScore(b) - userAttentionScore(a) || newest
    if (sort === 'signin') return Number(online.has(b.user_id)) - Number(online.has(a.user_id))
      || Date.parse(b.last_sign_in_at || '1970-01-01') - Date.parse(a.last_sign_in_at || '1970-01-01') || newest
    return newest
  })
}

export const paymentStates = {
  active: { label: 'Aktiivne', tone: 'good', icon: 'check' },
  restricted: { label: 'Takistus', tone: 'warning', icon: 'alert' },
  pending: { label: 'Seadistab', tone: 'neutral', icon: 'clock' },
  not_connected: { label: 'Ühendamata', tone: 'muted', icon: 'minus' },
  test: { label: 'Testrežiim', tone: 'neutral', icon: 'flask' },
  unknown: { label: 'Kontrollimata', tone: 'muted', icon: 'help' },
} as const

export const salesDefinition = 'Viimase 30 päeva jooksul loodud ja tasutud päristellimused. Summa sisaldab tarnet; täielikud ja osalised tagastused on maha arvatud. Täielikult tagastatud tellimused, testmaksed ning pooleli ja ebaõnnestunud ostud ei kuulu tellimuste arvu.'
