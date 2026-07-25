import { lazy, StrictMode, Suspense, useEffect, useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from './ErrorBoundary'
import PlatformApp from './PlatformApp'
import type { LegalDocument } from './LegalPage'
import { applySeoMetadata } from './lib/seo'
import { registerGlobalErrorMonitoring } from './lib/errorMonitoring'
import { getStoreSlugFromHostname } from './lib/storefrontUrl'
import { isSupabaseConfigured, requireSupabase } from './lib/supabase'
import './styles.css'
import './brand.css'
import './platform.css'
import './admin.css'

const AdminApp = lazy(() => import('./AdminApp'))
const ComingSoon = lazy(() => import('./ComingSoon'))
const LegalPage = lazy(() => import('./LegalPage'))
const SupportCenter = lazy(() => import('./SupportCenter'))

const LoadingScreen = () => <main className="homepage-mode-loading" aria-label="Laadin Poeruumi"><span /></main>
const PlatformWithSupport = () => <><PlatformApp /><Suspense fallback={null}><SupportCenter /></Suspense></>

const hasAppReturnState = ['billing', 'checkout'].some((key) => new URLSearchParams(window.location.search).has(key))
const isDeindexedTestStorePath = /^\/p\/test(?:\/|$)/i.test(window.location.pathname)

if (isDeindexedTestStorePath) {
  applySeoMetadata({
    title: 'Lehte ei leitud — Poeruum',
    description: 'Seda e-poodi ei ole avalikult saadaval.',
    canonicalUrl: `https://poeruum.ee${window.location.pathname}`,
    noIndex: true,
  })
}

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

function Homepage() {
  const [comingSoonEnabled, setComingSoonEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setComingSoonEnabled(true)
      return
    }

    let active = true
    const client = requireSupabase()
    client.from('platform_settings')
      .select('coming_soon_enabled')
      .eq('id', 'homepage')
      .maybeSingle()
      .then(({ data, error }) => {
        if (active) setComingSoonEnabled(error ? true : data?.coming_soon_enabled ?? true)
      })

    const channel = client.channel('public-homepage-mode')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'platform_settings',
        filter: 'id=eq.homepage',
      }, (payload) => {
        if (active && typeof payload.new.coming_soon_enabled === 'boolean') {
          setComingSoonEnabled(payload.new.coming_soon_enabled)
        }
      })
      .subscribe()

    return () => {
      active = false
      void client.removeChannel(channel)
    }
  }, [])

  if (comingSoonEnabled === null) {
    return <main className="homepage-mode-loading" aria-label="Laadin Poeruumi avalehte"><span /></main>
  }

  return <Suspense fallback={<LoadingScreen />}>
    {comingSoonEnabled ? <ComingSoon /> : <PlatformWithSupport />}
  </Suspense>
}

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

  if (isAdminPath) return <Suspense fallback={<LoadingScreen />}><AdminApp /></Suspense>
  if (legalDocument) return <Suspense fallback={<LoadingScreen />}><LegalPage document={legalDocument} /></Suspense>
  return isPoeruumHomepage ? <Homepage /> : <PlatformWithSupport />
}

registerGlobalErrorMonitoring()

createRoot(document.getElementById('root')!).render(
  <StrictMode><ErrorBoundary><Root /></ErrorBoundary></StrictMode>,
)
