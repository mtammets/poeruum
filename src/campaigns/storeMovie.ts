import { previewDocument } from '../HomepageStorePhone'
import { actionTimeline, materializeSnapshot, type PhoneContent } from './phoneContent'
import type { CaptureState } from './captureTypes'

const W = 780, H = 1608
const ease = (t: number) => { const p = Math.max(0, Math.min(1, t)); return p * p * (3 - 2 * p) }
const stateKey = (state: CaptureState) => JSON.stringify(state)
const stateFor = (productId: string, imageIndex = 0, search: CaptureState['search'] = null): CaptureState => ({ productId, imageIndex, search })
function queries(query: string) {
  const chars = Array.from(query)
  return [...new Set(['', ...Array.from({ length: Math.min(6, chars.length) }, (_, i) => chars.slice(0, Math.ceil(chars.length * (i + 1) / Math.min(6, chars.length))).join(''))])]
}
function captureStates(content: PhoneContent) {
  const states = new Map<string, CaptureState>()
  const add = (state: CaptureState) => states.set(stateKey(state), state)
  content.snapshot.products.forEach((p) => add(stateFor(p.id)))
  let current = content.snapshot.products[0].id
  for (const action of content.actions) {
    if (action.type === 'gallery') add(stateFor(action.productId, action.imageIndex))
    if (action.type === 'search') {
      queries(action.query!).forEach((query) => add(stateFor(current, 0, { query })))
      add(stateFor(current, 0, { query: action.query!, selectedProductId: action.productId }))
    }
    current = action.productId
  }
  return states
}
type Cache = { key: string; promise: Promise<Map<string, HTMLCanvasElement>>; abort: AbortController; users: number; ready: boolean }
let cache: Cache | undefined
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function capture(content: PhoneContent, states: Map<string, CaptureState>, signal: AbortSignal) {
  const frame = document.createElement('iframe')
  frame.title = 'Kampaania poe salvestamine'; frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1
  frame.sandbox.add('allow-scripts', 'allow-same-origin'); frame.dataset.previewVisible = 'false'
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:390px;height:804px;border:0;pointer-events:none;'
  frame.srcdoc = previewDocument(materializeSnapshot(content.snapshot), true)
  const remove = () => frame.remove()
  signal.addEventListener('abort', remove, { once: true }); document.body.appendChild(frame)
  try {
    const start = performance.now()
    while (!frame.contentWindow?.campaignCapture) {
      signal.throwIfAborted()
      if (performance.now() - start > 20_000) throw new Error('Poe vaate laadimine aegus. Proovi eelvaadet uuesti laadida.')
      await delay(50)
    }
    const result = new Map<string, HTMLCanvasElement>()
    for (const [key, state] of states) {
      signal.throwIfAborted()
      // Bound each capture too: fonts/images must never leave the editor waiting indefinitely.
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const canvas = await Promise.race([frame.contentWindow.campaignCapture!(state), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Poe pildi loomine aegus. Proovi uuesti.')), 15_000) })])
        signal.throwIfAborted()
        // A canvas owned by a removed iframe loses its backing store in Chromium.
        const retained = document.createElement('canvas'); retained.width = canvas.width; retained.height = canvas.height
        retained.getContext('2d')!.drawImage(canvas, 0, 0); result.set(key, retained)
      } finally { clearTimeout(timer) }
    }
    return result
  } finally { signal.removeEventListener('abort', remove); remove() }
}
export async function loadStoreMovie(content: PhoneContent, signal: AbortSignal) {
  signal.throwIfAborted()
  const states = captureStates(content), key = content.snapshot.id + [...states.keys()].sort().join('|')
  if (!cache || cache.key !== key || cache.abort.signal.aborted) {
    const entry: Cache = { key, promise: Promise.resolve(new Map()), abort: new AbortController(), users: 0, ready: false }
    entry.promise = capture(content, states, entry.abort.signal).then((frames) => { entry.ready = true; return frames }).catch((error) => { if (cache === entry) cache = undefined; throw error })
    cache = entry
  }
  const entry = cache; entry.users++
  let released = false
  const release = () => { if (released) return; released = true; signal.removeEventListener('abort', release); if (--entry.users === 0 && !entry.ready) entry.abort.abort() }
  signal.addEventListener('abort', release, { once: true })
  let frames: Map<string, HTMLCanvasElement>
  try { frames = await entry.promise; signal.throwIfAborted() } catch (error) { release(); throw error }
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d', { alpha: false })!, timeline = actionTimeline(content.actions)
  const get = (state: CaptureState) => {
    const image = frames.get(stateKey(state))
    if (!image) throw new Error('Valitud poe kaader puudub. Laadi eelvaade uuesti.')
    return image
  }
  function frameAt(time: number) {
    const stepIndex = Math.max(0, timeline.findIndex((s) => time < s.end)), step = timeline[stepIndex]
    // After the last action, hold its resulting product while the outro fades in.
    if (time >= timeline.at(-1)!.end) { ctx.drawImage(get(stateFor(timeline.at(-1)!.productId, timeline.at(-1)!.type === 'gallery' ? timeline.at(-1)!.imageIndex : 0)), 0, 0, W, H, 0, 0, W, H); return canvas }
    const previous = timeline[stepIndex - 1], previousId = previous?.productId ?? content.snapshot.products[0].id
    const p = (time - step.start) / step.duration, target = get(stateFor(step.productId))
    ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, W, H)
    const draw = (image: HTMLCanvasElement, x = 0, y = 0) => ctx.drawImage(image, 0, y, W, H, x, 0, W, H)
    if (step.type === 'scroll') {
      const travel = p < .32 ? ease(p / .32) : p > .68 ? 1 - ease((p - .68) / .32) : 1
      draw(target, 0, Math.min(H * .93, target.height - H) * travel)
    } else if (step.type === 'swipe') {
      const slide = ease(p / .4), from = get(stateFor(previousId, previous?.type === 'gallery' ? previous.imageIndex : 0))
      draw(from, -W * slide); draw(target, W * (1 - slide))
      // Store header stays in place, like the real horizontally scrolling carousel.
      ctx.drawImage(slide < .5 ? from : target, 0, 0, W, 230, 0, 0, W, 230)
    } else if (step.type === 'gallery') {
      draw(target); ctx.globalAlpha = ease((p - .12) / .18); draw(get(stateFor(step.productId, step.imageIndex))); ctx.globalAlpha = 1
    } else if (step.type === 'search') {
      const list = queries(step.query!)
      if (p < .1) draw(get(stateFor(previousId)))
      else if (p < .7) draw(get(stateFor(previousId, 0, { query: list[Math.min(list.length - 1, Math.floor((p - .1) / .6 * list.length))] })))
      else if (p < .84) draw(get(stateFor(previousId, 0, { query: step.query!, selectedProductId: step.productId })))
      else draw(target)
    } else draw(target)
    return canvas
  }
  return {
    stillAt(index: number) { const image = get(stateFor(content.snapshot.products[index % content.snapshot.products.length].id)); ctx.drawImage(image, 0, 0, W, H, 0, 0, W, H); return canvas },
    frameAt: async (time: number) => frameAt(time),
    async *frames(times: number[]) { for (const time of times) { signal.throwIfAborted(); yield { canvas: frameAt(time) } } },
    dispose: release,
  }
}
