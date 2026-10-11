import { useRef, useState } from 'react'
import StoreTermsContent from './StoreTermsContent'

export default function StoreTermsSettings({ returnsText, contactEmail, onSave }: {
  returnsText: string; contactEmail: string; onSave: (text: string) => Promise<void>
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const editButton = useRef<HTMLButtonElement>(null)
  const finish = () => { setDraft(null); setError(''); requestAnimationFrame(() => editButton.current?.focus()) }
  return <div className="settings-terms">
    {draft === null ? <>
      <div className="settings-terms__intro"><span>Ostjale nähtavad tingimused</span><button ref={editButton} type="button" onClick={() => { setDraft(returnsText); setSaved(false) }}>Muuda</button></div>
      <StoreTermsContent returnsText={returnsText} contactEmail={contactEmail} />
      {saved && <p role="status">Tingimused salvestatud.</p>}
    </> : <form className="settings-fields" onSubmit={async (event) => {
      event.preventDefault()
      if (busy) return
      if (!draft.trim()) { setError('Lisa tagastustingimused.'); return }
      setBusy(true); setError('')
      try { await onSave(draft.trim()); finish(); setSaved(true) }
      catch (reason) { setError(reason instanceof Error ? reason.message : 'Salvestamine ebaõnnestus. Proovi uuesti.') }
      finally { setBusy(false) }
    }}>
      <label>Tagastustingimused<textarea autoFocus rows={14} maxLength={16000} required value={draft} disabled={busy} onChange={(event) => setDraft(event.target.value)} /></label>
      <p className="settings-hint">Muudatused avalduvad pärast salvestamist.</p>
      {error && <p role="alert">{error}</p>}
      <div className="settings-terms__actions"><button type="button" disabled={busy} onClick={finish}>Loobu</button><button type="submit" disabled={busy}>{busy ? 'Salvestan…' : 'Salvesta'}</button></div>
    </form>}
  </div>
}
