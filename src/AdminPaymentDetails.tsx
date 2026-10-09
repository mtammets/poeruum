import { useEffect, useState } from 'react'
import type { AdminUserRow } from './lib/adminUserOverview'
import { paymentStatusRequest } from './lib/adminPaymentStatus'
import { paymentExplanation, requirementGroups, type PaymentDiagnostics } from '../shared/paymentDiagnostics'
import { getStripeRequirementIssueCopies } from '../supabase/functions/_shared/stripe-requirement-issues.mjs'
import { date } from './lib/adminUserDisplay'
import Icon from './AdminUserIcon'
import './adminPaymentDetails.css'

type Props = { row: AdminUserRow; diagnostic?: PaymentDiagnostics | null; onUpdated: (diagnostic: PaymentDiagnostics) => void }
export default function AdminPaymentDetails({ row, diagnostic, onUpdated }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const issueSignature = JSON.stringify(row.stripe_account_requirement_issues)
  useEffect(() => {
    if (!row.store_id) return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    void paymentStatusRequest({ userId: row.user_id }, controller.signal).then(({ diagnostic: fresh }) => {
      if (controller.signal.aborted) return
      if (fresh?.version !== 1 || fresh.userId !== row.user_id || fresh.storeId !== row.store_id) throw new Error('Maksete vastus ei vasta valitud kasutajale.')
      onUpdated(fresh)
    }).catch((cause) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Maksete seisu ei õnnestunud laadida.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [row.user_id, row.store_id, row.payment_checked_at, row.payment_status, issueSignature, retry, onUpdated])
  if (!row.store_id) return null
  const state = paymentExplanation(diagnostic, { state: row.payment_state, issues: row.stripe_account_requirement_issues })
  const due = requirementGroups(diagnostic?.dueFields)
  const pending = requirementGroups(diagnostic?.pendingFields)
  const future = requirementGroups(diagnostic?.futureFields)
  const issues = getStripeRequirementIssueCopies(diagnostic?.issues ?? row.stripe_account_requirement_issues)
  const dashboardUrl = diagnostic?.dashboardUrl && /^https:\/\/dashboard\.stripe\.com\/(test\/)?connect\/accounts\/acct_[a-zA-Z0-9]+$/.test(diagnostic.dashboardUrl) ? diagnostic.dashboardUrl : null
  const technical = diagnostic?.disabledReason || diagnostic?.dueFields?.length || diagnostic?.issues.length
  return <section className={`admin-payment-details is-${state.tone}`} aria-label="Maksete põhjus" aria-busy={loading}>
    <header><Icon name={state.icon} /><div><h3>{state.title}</h3>{state.detail && <p>{state.detail}</p>}</div><button type="button" disabled={loading} onClick={() => setRetry((value) => value + 1)}><Icon name="refresh" />{loading ? 'Kontrollin…' : 'Uuenda'}</button>{dashboardUrl && <a href={dashboardUrl} target="_blank" rel="noopener noreferrer">Stripe<Icon name="arrow" /></a>}</header>
    {error && <p className="admin-payment-error" role="status">{error}{diagnostic && ' Kuvatud on viimane teadaolev seis.'}</p>}
    {issues.some((issue) => issue.title !== state.title) && <div className="admin-payment-issues">{issues.filter((issue) => issue.title !== state.title).map((issue) => <div key={issue.title}><strong>{issue.title}</strong><p>{issue.detail}</p></div>)}</div>}
    {due.length > 0 && <dl className="admin-payment-requirements">{due.map((group) => <div key={group.title}><dt>{group.title}</dt><dd>{group.fields.join(', ')}</dd></div>)}</dl>}
    {!due.length && diagnostic && diagnostic.dueCount > 0 && diagnostic.dueFields === null && <p>{loading ? 'Laadin puuduvate andmete loendit…' : 'Puuduvate väljade loend pole saadaval. Uuenda seisu või ava Stripe.'}</p>}
    {diagnostic?.identityError && diagnostic.identityError !== state.detail && <p className="admin-payment-identity">{diagnostic.identityError}</p>}
    {diagnostic?.setupError && diagnostic.setupError !== state.detail && <p className="admin-payment-identity">{diagnostic.setupError}</p>}
    {pending.length > 0 && <p className="admin-payment-secondary">Kontrollimisel: {pending.map((group) => `${group.title.toLocaleLowerCase('et')} (${group.fields.join(', ')})`).join('; ')}.</p>}
    {future.length > 0 && <p className="admin-payment-secondary">Edaspidi nõutav: {future.map((group) => `${group.title.toLocaleLowerCase('et')} (${group.fields.join(', ')})`).join('; ')}.</p>}
    <footer><span>{diagnostic?.checkedAt ? `${diagnostic.source === 'stripe' ? 'Stripe’ist kontrollitud' : 'Salvestatud seis'}: ${date(diagnostic.checkedAt)}` : 'Maksete seisu pole veel kontrollitud'}</span>{diagnostic?.mode === 'live' && <span>Maksed: {diagnostic.chargesEnabled == null ? 'teadmata' : diagnostic.chargesEnabled ? 'lubatud' : 'keelatud'} · Väljamaksed: {diagnostic.payoutsEnabled == null ? 'teadmata' : diagnostic.payoutsEnabled ? 'lubatud' : 'keelatud'}</span>}{diagnostic?.deadline && <span>Tähtaeg: {date(diagnostic.deadline)}</span>}</footer>
    {Boolean(technical) && <details className="admin-payment-technical"><summary>Stripe’i täpsed nõuded</summary>{diagnostic?.disabledReason && <p>{diagnostic.disabledReason}</p>}<ul>{diagnostic?.dueFields?.map((field) => <li key={field}>{field}</li>)}{diagnostic?.issues.map((issue) => <li key={`${issue.code}-${issue.requirement}`}>{issue.code}{issue.requirement && ` · ${issue.requirement}`}</li>)}</ul></details>}
  </section>
}
