import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { CardIcon, type CardIconName } from './CardIcon'
import { CardElementArtwork, CardThumbnail } from './CardArtwork'
import { ensureCardFonts, getCardFontFamily, layoutText } from './fonts'
import { CARD_ELEMENT_LABELS, CARD_SIDE_LABELS, MAX_ELEMENTS, MM_PER_PT, clamp, createCardElement, getCardIssues, parseCardDocument, round, type CardDocument, type CardElement, type CardIssue, type CardSideId } from './model'
import { getQrMatrix } from './qr'
import './fonts.css'
import './editor.css'

type EditorProps = {
  initialDocument: CardDocument
  onDocumentChange?: (document: CardDocument) => void
  onSave?: () => void
  saveStatus?: string
  storageNotice?: ReactNode
}
type History = { past: CardDocument[]; present: CardDocument; future: CardDocument[] }
type Gesture = {
  start: { x: number; y: number }
  element: CardElement
  document: CardDocument
  mode: 'move' | 'resize' | 'rotate'
  corner: { x: number; y: number }
}

function IconButton({ icon, label, onClick, disabled, active }: { icon: CardIconName; label: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return <button type="button" className={`bc-icon-button${active ? ' is-active' : ''}`} title={label} aria-label={label} aria-pressed={active} onClick={onClick} disabled={disabled}><CardIcon name={icon} /></button>
}

function NumberField({ label, value, onChange, min = -300, max = 300, step = 0.1, disabled }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; disabled?: boolean }) {
  const [draft, setDraft] = useState(String(round(value)))
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setDraft(String(round(value))) }, [value, focused])
  return <label className="bc-field"><span>{label}</span><input type="number" inputMode="decimal" value={draft} min={min} max={max} step={step} disabled={disabled}
    onFocus={() => setFocused(true)} onChange={(event) => { setDraft(event.target.value); if (event.target.value !== '' && Number.isFinite(event.target.valueAsNumber)) onChange(clamp(event.target.valueAsNumber, min, max)) }}
    onBlur={() => { setFocused(false); setDraft(String(round(value))) }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
}

function ColorField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return <label className="bc-field"><span>{label}</span><span className="bc-color-field"><input type="color" aria-label={`${label}: vali värv`} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} /><input aria-label={`${label}: HEX`} value={text.toUpperCase()} maxLength={7} spellCheck={false} onChange={(event) => { const next = event.target.value; setText(next); if (/^#[\da-f]{6}$/i.test(next)) onChange(next) }} onBlur={() => setText(value)} disabled={disabled} /></span></label>
}

function ExportDialog({ document: doc, issues, onClose, onIssue }: { document: CardDocument; issues: CardIssue[]; onClose: () => void; onIssue: (issue: CardIssue) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  useEffect(() => { dialog.current?.showModal() }, [])
  const exportPdf = async () => {
    setBusy(true); setError('')
    try {
      const { exportBusinessCardPdf } = await import('./exportPdf')
      const data = await exportBusinessCardPdf(parseCardDocument(doc))
      downloadFile(new Blob([new Uint8Array(data)], { type: 'application/pdf' }), `visiitkaart-${doc.width}x${doc.height}mm.pdf`)
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'PDF-i loomine ebaõnnestus. Proovi uuesti.') }
    finally { setBusy(false) }
  }
  const hasErrors = issues.some((issue) => issue.severity === 'error')
  return <dialog ref={dialog} className="bc-export-dialog" aria-label="Trüki-PDF" onCancel={(event) => { if (busy) event.preventDefault(); else onClose() }} onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <div className="bc-export-dialog__body">
      <header><div><span className="bc-eyebrow">VALMIS TRÜKIKOJAKS</span><h2>Trüki-PDF</h2></div><IconButton icon="close" label="Sulge eksport" onClick={onClose} disabled={busy} /></header>
      <div className="bc-export-preview"><CardThumbnail document={doc} side="front" /><CardThumbnail document={doc} side="back" /></div>
      <dl className="bc-export-facts"><div><dt>Formaat</dt><dd>{doc.width} × {doc.height} mm</dd></div><div><dt>Küljed</dt><dd>2 lehekülge</dd></div><div><dt>Lõikevaru</dt><dd>{doc.bleed} mm</dd></div><div><dt>Lõikemärgid</dt><dd>{doc.cropMarks ? 'Jah' : 'Ei'}</dd></div></dl>
      <div className="bc-export-profile"><CardIcon name="file" /><div><strong>PDF/X-4 · FOGRA51</strong><span>PSO Coated v3 · fondid kaasas</span></div></div>
      {!!issues.length && <div className="bc-export-issues"><strong>{issues.length} {issues.length === 1 ? 'koht vajab' : 'kohta vajavad'} tähelepanu</strong>{issues.map((issue, index) => <button type="button" key={`${issue.elementId}-${index}`} onClick={() => onIssue(issue)}><span>{CARD_SIDE_LABELS[issue.side]}</span>{issue.message}<span aria-hidden="true">↗</span></button>)}</div>}
      {!!issues.length && !hasErrors && <label className="bc-check-field"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />Ekspordi koos hoiatustega</label>}
      {error && <p className="bc-error" role="alert">{error}</p>}
      <button className="bc-primary bc-export-download" type="button" onClick={() => void exportPdf()} disabled={busy || hasErrors || (!!issues.length && !acknowledged)}><CardIcon name="download" />{busy ? 'Valmistan PDF-i…' : 'Laadi PDF alla'}</button>
    </div>
  </dialog>
}

export function downloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = filename
  document.body.append(link); link.click(); link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function BusinessCardEditor({ initialDocument, onDocumentChange, onSave, saveStatus = 'Salvestatud', storageNotice }: EditorProps) {
  const [history, setHistory] = useState<History>(() => ({ past: [], present: initialDocument, future: [] }))
  const doc = history.present
  const [side, setSide] = useState<CardSideId>('front')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [fontsReady, setFontsReady] = useState(false)
  const [fontError, setFontError] = useState('')
  const [error, setError] = useState('')
  const [imageBusy, setImageBusy] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showGuides, setShowGuides] = useState(true)
  const [preview, setPreview] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [snapLines, setSnapLines] = useState<{ x?: number; y?: number }>({})
  const [editingText, setEditingText] = useState<string | null>(null)
  const [canvasWidth, setCanvasWidth] = useState(580)
  const svg = useRef<SVGSVGElement>(null)
  const workspace = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const merge = useRef({ key: '', at: 0 })
  const latestDoc = useRef(doc)
  const notifyRef = useRef(onDocumentChange)
  const clipId = useId().replaceAll(':', '')
  latestDoc.current = doc
  notifyRef.current = onDocumentChange
  const currentSide = doc.sides[side]
  const selected = currentSide.elements.find((el) => el.id === selectedId)
  const scale = canvasWidth * zoom / (doc.width + doc.bleed * 2)

  const loadFonts = () => { setFontError(''); void ensureCardFonts().then(() => setFontsReady(true)).catch((cause: unknown) => setFontError(cause instanceof Error ? cause.message : 'Kirjatüüpide laadimine ebaõnnestus.')) }
  useEffect(loadFonts, [])
  useEffect(() => { if (doc !== initialDocument && !gesture.current) notifyRef.current?.(doc) }, [doc, initialDocument])
  useEffect(() => {
    if (!workspace.current) return
    const observer = new ResizeObserver(([entry]) => setCanvasWidth(Math.max(150, Math.min(760, entry.contentRect.width - 64))))
    observer.observe(workspace.current)
    return () => observer.disconnect()
  }, [fontsReady])

  const change = (next: CardDocument, key = '') => {
    const shouldMerge = key && merge.current.key === key && Date.now() - merge.current.at < 800
    merge.current = { key, at: Date.now() }
    setHistory((current) => ({ past: shouldMerge ? current.past : [...current.past.slice(-59), current.present], present: next, future: [] }))
  }
  const updateElement = (patch: Partial<CardElement>, key = '') => {
    if (!selected || (selected.locked && !('locked' in patch))) return
    change({ ...doc, sides: { ...doc.sides, [side]: { ...currentSide, elements: currentSide.elements.map((el) => el.id === selected.id ? { ...el, ...patch } : el) } } }, key ? `${selected.id}-${key}` : '')
  }
  const updateSide = (patch: Partial<typeof currentSide>) => change({ ...doc, sides: { ...doc.sides, [side]: { ...currentSide, ...patch } } }, 'side-color')
  const undo = () => { merge.current.key = ''; setEditingText(null); setHistory((current) => current.past.length ? { past: current.past.slice(0, -1), present: current.past.at(-1)!, future: [current.present, ...current.future] } : current) }
  const redo = () => { merge.current.key = ''; setEditingText(null); setHistory((current) => current.future.length ? { past: [...current.past, current.present], present: current.future[0], future: current.future.slice(1) } : current) }
  const switchSide = (next: CardSideId) => { setSide(next); setSelectedId(null); setEditingText(null); setError('') }
  const addElement = (type: CardElement['type'], overrides: Partial<CardElement> = {}) => {
    if (currentSide.elements.length >= MAX_ELEMENTS) { setError('Ühele küljele saab lisada kuni 60 elementi.'); return }
    const el = createCardElement(type, { ...overrides })
    if (type !== 'image') { el.x = overrides.x ?? round((doc.width - el.width) / 2); el.y = overrides.y ?? round((doc.height - el.height) / 2) }
    if (type === 'text' && !overrides.color && currentSide.background === '#244d3c') el.color = '#f8f5ec'
    change({ ...doc, sides: { ...doc.sides, [side]: { ...currentSide, elements: [...currentSide.elements, el] } } })
    setSelectedId(el.id); setPreview(false); setError('')
  }
  const removeElement = () => {
    if (!selected || selected.locked) return
    change({ ...doc, sides: { ...doc.sides, [side]: { ...currentSide, elements: currentSide.elements.filter((el) => el.id !== selected.id) } } })
    setSelectedId(null); setEditingText(null)
  }
  const duplicateElement = () => { if (selected) addElement(selected.type, { ...selected, id: createCardElement(selected.type).id, name: `${selected.name.slice(0, 110)} koopia`, x: selected.x + 2, y: selected.y + 2, locked: false }) }
  const reorder = (direction: number) => {
    if (!selected || selected.locked) return
    const elements = [...currentSide.elements]
    const index = elements.findIndex((el) => el.id === selected.id)
    const next = clamp(index + direction, 0, elements.length - 1)
    elements.splice(index, 1); elements.splice(next, 0, selected)
    change({ ...doc, sides: { ...doc.sides, [side]: { ...currentSide, elements } } })
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable="true"], dialog') || showExport) return
      const command = event.metaKey || event.ctrlKey
      if (command && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo() }
      else if (command && event.key.toLowerCase() === 'y') { event.preventDefault(); redo() }
      else if (command && event.key.toLowerCase() === 's') { event.preventDefault(); onSave?.() }
      else if (command && event.key.toLowerCase() === 'd' && selected) { event.preventDefault(); duplicateElement() }
      else if ((event.key === 'Delete' || event.key === 'Backspace') && selected) { event.preventDefault(); removeElement() }
      else if (event.key === 'Escape') { setSelectedId(null); setEditingText(null); setPreview(false) }
      else if (selected && !selected.locked && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault()
        const step = event.shiftKey ? 1 : 0.1
        updateElement({ x: round(clamp(selected.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), -300, 300)), y: round(clamp(selected.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0), -300, 300)) }, 'nudge')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const point = (event: ReactPointerEvent) => {
    const matrix = svg.current?.getScreenCTM()
    if (!matrix) return { x: 0, y: 0 }
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    return { x: p.x, y: p.y }
  }
  const startGesture = (event: ReactPointerEvent, el: CardElement, mode: Gesture['mode'], corner = { x: 1, y: 1 }) => {
    if (event.button !== 0 || preview) return
    event.stopPropagation(); setSelectedId(el.id)
    if (el.locked) return
    event.preventDefault()
    svg.current?.focus({ preventScroll: true })
    setEditingText(null)
    gesture.current = { start: point(event), element: { ...el }, document: doc, mode, corner }
    svg.current?.setPointerCapture(event.pointerId)
  }
  const moveGesture = (event: ReactPointerEvent<SVGSVGElement>) => {
    const active = gesture.current
    if (!active) return
    const position = point(event)
    const dx = position.x - active.start.x; const dy = position.y - active.start.y
    const el = { ...active.element }
    const guides: { x?: number; y?: number } = {}
    if (active.mode === 'move') {
      el.x += dx; el.y += dy
      if (!event.altKey) {
        const threshold = 5 / scale
        const candidatesX = [0, 3, doc.width / 2, doc.width - 3, doc.width]
        const candidatesY = [0, 3, doc.height / 2, doc.height - 3, doc.height]
        for (const other of currentSide.elements.filter((item) => item.id !== el.id)) { candidatesX.push(other.x, other.x + other.width / 2, other.x + other.width); candidatesY.push(other.y, other.y + other.height / 2, other.y + other.height) }
        let bestX = threshold; let bestY = threshold
        for (const anchor of [0, el.width / 2, el.width]) for (const target of candidatesX) { const distance = Math.abs(target - el.x - anchor); if (distance < bestX) { bestX = distance; guides.x = target; el.x = target - anchor } }
        for (const anchor of [0, el.height / 2, el.height]) for (const target of candidatesY) { const distance = Math.abs(target - el.y - anchor); if (distance < bestY) { bestY = distance; guides.y = target; el.y = target - anchor } }
      }
      el.x = round(clamp(el.x, -doc.bleed - el.width + 1, doc.width + doc.bleed - 1)); el.y = round(clamp(el.y, -doc.bleed - el.height + 1, doc.height + doc.bleed - 1))
    } else if (active.mode === 'rotate') {
      const center = { x: el.x + el.width / 2, y: el.y + el.height / 2 }
      el.rotation = round(Math.atan2(position.y - center.y, position.x - center.x) * 180 / Math.PI + 90)
      if (event.shiftKey) el.rotation = Math.round(el.rotation / 15) * 15
    } else {
      const angle = el.rotation * Math.PI / 180
      const localDx = Math.cos(angle) * dx + Math.sin(angle) * dy
      const localDy = -Math.sin(angle) * dx + Math.cos(angle) * dy
      const width = clamp(el.width + localDx * active.corner.x, 0.5, 300)
      let height = clamp(el.height + localDy * active.corner.y, 0.5, 300)
      if (event.shiftKey || el.type === 'qr') height = clamp(width / el.width * el.height, 0.5, 300)
      const cx = (width - el.width) / 2 * active.corner.x; const cy = (height - el.height) / 2 * active.corner.y
      el.x += Math.cos(angle) * cx - Math.sin(angle) * cy - (width - el.width) / 2
      el.y += Math.sin(angle) * cx + Math.cos(angle) * cy - (height - el.height) / 2
      el.width = round(width); el.height = round(height); el.x = round(clamp(el.x, -300, 300)); el.y = round(clamp(el.y, -300, 300))
    }
    setSnapLines(guides)
    setHistory((current) => ({ ...current, present: { ...current.present, sides: { ...current.present.sides, [side]: { ...current.present.sides[side], elements: current.present.sides[side].elements.map((item) => item.id === el.id ? el : item) } } } }))
  }
  const endGesture = (event: ReactPointerEvent<SVGSVGElement>, cancel = false) => {
    const active = gesture.current
    if (!active) return
    gesture.current = null; setSnapLines({}); merge.current.key = ''
    if (svg.current?.hasPointerCapture(event.pointerId)) svg.current.releasePointerCapture(event.pointerId)
    setHistory((current) => cancel ? { ...current, present: active.document } : JSON.stringify(current.present) === JSON.stringify(active.document) ? current : { ...current, present: { ...current.present }, past: [...current.past.slice(-59), active.document], future: [] })
  }

  const uploadImage = async (file?: File) => {
    if (!file) return
    setImageBusy(true); setError('')
    const uploadSide = side
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Vali PNG-, JPG- või WebP-pilt.')
      if (file.size > 12_000_000) throw new Error('Pilt võib olla kuni 12 MB.')
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      if (bitmap.width * bitmap.height > 40_000_000) { bitmap.close(); throw new Error('Pilt on liiga suur. Vali kuni 40-megapiksline pilt.') }
      const canvas = document.createElement('canvas')
      const factor = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height))
      canvas.width = Math.round(bitmap.width * factor); canvas.height = Math.round(bitmap.height * factor)
      const context = canvas.getContext('2d', { colorSpace: 'srgb' })
      if (!context) { bitmap.close(); throw new Error('Pildi laadimine ebaõnnestus.') }
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close()
      const src = canvas.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.95)
      const width = Math.min(40, latestDoc.current.width - 14)
      const height = Math.min(latestDoc.current.height - 14, width / canvas.width * canvas.height)
      const fittedWidth = height / canvas.height * canvas.width
      const el = createCardElement('image', { name: file.name.slice(0, 120), src, pixelWidth: canvas.width, pixelHeight: canvas.height, width: fittedWidth, height, x: (latestDoc.current.width - fittedWidth) / 2, y: (latestDoc.current.height - height) / 2, cropX: 50, cropY: 50 })
      const current = latestDoc.current
      const next = { ...current, sides: { ...current.sides, [uploadSide]: { ...current.sides[uploadSide], elements: [...current.sides[uploadSide].elements, el] } } }
      parseCardDocument(next)
      change(next); setSide(uploadSide); setSelectedId(el.id); setPreview(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Pildi lisamine ebaõnnestus.') }
    finally { setImageBusy(false); if (fileInput.current) fileInput.current.value = '' }
  }
  const importDocument = async (file?: File) => {
    if (!file) return
    try { if (file.size > 12_000_000) throw new Error('Fail võib olla kuni 12 MB.'); const next = parseCardDocument(JSON.parse(await file.text())); change(next); setSelectedId(null); setSide('front'); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Faili avamine ebaõnnestus.') }
    finally { if (importInput.current) importInput.current.value = '' }
  }

  const issues = useMemo(() => {
    const result = getCardIssues(doc)
    if (!fontsReady) return result
    for (const sideId of ['front', 'back'] as const) for (const el of doc.sides[sideId].elements) {
      if (el.type === 'text') {
        const layout = layoutText(el)
        if (layout.overflow) result.push({ side: sideId, elementId: el.id, severity: 'error', message: 'Tekst ei mahu tekstikasti.' })
        if (layout.unsupportedCharacters.length) result.push({ side: sideId, elementId: el.id, severity: 'error', message: 'Kirjatüüp ei toeta mõnda märki.' })
      }
      if (el.type === 'qr') {
        try { const qr = getQrMatrix(el.qrValue ?? ''); if (Math.min(el.width, el.height) / qr.size < 0.3) result.push({ side: sideId, elementId: el.id, severity: 'warning', message: 'QR-kood on selle sisu jaoks liiga tihe.' }) }
        catch { result.push({ side: sideId, elementId: el.id, severity: 'error', message: 'Lisa QR-koodile aadress või tekst.' }) }
      }
    }
    return result
  }, [doc, fontsReady])
  const selectIssue = (issue: CardIssue) => { setSide(issue.side); setSelectedId(issue.elementId); setShowExport(false); setPreview(false) }
  const selectedIssues = issues.filter((issue) => issue.side === side && issue.elementId === selected?.id)

  if (!fontsReady) return <section className="business-card-editor bc-loading" aria-busy={!fontError}>{fontError ? <><p role="alert">{fontError}</p><button type="button" className="bc-primary" onClick={loadFonts}>Proovi uuesti</button></> : <><span className="bc-spinner" /><span>Avan kujunduse…</span></>}</section>

  return <section className="business-card-editor" aria-label="Visiitkaardi editor">
    <header className="bc-toolbar">
      <div className="bc-side-tabs" role="tablist" aria-label="Kaardi külg">{(['front', 'back'] as const).map((id) => <button type="button" role="tab" aria-selected={side === id} key={id} onClick={() => switchSide(id)}>{CARD_SIDE_LABELS[id]}</button>)}</div>
      <div className="bc-toolbar__history"><IconButton icon="undo" label="Võta tagasi" onClick={undo} disabled={!history.past.length} /><IconButton icon="redo" label="Tee uuesti" onClick={redo} disabled={!history.future.length} /></div>
      <button type="button" className="bc-save-status" onClick={onSave} disabled={!onSave} title={saveStatus} aria-label={saveStatus}><CardIcon name={saveStatus === 'Salvestatud' ? 'check' : 'file'} /><span role="status">{saveStatus}</span></button>
      <button type="button" className="bc-primary" onClick={() => { setEditingText(null); setShowExport(true) }}><CardIcon name="download" />Ekspordi PDF</button>
    </header>
    {storageNotice}
    {error && <div className="bc-notice is-error" role="alert"><span>{error}</span><IconButton icon="close" label="Sulge teade" onClick={() => setError('')} /></div>}
    <div className="bc-workspace">
      <aside className="bc-tools" aria-label="Lisa element">
        <button type="button" onClick={() => addElement('text')} aria-label="Lisa tekst"><CardIcon name="text" /><span>Tekst</span></button>
        <button type="button" onClick={() => fileInput.current?.click()} disabled={imageBusy} aria-label="Lisa pilt"><CardIcon name="image" /><span>{imageBusy ? 'Laen…' : 'Pilt'}</span></button>
        <button type="button" onClick={() => addElement('shape')} aria-label="Lisa kujund"><CardIcon name="shape" /><span>Kujund</span></button>
        <button type="button" onClick={() => addElement('qr')} aria-label="Lisa QR-kood"><CardIcon name="qr" /><span>QR-kood</span></button>
        <div className="bc-tools__divider" />
        <button type="button" onClick={() => { setSelectedId(null); setEditingText(null) }} aria-label="Kaardi seaded" className={!selected ? 'is-active' : ''}><CardIcon name="settings" /><span>Kaart</span></button>
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => void uploadImage(event.target.files?.[0])} />
        <input ref={importInput} type="file" accept=".json,application/json" hidden onChange={(event) => void importDocument(event.target.files?.[0])} />
      </aside>

      <div className="bc-design-area">
        <div className="bc-stage-heading"><span>{CARD_SIDE_LABELS[side]}</span><span>{doc.width} × {doc.height} mm</span></div>
        <div className="bc-stage-scroll" ref={workspace} onClick={(event) => { if (event.target === event.currentTarget) setSelectedId(null) }}>
          <div className="bc-stage-position" style={{ width: canvasWidth * zoom, height: (doc.height + 2 * doc.bleed) * scale }}>
            <svg ref={svg} className={`bc-canvas${preview ? ' is-preview' : ''}`} width={canvasWidth * zoom} height={(doc.height + 2 * doc.bleed) * scale} viewBox={`${-doc.bleed} ${-doc.bleed} ${doc.width + 2 * doc.bleed} ${doc.height + 2 * doc.bleed}`} role="group" aria-label={`${side === 'front' ? 'Esikülje' : 'Tagakülje'} kujundus`} tabIndex={0}
              onPointerDown={(event) => { if (event.target === event.currentTarget || (event.target as SVGElement).dataset.background) { setSelectedId(null); setEditingText(null) } }} onPointerMove={moveGesture} onPointerUp={(event) => endGesture(event)} onPointerCancel={(event) => endGesture(event, true)} onDoubleClick={() => { if (selected?.type === 'text' && !selected.locked && !preview) setEditingText(selected.id) }}>
              <defs><clipPath id={clipId}><rect x={preview ? 0 : -doc.bleed} y={preview ? 0 : -doc.bleed} width={doc.width + (preview ? 0 : 2 * doc.bleed)} height={doc.height + (preview ? 0 : 2 * doc.bleed)} /></clipPath></defs>
              <g clipPath={`url(#${clipId})`}>
                <rect data-background="true" x={-doc.bleed} y={-doc.bleed} width={doc.width + 2 * doc.bleed} height={doc.height + 2 * doc.bleed} fill={currentSide.background} />
                {currentSide.elements.map((el) => <g key={el.id} data-element-id={el.id} role="button" aria-label={el.name} aria-pressed={selectedId === el.id} tabIndex={preview ? -1 : 0} transform={`translate(${el.x} ${el.y}) rotate(${el.rotation} ${el.width / 2} ${el.height / 2})`} className={`bc-element${el.locked ? ' is-locked' : ''}`} onPointerDown={(event) => startGesture(event, el, 'move')} onDoubleClick={() => { if (el.type === 'text' && !el.locked && !preview) { setSelectedId(el.id); setEditingText(el.id) } }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(el.id) } }}>
                  <CardElementArtwork element={el} /><rect className="bc-hit-area" width={el.width} height={el.height} fill="transparent" />
                </g>)}
              </g>
              {!preview && showGuides && <g className="bc-guides" pointerEvents="none"><rect x="0" y="0" width={doc.width} height={doc.height} fill="none" stroke="#ffffffaa" strokeWidth={1 / scale} /><rect x="3" y="3" width={doc.width - 6} height={doc.height - 6} fill="none" stroke="#879a99" strokeDasharray={`${3 / scale} ${4 / scale}`} strokeWidth={1 / scale} /></g>}
              {snapLines.x !== undefined && <line x1={snapLines.x} x2={snapLines.x} y1={-doc.bleed} y2={doc.height + doc.bleed} stroke="#e26dbe" strokeWidth={1 / scale} pointerEvents="none" />}
              {snapLines.y !== undefined && <line x1={-doc.bleed} x2={doc.width + doc.bleed} y1={snapLines.y} y2={snapLines.y} stroke="#e26dbe" strokeWidth={1 / scale} pointerEvents="none" />}
              {selected && !preview && <g transform={`translate(${selected.x} ${selected.y}) rotate(${selected.rotation} ${selected.width / 2} ${selected.height / 2})`} className="bc-selection">
                <rect width={selected.width} height={selected.height} fill="none" stroke="#3b8570" strokeWidth={1.5 / scale} pointerEvents="none" />
                {!selected.locked && <>
                  <line x1={selected.width / 2} x2={selected.width / 2} y1={0} y2={-22 / scale} stroke="#3b8570" strokeWidth={1 / scale} />
                  <circle cx={selected.width / 2} cy={-25 / scale} r={5 / scale} fill="white" stroke="#3b8570" strokeWidth={1.5 / scale} role="button" aria-label="Pööra elementi" onPointerDown={(event) => startGesture(event, selected, 'rotate')} className="bc-rotate-handle" />
                  {[{ x: -1, y: -1, name: 'ülemine vasak' }, { x: 1, y: -1, name: 'ülemine parem' }, { x: -1, y: 1, name: 'alumine vasak' }, { x: 1, y: 1, name: 'alumine parem' }].map((corner) => <rect key={corner.name} x={(corner.x === -1 ? 0 : selected.width) - 4 / scale} y={(corner.y === -1 ? 0 : selected.height) - 4 / scale} width={8 / scale} height={8 / scale} rx={1 / scale} fill="white" stroke="#3b8570" strokeWidth={1.5 / scale} role="button" aria-label={`Muuda suurust: ${corner.name}`} onPointerDown={(event) => startGesture(event, selected, 'resize', corner)} style={{ cursor: corner.x === corner.y ? 'nwse-resize' : 'nesw-resize' }} />)}
                </>}
              </g>}
            </svg>
            {editingText && selected?.id === editingText && <textarea className="bc-inline-text" aria-label="Muuda teksti kaardil" autoFocus value={selected.text} style={{ left: (selected.x + doc.bleed) * scale, top: (selected.y + doc.bleed) * scale, width: selected.width * scale, height: selected.height * scale, transform: `rotate(${selected.rotation}deg)`, fontFamily: getCardFontFamily(selected.fontFamily), fontSize: (selected.fontSize || 14) * MM_PER_PT * scale, fontWeight: selected.fontWeight, textAlign: selected.textAlign, lineHeight: `${layoutText(selected).lineHeight * scale}px`, color: selected.color, background: currentSide.background }} onChange={(event) => updateElement({ text: event.target.value.slice(0, 3000) }, 'text')} onBlur={() => setEditingText(null)} onKeyDown={(event) => { if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) setEditingText(null) }} />}
          </div>
        </div>
        <div className="bc-stage-controls"><button type="button" className={showGuides ? 'is-active' : ''} aria-pressed={showGuides} onClick={() => setShowGuides(!showGuides)}>Turvaala</button><IconButton icon="eye" label="Eelvaade" active={preview} onClick={() => { setPreview(!preview); setEditingText(null) }} /><span className="bc-stage-controls__spacer" /><IconButton icon="minus" label="Vähenda" onClick={() => setZoom((value) => clamp(value - 0.25, 0.5, 2))} disabled={zoom <= 0.5} /><button type="button" className="bc-zoom" onClick={() => setZoom(1)} title="Mahuta vaatesse">{Math.round(zoom * 100)}%</button><IconButton icon="plus" label="Suurenda" onClick={() => setZoom((value) => clamp(value + 0.25, 0.5, 2))} disabled={zoom >= 2} /></div>
        <div className="bc-side-previews">{(['front', 'back'] as const).map((id) => <button type="button" key={id} aria-label={`${CARD_SIDE_LABELS[id]}: eelvaade`} aria-pressed={side === id} className={side === id ? 'is-active' : ''} onClick={() => switchSide(id)}><CardThumbnail document={doc} side={id} /><span>{CARD_SIDE_LABELS[id]}</span></button>)}</div>
      </div>

      <aside className="bc-inspector" aria-label="Elemendi seaded">
        <div className="bc-inspector__heading"><h2>{selected ? CARD_ELEMENT_LABELS[selected.type] : 'Kaart'}</h2>{selected && <IconButton icon="close" label="Sulge elemendi seaded" onClick={() => setSelectedId(null)} />}</div>
        {selected ? <>
          <div className="bc-inspector__section">
            {selected.type === 'text' && <>
              <label className="bc-field"><span>Tekst</span><textarea value={selected.text || ''} rows={3} maxLength={3000} disabled={selected.locked} onChange={(event) => updateElement({ text: event.target.value }, 'text')} /></label>
              <label className="bc-field"><span>Kirjatüüp</span><select value={selected.fontFamily} disabled={selected.locked} onChange={(event) => updateElement({ fontFamily: event.target.value as CardElement['fontFamily'] })}><option value="sans">Noto Sans</option><option value="serif">Noto Serif</option><option value="mono">Noto Mono</option></select></label>
              <div className="bc-field-row"><NumberField label="Suurus (pt)" value={selected.fontSize || 14} min={4} max={120} step={1} disabled={selected.locked} onChange={(value) => updateElement({ fontSize: value }, 'fontSize')} /><label className="bc-field"><span>Paksus</span><select value={selected.fontWeight} disabled={selected.locked} onChange={(event) => updateElement({ fontWeight: Number(event.target.value) as 400 | 700 })}><option value="400">Tavaline</option><option value="700">Paks</option></select></label></div>
              <div className="bc-segmented" aria-label="Teksti joondus">{(['left', 'center', 'right'] as const).map((align) => <IconButton key={align} icon={align === 'left' ? 'alignLeft' : align === 'center' ? 'alignCenter' : 'alignRight'} label={align === 'left' ? 'Tekst vasakule' : align === 'center' ? 'Tekst keskele' : 'Tekst paremale'} active={selected.textAlign === align} disabled={selected.locked} onClick={() => updateElement({ textAlign: align })} />)}</div>
            </>}
            {selected.type === 'shape' && <label className="bc-field"><span>Kujund</span><select value={selected.shape} disabled={selected.locked} onChange={(event) => updateElement({ shape: event.target.value as CardElement['shape'], ...(event.target.value === 'line' ? { height: 0.5 } : {}) })}><option value="rectangle">Ristkülik</option><option value="ellipse">Ellips</option><option value="line">Joon</option></select></label>}
            {selected.type === 'qr' && <label className="bc-field"><span>QR-koodi sisu</span><textarea value={selected.qrValue || ''} rows={3} maxLength={500} disabled={selected.locked} onChange={(event) => updateElement({ qrValue: event.target.value }, 'qrValue')} spellCheck={false} /></label>}
            {selected.type === 'image' ? <><div className="bc-image-info"><img src={selected.src} alt="" /><span>{selected.pixelWidth} × {selected.pixelHeight} px</span></div><label className="bc-field"><span>Pildi asukoht: horisontaalne</span><input type="range" min="0" max="100" value={selected.cropX ?? 50} disabled={selected.locked} onChange={(event) => updateElement({ cropX: Number(event.target.value) }, 'cropX')} /></label><label className="bc-field"><span>Pildi asukoht: vertikaalne</span><input type="range" min="0" max="100" value={selected.cropY ?? 50} disabled={selected.locked} onChange={(event) => updateElement({ cropY: Number(event.target.value) }, 'cropY')} /></label></> : <ColorField label="Värv" value={selected.color || '#244d3c'} disabled={selected.locked} onChange={(color) => updateElement({ color }, 'color')} />}
          </div>
          <div className="bc-inspector__section"><h3>Paigutus</h3>
            <div className="bc-field-row"><NumberField label="X (mm)" value={selected.x} disabled={selected.locked} onChange={(x) => updateElement({ x }, 'x')} /><NumberField label="Y (mm)" value={selected.y} disabled={selected.locked} onChange={(y) => updateElement({ y }, 'y')} /></div>
            <div className="bc-field-row"><NumberField label="Laius (mm)" value={selected.width} min={0.5} disabled={selected.locked} onChange={(width) => updateElement({ width, ...(selected.type === 'qr' ? { height: width } : {}) }, 'width')} /><NumberField label="Kõrgus (mm)" value={selected.height} min={0.5} disabled={selected.locked} onChange={(height) => updateElement({ height, ...(selected.type === 'qr' ? { width: height } : {}) }, 'height')} /></div>
            <NumberField label="Pööre (°)" value={selected.rotation} min={-360} max={360} step={1} disabled={selected.locked} onChange={(rotation) => updateElement({ rotation }, 'rotation')} />
            <div className="bc-segmented bc-position-align"><button type="button" disabled={selected.locked} title="Joonda kaardi keskele horisontaalselt" onClick={() => updateElement({ x: (doc.width - selected.width) / 2 })}>↔ Keskele</button><button type="button" disabled={selected.locked} title="Joonda kaardi keskele vertikaalselt" onClick={() => updateElement({ y: (doc.height - selected.height) / 2 })}>↕ Keskele</button></div>
          </div>
          <div className="bc-element-actions"><IconButton icon="copy" label="Tee koopia" onClick={duplicateElement} /><IconButton icon={selected.locked ? 'unlock' : 'lock'} label={selected.locked ? 'Ava element' : 'Lukusta element'} active={selected.locked} onClick={() => updateElement({ locked: !selected.locked })} /><IconButton icon="down" label="Saada tahapoole" onClick={() => reorder(-1)} disabled={selected.locked || currentSide.elements[0]?.id === selected.id} /><IconButton icon="up" label="Too ettepoole" onClick={() => reorder(1)} disabled={selected.locked || currentSide.elements.at(-1)?.id === selected.id} /><IconButton icon="trash" label="Kustuta element" onClick={removeElement} disabled={selected.locked} /></div>
          {selectedIssues.map((issue, index) => <div key={index} className={`bc-element-warning${issue.severity === 'error' ? ' is-error' : ''}`}>{issue.message}</div>)}
        </> : <>
          <div className="bc-inspector__section"><ColorField label="Taust" value={currentSide.background} onChange={(background) => updateSide({ background })} /><div className="bc-swatches">{['#244d3c', '#f8f5ec', '#ffffff', '#17231c', '#e4ef85', '#e7c2ab'].map((color) => <button key={color} type="button" aria-label={`Taust ${color}`} aria-pressed={color === currentSide.background} style={{ background: color }} onClick={() => updateSide({ background: color })} />)}</div></div>
          <div className="bc-inspector__section"><h3>Mõõdud</h3><div className="bc-field-row"><NumberField label="Laius (mm)" value={doc.width} min={40} max={150} onChange={(width) => change({ ...doc, width }, 'docWidth')} /><NumberField label="Kõrgus (mm)" value={doc.height} min={30} max={150} onChange={(height) => change({ ...doc, height }, 'docHeight')} /></div><NumberField label="Lõikevaru (mm)" value={doc.bleed} min={0} max={5} step={0.5} onChange={(bleed) => change({ ...doc, bleed }, 'bleed')} /><label className="bc-check-field"><input type="checkbox" checked={doc.cropMarks} onChange={(event) => change({ ...doc, cropMarks: event.target.checked })} />Lõikemärgid PDF-is</label></div>
          <div className="bc-inspector__section bc-project-actions"><button type="button" onClick={() => downloadFile(new Blob([JSON.stringify(doc)], { type: 'application/json' }), 'visiitkaart-kujundus.json')}><CardIcon name="download" />Laadi kujundus alla</button><button type="button" onClick={() => importInput.current?.click()}><CardIcon name="upload" />Ava kujundusfail</button></div>
        </>}
        <div className="bc-layers"><h3><CardIcon name="layers" />Kihid <span>{currentSide.elements.length}</span></h3><div className="bc-layer-list">{[...currentSide.elements].reverse().map((el) => <button type="button" key={el.id} className={selectedId === el.id ? 'is-active' : ''} onClick={() => { setSelectedId(el.id); setPreview(false); setEditingText(null) }} aria-label={`Vali kiht: ${el.name}`}><CardIcon name={el.type} /><span>{el.type === 'text' ? el.text?.trim().split('\n')[0] || 'Tekst' : el.name}</span>{el.locked && <CardIcon name="lock" />}</button>)}</div></div>
      </aside>
    </div>
    <footer className="bc-footer"><span>{currentSide.elements.length} elementi</span><button type="button" onClick={() => setShowExport(true)} className={issues.length ? 'has-issues' : ''}><CardIcon name={issues.length ? 'file' : 'check'} />{issues.length ? `${issues.length} trükikontrolli teadet` : 'Trükikontroll korras'}</button><span>PDF · 2 külge</span></footer>
    {showExport && <ExportDialog document={doc} issues={issues} onClose={() => setShowExport(false)} onIssue={selectIssue} />}
  </section>
}
