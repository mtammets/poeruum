import { useEffect, useRef, useState } from 'react'
import ModalCloseButton from './ModalCloseButton'
import { createStoreQr, DEFAULT_STORE_QR_OPTIONS, exportStoreQrPdf, exportStoreQrPng, getStoreQrBrandColors, renderStoreQr, STORE_QR_PRINT_MM, type StoreQrDesign, type StoreQrOptions, type StoreQrShape } from './lib/storeQr'
import './storeQr.css'

export default function StoreQrDialog({ url, storeName, logo, accent, onClose }: {
  url: string; storeName: string; logo: string | null; accent: string; onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const mounted = useRef(false)
  const [shape, setShape] = useState<StoreQrShape>('round')
  const [useLogo, setUseLogo] = useState(Boolean(logo))
  const [options, setOptions] = useState<StoreQrOptions>(DEFAULT_STORE_QR_OPTIONS)
  const [artwork, setArtwork] = useState<{ key: string; design: StoreQrDesign; preview: string } | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [exporting, setExporting] = useState<'png' | 'pdf' | null>(null)
  const requestKey = JSON.stringify([url, shape, useLogo ? logo : null, options])
  const isCurrent = artwork?.key === requestKey
  const validationMessage = isCurrent ? artwork.design.validationMessage : ''
  const ready = isCurrent && !validationMessage && !error
  const updating = !isCurrent && !error

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
    setError('')
    const timer = window.setTimeout(() => {
      void createStoreQr(url, shape, useLogo ? logo : null, options).then((design) => {
        if (active) setArtwork({ key: requestKey, design, preview: renderStoreQr(design).toDataURL('image/png') })
      }).catch((cause: unknown) => {
        if (active) {
          setArtwork(null)
          setError(cause instanceof Error ? cause.message : 'QR-koodi ei õnnestunud luua. Proovi uuesti.')
        }
      })
    }, 150)
    return () => { active = false; window.clearTimeout(timer) }
  }, [url, shape, logo, useLogo, options, requestKey, attempt])

  const download = async (format: 'png' | 'pdf') => {
    if (!ready || !artwork || exporting) return
    const { design } = artwork
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
      <div className="store-qr__shapes" role="group" aria-label="Kuju">
        <button type="button" aria-pressed={shape === 'square'} onClick={() => setShape('square')} disabled={Boolean(exporting)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="1" /></svg>Ruut
        </button>
        <button type="button" aria-pressed={shape === 'round'} onClick={() => setShape('round')} disabled={Boolean(exporting)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /></svg>Ring
        </button>
      </div>
      <div className="store-qr__preview" aria-busy={updating}>
        {artwork ? <><img src={artwork.preview} alt={`${storeName}: poodi juhatav QR-kood`} />{updating && <span className="store-qr__updating" role="status">Uuendan…</span>}</>
          : <span role="status">{error ? 'Eelvaade pole saadaval' : 'Loon QR-koodi…'}</span>}
      </div>
      {validationMessage && <p className="store-qr__validation" id="store-qr-validation" role="alert">{validationMessage}</p>}
      {error && <div className="store-qr__error" role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt((value) => value + 1)}>Proovi uuesti</button></div>}
      <fieldset className="store-qr__customize" disabled={Boolean(exporting)} aria-describedby={validationMessage ? 'store-qr-validation' : undefined}>
        <legend>Kujunda</legend>
        <div className="store-qr__presets">
          <button type="button" onClick={() => setOptions((value) => ({ ...value, ...getStoreQrBrandColors(accent) }))}>Poe värvid</button>
          <button type="button" onClick={() => { setOptions(DEFAULT_STORE_QR_OPTIONS); setUseLogo(Boolean(logo)) }}>Lähtesta</button>
        </div>
        <div className="store-qr__colors">
          {([['foreground', 'Koodi värv'], ['background', 'Tausta värv']] as const).map(([key, label]) => <label key={key}>
            <input type="color" aria-label={label} value={options[key]} onChange={(event) => setOptions((value) => ({ ...value, [key]: event.target.value }))} />
            <span>{label}<small>{options[key].toUpperCase()}</small></span>
          </label>)}
        </div>
        <div className="store-qr__choices" role="group" aria-label="Muster">
          {([['square', 'Ruudud'], ['rounded', 'Ümarad'], ['dots', 'Täpid']] as const).map(([id, label]) => <button type="button" aria-pressed={options.pattern === id} onClick={() => setOptions((value) => ({ ...value, pattern: id }))} key={id}>
            <svg viewBox="0 0 24 24" aria-hidden="true">{[3, 14].flatMap((x) => [3, 14].map((y) => <rect key={`${x}-${y}`} x={x} y={y} width="7" height="7" rx={id === 'dots' ? 3.5 : id === 'rounded' ? 2 : 0} />))}</svg>{label}
          </button>)}
        </div>
        {logo ? <>
          <label className="store-qr__logo"><input type="checkbox" checked={useLogo} onChange={(event) => setUseLogo(event.target.checked)} />Poe logoga</label>
          <div className="store-qr__choices" role="group" aria-label="Logo suurus">
            {([['small', 'Väike'], ['medium', 'Keskmine'], ['large', 'Suur']] as const).map(([id, label]) => <button type="button" disabled={!useLogo} aria-pressed={options.logoSize === id} onClick={() => setOptions((value) => ({ ...value, logoSize: id }))} key={id}>{label}</button>)}
          </div>
        </> : <p className="store-qr__note">Logo saad lisada poe kujunduse seadetes.</p>}
      </fieldset>
      <div className="store-qr__downloads">
        <button type="button" disabled={!ready || Boolean(exporting)} onClick={() => void download('png')}>
          <strong>{exporting === 'png' ? 'Loon faili…' : 'Laadi PNG alla'}</strong><small>2000 × 2000 px</small>
        </button>
        <button type="button" disabled={!ready || Boolean(exporting)} onClick={() => void download('pdf')}>
          <strong>{exporting === 'pdf' ? 'Loon faili…' : 'Laadi PDF alla'}</strong><small>{shape === 'round' ? `Ø ${STORE_QR_PRINT_MM} mm` : `${STORE_QR_PRINT_MM} × ${STORE_QR_PRINT_MM} mm`}</small>
        </button>
      </div>
    </section>
  </dialog>
}
