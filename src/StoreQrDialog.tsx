import { useEffect, useRef, useState } from 'react'
import ModalCloseButton from './ModalCloseButton'
import { createStoreQr, exportStoreQrPdf, exportStoreQrPng, renderStoreQr, STORE_QR_PRINT_MM, type StoreQrDesign, type StoreQrShape } from './lib/storeQr'
import './storeQr.css'

export default function StoreQrDialog({ url, storeName, logo, onClose }: {
  url: string; storeName: string; logo: string | null; onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const mounted = useRef(false)
  const [shape, setShape] = useState<StoreQrShape>('round')
  const [useLogo, setUseLogo] = useState(Boolean(logo))
  const [design, setDesign] = useState<StoreQrDesign | null>(null)
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [exporting, setExporting] = useState<'png' | 'pdf' | null>(null)

  useEffect(() => {
    mounted.current = true
    const element = dialog.current!
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element.showModal()
    return () => {
      mounted.current = false
      element.close()
      window.requestAnimationFrame(() => {
        if (!element.open && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
      })
    }
  }, [])

  useEffect(() => {
    let active = true
    setDesign(null)
    setPreview('')
    setError('')
    createStoreQr(url, shape, useLogo ? logo : null).then((result) => {
      if (!active) return
      setPreview(renderStoreQr(result).toDataURL('image/png'))
      setDesign(result)
    }).catch(() => {
      if (active) setError(useLogo
        ? 'Logoga QR-koodi ei õnnestunud luua. Proovi uuesti või vali ilma logota.'
        : 'QR-koodi ei õnnestunud luua. Proovi uuesti.')
    })
    return () => { active = false }
  }, [url, shape, logo, useLogo, attempt])

  const download = async (format: 'png' | 'pdf') => {
    if (!design || exporting) return
    setExporting(format)
    setError('')
    try {
      const blob = format === 'png' ? await exportStoreQrPng(design) : await exportStoreQrPdf(design, storeName)
      if (!mounted.current) return
      const fileUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const name = storeName.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'pood'
      link.href = fileUrl
      link.download = `${name}-qr-${design.shape === 'round' ? 'kleeps' : 'ruut'}.${format}`
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(fileUrl), 30000)
    } catch {
      if (mounted.current) setError('Faili allalaadimine ebaõnnestus. Proovi uuesti.')
    } finally {
      if (mounted.current) setExporting(null)
    }
  }

  return <dialog ref={dialog} className="store-qr-dialog" aria-labelledby="store-qr-title"
    onCancel={(event) => { event.preventDefault(); onClose() }}
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="store-qr">
      <ModalCloseButton onClose={onClose} className="store-qr__close" />
      <header><h2 id="store-qr-title">Poe QR-kood</h2><p>{url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</p></header>
      <div className="store-qr__shapes" role="group" aria-label="Kujundus">
        <button type="button" aria-pressed={shape === 'square'} onClick={() => setShape('square')} disabled={Boolean(exporting)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="1" /></svg>Ruut
        </button>
        <button type="button" aria-pressed={shape === 'round'} onClick={() => setShape('round')} disabled={Boolean(exporting)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /></svg>Ring
        </button>
      </div>
      <div className="store-qr__preview" aria-busy={!design && !error}>
        {preview ? <img src={preview} alt={`${storeName}: poodi juhatav QR-kood`} />
          : <span role="status">{error ? 'Eelvaade pole saadaval' : 'Loon QR-koodi…'}</span>}
      </div>
      {logo ? <label className="store-qr__logo"><input type="checkbox" checked={useLogo} disabled={Boolean(exporting)} onChange={(event) => setUseLogo(event.target.checked)} />Poe logoga</label>
        : <p className="store-qr__note">Logo saad lisada poe kujunduse seadetes.</p>}
      {error && <div className="store-qr__error" role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt((value) => value + 1)}>Proovi uuesti</button></div>}
      <div className="store-qr__downloads">
        <button type="button" disabled={!design || Boolean(exporting)} onClick={() => void download('png')}>
          <strong>{exporting === 'png' ? 'Loon faili…' : 'Laadi PNG alla'}</strong><small>2000 × 2000 px</small>
        </button>
        <button type="button" disabled={!design || Boolean(exporting)} onClick={() => void download('pdf')}>
          <strong>{exporting === 'pdf' ? 'Loon faili…' : 'Laadi PDF alla'}</strong><small>{shape === 'round' ? `Ø ${STORE_QR_PRINT_MM} mm` : `${STORE_QR_PRINT_MM} × ${STORE_QR_PRINT_MM} mm`}</small>
        </button>
      </div>
    </section>
  </dialog>
}
