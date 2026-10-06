import type { VisitNotice } from './useHomepageVisitFeedback'
import './visitFeedback.css'

export function VisitBadge({ notice }: { notice: VisitNotice | null }) {
  const label = notice?.kind === 'account'
    ? notice.delta === 1 ? ' uus konto' : ' uut kontot'
    : notice?.delta === 1 ? ' uus külastus' : ' uut külastust'
  return notice && <span key={notice.id} className="visit-feedback__badge" data-kind={notice.kind} role="status" aria-live="polite" aria-atomic="true">
    +{new Intl.NumberFormat('et-EE').format(notice.delta)}<span className="users-sr-only">{label}</span>
  </span>
}

export function VisitNumber({ value, notice }: { value: string; notice: VisitNotice | null }) {
  return <span key={notice?.id ?? 'idle'} data-kind={notice?.kind} className={notice ? 'visit-feedback__number is-new' : 'visit-feedback__number'}>{value}</span>
}
