import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { requireSupabase } from './lib/supabase'
import { isSupabaseProductImageUrl } from './lib/database'
import Icon from './AdminUserIcon'
import './adminProductPreview.css'

type PreviewProduct = { id: string; name: string; image_url: string; gallery: unknown; alt: string }
type ProductPage = { version: 1; store_id: string; offset: number; total: number; products: PreviewProduct[] }

function ProductPhoto({ src, alt }: { src?: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [retry, setRetry] = useState(0)
  if (!src || failed) return <div className="admin-product-preview__empty" role="status"><Icon name="box" /><span>{failed ? 'Pilti ei õnnestunud laadida' : 'Pilt puudub'}</span>{failed && <button type="button" onClick={() => { setFailed(false); setLoaded(false); setRetry((value) => value + 1) }}>Proovi uuesti</button>}</div>
  return <>{!loaded && <span className="admin-product-preview__loading" role="status">Laadin pilti…</span>}<img key={retry} src={src} alt={alt} decoding="async" referrerPolicy="no-referrer" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} /></>
}

export default function AdminProductPreview({ storeId, storeName, onClose }: { storeId: string; storeName: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [index, setIndex] = useState(0)
  const [photoIndex, setPhotoIndex] = useState(0)
  const [page, setPage] = useState<ProductPage | null>(null)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const offset = Math.floor(index / 48) * 48
  useEffect(() => {
    const dialog = dialogRef.current!
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.showModal()
    return () => {
      dialog.close()
      document.body.style.overflow = overflow
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setError(false)
    setPage(null)
    void Promise.resolve(requireSupabase().rpc('admin_store_products', { target_store_id: storeId, page_offset: offset }).abortSignal(controller.signal)).then(({ data, error: queryError }) => {
      if (controller.signal.aborted) return
      if (queryError || data?.version !== 1 || data.store_id !== storeId || data.offset !== offset || !Number.isInteger(data.total) || data.total < 0 || !Array.isArray(data.products)) { setError(true); return }
      setPage(data as ProductPage)
      setIndex((current) => Math.min(current, Math.max(0, data.total - 1)))
    }).catch(() => { if (!controller.signal.aborted) setError(true) })
    return () => controller.abort()
  }, [storeId, offset, retry])
  const currentPage = page?.offset === offset ? page : null
  useEffect(() => {
    const dialog = dialogRef.current
    // A selected navigation button can become disabled or disappear on a page change.
    if (dialog && (!dialog.contains(document.activeElement) || (document.activeElement instanceof HTMLButtonElement && document.activeElement.disabled))) {
      dialog.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    }
  }, [index, currentPage])
  const product = currentPage?.products[index - offset]
  const photos = product ? [...new Set([product.image_url, ...(Array.isArray(product.gallery) ? product.gallery : [])].filter(isSupabaseProductImageUrl))] : []
  const photo = photos[photoIndex] ?? photos[0]
  const move = (direction: number) => {
    if (!currentPage) return
    setIndex((current) => Math.max(0, Math.min(currentPage.total - 1, current + direction)))
    setPhotoIndex(0)
  }
  return createPortal(<dialog ref={dialogRef} className="admin-product-preview" aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose() }}
    onKeyDown={(event) => {
      event.stopPropagation()
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1) }
      if (event.key === 'Tab') {
        const controls = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
        const first = controls[0], last = controls.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }} onClick={(event) => {
      event.stopPropagation()
      if (event.target !== event.currentTarget) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
    }}>
    <header><h2 id={titleId}>{storeName}</h2><button type="button" className="admin-product-preview__icon" aria-label="Sulge tootepildid" onClick={onClose}><Icon name="close" /></button></header>
    <div className="admin-product-preview__image">
      {error ? <div className="admin-product-preview__empty" role="status"><Icon name="alert" /><span>Tooteid ei õnnestunud laadida</span><button type="button" onClick={() => setRetry((value) => value + 1)}>Proovi uuesti</button></div>
        : !currentPage ? <span role="status">Laadin tooteid…</span>
          : product ? <ProductPhoto key={`${product.id}:${photo}`} src={photo} alt={product.alt || product.name} />
            : <div className="admin-product-preview__empty" role="status"><Icon name="box" /><span>Tooteid pole veel lisatud</span></div>}
    </div>
    {product && <footer><div className="admin-product-preview__caption"><h3>{product.name}</h3>{photos.length > 1 && <div className="admin-product-preview__photos" role="group" aria-label="Toote pildid">{photos.map((src, i) => <button type="button" key={src} aria-label={`Pilt ${i + 1}`} aria-pressed={src === photo} onClick={() => setPhotoIndex(i)}><img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" /></button>)}</div>}</div>{currentPage!.total > 1 && <div className="admin-product-preview__navigation"><button type="button" className="admin-product-preview__icon is-previous" aria-label="Eelmine toode" disabled={index === 0} onClick={() => move(-1)}><Icon name="chevron" /></button><span aria-live="polite">{index + 1} / {currentPage!.total}</span><button type="button" className="admin-product-preview__icon" aria-label="Järgmine toode" disabled={index >= currentPage!.total - 1} onClick={() => move(1)}><Icon name="chevron" /></button></div>}</footer>}
  </dialog>, document.body)
}
