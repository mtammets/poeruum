type RandomCrypto = {
  randomUUID?: () => string
  getRandomValues?: (bytes: Uint8Array) => Uint8Array
}
export const createRandomId = (
  cryptoApi: RandomCrypto | undefined = globalThis.crypto as RandomCrypto | undefined,
) => {
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID()

  const bytes = new Uint8Array(16)
  cryptoApi?.getRandomValues?.(bytes)
  if (bytes.some(Boolean)) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}
