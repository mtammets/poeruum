import type { PDFDocument, PDFImage } from 'npm:pdf-lib@^1.17.1'

const maximumBytes = 2 * 1024 * 1024
const maximumSide = 2048

function logoUrl(value: string): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    const origin = new URL(Deno.env.get('SUPABASE_URL') ?? '').origin
    const path = decodeURIComponent(url.pathname)
    // Store logos are public, immutable uploads in this project's image bucket.
    // Never let a seller-supplied setting turn the renderer into an HTTP proxy.
    if (url.origin !== origin || url.username || url.password || url.search || url.hash
      || !/^\/storage\/v1\/object\/public\/product-images\/[\da-f-]{36}\/[\w./-]+\.(?:png|jpe?g|webp)$/i.test(path)
      || path.split('/').some((part) => part === '.' || part === '..')) return null
    return url.href
  } catch { return null }
}

async function downloadLogo(url: string): Promise<Uint8Array> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const response = await fetch(url, { redirect: 'error', credentials: 'omit', signal: controller.signal })
    reader = response.body?.getReader()
    if (!response.ok || !reader || Number(response.headers.get('content-length')) > maximumBytes) throw new Error('Logo unavailable')
    const chunks: Uint8Array[] = []
    let length = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.length
      if (length > maximumBytes) throw new Error('Logo too large')
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    return bytes
  } finally {
    controller.abort()
    clearTimeout(timeout)
    await reader?.cancel().catch(() => undefined)
  }
}

const validSize = (width: number, height: number) => width > 0 && height > 0 && width <= maximumSide && height <= maximumSide
const text = (bytes: Uint8Array, start: number, end: number) => new TextDecoder().decode(bytes.subarray(start, end))

// Inspect dimensions before decoding compressed pixels, including normal lossy,
// lossless and extended WebP headers produced by the storefront's upload flow.
function webpSize(bytes: Uint8Array): [number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const chunk = text(bytes, 12, 16)
  if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) {
    return [view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff]
  }
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = view.getUint32(21, true)
    return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1]
  }
  if (chunk === 'VP8X' && bytes.length >= 30) {
    return [1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)]
  }
  return [0, 0]
}

export async function embedInvoiceLogo(pdf: PDFDocument, value: string): Promise<PDFImage | null> {
  const url = logoUrl(value)
  if (!url) return null
  try {
    const bytes = await downloadLogo(url)
    if (bytes.length < 24) return null
    if (bytes[0] === 0x89 && text(bytes, 1, 4) === 'PNG' && text(bytes, 12, 16) === 'IHDR') {
      const view = new DataView(bytes.buffer)
      if (!validSize(view.getUint32(16), view.getUint32(20))) return null
      return await pdf.embedPng(bytes)
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      // JPEG is embedded as compressed DCT data; pdf-lib does not decode pixels.
      const image = await pdf.embedJpg(bytes)
      return validSize(image.width, image.height) ? image : null
    }
    if (text(bytes, 0, 4) === 'RIFF' && text(bytes, 8, 12) === 'WEBP') {
      if (!validSize(...webpSize(bytes))) return null
      const { webpToPng } = await import('./invoice-image/decode-webp.ts')
      return await pdf.embedPng(await webpToPng(bytes))
    }
  } catch {
    // Branding is optional; a missing or invalid logo must not delay the invoice.
  }
  return null
}
