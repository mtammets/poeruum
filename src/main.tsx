import { lazy, StrictMode, Suspense, useEffect, useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from './ErrorBoundary'
import type { LegalDocument } from './LegalPage'
import { applySeoMetadata } from './lib/seo'
import { registerGlobalErrorMonitoring } from './lib/errorMonitoring'
import { getStoreSlugFromHostname, isPlatformHostname } from './lib/storefrontUrl'
import { isSupabaseConfigured, requireSupabase } from './lib/supabase'
import './styles.css'
import './brand.css'

const AdminApp = lazy(() => import('./AdminApp'))
const ComingSoon = lazy(() => import('./ComingSoon'))
const LegalPage = lazy(() => import('./LegalPage'))
const PlatformApp = lazy(() => import('./PlatformApp'))
const SupportCenter = lazy(() => import('./SupportCenter'))

const LoadingScreen = () => <main className="homepage-mode-loading" aria-label="Laadin Poeruumi"><span /></main>
const PlatformWithSupport = () => <Suspense fallback={<LoadingScreen />}>
  <PlatformApp />
  <Suspense fallback={null}><SupportCenter /></Suspense>
</Suspense>

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
const isPlatformSurface = isPlatformHostname(window.location.hostname) && !isStorefrontSubdomain
const appSurface = isPlatformSurface ? 'platform' : 'storefront'
document.documentElement.dataset.appSurface = appSurface
document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  ?.setAttribute('content', appSurface === 'platform' ? '#f4f2e9' : '#000000')
const isAdminPath = isPlatformSurface && /^\/admin(?:\/(?:homepage|seo|users|support))?\/?$/i.test(window.location.pathname)
const legalDocument: LegalDocument | null = isPlatformSurface
  ? /^\/kasutustingimused\/?$/i.test(window.location.pathname)
    ? 'terms'
    : /^\/(?:privaatsus|privaatsuspoliitika)\/?$/i.test(window.location.pathname)
      ? 'privacy'
      : null
  : null

function Homepage() {
  const [homepageSettings, setHomepageSettings] = useState<{
    comingSoonEnabled: boolean
    seoTitle: string
    seoDescription: string
    socialTitle: string
    socialDescription: string
    searchIndexingEnabled: boolean
    socialImagePath: string | null
  } | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setHomepageSettings({
        comingSoonEnabled: true,
        seoTitle: 'Poeruum – loo Eesti e-pood 10 minutiga',
        seoDescription: 'Loo professionaalne e-pood umbes 10 minutiga. Lisa tooted telefonist, võta vastu makseid ning halda tellimusi ja tarnet ühest lihtsast keskkonnast.',
        socialTitle: 'Lihtne e-pood Eesti väikeettevõtjale',
        socialDescription: 'Lisa tooted, võta vastu makseid ja halda tellimusi ühest kohast.',
        searchIndexingEnabled: true,
        socialImagePath: null,
      })
      return
    }

    let active = true
    const client = requireSupabase()
    client.from('platform_settings')
      .select('coming_soon_enabled,seo_title,seo_description,social_title,social_description,search_indexing_enabled,social_image_path')
      .eq('id', 'homepage')
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return
        setHomepageSettings({
          comingSoonEnabled: error ? true : data?.coming_soon_enabled ?? true,
          seoTitle: data?.seo_title ?? 'Poeruum – loo Eesti e-pood 10 minutiga',
          seoDescription: data?.seo_description ?? 'Loo professionaalne e-pood umbes 10 minutiga. Lisa tooted telefonist, võta vastu makseid ning halda tellimusi ja tarnet ühest lihtsast keskkonnast.',
          socialTitle: data?.social_title ?? 'Lihtne e-pood Eesti väikeettevõtjale',
          socialDescription: data?.social_description ?? 'Lisa tooted, võta vastu makseid ja halda tellimusi ühest kohast.',
          searchIndexingEnabled: data?.search_indexing_enabled ?? true,
          socialImagePath: data?.social_image_path ?? null,
        })
      })

    const channel = client.channel('public-homepage-mode')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'platform_settings',
        filter: 'id=eq.homepage',
      }, (payload) => {
        if (!active) return
        setHomepageSettings((current) => current ? {
          comingSoonEnabled: typeof payload.new.coming_soon_enabled === 'boolean' ? payload.new.coming_soon_enabled : current.comingSoonEnabled,
          seoTitle: typeof payload.new.seo_title === 'string' ? payload.new.seo_title : current.seoTitle,
          seoDescription: typeof payload.new.seo_description === 'string' ? payload.new.seo_description : current.seoDescription,
          socialTitle: typeof payload.new.social_title === 'string' ? payload.new.social_title : current.socialTitle,
          socialDescription: typeof payload.new.social_description === 'string' ? payload.new.social_description : current.socialDescription,
          searchIndexingEnabled: typeof payload.new.search_indexing_enabled === 'boolean' ? payload.new.search_indexing_enabled : current.searchIndexingEnabled,
          socialImagePath: typeof payload.new.social_image_path === 'string' ? payload.new.social_image_path : payload.new.social_image_path === null ? null : current.socialImagePath,
        } : current)
      })
      .subscribe()

    return () => {
      active = false
      void client.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    if (!homepageSettings) return
    const supabaseOrigin = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
    const imageVersion = homepageSettings.socialImagePath
    applySeoMetadata({
      title: homepageSettings.seoTitle,
      description: homepageSettings.seoDescription,
      socialTitle: homepageSettings.socialTitle,
      socialDescription: homepageSettings.socialDescription,
      canonicalUrl: 'https://poeruum.ee/',
      imageUrl: supabaseOrigin && imageVersion
        ? `${supabaseOrigin}/functions/v1/homepage-social-image?v=${encodeURIComponent(imageVersion)}`
        : undefined,
      imageWidth: imageVersion ? 1200 : undefined,
      imageHeight: imageVersion ? 630 : undefined,
      imageType: imageVersion ? (imageVersion.endsWith('.webp') ? 'image/webp' : 'image/png') : undefined,
      noIndex: !homepageSettings.searchIndexingEnabled,
    })
  }, [homepageSettings])

  if (homepageSettings === null) {
    return <main className="homepage-mode-loading" aria-label="Laadin Poeruumi avalehte"><span /></main>
  }

  return <Suspense fallback={<LoadingScreen />}>
    {homepageSettings.comingSoonEnabled ? <ComingSoon /> : <PlatformWithSupport />}
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
