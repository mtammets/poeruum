import type { AdminPushFeedback } from './useAdminPush'
import './adminSettings.css'

export default function AdminSettings({ push }: { push: AdminPushFeedback }) {
  const disabled = push.busy || push.loading
  return <section className="admin-notification-settings" aria-labelledby="notification-settings-title">
    <header>
      <h2 id="notification-settings-title">Märguanded</h2>
      <p>Vali, milliseid teavitusi selles seadmes saad. Valikud salvestatakse automaatselt.</p>
    </header>
    <div className="admin-notification-settings__row">
      <div><h3 id="push-device-label">Märguanded selles seadmes</h3><p id="push-device-description">Teavitused jõuavad sinuni ka lukustatud ekraaniga.</p></div>
      <button type="button" role="switch" className="admin-notification-settings__switch" aria-checked={push.enabled} aria-labelledby="push-device-label" aria-describedby="push-device-description" disabled={disabled} onClick={() => void push.toggle()}><span /></button>
    </div>
    <fieldset disabled={disabled || !push.enabled}>
      <legend>Millest märku anda?</legend>
      {([
        ['visits', 'Avalehe külastused', 'Kui keegi külastab Poeruumi avalehte.'],
        ['accounts', 'Uued kontod', 'Kui Poeruumis luuakse uus konto.'],
      ] as const).map(([kind, label, description]) => <div className="admin-notification-settings__row" key={kind}>
        <div><h3 id={`push-${kind}-label`}>{label}</h3><p id={`push-${kind}-description`}>{description}</p></div>
        <button type="button" role="switch" className="admin-notification-settings__switch" aria-checked={push.preferences[kind]} aria-labelledby={`push-${kind}-label`} aria-describedby={`push-${kind}-description`} onClick={() => void push.updatePreference(kind, !push.preferences[kind])}><span /></button>
      </div>)}
    </fieldset>
    <footer>
      <p>{push.loading ? 'Laadin märguannete seadeid…' : !push.enabled ? 'Valikute muutmiseks luba esmalt selles seadmes märguanded.' : !push.preferences.visits && !push.preferences.accounts ? 'Mõlemad liigid on välja lülitatud. Sellesse seadmesse praegu teavitusi ei saadeta.' : 'Heli ja lukuekraanil kuvamist saad muuta telefoni või brauseri seadetes.'}</p>
      {push.enabled && <button type="button" className="admin-notification-settings__test" disabled={disabled} onClick={() => void push.test()}>Saada prooviteavitus</button>}
    </footer>
    {(push.message || push.error) && <div className={`admin-notification-settings__notice${push.error ? ' is-error' : ''}`} role={push.error ? 'alert' : 'status'}>
      <span>{push.error || push.message}</span><button type="button" aria-label="Sulge märguannete juhis" onClick={push.dismiss}>×</button>
    </div>}
  </section>
}
