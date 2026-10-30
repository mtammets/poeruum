import { useEffect, useState } from 'react'
import { companyCopyDefaults, companyCopyEqual, normalizeCompanyCopy, type CompanyCopy } from '../shared/company-homepage-copy.mjs'
import type { PublicStoreRecord } from './lib/database'
import type { Product } from './products'
import { isSupabaseConfigured, requireSupabase } from './lib/supabase'
import { getCompanyHomepageOwner, saveCompanyHomepageCopy } from './lib/companyHomepage'
import CompanyEditableText from './CompanyEditableText'

const localDevelopment = import.meta.env.DEV && /^(localhost|127\.0\.0\.1|.*\.localhost)$/.test(window.location.hostname)

export type CompanyHomepageReview = {
  shopUrl: string
  homePath?: string
  save: (copy: CompanyCopy) => Promise<void>
  logout: () => void
}

export default function useCompanyHomepageEditor(store: PublicStoreRecord, product?: Product, review?: CompanyHomepageReview) {
  const defaults = companyCopyDefaults(store.settings, store.name, product)
  const [saved, setSaved] = useState(() => normalizeCompanyCopy(store.settings.companyHomepage))
  const [draft, setDraft] = useState<CompanyCopy>(saved)
  const [ownerId, setOwnerId] = useState<string | null>(null)
  const [ready, setReady] = useState(Boolean(review))
  const [active, setActive] = useState(false)
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [discarded, setDiscarded] = useState<CompanyCopy | null>(null)
  const storageKey = `poeruum:company-homepage:${store.id}`
  const canEdit = ready && (Boolean(review) || Boolean(ownerId) || localDevelopment)
  const editing = canEdit && active && !preview
  const dirty = !companyCopyEqual(saved, draft)
  const copy = { ...defaults, ...(active ? draft : saved) } as Record<string, string>

  useEffect(() => {
    if (review) return
    let cancelled = false
    let revision = 0
    const check = async () => {
      const current = ++revision
      try {
        const owner = isSupabaseConfigured ? await getCompanyHomepageOwner(store.id) : null
        if (cancelled || current !== revision) return
        setOwnerId(owner)
        if (!owner && localDevelopment) {
          try {
            const local = localStorage.getItem(storageKey)
            if (local) { const value = normalizeCompanyCopy(JSON.parse(local)); setSaved(value); setDraft(value) }
          } catch { setError('Brauseri salvestatud eelvaadet ei saanud laadida.') }
        }
        setReady(true)
      } catch (error) {
        if (!cancelled && current === revision) setError(error instanceof Error ? error.message : 'Muutmisõiguse kontroll ebaõnnestus.')
      }
    }
    void check()
    const subscription = isSupabaseConfigured ? requireSupabase().auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') {
        revision += 1
        setOwnerId(null); setReady(false); setActive(false)
      }
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        // Run outside Supabase's auth callback lock.
        queueMicrotask(() => { if (!cancelled) void check() })
      }
    }).data.subscription : null
    return () => { cancelled = true; subscription?.unsubscribe() }
  }, [storageKey, store.id, review])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const change = (field: string, value: string) => {
    setDraft(current => ({ ...current, [field]: value }))
    setNotice(''); setError('')
  }
  const save = async () => {
    if (!canEdit || busy || !dirty) return
    if (copy.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(copy.email.trim())) {
      setError('Kontrolli e-posti aadressi kontaktide jaotises.'); return
    }
    setBusy(true); setError(''); setNotice('')
    try {
      const next = normalizeCompanyCopy(draft)
      if (review) await review.save(next)
      else if (ownerId) await saveCompanyHomepageCopy(store.id, ownerId, next, saved)
      else if (localDevelopment) localStorage.setItem(storageKey, JSON.stringify(next))
      else throw new Error('Kodulehe muutmiseks logi sisse poe omanikuna.')
      setSaved(next); setDraft(next)
      setNotice(review ? 'Muudatused on salvestatud.' : ownerId ? 'Tekstid on salvestatud ja lehel nähtavad.' : 'Eelvaade on sellesse brauserisse salvestatud.')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Salvestamine ebaõnnestus. Sinu muudatused on alles.')
    } finally { setBusy(false) }
  }
  useEffect(() => {
    if (!active) return
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save() }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  })

  const close = () => {
    setDiscarded(dirty ? draft : null)
    setDraft(saved); setActive(false); setPreview(false); setError(''); setNotice('')
  }
  const toolbar = canEdit ? <aside className={`company-editor${active ? ' is-active' : ''}`} aria-label="Kodulehe muutmine">
    {active ? <>
      <div className="company-editor__info"><strong>{preview ? 'Kodulehe eelvaade' : 'Klõpsa tekstil ja kirjuta'}</strong>
        <span>{review ? 'Muudatused salvestuvad sellesse eelvaatesse.' : ownerId ? 'Muudatused avalduvad salvestamisel.' : 'Kohalik eelvaade · salvestub ainult selles brauseris.'}</span>
      </div>
      <div className="company-editor__actions">
        <button type="button" onClick={() => setPreview(value => !value)} disabled={busy} aria-pressed={preview}>{preview ? 'Jätka muutmist' : 'Eelvaade'}</button>
        <button type="button" onClick={close} disabled={busy}>{dirty ? 'Loobu' : 'Valmis'}</button>
        <button type="button" className="company-editor__save" onClick={() => void save()} disabled={busy || !dirty}>{busy ? 'Salvestan…' : review || ownerId ? 'Salvesta' : 'Salvesta eelvaade'}</button>
      </div>
      <p className={`company-editor__status${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>
        {error || notice || (dirty ? 'Salvestamata muudatused' : 'Kõik muudatused on salvestatud')}
      </p>
    </> : <>
      {discarded && <div className="company-editor__undo"><span role="status">Muudatused tühistatud.</span><button type="button" onClick={() => {
        setDraft(discarded); setDiscarded(null); setActive(true); setPreview(false)
      }}>Võta tagasi</button></div>}
      <button type="button" className="company-editor__open" onClick={() => { setDraft(saved); setDiscarded(null); setActive(true); setPreview(false) }}>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m15 5 4 4M4 20l5-1L20 8a2.8 2.8 0 0 0-4-4L5 15l-1 5Z" /></svg>Muuda
      </button>
      {review && <button type="button" className="company-editor__logout" onClick={review.logout}>Välju</button>}
    </>}
  </aside> : null
  return {
    copy, editing, active, toolbar,
    editable: (field: string) => <CompanyEditableText field={field} value={copy[field] ?? ''} editing={editing} disabled={busy} onChange={change} />,
  }
}
