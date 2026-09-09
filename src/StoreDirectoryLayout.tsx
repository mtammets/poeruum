import type { ReactNode } from 'react'
import { Brand } from './Brand'
import { getMerchantLoginUrl } from './lib/storefrontUrl'

export const ArrowUpRight = ({ className = '' }: { className?: string }) => <svg
  className={className}
  viewBox="0 0 20 20"
  fill="none"
  aria-hidden="true"
>
  <path d="M5 15 15 5M7 5h8v8" />
</svg>

export default function StoreDirectoryLayout({ children, isStory = false }: { children: ReactNode; isStory?: boolean }) {
  return <main className="store-directory">
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
    {children}
    <footer className="store-directory__footer">
      <span>© 2026 Poeruum</span>
      <div>
        <a href="https://poeruum.ee/mis-on-poeruum/">Mis on Poeruum?</a>
        <a href="https://poeruum.ee/#hind">Loo oma pood <ArrowUpRight /></a>
      </div>
    </footer>
  </main>
}
