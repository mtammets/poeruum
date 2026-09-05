import QRCode from 'qrcode'

const cache = new Map<string, { size: number; data: Uint8Array }>()

/** The returned matrix includes the required four-module quiet zone. */
export function getQrMatrix(value: string): { size: number; data: Uint8Array } {
  const existing = cache.get(value)
  if (existing) return existing
  if (!value.trim()) throw new Error('Lisa QR-koodi aadress või tekst.')
  const { modules } = QRCode.create(value, { errorCorrectionLevel: 'M' })
  const size = modules.size + 8
  const data = new Uint8Array(size * size)
  for (let y = 0; y < modules.size; y++) {
    for (let x = 0; x < modules.size; x++) data[(y + 4) * size + x + 4] = modules.data[y * modules.size + x]
  }
  const matrix = { size, data }
  if (cache.size > 80) cache.clear()
  cache.set(value, matrix)
  return matrix
}
