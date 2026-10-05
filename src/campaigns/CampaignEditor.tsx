import { campaignDuration, contentDuration } from './phoneContent'
import { useEffect, useRef, useState } from 'react'
import CampaignPreview from './CampaignPreview'
import CanvasEditorOverlay from './CanvasEditorOverlay'
import { campaignCopyLimits, type CampaignDocument } from './model'
import { fitToSafeArea, outsideSafeArea, safeArea, SAFE_ZONE_SOURCE, sceneElements, sceneHeight, sceneKey, setElement, transformOf,
  type CampaignFormat, type CampaignLayouts, type LayerId, type LayerTransform } from './layout'

type History = { past: (CampaignLayouts | undefined)[]; future: (CampaignLayouts | undefined)[] }
export default function CampaignEditor({ document: doc, format, disabled, onChange, videoUrl }: {
  document: CampaignDocument; format: CampaignFormat; disabled: boolean; onChange: (doc: CampaignDocument) => void; videoUrl?: string
}) {
  const [index, setIndex] = useState(0), [end, setEnd] = useState(false), [time, setTime] = useState(1)
  const [playing, setPlaying] = useState(false), [showVideo, setShowVideo] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [guides, setGuides] = useState(true), [selected, setSelected] = useState<LayerId | null>('phone')
  const [transient, setTransient] = useState<CampaignDocument | null>(null)
  const [history, setHistory] = useState<History>({ past: [], future: [] })
  const ownLayouts = useRef(doc.layouts)
  const scene = sceneKey(format, index, end), activeDoc = transient ?? doc
  const elements = sceneElements(activeDoc, scene), safe = safeArea(scene), height = sceneHeight(scene)
  const current = elements.find((element) => element.id === selected)
  const duration = campaignDuration(doc), intro = contentDuration(doc)
  const locked = disabled || playing || showVideo

  useEffect(() => {
    if (doc.layouts !== ownLayouts.current) setHistory({ past: [], future: [] })
    ownLayouts.current = doc.layouts
  }, [doc.layouts])
  useEffect(() => { setTime((t) => Math.min(t, duration - .1)); setPlaying(false); setEnd(false) }, [doc.phoneContent, duration])
  useEffect(() => { if (!videoUrl) setShowVideo(false) }, [videoUrl])
  useEffect(() => { if (disabled) setPlaying(false) }, [disabled])

  function commit(next: CampaignDocument) {
    if (JSON.stringify(next.layouts) === JSON.stringify(doc.layouts)) return
    setHistory((h) => ({ past: [...h.past.slice(-49), doc.layouts], future: [] }))
    ownLayouts.current = next.layouts; onChange(next)
  }
  function undo(redo = false) {
    if (locked) return
    const stack = redo ? history.future : history.past
    if (!stack.length) return
    const layouts = stack.at(-1)
    setHistory(redo ? { past: [...history.past, doc.layouts], future: stack.slice(0, -1) } : { past: stack.slice(0, -1), future: [...history.future, doc.layouts] })
    ownLayouts.current = layouts; onChange({ ...doc, layouts })
  }
  function changeTransform(patch: Partial<LayerTransform>) {
    if (current) commit(setElement(doc, scene, current.id, { ...transformOf(current), ...patch }))
  }
  function changeText(value: string) {
    if (!current) return
    if (end && (current.id === 'headline' || current.id === 'slogan')) {
      onChange({ ...doc, endCopy: { headline: doc.endCopy?.headline ?? 'Sinu e-pood.', slogan: doc.endCopy?.slogan ?? '10 minutiga.', [current.id]: value } })
    } else if (current.id === 'headline') onChange({ ...doc, copy: { ...doc.copy, headlines: doc.copy.headlines.map((text, i) => i === index ? value : text) } })
    else if (current.id === 'cta' || current.id === 'support') onChange({ ...doc, copy: { ...doc.copy, [current.id]: value } })
  }
  const editableText = current && ['headline', 'slogan', 'cta', 'support'].includes(current.id)

  return <div className="campaign-editor" onKeyDown={(event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !(event.target instanceof HTMLElement && event.target.closest('input,textarea,select'))) {
      event.preventDefault(); undo(event.shiftKey)
    }
  }}>
    <div className="campaign-editor__toolbar">
      <div className="campaign-editor__scenes" role="group" aria-label="Muudetav kaader">
        {format === 'reel' ? <>
          <button type="button" aria-pressed={!end} disabled={disabled || playing} onClick={() => { setEnd(false); setTime(1); setSelected('phone'); setShowVideo(false) }}>Video <small>0–{intro} s</small></button>
          <button type="button" aria-pressed={end} disabled={disabled || playing} onClick={() => { setEnd(true); setTime(intro + 1.5); setSelected('logo'); setShowVideo(false) }}>Lõpp <small>{intro}–{duration} s</small></button>
        </> : [0, 1, 2].map((i) => <button key={i} type="button" disabled={disabled} aria-pressed={index === i} onClick={() => setIndex(i)}>{format === 'post' ? 'Postitus' : 'Story'} {i + 1}</button>)}
      </div>
      <div className="campaign-editor__tools">
        <button type="button" aria-label="Võta paigutus tagasi" title="Tagasi · ⌘/Ctrl Z" disabled={locked || !history.past.length} onClick={() => undo()}>↶</button>
        <button type="button" aria-label="Taasta paigutuse muudatus" title="Edasi · ⌘/Ctrl Shift Z" disabled={locked || !history.future.length} onClick={() => undo(true)}>↷</button>
        <label className="campaigns__checkbox"><input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} />Turvaala</label>
      </div>
    </div>
    <div className="campaign-editor__workspace">
      <div className="campaign-editor__stage">
        {showVideo && videoUrl ? <video className="campaigns__video" src={videoUrl} controls playsInline /> :
          <CampaignPreview document={activeDoc} format={format} index={index} time={time} playing={playing} onTimeUpdate={setPlayhead}>
            {!playing && guides && <div className="campaign-editor__safe" aria-hidden="true" style={{ left: `${safe.x / 1080 * 100}%`, top: `${safe.y / height * 100}%`, width: `${safe.width / 1080 * 100}%`, height: `${safe.height / height * 100}%` }} />}
            {!locked && <CanvasEditorOverlay document={doc} scene={scene} elements={elements} selected={selected} onSelect={setSelected} onPreview={setTransient} onCommit={commit} />}
          </CampaignPreview>}
        {format === 'reel' && <>
          <div className="campaigns__playback">
            {showVideo ? <button type="button" onClick={() => setShowVideo(false)}>Muuda kujundust</button> : <button type="button" disabled={disabled} onClick={() => {
              if (!playing) { setTime(0); setPlayhead(0); setEnd(false) }
              else { setTime(playhead); setEnd(playhead >= intro + .35) }
              setPlaying(!playing)
            }}>{playing ? 'Peata' : 'Esita'}</button>}
            {videoUrl && !showVideo && <button type="button" onClick={() => { setPlaying(false); setShowVideo(true) }}>Vaata valmis videot</button>}
          </div>
          {!showVideo && <label className="campaign-editor__timeline"><span className="campaigns__sr-only">Videokaader</span><input type="range" aria-label="Videokaader" min="0" max={duration - .1} step="0.1" disabled={playing || disabled} value={Math.min(duration - .1, playing ? playhead : time)} onChange={(e) => { const next = Number(e.target.value); setTime(next); setEnd(next >= intro + .35) }} /><small>{(playing ? playhead : time).toFixed(1)} s / {duration} s</small></label>}
        </>}
        <small>{format === 'post' ? '1080 × 1350' : '1080 × 1920'} · {format === 'reel' ? 'MP4' : 'JPG'}</small>
      </div>

      <aside className="campaign-editor__inspector" aria-label="Elementide muutmine">
        <fieldset disabled={locked} className="campaign-editor__layers"><legend>Elemendid</legend>
          {elements.map((element) => <div key={element.id} className={selected === element.id ? 'is-selected' : ''}>
            <button type="button" aria-pressed={selected === element.id} onClick={() => setSelected(element.id)}>{element.name}</button>
            <input type="checkbox" aria-label={`Näita: ${element.name}`} checked={element.visible} onChange={(e) => commit(setElement(doc, scene, element.id, { ...transformOf(element), visible: e.target.checked }))} />
          </div>)}
        </fieldset>
        {current && <fieldset disabled={locked} className="campaign-editor__properties"><legend>{current.name}</legend>
          <div className="campaign-editor__coordinates">
            <label>X<input type="number" aria-label="Elemendi X" min="0" max="1080" value={Math.round(current.x)} onChange={(e) => { if (e.target.value) changeTransform({ x: Math.max(0, Math.min(1080, Number(e.target.value))) }) }} /></label>
            <label>Y<input type="number" aria-label="Elemendi Y" min="0" max={height} value={Math.round(current.y)} onChange={(e) => { if (e.target.value) changeTransform({ y: Math.max(0, Math.min(height, Number(e.target.value))) }) }} /></label>
            <label>Suurus %<input type="number" aria-label="Elemendi suurus" min="15" max="300" value={Math.round(current.scale * 100)} onChange={(e) => { if (e.target.value) changeTransform({ scale: Math.max(.15, Math.min(3, Number(e.target.value) / 100)) }) }} /></label>
            <label>Pööre °<input type="number" aria-label="Elemendi pööre" min="-180" max="180" value={Math.round(current.rotation)} onChange={(e) => { if (e.target.value) changeTransform({ rotation: Math.max(-180, Math.min(180, Number(e.target.value))) }) }} /></label>
          </div>
          <div className="campaign-editor__align"><button type="button" onClick={() => changeTransform({ x: 540 })}>Keskenda</button><button type="button" onClick={() => changeTransform(fitToSafeArea(current, scene))}>Turvaalasse</button></div>
          {editableText && <label>Tekst<textarea aria-label="Elemendi tekst" rows={2} maxLength={current.id === 'cta' ? campaignCopyLimits.cta : current.id === 'support' ? campaignCopyLimits.support : 72} value={current.text ?? ''} onChange={(e) => changeText(e.target.value)} /></label>}
          {guides && current.visible && outsideSafeArea(current, scene) && <small>{current.id === 'phone' || current.id.startsWith('photo') ? 'Pildi serv ulatub turvaalast välja.' : 'Tekst või logo võib jääda Instagrami nuppude alla.'}</small>}
        </fieldset>}
        <div className="campaign-editor__footer">
          <button type="button" className="campaigns__text-button" disabled={locked} onClick={() => {
            const layouts = { ...doc.layouts }; delete layouts[scene]; commit({ ...doc, layouts })
          }}>Taasta kaadri paigutus</button>
          {guides && <small>Tekst ja logo hoia juhiku sees. <a href={SAFE_ZONE_SOURCE} target="_blank" rel="noreferrer">Meta juhend ↗</a></small>}
        </div>
      </aside>
    </div>
  </div>
}
