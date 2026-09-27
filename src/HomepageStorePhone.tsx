import { useEffect, useMemo, useRef, useState } from 'react'
import type { PublicStoreRecord } from './lib/database'
import type { Product } from './products'

export type StorefrontPreviewData = { store: PublicStoreRecord; products: Product[] }

function previewDocument(data: StorefrontPreviewData) {
  // Boot the same application in its own window so viewport styles, scrolling,
  // and document effects behave exactly as they do in a mobile storefront.
  const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"]'), (node) => node.outerHTML).join('')
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"]'))
    .filter((script) => script.src || (import.meta.env.DEV && script.textContent?.includes('/@react-refresh')))
    .map((script) => script.outerHTML).join('')
  const payload = JSON.stringify(data).replace(/</g, '\\u003c')
  return `<!doctype html><html lang="et" data-storefront-preview="true" data-app-surface="storefront"><head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow"><base href="${window.location.origin}/">
    ${styles}</head><body><div id="root"></div>
    <script type="application/json" id="storefront-preview-data">${payload}</script>${scripts}</body></html>`
}

export default function HomepageStorePhone({ store, products, url }: StorefrontPreviewData & { url: string }) {
  const screen = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ scale: 1, height: 800 })
  const srcDoc = useMemo(() => previewDocument({ store, products }), [store, products])

  useEffect(() => {
    const node = screen.current
    if (!node) return
    const resize = () => {
      const scale = node.clientWidth / 390
      if (scale > 0) setSize({ scale, height: Math.round(node.clientHeight / scale) })
    }
    const observer = new ResizeObserver(resize)
    observer.observe(node)
    resize()
    return () => observer.disconnect()
  }, [])

  return <div className="platform-phone-stage">
    <a className="platform-phone" href={url} aria-label={`Ava pood ${store.name}`}>
      <div className="platform-phone__screen" ref={screen} inert aria-hidden="true">
        <iframe className="platform-phone__frame" title={`${store.name} mobiilivaade`}
          srcDoc={srcDoc} tabIndex={-1} sandbox="allow-scripts allow-same-origin"
          style={{ height: size.height, transform: `scale(${size.scale})` }} />
      </div>
    </a>
  </div>
}
