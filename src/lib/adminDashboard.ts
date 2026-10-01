export type RevenueEvent = {
  id: string
  kind: 'subscription' | 'transaction_fee' | 'transaction_fee_refund'
  amount_cents: number
  currency: string
  description: string
  occurred_at: string
  store_id: string | null
  store_name: string
}

export type RevenueDashboard = {
  month_total_cents: number
  today_total_cents: number
  subscription_total_cents: number
  transaction_fee_total_cents: number
  refund_total_cents: number
  recent_events: RevenueEvent[]
}

export type AnalyticsRange = 7 | 30 | 90

export type AnalyticsDailyPoint = {
  date: string
  sessions: number
  signup_starts: number
  accounts_created: number
}

export type AnalyticsBreakdown = {
  label: string
  sessions: number
}

export type AnalyticsSource = {
  source: string
  sessions: number
  measured_sessions: number
  engaged_sessions: number
  average_engaged_seconds: number
}

export type AnalyticsEngagementBucket = {
  bucket: 'under_10' | '10_29' | '30_119' | '120_plus'
  sessions: number
}

export type HomepageAnalyticsDashboard = {
  range_days: number
  sessions: number
  anonymous_sessions: number
  merchant_sessions: number
  average_engaged_seconds: number
  measured_sessions: number
  engaged_sessions: number
  signup_starts: number
  tracked_accounts: number
  demo_opens: number
  pricing_views: number
  accounts_created: number
  stores_started: number
  payments_connected: number
  stores_published: number
  daily: AnalyticsDailyPoint[]
  sources: AnalyticsSource[]
  engagement_buckets: AnalyticsEngagementBucket[]
  devices: Array<{ device: 'mobile' | 'tablet' | 'desktop'; sessions: number }>
  ctas: AnalyticsBreakdown[]
  faqs: AnalyticsBreakdown[]
}

export type HomepageEngagementDashboard = Pick<
  HomepageAnalyticsDashboard,
  'range_days' | 'average_engaged_seconds' | 'measured_sessions' | 'engaged_sessions' | 'sources' | 'engagement_buckets'
>

