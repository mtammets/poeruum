import { campaignDuration } from './phoneContent'
import { zipSync, strToU8 } from 'fflate'
import { campaignSlug, campaignText, type CampaignDocument } from './model'
import { canvasBlob, drawCampaignFrame, loadCampaignAssets, type CampaignAssets } from './render'
import { loadPhoneDemo, type PhoneDemo } from './phoneDemo'

export type CampaignFile = { name: string; label: string; blob: Blob; kind: 'image' | 'video' | 'text' }
export type ExportProgress = (message: string, percent: number) => void
const checkAbort = (signal: AbortSignal) => { signal.throwIfAborted() }

export async function renderImages(doc: CampaignDocument, assets: CampaignAssets, signal: AbortSignal): Promise<CampaignFile[]> {
  const canvas = document.createElement('canvas')
  canvas.width = 1080
  const files: CampaignFile[] = []
  const demo = doc.phoneContent ? await loadPhoneDemo(doc, signal) : null
  try {
  for (const format of ['post', 'story'] as const) {
    canvas.height = format === 'post' ? 1350 : 1920
    for (let index = 0; index < 3; index++) {
      checkAbort(signal)
      drawCampaignFrame(canvas, doc, assets, { format, index, phoneFrame: demo && 'stillAt' in demo ? demo.stillAt(index) : undefined })
      files.push({ name: `${format}-${index + 1}.jpg`, label: `${format === 'post' ? 'Postitus' : 'Story'} ${index + 1}`, blob: await canvasBlob(canvas), kind: 'image' })
    }
  }
  checkAbort(signal)
  drawCampaignFrame(canvas, doc, assets, { format: 'reel', time: 1, phoneFrame: demo ? await demo.frameAt(1) : undefined })
  files.push({ name: 'reels-cover.jpg', label: 'Reelsi kaanepilt', blob: await canvasBlob(canvas), kind: 'image' })
  files.push({ name: 'tekstid.txt', label: 'Postituste tekstid', blob: new Blob([campaignText(doc)], { type: 'text/plain;charset=utf-8' }), kind: 'text' })
  return files
  } finally { demo?.dispose() }
}

export async function renderVideo(doc: CampaignDocument, assets: CampaignAssets, signal: AbortSignal, progress: ExportProgress) {
  const duration = campaignDuration(doc)
  const { Output, BufferTarget, Mp4OutputFormat, CanvasSource, canEncodeVideo } = await import('mediabunny')
  checkAbort(signal)
  if (!await canEncodeVideo('avc', { width: 1080, height: 1920, bitrate: 5_000_000 })) {
    throw new Error('See brauser ei toeta MP4 loomist. Ava kampaania uuemas Chrome’is, Edge’is või Safaris. Pildid ja tekstid on allalaadimiseks valmis.')
  }
  const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1920
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
  const source = new CanvasSource(canvas, { codec: 'avc', bitrate: 5_000_000, keyFrameInterval: 2 })
  output.addVideoTrack(source, { frameRate: 30 })
  let demo: PhoneDemo = null
  let demoFrames: ReturnType<NonNullable<PhoneDemo>['frames']> | undefined
  try {
    demo = await loadPhoneDemo(doc, signal)
    demoFrames = demo?.frames(Array.from({ length: Math.round(duration * 30) }, (_, frame) => frame / 30))
    await output.start()
    for (let frame = 0; frame < Math.round(duration * 30); frame++) {
      checkAbort(signal)
      const phoneFrame = demoFrames ? (await demoFrames.next()).value?.canvas : undefined
      checkAbort(signal)
      if (demoFrames && !phoneFrame) throw new Error('Näidispoe videokaadrit ei saanud avada.')
      drawCampaignFrame(canvas, doc, assets, { format: 'reel', time: frame / 30, phoneFrame })
      await source.add(frame / 30, 1 / 30)
      if (frame % 6 === 0) {
        progress('Koostan Reelsi videot…', 15 + Math.round(frame / (Math.round(duration * 30)) * 75))
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }
    source.close()
    await output.finalize()
    checkAbort(signal)
    return { name: 'reels-helita.mp4', label: 'Reels · helita', kind: 'video' as const, blob: new Blob([output.target.buffer!], { type: 'video/mp4' }) }
  } catch (error) { await output.cancel().catch(() => {}); throw error }
  finally { await demoFrames?.return(undefined).catch(() => {}); demo?.dispose() }
}

export async function addSoundtrack(video: CampaignFile, signal: AbortSignal): Promise<CampaignFile> {
  const { Input, BlobSource, UrlSource, MP4, Output, BufferTarget, Mp4OutputFormat, EncodedPacketSink, EncodedVideoPacketSource, EncodedAudioPacketSource } = await import('mediabunny')
  const input = new Input({ source: new BlobSource(video.blob), formats: [MP4] })
  const sound = new Input({ source: new UrlSource('/campaigns/soundtrack.m4a'), formats: [MP4] })
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
  try {
    const videoTrack = await input.getPrimaryVideoTrack(), audioTrack = await sound.getPrimaryAudioTrack()
    if (!videoTrack || !audioTrack) throw new Error('Heliraja lisamine ebaõnnestus.')
    const videoSource = new EncodedVideoPacketSource('avc'), audioSource = new EncodedAudioPacketSource('aac')
    output.addVideoTrack(videoSource, { frameRate: 30 }); output.addAudioTrack(audioSource)
    await output.start()
    const videoConfig = await videoTrack.getDecoderConfig(), audioConfig = await audioTrack.getDecoderConfig()
    for await (const packet of new EncodedPacketSink(videoTrack).packets()) {
      checkAbort(signal); await videoSource.add(packet, { decoderConfig: videoConfig ?? undefined })
    }
    videoSource.close()
    const duration = await videoTrack.computeDuration()
    const packets = []
    for await (const packet of new EncodedPacketSink(audioTrack).packets()) if (packet.timestamp >= 0) packets.push(packet)
    const first = packets[0]?.timestamp ?? 0
    const loopDuration = packets.length ? packets.at(-1)!.timestamp + packets.at(-1)!.duration - first : 0
    if (!(loopDuration > 0)) throw new Error('Heliraja pikkust ei saanud lugeda.')
    for (let offset = 0; offset < duration; offset += loopDuration) {
      for (const packet of packets) {
        checkAbort(signal)
        const timestamp = packet.timestamp - first + offset
        if (timestamp >= duration) break
        await audioSource.add(packet.clone({ timestamp, duration: Math.min(packet.duration, duration - timestamp) }), { decoderConfig: audioConfig ?? undefined })
      }
    }
    audioSource.close(); await output.finalize(); checkAbort(signal)
    return { name: 'reels-heliga.mp4', label: 'Reels · heliga', kind: 'video', blob: new Blob([output.target.buffer!], { type: 'video/mp4' }) }
  } catch (error) { await output.cancel().catch(() => {}); throw error }
  finally { input.dispose(); sound.dispose() }
}

// Callers retain completed files, so a retry only renders missing outputs.
export async function exportCampaign(doc: CampaignDocument, completed: CampaignFile[], signal: AbortSignal, progress: ExportProgress, onFiles: (files: CampaignFile[]) => void) {
  let files = [...completed]
  progress('Valmistan kujundused ette…', 2)
  const assets = await loadCampaignAssets(doc)
  checkAbort(signal)
  if (!files.some((f) => f.name === 'tekstid.txt')) { files = await renderImages(doc, assets, signal); onFiles(files) }
  let silent = files.find((f) => f.name === 'reels-helita.mp4')
  if (!silent) { silent = await renderVideo(doc, assets, signal, progress); files = [...files, silent]; onFiles(files) }
  if (!files.some((f) => f.name === 'reels-heliga.mp4')) {
    progress('Lisan muusika…', 94)
    files = [...files, await addSoundtrack(silent, signal)]; onFiles(files)
  }
  progress('Kampaaniapakett on valmis', 100)
  return files
}
export async function campaignZip(doc: CampaignDocument, files: CampaignFile[]) {
  const entries: Record<string, Uint8Array> = { 'kampaania.json': strToU8(JSON.stringify(doc, null, 2)) }
  for (const file of files) entries[file.name] = new Uint8Array(await file.blob.arrayBuffer())
  // JPG and MP4 are already compressed; STORE avoids wasting CPU and blocking the UI.
  return new Blob([zipSync(entries, { level: 0 }) as Uint8Array<ArrayBuffer>], { type: 'application/zip' })
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
export const zipName = (doc: CampaignDocument) => `${campaignSlug(doc.name)}.zip`
