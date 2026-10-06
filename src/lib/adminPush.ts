import { requireSupabase } from './supabase'

export type AdminPushPreferences = { visits: boolean; accounts: boolean }
export type AdminPushStatus = { enabled: boolean; preferences: AdminPushPreferences }
export const defaultPushPreferences: AdminPushPreferences = { visits: true, accounts: true }

export function needsHomeScreen() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  return ios && !window.matchMedia('(display-mode: standalone)').matches && !(navigator as Navigator & { standalone?: boolean }).standalone
}

export function supportsAdminPush() {
  return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export async function adminPushRequest<T = { enabled?: boolean; sent?: boolean }>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireSupabase().functions.invoke('admin-push', { body, signal: AbortSignal.timeout(15_000) })
  if (error) {
    const response = error.context
    const details = response instanceof Response ? await response.json().catch(() => null) : null
    throw new Error(details?.error || 'Märguannete toiming ebaõnnestus. Proovi uuesti.')
  }
  if (data?.error) throw new Error(data.error)
  return data as T
}

export async function currentPushSubscription() {
  if (!supportsAdminPush()) return null
  const registration = await navigator.serviceWorker.getRegistration('/')
  return await registration?.pushManager.getSubscription() ?? null
}

export async function disableAdminPush() {
  const subscription = await currentPushSubscription()
  if (!subscription) return
  // Stop local delivery even if the session or network has already expired.
  const results = await Promise.allSettled([
    adminPushRequest({ action: 'unsubscribe', endpoint: subscription.endpoint }),
    subscription.unsubscribe(),
  ])
  const serverRemoved = results[0].status === 'fulfilled'
  const browserRemoved = results[1].status === 'fulfilled' && results[1].value
  if (!serverRemoved && !browserRemoved) throw new Error('Märguandeid ei saanud välja lülitada. Kontrolli ühendust ja proovi uuesti.')
}

export function applicationServerKey(key: string) {
  const decoded = atob(key.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
}
