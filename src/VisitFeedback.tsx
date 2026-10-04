import type { HomepageVisitFeedback, VisitNotice } from './useHomepageVisitFeedback'
import './visitFeedback.css'

export function VisitSoundToggle({ feedback }: { feedback: HomepageVisitFeedback }) {
  return <div className="visit-sound">
    <button type="button" className="visit-sound__toggle" aria-label="Külastuste ja uute kontode heli" aria-pressed={feedback.soundEnabled}
      title={feedback.soundEnabled ? 'Lülita külastuste ja uute kontode heli välja' : 'Lülita külastuste ja uute kontode heli sisse'} onClick={() => void feedback.toggleSound()}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4Z" />{feedback.soundEnabled
        ? <><path d="M16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14" /></>
        : <path d="m17 9 5 6m0-6-5 6" />}</svg>
      <span>Heli</span>
    </button>
    {feedback.soundError && <span className="visit-sound__error" role="alert">{feedback.soundError}</span>}
  </div>
}

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
