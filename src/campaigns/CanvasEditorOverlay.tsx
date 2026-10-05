import { useRef, useState, type PointerEvent } from 'react'
import type { CampaignDocument } from './model'
import { sceneHeight, setElement, transformOf, type LayerId, type SceneElement, type SceneKey } from './layout'

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
type Drag = { pointer: number; startX: number; startY: number; element: SceneElement; doc: CampaignDocument; corner?: [number, number]; latest: CampaignDocument }

export default function CanvasEditorOverlay({ document, scene, elements, selected, onSelect, onPreview, onCommit }: {
  document: CampaignDocument; scene: SceneKey; elements: SceneElement[]; selected: LayerId | null
  onSelect: (id: LayerId | null) => void; onPreview: (doc: CampaignDocument | null) => void; onCommit: (doc: CampaignDocument) => void
}) {
  const root = useRef<HTMLDivElement>(null), drag = useRef<Drag | null>(null)
  const [centerGuide, setCenterGuide] = useState(false)
  const height = sceneHeight(scene)
  const start = (event: PointerEvent, element: SceneElement, corner?: [number, number]) => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation(); onSelect(element.id)
    if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus({ preventScroll: true })
    root.current?.setPointerCapture(event.pointerId)
    drag.current = { pointer: event.pointerId, startX: event.clientX, startY: event.clientY, element, doc: document, corner, latest: document }
  }
  const finish = (cancel = false) => {
    const current = drag.current
    if (!current) return
    drag.current = null; setCenterGuide(false); onPreview(null)
    if (root.current?.hasPointerCapture(current.pointer)) root.current.releasePointerCapture(current.pointer)
    if (!cancel && current.latest !== current.doc) onCommit(current.latest)
  }
  return <div ref={root} className="campaign-editor__overlay" onPointerDown={() => onSelect(null)}
    onPointerMove={(event) => {
      const current = drag.current, rect = root.current?.getBoundingClientRect()
      if (!current || !rect || current.pointer !== event.pointerId) return
      const dx = (event.clientX - current.startX) * 1080 / rect.width, dy = (event.clientY - current.startY) * height / rect.height
      const element = current.element, next = transformOf(element)
      if (current.corner) {
        const [sx, sy] = current.corner, angle = element.rotation * Math.PI / 180
        const cos = Math.cos(angle), sin = Math.sin(angle)
        const vx = sx * element.width * cos - sy * element.height * sin
        const vy = sx * element.width * sin + sy * element.height * cos
        next.scale = clamp(element.scale + (dx * vx + dy * vy) / (vx * vx + vy * vy), .15, 3)
        next.x += vx * (next.scale - element.scale) / 2
        next.y += vy * (next.scale - element.scale) / 2
      } else {
        next.x = clamp(element.x + dx, 0, 1080); next.y = clamp(element.y + dy, 0, height)
        const snap = !event.altKey && Math.abs(next.x - 540) < 12
        if (snap) next.x = 540
        setCenterGuide(snap)
      }
      current.latest = setElement(current.doc, scene, element.id, next)
      onPreview(current.latest)
    }} onPointerUp={() => finish()} onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish(true)}
    onKeyDown={(event) => {
      if (event.key === 'Escape') { finish(true); onSelect(null); return }
      const element = elements.find((e) => e.id === selected)
      if (!element) return
      const step = event.shiftKey ? 10 : 1, next = transformOf(element)
      if (event.key === 'ArrowLeft') next.x -= step
      else if (event.key === 'ArrowRight') next.x += step
      else if (event.key === 'ArrowUp') next.y -= step
      else if (event.key === 'ArrowDown') next.y += step
      else if (event.key === 'Delete' || event.key === 'Backspace') next.visible = false
      else return
      event.preventDefault(); onCommit(setElement(document, scene, element.id, next))
    }}>
    {elements.filter((element) => element.visible).map((element) => <div key={element.id} className={`campaign-editor__layer${selected === element.id ? ' is-selected' : ''}`}
      style={{ left: `${element.x / 1080 * 100}%`, top: `${element.y / height * 100}%`, width: `${element.width * element.scale / 1080 * 100}%`, height: `${element.height * element.scale / height * 100}%`, transform: `translate(-50%, -50%) rotate(${element.rotation}deg)` }}>
      <button type="button" className="campaign-editor__hit" aria-label={`Liiguta: ${element.name}`} aria-pressed={selected === element.id} onFocus={() => onSelect(element.id)} onPointerDown={(e) => start(e, element)} />
      {selected === element.id && <>
        <span className="campaign-editor__selection-name">{element.name}</span>
        {([[-1, -1], [1, -1], [-1, 1], [1, 1]] as [number, number][]).map(([x, y]) => <button type="button" key={`${x}${y}`}
          className="campaign-editor__handle" aria-label={`Muuda suurust: ${element.name}, ${y < 0 ? 'ülal' : 'all'} ${x < 0 ? 'vasakul' : 'paremal'}`}
          style={{ left: x < 0 ? 0 : '100%', top: y < 0 ? 0 : '100%', cursor: x === y ? 'nwse-resize' : 'nesw-resize' }}
          onPointerDown={(e) => start(e, element, [x, y])} onKeyDown={(event) => {
            if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
            event.preventDefault(); event.stopPropagation()
            const change = (['ArrowUp', 'ArrowRight'].includes(event.key) ? 1 : -1) * (event.shiftKey ? .1 : .01)
            onCommit(setElement(document, scene, element.id, { ...transformOf(element), scale: clamp(element.scale + change, .15, 3) }))
          }} />)}
      </>}
    </div>)}
    {centerGuide && <i className="campaign-editor__center-guide" />}
  </div>
}
