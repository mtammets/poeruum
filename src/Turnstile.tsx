import { useEffect, useRef } from 'react'

const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim()
export const isCaptchaConfigured = Boolean(siteKey)
const ipHostname = /^(?:\d{1,3}\.){3}\d{1,3}$|^\[[0-9a-f:]+\]$/i

export const isCaptchaUnsupportedHost = () =>
  Boolean(siteKey && ipHostname.test(window.location.hostname))

export const getCaptchaRequiredMessage = () => isCaptchaUnsupportedHost()
  ? 'Botikaitse ei tööta IP-aadressil. Ava arvutis localhost või kasuta lubatud HTTPS-arendusdomeeni.'
  : 'Kinnita enne jätkamist, et sa ei ole robot.'

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null

const loadTurnstile = () => {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-poeruum-turnstile]')
    const script = existing ?? document.createElement('script')
    const resolveApi = () => window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile ei käivitunud.'))
    script.addEventListener('load', resolveApi, { once: true })
    script.addEventListener('error', () => reject(new Error('Botikaitse laadimine ebaõnnestus.')), { once: true })
    if (!existing) {
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.defer = true
      script.dataset.poeruumTurnstile = 'true'
      document.head.append(script)
    }
  })
  return scriptPromise
}

export function Turnstile({ action, onToken }: { action: string; onToken: (token: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onTokenRef = useRef(onToken)
  onTokenRef.current = onToken

  useEffect(() => {
    if (!siteKey || isCaptchaUnsupportedHost() || !containerRef.current) return
    let active = true
    let widgetId: string | null = null
    loadTurnstile().then((turnstile) => {
      if (!active || !containerRef.current) return
      widgetId = turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action,
        theme: 'auto',
        size: 'flexible',
        language: 'auto',
        appearance: 'interaction-only',
        callback: (token: string) => onTokenRef.current(token),
        'expired-callback': () => onTokenRef.current(''),
        'error-callback': () => onTokenRef.current(''),
      })
    }).catch(() => onTokenRef.current(''))
    return () => {
      active = false
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [action])

  if (!siteKey) return null
  if (isCaptchaUnsupportedHost()) {
    return <p className="turnstile-host-error" role="alert">{getCaptchaRequiredMessage()}</p>
  }
  return <div className="turnstile-field" ref={containerRef} aria-label="Botikaitse" />
}
