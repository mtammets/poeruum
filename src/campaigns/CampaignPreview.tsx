import { campaignDuration, contentDuration, parsePhoneContent } from './phoneContent'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { CampaignDocument } from './model'
import { drawCampaignFrame, loadCampaignAssets, type CampaignAssets, type FrameOptions } from './render'
import { loadPhoneDemo, type PhoneDemo } from './phoneDemo'

export default function CampaignPreview({ document, format, index = 0, playing = false, time = 1, onError, onTimeUpdate, children }: {
  document: CampaignDocument; format: FrameOptions['format']; index?: number; playing?: boolean; time?: number; onError?: (message: string) => void; onTimeUpdate?: (time: number) => void; children?: ReactNode
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [loaded, setLoaded] = useState<{ assets: CampaignAssets; demo: PhoneDemo; key: string } | null>(null)
  const [error, setError] = useState('')
  const imageKey = document.media.map((m) => `${m.kind}:${m.src}`).join('|')
  const template = document.template
  const phoneKey = document.phoneContent ? `${document.phoneContent.snapshot.id}|${JSON.stringify(document.phoneContent.actions)}` : ''
  const assetKey = `${template}|${format}|${imageKey}|${phoneKey}`
  const [retry, setRetry] = useState(0)
  const latest = useRef(document); latest.current = document
  const onErrorRef = useRef(onError); onErrorRef.current = onError
  const onTimeRef = useRef(onTimeUpdate); onTimeRef.current = onTimeUpdate
  useEffect(() => {
    const abort = new AbortController()
    let demo: PhoneDemo = null
    setLoaded(null); setError('')
    void (async () => {
      const doc = latest.current
      const assets = await loadCampaignAssets(doc)
      abort.signal.throwIfAborted()
      if (doc.phoneContent && !parsePhoneContent(doc.phoneContent)) throw new Error('Kontrolli tegevuste kestust ja otsingusõna.')
      if (format === 'reel' || doc.phoneContent) demo = await loadPhoneDemo(doc, abort.signal)
      abort.signal.throwIfAborted()
      setLoaded({ assets, demo, key: assetKey })
    })().catch((cause) => {
      demo?.dispose()
      if (!abort.signal.aborted) {
        const message = cause instanceof Error ? cause.message : 'Eelvaadet ei saanud laadida.'
        setError(message); onErrorRef.current?.(message)
      }
    })
    return () => { abort.abort(); demo?.dispose() }
  }, [assetKey, format, retry])
  useEffect(() => {
    if (!loaded || loaded.key !== assetKey || !canvas.current) return
    let canceled = false
    let frame = 0
    const start = performance.now()
    let lastTimeUpdate = 0
    const draw = async () => {
      try {
        const timestamp = playing ? ((performance.now() - start) / 1000 + time) % campaignDuration(document) : Math.min(time, campaignDuration(document) - .1)
        const phoneFrame = loaded.demo && (format !== 'reel' || timestamp < contentDuration(document) + .35) ? format !== 'reel' && 'stillAt' in loaded.demo ? loaded.demo.stillAt(index) : await loaded.demo.frameAt(timestamp) : undefined
        if (canceled || !canvas.current) return
        drawCampaignFrame(canvas.current, document, loaded.assets, { format, index, time: timestamp, phoneFrame })
        if (playing && performance.now() - lastTimeUpdate > 80) { lastTimeUpdate = performance.now(); onTimeRef.current?.(timestamp) }
        if (playing) frame = requestAnimationFrame(() => void draw())
      } catch (cause) {
        if (!canceled) {
          const message = cause instanceof Error ? cause.message : 'Eelvaadet ei saanud esitada.'
          setError(message); onErrorRef.current?.(message)
        }
      }
    }
    void draw()
    return () => { canceled = true; cancelAnimationFrame(frame) }
  }, [document, loaded, assetKey, format, index, playing, time])
  return <div className={`campaign-preview campaign-preview--${format}`}>
    <canvas ref={canvas} width={540} height={format === 'post' ? 675 : 960} role="img" aria-label={`${format === 'post' ? 'Postituse' : format === 'story' ? 'Story' : 'Reelsi'} eelvaade: ${document.copy.headlines[index]}`} />
    {(!loaded || error) && <span role="status">{error || 'Laadin eelvaadet…'}{error && <button type="button" onClick={() => setRetry((n) => n + 1)}>Proovi uuesti</button>}</span>}
    {loaded && !error && children}
  </div>
}
