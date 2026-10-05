import { useEffect, useRef, useState } from 'react'
import { getStoreBySlug, listProducts, listPublicStoreDirectory, type PublicStoreRecord } from '../lib/database'
import type { Product } from '../products'
import type { CampaignDocument } from './model'
import { defaultMedia } from './model'
import { actionLabels, MAX_CONTENT_SECONDS, MAX_PRODUCTS, parsePhoneContent, presetActions, productMedia, type PhoneAction } from './phoneContent'
import { captureStoreSnapshot } from './storeSnapshot'

type Directory = Awaited<ReturnType<typeof listPublicStoreDirectory>>
const move = <T,>(items: T[], from: number, to: number) => { const copy = [...items]; copy.splice(to, 0, copy.splice(from, 1)[0]); return copy }
export default function PhoneContentEditor({ document: doc, disabled, onChange, onBusy }: { document: CampaignDocument; disabled: boolean; onChange: (doc: CampaignDocument) => void; onBusy: (busy: boolean) => void }) {
  const content = doc.phoneContent
  const [directory, setDirectory] = useState<Directory>([]), [catalog, setCatalog] = useState<Product[]>([])
  const [store, setStore] = useState<PublicStoreRecord | null>(null), [slug, setSlug] = useState(content?.snapshot.store.slug ?? '')
  const [selected, setSelected] = useState<string[]>([]), [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState(''), [opened, setOpened] = useState(false)
  const request = useRef(0), abort = useRef<AbortController | null>(null), latest = useRef(doc); latest.current = doc
  useEffect(() => () => { request.current++; abort.current?.abort() }, [])
  useEffect(() => { setSlug(content?.snapshot.store.slug ?? ''); setStore(null); setCatalog([]); setSelected([]) }, [content?.snapshot.id])
  useEffect(() => {
    if (!opened) return
    let canceled = false
    void listPublicStoreDirectory().then((rows) => { if (!canceled) setDirectory(rows) }).catch(() => { if (!canceled) setError('Poodide laadimine ebaõnnestus.') })
    return () => { canceled = true }
  }, [opened])
  async function chooseStore(value: string) {
    const id = ++request.current; setSlug(value); setLoading(true); setError(''); setStore(null); setCatalog([]); setSelected([])
    try {
      if (!value) return
      const next = await getStoreBySlug(value)
      if (!next?.is_published) throw new Error('Pood ei ole avaldatud või pole enam kättesaadav.')
      const products = await listProducts(next.id)
      if (id !== request.current) return
      setStore(next); setCatalog(products)
      setSelected(next.id === content?.snapshot.store.id ? content.snapshot.products.map((p) => p.id).filter((id) => products.some((p) => p.id === id)) : products.slice(0, 3).map((p) => p.id))
      if (!products.length) setError('Selles poes ei ole pildiga tooteid.')
    } catch (cause) { if (id === request.current) setError(cause instanceof Error ? cause.message : 'Poe laadimine ebaõnnestus.') }
    finally { if (id === request.current) setLoading(false) }
  }
  async function apply() {
    if (!store || !selected.length) return
    const controller = new AbortController(); abort.current = controller; setSaving(true); onBusy(true); setError('')
    try {
      const snapshot = await captureStoreSnapshot(store, selected.map((id) => catalog.find((p) => p.id === id)!), controller.signal)
      const previous = latest.current.phoneContent
      const preserved = previous?.snapshot.store.id === snapshot.store.id ? parsePhoneContent({ snapshot, actions: previous.actions }) : null
      const phoneContent = preserved ?? parsePhoneContent({ snapshot, actions: presetActions(snapshot.products) })
      if (!phoneContent) throw new Error('Poe andmeid ei saanud kampaaniasse salvestada. Kontrolli toodete andmeid.')
      controller.signal.throwIfAborted()
      onChange({ ...latest.current, template: 'phone', phoneContent, media: productMedia(snapshot) })
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Poe salvestamine ebaõnnestus.') }
    finally { if (!controller.signal.aborted) { setSaving(false); onBusy(false) } }
  }
  function actions(next: PhoneAction[]) {
    if (!content) return
    setError(''); onChange({ ...doc, phoneContent: { ...content, actions: next } })
  }
  function patch(index: number, patch: Partial<PhoneAction>) { if (content) actions(content.actions.map((a, i) => i === index ? { ...a, ...patch } : a)) }
  const seconds = content?.actions.reduce((sum, a) => sum + a.duration, 0) ?? 9
  const invalid = content && !parsePhoneContent(content)
  const products = content?.snapshot.products ?? []
  return <details className="campaigns__media campaign-phone" onToggle={(e) => { if (e.currentTarget.open) setOpened(true) }}>
    <summary>Telefoni sisu <span>{content?.snapshot.store.name ?? 'Näidispood'}</span></summary>
    <fieldset disabled={disabled || saving}><legend className="campaigns__sr-only">Pood reklaamis</legend>
      <details className="campaign-phone__picker" open={!content}><summary>{content ? 'Vaheta poodi või tooteid' : 'Vali pood'}</summary>
      <label>Otsi poodi<input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Poe nimi" /></label>
      <label>Pood<select aria-label="Pood" value={slug} onChange={(e) => void chooseStore(e.target.value)}>
        <option value="">Vali pood</option>
        {content && !directory.some((s) => s.slug === content.snapshot.store.slug) && <option value={content.snapshot.store.slug}>{content.snapshot.store.name} · salvestatud</option>}
        {directory.filter((s) => s.slug === slug || s.name.toLocaleLowerCase('et').includes(filter.toLocaleLowerCase('et'))).map((s) => <option key={s.id} value={s.slug}>{s.name}</option>)}
      </select></label>
      {loading && <small role="status">Laadin tooteid…</small>}
      {!store && content && <button type="button" disabled={loading} onClick={() => void chooseStore(content.snapshot.store.slug)}>Muuda tootevalikut</button>}
      {store && <>
        <div className="campaign-phone__catalog" role="group" aria-label="Vali reklaami tooted">
          {catalog.map((p) => <label key={p.id} className="campaigns__checkbox"><input type="checkbox" checked={selected.includes(p.id)} disabled={!selected.includes(p.id) && selected.length >= MAX_PRODUCTS} onChange={(e) => setSelected(e.target.checked ? [...selected, p.id] : selected.filter((id) => id !== p.id))} /><img src={p.image} alt="" loading="lazy" /><span>{p.name}</span></label>)}
        </div>
        <div className="campaign-phone__order">{selected.map((id, i) => <div key={id}><span>{i + 1}. {catalog.find((p) => p.id === id)?.name}</span><button type="button" aria-label={`Toode ${i + 1} üles`} disabled={!i} onClick={() => setSelected(move(selected, i, i - 1))}>↑</button><button type="button" aria-label={`Toode ${i + 1} alla`} disabled={i === selected.length - 1} onClick={() => setSelected(move(selected, i, i + 1))}>↓</button></div>)}</div>
        <button type="button" disabled={!selected.length || loading} onClick={() => void apply()}>{saving ? 'Salvestan poe sisu…' : `Rakenda valik · ${selected.length}/${MAX_PRODUCTS}`}</button>
      </>}
      </details>
      {content && <>
        <small>Poe sisu salvestatud {new Date(content.snapshot.capturedAt).toLocaleDateString('et-EE')} · {products.length} toodet</small>
        <label>Tegevuste mall<select aria-label="Tegevuste mall" value="" onChange={(e) => actions(presetActions(products, e.target.value))}><option value="" disabled>Vali järjestus</option><option value="products">Toodete tutvustus</option><option value="browse">Poe sirvimine</option><option value="search" disabled={!products.some((p) => p.searchVisible !== false)}>Otsingu demo</option></select></label>
        <ol className="campaign-phone__actions">{content.actions.map((action, i) => {
          const product = products.find((p) => p.id === action.productId)!
          return <li key={i}>
            <div className="campaign-phone__action-top"><b>{i + 1}</b><select aria-label={`Tegevus ${i + 1}`} value={action.type} onChange={(e) => {
              const type = e.target.value as PhoneAction['type'], target = type === 'search' ? products.find((p) => p.searchVisible !== false) ?? product : product
              patch(i, { type, productId: target.id, imageIndex: Math.min(1, (target.gallery?.length ?? 1) - 1), query: target.name.slice(0, 40) })
            }}>{Object.entries(actionLabels).map(([key, label]) => <option key={key} value={key} disabled={key === 'search' && !products.some((p) => p.searchVisible !== false)}>{label}</option>)}</select><label><input type="number" aria-label={`Tegevuse ${i + 1} kestus`} min="1" max="10" step="0.5" value={action.duration} onChange={(e) => { if (e.target.value) patch(i, { duration: Math.max(1, Math.min(10, Math.round(Number(e.target.value) * 10) / 10)) }) }} />s</label></div>
            <select aria-label={`Tegevuse ${i + 1} toode`} value={action.productId} onChange={(e) => { const p = products.find((p) => p.id === e.target.value)!; patch(i, { productId: p.id, imageIndex: Math.min(1, (p.gallery?.length ?? 1) - 1), query: p.name.slice(0, 40) }) }}>{products.filter((p) => action.type !== 'search' || p.searchVisible !== false).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            {action.type === 'gallery' && <label>Galeriipilt<select aria-label={`Tegevuse ${i + 1} galeriipilt`} value={action.imageIndex ?? 0} onChange={(e) => patch(i, { imageIndex: Number(e.target.value) })}>{product.gallery?.map((_, n) => <option key={n} value={n}>Pilt {n + 1}</option>)}</select></label>}
            {action.type === 'search' && <label>Otsingusõna<input maxLength={40} aria-label={`Tegevuse ${i + 1} otsingusõna`} value={action.query ?? ''} onChange={(e) => patch(i, { query: e.target.value })} /></label>}
            <div className="campaign-phone__action-tools"><button type="button" aria-label={`Tegevus ${i + 1} üles`} disabled={!i} onClick={() => actions(move(content.actions, i, i - 1))}>↑</button><button type="button" aria-label={`Tegevus ${i + 1} alla`} disabled={i === content.actions.length - 1} onClick={() => actions(move(content.actions, i, i + 1))}>↓</button><button type="button" aria-label={`Eemalda tegevus ${i + 1}`} disabled={content.actions.length === 1} onClick={() => actions(content.actions.filter((_, n) => n !== i))}>Eemalda</button></div>
          </li>
        })}</ol>
        <div className="campaign-phone__total"><button type="button" disabled={content.actions.length >= 8 || seconds >= MAX_CONTENT_SECONDS} onClick={() => actions([...content.actions, { type: 'product', productId: products[0].id, duration: Math.min(2, MAX_CONTENT_SECONDS - seconds) }])}>+ Tegevus</button><small>{Number(seconds.toFixed(1))} s + lõpp 3 s</small></div>
        {invalid && <small role="alert">{seconds > MAX_CONTENT_SECONDS ? 'Tegevuste kogukestus võib olla kuni 27 sekundit.' : 'Otsingusõna peab leidma valitud toote.'}</small>}
        <button type="button" className="campaigns__text-button" onClick={() => { const next = { ...doc }; delete next.phoneContent; onChange({ ...next, media: structuredClone(defaultMedia) }); setError('') }}>Taasta näidispood</button>
      </>}
      {error && <small role="alert">{error}</small>}
    </fieldset>
  </details>
}
