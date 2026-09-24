import decode, { init } from 'npm:@jsquash/webp@1.5.0/decode.js'
import PNG from 'npm:@pdf-lib/upng@1.0.1/UPNG.js'
import { webpDecoderBase64 } from './webp-wasm.ts'

let ready: Promise<void> | undefined

export async function webpToPng(bytes: Uint8Array): Promise<Uint8Array> {
  ready ??= WebAssembly.compile(Uint8Array.from(atob(webpDecoderBase64), (character) => character.charCodeAt(0)))
    .then((module) => init(module))
  await ready
  const image = await decode(new Uint8Array(bytes).buffer)
  // Lossless RGBA encoding preserves transparent logos without quantization.
  return new Uint8Array(PNG.encode([new Uint8Array(image.data).buffer], image.width, image.height, 0))
}
