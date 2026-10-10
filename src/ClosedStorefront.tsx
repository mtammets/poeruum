import { useEffect } from 'react'
import { closedStoreMessage, closedStoreStyles, renderClosedStoreContent, type ClosedStore } from '../shared/closed-storefront.mjs'
import { applySeoMetadata } from './lib/seo'

export default function ClosedStorefront({ store }: { store: ClosedStore }) {
  useEffect(() => {
    applySeoMetadata({ title: `${store.name} — ${closedStoreMessage}`, description: closedStoreMessage, canonicalUrl: window.location.href, noIndex: true })
  }, [store.name])
  return <>
    <style>{closedStoreStyles}</style>
    <div className="closed-storefront" onErrorCapture={(event) => {
      const logo = event.target
      if (logo instanceof HTMLImageElement) logo.replaceWith(document.createTextNode(store.name))
    }} dangerouslySetInnerHTML={{ __html: renderClosedStoreContent(store) }} />
  </>
}
