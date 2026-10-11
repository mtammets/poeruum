import { useRef, useState } from 'react'
import SellerDetailsFields, { type SellerDetailsValue } from './SellerDetailsFields'
import { sellerDetailsError, sellerName } from '../shared/seller'
import { cleanSellerSettings, sellerIdentityChanged, sellerSettings, type SellerSettings } from '../shared/seller-settings'

export default function StoreSellerSettings({ value, linked, onSave, onManageStripe, onSupport }: {
  value: SellerDetailsValue
  linked: boolean
  onSave: (next: SellerSettings, expected: SellerSettings) => Promise<void>
  onManageStripe?: () => void
  onSupport?: () => void
}) {
  const [draft, setDraft] = useState<SellerDetailsValue | null>(null)
  const expected = useRef(sellerSettings(value))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const editButton = useRef<HTMLButtonElement>(null)
  const cancel = () => { setDraft(null); setError(''); requestAnimationFrame(() => editButton.current?.focus()) }
  const effectiveDraft = draft && { ...draft, entrepreneurPayoutAdminException: value.entrepreneurPayoutAdminException === true
    && !sellerIdentityChanged(expected.current, sellerSettings(draft)) }

  return <section className="seller-settings" aria-label="Müüja andmed">
    {!effectiveDraft ? <>
      <div className="seller-settings__identity">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2" /></svg>
        <div><strong>{sellerName(value) || 'Müüja andmed lisamata'}</strong><small>{value.sellerType === 'entrepreneur' ? 'Ettevõtluskontoga eraisik' : value.registryCode ? `Registrikood ${value.registryCode}` : 'Ettevõte'}</small></div>
      </div>
      <dl className="seller-settings__details">
        <div><dt>Aadress</dt><dd>{value.businessAddress || '—'}</dd></div>
        <div><dt>Kontakt-e-post</dt><dd>{value.contactEmail || '—'}</dd></div>
        {value.sellerType === 'company' && <div><dt>Käibemaks</dt><dd>{value.vatRegistered ? value.vatNumber || 'KMKR number lisamata' : 'Ei ole käibemaksukohustuslane'}</dd></div>}
      </dl>
      <button ref={editButton} type="button" className="settings-secondary-action" onClick={() => { expected.current = sellerSettings(value); setDraft({ ...value }); setError(''); setSaved(false) }}>Muuda müüja andmeid<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg></button>
      {saved && <p className="seller-settings__saved" role="status">Müüja andmed salvestatud.</p>}
    </> : <form className="seller-settings__form" onSubmit={async event => {
      event.preventDefault()
      if (busy) return
      const next = cleanSellerSettings(sellerSettings(effectiveDraft))
      const problem = sellerDetailsError({ ...next, entrepreneurPayoutAdminException: effectiveDraft.entrepreneurPayoutAdminException })
      if (problem) { setError(problem); return }
      setBusy(true); setError('')
      try { await onSave(next, expected.current); setSaved(true); cancel() }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'Andmete salvestamine ebaõnnestus.') }
      finally { setBusy(false) }
    }}>
      <fieldset disabled={busy}>
        <SellerDetailsFields value={effectiveDraft} typeLocked={linked} identityEditable onChange={patch => { setDraft(current => current ? { ...current, ...patch } : current); setError('') }} />
        {linked && <div className="seller-settings__help">
          <p>Nimemuutus peab olema kinnitatud ka Stripe’is. Registrikoodi vahetamiseks võta ühendust toega.</p>
          <div>{onManageStripe && <button type="button" onClick={onManageStripe}>Ava Stripe’i andmed ↗</button>}{onSupport && <button type="button" onClick={onSupport}>Võta ühendust</button>}</div>
        </div>}
        {error && <p className="seller-settings__error" role="alert">{error}</p>}
        <div className="seller-settings__actions"><button type="button" onClick={cancel}>Loobu</button><button type="submit">{busy ? 'Kontrollin…' : 'Kinnita ja salvesta'}</button></div>
      </fieldset>
    </form>}
  </section>
}
