import { useEffect, useRef, useState } from 'react'
import { adminPushRequest, applicationServerKey, currentPushSubscription, disableAdminPush, needsHomeScreen, supportsAdminPush } from './lib/adminPush'

type PushConfig = { available: boolean; publicKey: string | null }
export default function useAdminPush(userId: string | null) {
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const config = useRef<PushConfig | null>(null)
  const initializationError = useRef('')
  const registration = useRef<ServiceWorkerRegistration | null>(null)
  const homeScreen = needsHomeScreen()
  const supported = supportsAdminPush()

  useEffect(() => {
    const manifest = document.createElement('link')
    manifest.rel = 'manifest'; manifest.href = '/admin.webmanifest'
    const icon = document.createElement('link')
    icon.rel = 'apple-touch-icon'; icon.href = '/images/admin-icon-192.png'
    document.head.append(manifest, icon)
    return () => { manifest.remove(); icon.remove() }
  }, [])

  useEffect(() => {
    let active = true
    config.current = null
    registration.current = null
    initializationError.current = ''
    setEnabled(false)
    setError('')
    setMessage('')
    if (!userId || !supported || homeScreen) { setLoading(false); return }
    setLoading(true)
    const initialize = async () => {
      try {
        const settings = await adminPushRequest<PushConfig>({ action: 'config' })
        if (!active) return
        config.current = settings
        if (!settings.available) { initializationError.current = 'Telefoni märguanded pole veel seadistatud.'; return }
        await navigator.serviceWorker.register('/admin-push-sw.js', { scope: '/', updateViaCache: 'none' })
        let timeout: ReturnType<typeof setTimeout> | undefined
        const ready = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Märguannete käivitamine aegus. Laadi leht uuesti.')), 15_000) }),
        ]).finally(() => clearTimeout(timeout))
        if (!active) return
        registration.current = ready
        const subscription = await ready.pushManager.getSubscription()
        if (subscription && Notification.permission === 'granted') {
          const status = await adminPushRequest({ action: 'status', endpoint: subscription.endpoint })
          if (active) setEnabled(Boolean(status.enabled))
        }
      } catch (error) {
        if (active) initializationError.current = error instanceof Error ? error.message : 'Märguannete seadeid ei saanud laadida.'
      } finally { if (active) setLoading(false) }
    }
    void initialize()
    return () => { active = false }
  }, [userId, supported, homeScreen])

  const toggle = async () => {
    if (busy) return
    setError(''); setMessage('')
    if (homeScreen) {
      setMessage('Ava Safari jagamismenüü ja vali „Lisa avaekraanile” (Add to Home Screen). Ava Poeruum tekkinud ikoonist, logi adminisse ning luba siin märguanded.')
      return
    }
    if (!supported) { setMessage('See brauser ei toeta telefoni märguandeid. Kasuta ajakohast Safarit, Chrome’i, Edge’i või Firefoxi.'); return }
    if (!enabled && (!config.current?.available || !registration.current)) {
      setError(initializationError.current || 'Märguannete seaded pole saadaval. Laadi leht uuesti.')
      return
    }
    if (Notification.permission === 'denied' && !enabled) { setMessage('Märguanded on keelatud. Luba need telefoni või brauseri märguannete seadetes ning ava Poeruum uuesti.'); return }
    setBusy(true)
    let created: PushSubscription | null = null
    try {
      if (enabled) {
        await disableAdminPush()
        setEnabled(false)
        setMessage('Märguanded on selles seadmes välja lülitatud.')
        return
      }
      // iOS requires this call directly in the click gesture, before any network await.
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setMessage('Märguannete saatmiseks on vaja sinu luba.'); return }
      const settings = config.current
      const worker = registration.current
      if (!settings?.publicKey || !worker) throw new Error('Märguannete seaded pole saadaval. Laadi leht uuesti.')
      let subscription = await worker.pushManager.getSubscription()
      if (!subscription) {
        subscription = await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(settings.publicKey) })
        created = subscription
      }
      await adminPushRequest({ action: 'subscribe', subscription: subscription.toJSON() })
      setEnabled(true)
      setMessage('Külastuste ja uute kontode märguanded on selles seadmes sees ka lukustatud ekraaniga.')
    } catch (error) {
      if (created) await created.unsubscribe().catch(() => undefined)
      setError(error instanceof Error ? error.message : 'Märguannete lubamine ebaõnnestus.')
    } finally { setBusy(false) }
  }

  const test = async () => {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      const subscription = await currentPushSubscription()
      if (!subscription) { setEnabled(false); throw new Error('Lülita märguanded uuesti sisse.') }
      await adminPushRequest({ action: 'test', endpoint: subscription.endpoint })
      setMessage('Prooviteavitus on saadetud. Kui seda ei kuvata, kontrolli telefoni märguannete ja keskendumisrežiimi seadeid.')
    } catch (error) { setError(error instanceof Error ? error.message : 'Prooviteavituse saatmine ebaõnnestus.') }
    finally { setBusy(false) }
  }

  return { enabled, busy, loading, message, error, toggle, test, dismiss: () => { setMessage(''); setError('') } }
}
export type AdminPushFeedback = ReturnType<typeof useAdminPush>
