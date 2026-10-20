// Read the original file's dimensions without decoding or modifying the photo.
export function storyImageMetadata(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const text = (start: number, end: number) => new TextDecoder().decode(bytes.subarray(start, end))
  const result = (imageWidth: number, imageHeight: number, imageType: string) =>
    imageWidth > 0 && imageHeight > 0 ? { imageWidth, imageHeight, imageType } : null

  if (bytes.length >= 24 && text(1, 4) === 'PNG' && bytes[0] === 0x89 && text(12, 16) === 'IHDR') {
    return result(view.getUint32(16), view.getUint32(20), 'image/png')
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) return null
      while (bytes[offset] === 0xff) offset++
      const marker = bytes[offset++]
      if (marker === 0xd9 || marker === 0xda || offset + 2 > bytes.length) return null
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) return null
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return length >= 8 ? result(view.getUint16(offset + 5), view.getUint16(offset + 3), 'image/jpeg') : null
      }
      offset += length
    }
  }
  if (bytes.length >= 25 && text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') {
    const chunk = text(12, 16)
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true)
      return result((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1, 'image/webp')
    }
    if (bytes.length >= 30) {
      if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) {
        return result(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff, 'image/webp')
      }
      if (chunk === 'VP8X') {
        return result(1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
          1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16), 'image/webp')
      }
    }
  }
  return null
}
