import { usesPhoneDemo, type CampaignDocument } from './model'

export const PHONE_DEMO_DURATION = 9.4

// Decode the same captured storefront frames for both preview and export. Seeking
// by timeline time (rather than wall-clock playback) keeps MP4 rendering exact.
export async function loadPhoneDemo(doc: CampaignDocument, signal: AbortSignal) {
  if (doc.template === 'phone' && doc.phoneContent) return (await import('./storeMovie')).loadStoreMovie(doc.phoneContent, signal)
  if (!usesPhoneDemo(doc)) return null
  const { Input, UrlSource, MP4, CanvasSink } = await import('mediabunny')
  signal.throwIfAborted()
  const input = new Input({ source: new UrlSource('/campaigns/phone-demo.mp4'), formats: [MP4] })
  const dispose = () => { signal.removeEventListener('abort', dispose); input.dispose() }
  signal.addEventListener('abort', dispose, { once: true })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track || !await track.canDecode()) throw new Error('Brauser ei saa näidispoe videot avada. Proovi uuemat Chrome’i, Edge’i või Safarit.')
    signal.throwIfAborted()
    const sink = new CanvasSink(track, { poolSize: 2 })
    const timestamp = (time: number) => Math.max(0, Math.min(PHONE_DEMO_DURATION - 1 / 30, time))
    return {
      async frameAt(time: number) {
        const frame = await sink.getCanvas(timestamp(time))
        if (!frame) throw new Error('Näidispoe videokaadrit ei saanud avada.')
        return frame.canvas
      },
      frames: (times: number[]) => sink.canvasesAtTimestamps(times.map(timestamp)),
      dispose,
    }
  } catch (error) { dispose(); throw error }
}

export type PhoneDemo = Awaited<ReturnType<typeof loadPhoneDemo>>
