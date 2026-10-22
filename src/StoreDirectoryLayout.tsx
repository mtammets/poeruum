import type { ReactNode } from 'react'
import type { StoreDirectoryEntry } from '../shared/store-directory.mjs'
import { Brand } from './Brand'
import { getMerchantLoginUrl } from './lib/storefrontUrl'
import { useDirectoryTheme, type DirectoryTheme } from './lib/directoryTheme'
import BlackFridayBanner from './themes/black-friday/BlackFridayBanner'
import './themes/black-friday/blackFriday.css'

export const ArrowUpRight = ({ className = '' }: { className?: string }) => <svg
  className={className}
  viewBox="0 0 20 20"
  fill="none"
  aria-hidden="true"
>
  <path d="M5 15 15 5M7 5h8v8" />
</svg>

export default function StoreDirectoryLayout({ children, isStory = false, campaignStore }: {
  children: ReactNode
  isStory?: boolean
  campaignStore?: StoreDirectoryEntry
}) {
  const { theme, canPreview, preview } = useDirectoryTheme()
  const previewUrl = (nextTheme: DirectoryTheme | null) => {
    const url = new URL(window.location.href)
    if (nextTheme === null) url.searchParams.delete('theme')
    else url.searchParams.set('theme', nextTheme)
    return `${url.pathname}${url.search}${url.hash}`
  }

  return <main className="store-directory" data-directory-theme={theme}>
    {canPreview && <nav className="directory-theme-preview" aria-label="Kujunduse eelvaade">
      <span>Kujunduse eelvaade</span>
      <a href={previewUrl(null)} aria-current={preview === null ? 'page' : undefined}>Avalik vaade</a>
      <a href={previewUrl('default')} aria-current={preview === 'default' ? 'page' : undefined}>Tavaline</a>
      <a href={previewUrl('black-friday')} aria-current={preview === 'black-friday' ? 'page' : undefined}>Musta rähni päevad</a>
    </nav>}
    <nav className="store-directory__nav" aria-label="Poeruumi Kaubamaja">
      <a className="store-directory__brand" href={isStory ? '/' : 'https://poeruum.ee/'} aria-label={isStory ? 'Kaubamaja avaleht' : 'Poeruumi avaleht'}>
        <Brand />
        <span className="store-directory__brand-rule" aria-hidden="true" />
        <span className="store-directory__brand-edition">Kaubamaja</span>
      </a>
      <div className="store-directory__merchant-entry">
        <a className="store-directory__manage" href={getMerchantLoginUrl(window.location)}>Minu poe haldus</a>
        <a className="store-directory__create" href="https://poeruum.ee/#hind" aria-label="Loo oma e-pood">
          <span className="store-directory__create-full" aria-hidden="true">Loo oma e-pood</span>
          <span className="store-directory__create-short" aria-hidden="true">Loo e-pood</span>
          <ArrowUpRight />
        </a>
      </div>
    </nav>
    {theme === 'black-friday' && !isStory && <BlackFridayBanner store={campaignStore} />}
    {children}
    <footer className="store-directory__footer">
      <span>© 2026 Poeruum</span>
      <div>
        <a href="https://poeruum.ee/mis-on-poeruum/">Mis on Poeruum?</a>
        <a href="https://poeruum.ee/kasutustingimused">Kasutustingimused</a>
        <a href="https://poeruum.ee/privaatsus">Privaatsus</a>
        <a href="https://poeruum.ee/#hind">Loo oma pood <ArrowUpRight /></a>
      </div>
    </footer>
  </main>
}
