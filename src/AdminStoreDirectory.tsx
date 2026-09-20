import { useEffect, useState } from 'react'
import type { StoreDirectoryEntry } from '../shared/store-directory.mjs'
import { listPublicStoreDirectory } from './lib/database'
import { saveStoreDirectoryOrder, StoreDirectoryConflictError } from './lib/adminStoreDirectory'
import './adminStoreDirectory.css'

export default function AdminStoreDirectory() {
  const [stores, setStores] = useState<StoreDirectoryEntry[]>([])
  const [savedStores, setSavedStores] = useState<StoreDirectoryEntry[]>([])
  const [reload, setReload] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropId, setDropId] = useState<string | null>(null)
  const isDirty = stores.some((store, index) => store.id !== savedStores[index]?.id)
  const isBusy = isLoading || isSaving
  const canEdit = !isBusy && !loadFailed && !conflict

  useEffect(() => {
    let active = true
    setIsLoading(true)
    setError('')
    setNotice('')
    void listPublicStoreDirectory().then((loaded) => {
      if (!active) return
      setStores(loaded)
      setSavedStores(loaded)
      setLoadFailed(false)
      setConflict(false)
    }).catch(() => {
      if (!active) return
      setLoadFailed(true)
      setError('Poode ei õnnestunud laadida. Proovi uuesti.')
    }).finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [reload])

  useEffect(() => {
    if (!isDirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [isDirty])

  const moveStore = (id: string, targetIndex: number) => {
    if (!canEdit) return
    const sourceIndex = stores.findIndex((store) => store.id === id)
    if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= stores.length || sourceIndex === targetIndex) return
    const next = [...stores]
    const [store] = next.splice(sourceIndex, 1)
    next.splice(targetIndex, 0, store)
    setStores(next)
    setError('')
    setNotice(`${store.name} on kohal ${targetIndex + 1}. Muudatused on salvestamata.`)
  }

  const save = async () => {
    if (!canEdit || !isDirty) return
    setIsSaving(true)
    setError('')
    setNotice('')
    try {
      const saved = await saveStoreDirectoryOrder(stores.map((store) => store.id), savedStores.map((store) => store.id))
      setStores(saved)
      setSavedStores(saved)
      setNotice('Järjekord on salvestatud ja kehtib Kaubamajas.')
    } catch (cause) {
      setConflict(cause instanceof StoreDirectoryConflictError)
      setError(cause instanceof Error ? cause.message : 'Järjekorda ei õnnestunud salvestada. Proovi uuesti.')
    } finally { setIsSaving(false) }
  }

  return <section className="admin-directory" aria-labelledby="admin-directory-heading" aria-busy={isBusy}>
    <header className="admin-directory__header">
      <div>
        <h2 id="admin-directory-heading">E-poodide kuvamise järjekord</h2>
        <p>Lohista poed soovitud järjekorda või kasuta noolenuppe. Seejärel salvesta muudatused.</p>
        <p>Uued poed lisanduvad lõppu. Näidispoodide kaardid kuvatakse e-poodide järel.</p>
      </div>
      <a href="https://kaubamaja.poeruum.ee/" target="_blank" rel="noopener noreferrer">Ava Kaubamaja ↗</a>
    </header>
    <div className="admin-directory__toolbar">
      <div className="admin-directory__actions">
        <button className="admin-directory__save" type="button" disabled={!canEdit || !isDirty} onClick={() => void save()}>
          {isSaving ? 'Salvestan…' : 'Salvesta järjekord'}
        </button>
        <button type="button" disabled={!canEdit || !isDirty} onClick={() => {
          setStores(savedStores); setError(''); setNotice('Muudatused on tühistatud.')
        }}>Tühista muudatused</button>
        <button type="button" disabled={isBusy} onClick={() => { setIsLoading(true); setReload((value) => value + 1) }}>
          {isDirty || conflict ? 'Laadi salvestatud järjekord' : 'Uuenda loendit'}
        </button>
      </div>
      <span>{isDirty ? 'Salvestamata muudatused' : `${stores.length} ${stores.length === 1 ? 'pood' : 'poodi'}`}</span>
    </div>
    {error && <p className="admin-directory__error" role="alert">{error}</p>}
    <p className="admin-directory__notice" role="status">{isLoading ? 'Laadin poode…' : notice}</p>
    {!isLoading && !loadFailed && stores.length === 0 && <p className="admin-directory__empty">Kaubamajas pole veel avaldatud e-poode.</p>}
    <ol className="admin-directory__list" aria-label="E-poodide järjekord">
      {stores.map((store, index) => <li
        key={store.id}
        className={`${draggedId === store.id ? 'is-dragging' : ''} ${dropId === store.id ? 'is-drop-target' : ''}`.trim() || undefined}
        onDragOver={(event) => {
          if (!canEdit || !draggedId) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          setDropId(store.id)
        }}
        onDrop={(event) => {
          event.preventDefault()
          if (draggedId) moveStore(draggedId, index)
          setDraggedId(null); setDropId(null)
        }}
      >
        <span className="admin-directory__drag" aria-hidden="true" title="Lohista poe järjekorra muutmiseks"
          draggable={canEdit && stores.length > 1}
          onDragStart={(event) => {
            setDraggedId(store.id)
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', store.id)
          }}
          onDragEnd={() => { setDraggedId(null); setDropId(null) }}
        >⠿</span>
        <span className="admin-directory__position" aria-label={`Koht ${index + 1}`}>{index + 1}</span>
        <span className="admin-directory__image" aria-hidden="true">
          {store.logoUrl || store.imageUrl ? <img src={store.logoUrl || store.imageUrl!} alt="" loading="lazy" draggable={false}
            onError={(event) => { event.currentTarget.style.display = 'none' }} /> : store.name.charAt(0).toLocaleUpperCase('et')}
        </span>
        <div className="admin-directory__identity"><strong>{store.name}</strong><a href={store.url} target="_blank" rel="noopener noreferrer">{store.hostname} ↗</a></div>
        <div className="admin-directory__move">
          <button type="button" disabled={!canEdit || index === 0} aria-label={`Liiguta ${store.name} üles`} onClick={() => moveStore(store.id, index - 1)}>↑</button>
          <button type="button" disabled={!canEdit || index === stores.length - 1} aria-label={`Liiguta ${store.name} alla`} onClick={() => moveStore(store.id, index + 1)}>↓</button>
        </div>
      </li>)}
    </ol>
  </section>
}
