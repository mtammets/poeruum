import { useId } from 'react'
import type { AdminPushFeedback } from './useAdminPush'
import './visitFeedback.css'

export default function AdminPushToggle({ push }: { push: AdminPushFeedback }) {
  const messageId = useId()
  return <div className="admin-push">
    <button type="button" className="admin-push__toggle" aria-label="Telefoni märguanded" aria-pressed={push.enabled}
      aria-describedby={push.message || push.error ? messageId : undefined} disabled={push.busy || push.loading}
      title={push.enabled ? 'Lülita selle seadme märguanded välja' : 'Saa märguandeid ka lukustatud ekraaniga'} onClick={() => void push.toggle()}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
      <span>{push.loading ? 'Laadin…' : 'Märguanded'}</span>
    </button>
    {push.enabled && <button type="button" className="admin-push__test" disabled={push.busy} onClick={() => void push.test()}>Proovi</button>}
    {(push.message || push.error) && <div id={messageId} className="admin-push__message" role={push.error ? 'alert' : 'status'}>
      <span>{push.error || push.message}</span>
      <button type="button" aria-label="Sulge märguannete juhis" onClick={push.dismiss}>×</button>
    </div>}
  </div>
}
