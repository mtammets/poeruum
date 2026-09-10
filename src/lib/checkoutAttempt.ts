import { createCheckoutRequestId } from '../storefrontConfig'

// Persist only a hash and a random request ID, never customer details. A reload
// after a lost response must reuse the same attempt, just like a second click.
const key = 'poeruum-checkout-attempt-v1'
let memory: { fingerprint: string; requestId: string } | null = null
export const checkoutAttemptId = async (input: unknown) => {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input)))
  const fingerprint = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || 'null')
    if (saved?.fingerprint === fingerprint && typeof saved.requestId === 'string') memory = saved
  } catch { /* Keep retries working when browser storage is unavailable. */ }
  if (memory?.fingerprint !== fingerprint) memory = { fingerprint, requestId: createCheckoutRequestId() }
  try { sessionStorage.setItem(key, JSON.stringify(memory)) } catch { /* In-memory fallback. */ }
  return memory.requestId
}

export const forgetCheckoutAttempt = () => {
  memory = null
  try { sessionStorage.removeItem(key) } catch { /* In-memory fallback. */ }
}
