import { StrictMode, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import DemoApp from './DemoApp'
import AdminApp from './AdminApp'
import ComingSoon from './ComingSoon'
import LegalPage, { type LegalDocument } from './LegalPage'
import SupportCenter from './SupportCenter'
import { getStoreSlugFromHostname } from './lib/storefrontUrl'
import './styles.css'
import './brand.css'
import './demo.css'
import './admin.css'

const hasAppReturnState = ['billing', 'checkout'].some((key) => new URLSearchParams(window.location.search).has(key))
const isPoeruumHomepage = /^(?:www\.)?poeruum\.ee$/i.test(window.location.hostname)
  && window.location.pathname === '/' && !hasAppReturnState
const isStorefrontSubdomain = getStoreSlugFromHostname(window.location.hostname) !== null
const isPlatformHostname = /^(?:localhost|127\.0\.0\.1|(?:[a-z0-9-]+\.)?poeruum\.ee)$/i.test(window.location.hostname)
const isAdminPath = isPlatformHostname && !isStorefrontSubdomain && /^\/admin\/?$/i.test(window.location.pathname)
const legalDocument: LegalDocument | null = isPlatformHostname && !isStorefrontSubdomain
  ? /^\/kasutustingimused\/?$/i.test(window.location.pathname)
    ? 'terms'
    : /^\/(?:privaatsus|privaatsuspoliitika)\/?$/i.test(window.location.pathname)
      ? 'privacy'
      : null
  : null

function Root() {
  useLayoutEffect(() => {
    let readinessFrame = 0
    let revealFrame = 0
    let cancelled = false

    const reveal = () => {
      revealFrame = window.requestAnimationFrame(() => {
        revealFrame = window.requestAnimationFrame(() => {
          if (!cancelled) document.documentElement.classList.add('app-ready')
        })
      })
    }

    const waitForStyles = () => {
      if (cancelled) return
      const stylesReady = window.getComputedStyle(document.documentElement)
        .getPropertyValue('--poeruum-css-ready')
        .trim() === '1'

      if (stylesReady) {
        reveal()
        return
      }

      readinessFrame = window.requestAnimationFrame(waitForStyles)
    }

    const beginReadinessCheck = () => waitForStyles()

    if (document.readyState === 'complete') beginReadinessCheck()
    else window.addEventListener('load', beginReadinessCheck, { once: true })

    return () => {
      cancelled = true
      window.removeEventListener('load', beginReadinessCheck)
      window.cancelAnimationFrame(readinessFrame)
      window.cancelAnimationFrame(revealFrame)
    }
  }, [])

  if (isAdminPath) return <AdminApp />
  if (legalDocument) return <LegalPage document={legalDocument} />
  return isPoeruumHomepage ? <ComingSoon /> : <><DemoApp /><SupportCenter /></>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><Root /></StrictMode>,
)
