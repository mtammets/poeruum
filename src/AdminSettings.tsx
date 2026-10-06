import type { AdminPushFeedback } from './useAdminPush'
import './adminSettings.css'

export default function AdminSettings({ push }: { push: AdminPushFeedback }) {
  const disabled = push.busy || push.loading
  return <section className="admin-notification-settings" aria-labelledby="notification-settings-title" aria-busy={disabled}>
    <header>
      <span className={`admin-notification-settings__icon${push.enabled ? ' is-on' : ''}${disabled ? ' is-loading' : ''}`} aria-hidden="true">
        {disabled ? <span className="admin-notification-settings__spinner" /> : <svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />{!push.enabled && <path d="m3 3 18 18" />}</svg>}
      </span>
      <h2 id="notification-settings-title">Märguanded</h2>
      <button type="button" role="switch" className="admin-notification-settings__switch" aria-checked={push.enabled} aria-label="Märguanded selles seadmes" disabled={disabled} onClick={() => void push.toggle()}><span /></button>
    </header>
    <fieldset disabled={disabled || !push.enabled} aria-label="Märguannete liigid" className={!push.enabled ? 'is-off' : undefined}>
      {([
        ['visits', 'Avalehe külastused'],
        ['accounts', 'Uued kontod'],
      ] as const).map(([kind, label]) => <div className="admin-notification-settings__row" key={kind}>
        <span className={`admin-notification-settings__icon${push.enabled && push.preferences[kind] ? ' is-on' : ''}`} aria-hidden="true">
          <svg viewBox="0 0 24 24">{kind === 'visits'
            ? <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>
            : <><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M19 7v6M16 10h6" /></>}</svg>
        </span>
        <h3 id={`push-${kind}-label`}>{label}</h3>
        <button type="button" role="switch" className="admin-notification-settings__switch" aria-checked={push.preferences[kind]} aria-labelledby={`push-${kind}-label`} onClick={() => void push.updatePreference(kind, !push.preferences[kind])}><span /></button>
      </div>)}
    </fieldset>
    {push.enabled && <footer>
      <button type="button" className="admin-notification-settings__test" aria-label="Saada prooviteavitus" disabled={disabled} onClick={() => void push.test()}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 3-7 18-4-7-7-4 18-7ZM10 14 21 3" /></svg>
        Prooviteavitus
      </button>
    </footer>}
    {(push.message || push.error) && <div className={`admin-notification-settings__notice${push.error ? ' is-error' : ''}`} role={push.error ? 'alert' : 'status'}>
      <span>{push.error || push.message}</span><button type="button" aria-label="Sulge märguannete juhis" onClick={push.dismiss}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button>
    </div>}
  </section>
}
