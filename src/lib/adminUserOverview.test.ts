import { describe, expect, it } from 'vitest'
import { hasUserMetrics, matchesUserFilter, sortUserRows, userAttentionScore, type AdminUserRow } from './adminUserOverview'

const row = (changes: Partial<AdminUserRow> = {}): AdminUserRow => ({
  user_id: 'one', email: 'one@example.invalid', user_created_at: '2026-09-01', last_sign_in_at: null,
  store_id: 'store', store_name: 'Shop', store_slug: 'shop', custom_hostname: null, store_created_at: '2026-09-01',
  is_published: false, payment_status: 'connected', stripe_account_requirement_issues: [], pricing_plan: 'flexible',
  product_count: 1, order_count: 999, gross_sales: 99999, last_activity_at: '2026-10-01',
  has_store_details: true, has_payments: true, has_delivery: true, has_product: true, has_business_details: true,
  has_published: false, open_support_count: 5, last_support_at: null, email_confirmed: true,
  email_is_disposable: false, email_review_required: false, ...changes,
})

describe('admin user overview meaning', () => {
  it('does not invent sales or administrator tasks from old aggregate fields', () => {
    const unknown = row()
    expect(hasUserMetrics(unknown)).toBe(false)
    expect(matchesUserFilter(unknown, 'selling')).toBe(false)
    expect(matchesUserFilter(unknown, 'reply')).toBe(false)
    expect(matchesUserFilter(unknown, 'payments')).toBe(false)
    expect(userAttentionScore(unknown)).toBe(0)
  })
  it('keeps publication, actual sales and payment health independent', () => {
    const selling = row({ metrics_version: 1, paid_orders_30d: 3, payment_state: 'restricted' })
    expect(matchesUserFilter(selling, 'selling')).toBe(true)
    expect(matchesUserFilter(selling, 'published')).toBe(false)
    expect(matchesUserFilter(selling, 'payments')).toBe(true)
    expect(matchesUserFilter(row({ metrics_version: 1, is_published: true, paid_orders_30d: 0 }), 'selling')).toBe(false)
  })
  it('does not turn a waiting-user conversation into an admin reply task', () => {
    expect(matchesUserFilter(row({ metrics_version: 1, waiting_user_count: 3, awaiting_admin_count: 0 }), 'reply')).toBe(false)
    expect(matchesUserFilter(row({ metrics_version: 1, awaiting_admin_count: 1 }), 'reply')).toBe(true)
  })
  it('sorts attention by real tasks rather than incomplete setup percentage', () => {
    const draft = row({ user_id: 'draft', has_payments: false })
    const reply = row({ user_id: 'reply', metrics_version: 1, awaiting_admin_count: 1 })
    const blocked = row({ user_id: 'blocked', metrics_version: 1, is_published: true, payment_state: 'restricted' })
    expect(sortUserRows([draft, blocked, reply], 'attention', new Set()).map((r) => r.user_id)).toEqual(['reply', 'blocked', 'draft'])
  })
  it('uses sign-in timestamps instead of automatic record updates', () => {
    const older = row({ user_id: 'old', last_sign_in_at: '2026-09-01', last_activity_at: '2026-10-01' })
    const recent = row({ user_id: 'recent', last_sign_in_at: '2026-09-30', last_activity_at: '2026-09-30' })
    expect(sortUserRows([older, recent], 'signin', new Set())[0].user_id).toBe('recent')
    expect(sortUserRows([older, recent], 'signin', new Set(['old']))[0].user_id).toBe('old')
  })
  it('orders known net sales before unavailable metrics and leaves inputs untouched', () => {
    const input = [row(), row({ user_id: 'zero', metrics_version: 1, net_sales_30d_cents: 0 }), row({ user_id: 'sale', metrics_version: 1, net_sales_30d_cents: 2500 })]
    expect(sortUserRows(input, 'sales', new Set()).map((r) => r.user_id)).toEqual(['sale', 'zero', 'one'])
    expect(input[0].user_id).toBe('one')
  })
})
