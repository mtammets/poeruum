import { useEffect, useState } from 'react'
import { getHomepageShowcaseSettings, homepageStoreUnavailableReason, saveHomepageShowcaseSettings, type HomepageShowcaseSettings } from './lib/homepageShowcase'
import './adminStoreDirectory.css'

export default function AdminHomepageShowcase() {
  const [settings, setSettings] = useState<HomepageShowcaseSettings | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [reload, setReload] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const isDirty = Boolean(settings && (selected.length !== settings.selectedStoreIds.length
    || selected.some((id) => !settings.selectedStoreIds.includes(id))))
  const isBusy = isLoading || isSaving

  useEffect(() => {
    let active = true
    void getHomepageShowcaseSettings().then((value) => {
      if (!active) return
      setSettings(value)
      // Removed stores cannot be selected again; allow saving their removal.
      setSelected(value.selectedStoreIds.filter((id) => value.stores.some((store) => store.id === id)))
    }).catch((cause: unknown) => {
      if (active) { setSettings(null); setError(cause instanceof Error ? cause.message : 'Laadimine ebaõnnestus.') }
    }).finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [reload])

  useEffect(() => {
    if (!isDirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [isDirty])

  const save = async () => {
    if (!settings || isBusy || !isDirty || !selected.length) return
    setIsSaving(true); setError(''); setNotice('')
    try {
      const value = await saveHomepageShowcaseSettings(selected, settings.selectedStoreIds)
      setSettings(value); setSelected(value.selectedStoreIds)
      setNotice('Valik on salvestatud. See rakendub avalehe järgmisel avamisel.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Salvestamine ebaõnnestus.') }
    finally { setIsSaving(false) }
  }

  const eligibleCount = settings?.stores.filter((store) => selected.includes(store.id) && !homepageStoreUnavailableReason(store)).length ?? 0
  return <section className="admin-directory" aria-labelledby="homepage-showcase-heading" aria-busy={isBusy}>
    <header className="admin-directory__header">
      <div>
        <h2 id="homepage-showcase-heading">Avalehe eelvaade</h2>
        <p>Avalehe telefonis näidatakse juhuslikult üht valitud poodidest. Igal sobival poel on võrdne võimalus.</p>
        <p>Pood püsib sama külastuse jooksul. Mitme pildiga tootel näidatakse vahel ka lisapilti.</p>
        <p>Üle 10 sobiva tootega poes näidatakse aeg-ajalt ka otsingu kasutamist.</p>
      </div>
      <a href="https://poeruum.ee/" target="_blank" rel="noopener noreferrer">Ava avaleht ↗</a>
    </header>
    <div className="admin-directory__toolbar">
      <div className="admin-directory__actions">
        <button className="admin-directory__save" type="button" disabled={isBusy || !isDirty || !selected.length || !settings} onClick={() => void save()}>{isSaving ? 'Salvestan…' : 'Salvesta valik'}</button>
        <button type="button" disabled={isBusy} onClick={() => { setIsLoading(true); setError(''); setNotice(''); setReload((value) => value + 1) }}>Laadi salvestatud valik</button>
      </div>
      <span>{isDirty ? 'Salvestamata muudatused · ' : ''}{eligibleCount} kuvamiseks sobivat poodi</span>
    </div>
    {error && <p className="admin-directory__error" role="alert">{error}</p>}
    <p className="admin-directory__notice" role="status">{isLoading ? 'Laadin poode…' : notice}</p>
    {settings && !isLoading && <>
      {!selected.length && <p className="admin-directory__error">Vali vähemalt üks pood.</p>}
      {selected.length > 0 && eligibleCount === 0 && <p className="admin-directory__error">Valitud poode ei saa praegu näidata. Telefon ilmub avalehele, kui vähemalt üks neist sobib kuvamiseks.</p>}
      <div className="admin-homepage-stores" role="group" aria-label="Avalehe eelvaate poed">
        {settings.stores.map((store) => {
          const reason = homepageStoreUnavailableReason(store)
          return <label key={store.id} className="admin-homepage-stores__store">
            <input type="checkbox" checked={selected.includes(store.id)} disabled={isBusy} aria-label={store.name}
              onChange={(event) => { setSelected((ids) => event.target.checked ? [...ids, store.id] : ids.filter((id) => id !== store.id)); setNotice('') }} />
            <span><strong>{store.name}</strong><small>{store.slug}.poeruum.ee</small><small className={reason ? 'is-unavailable' : undefined}>{reason ?? `${store.eligibleProductCount} sobivat toodet`}</small></span>
          </label>
        })}
      </div>
      {!settings.stores.length && <p className="admin-directory__empty">Valitavaid poode veel pole.</p>}
    </>}
  </section>
}
