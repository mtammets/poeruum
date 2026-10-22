import type { StoreDirectoryEntry } from '../../../shared/store-directory.mjs'
import { formatStoreDirectoryPrice, getStoreDirectoryVisitUrl } from '../../../shared/store-directory.mjs'
import { useDirectoryImpression } from '../../useDirectoryImpression'
import { trackDirectoryEvent } from '../../lib/directoryAnalytics'
import type { useKrukPurchase } from './useKrukPurchase'

export default function KrukKrukSpotlight({ store, purchase, foreground = false }: {
  store: StoreDirectoryEntry
  purchase: ReturnType<typeof useKrukPurchase>
  foreground?: boolean
}) {
  const headingId = useId()
  const ref = useDirectoryImpression(store.id, 'directory', 1)
  const { product, busy, error, buy } = purchase
  if (!product) return null
  const productUrl = getStoreDirectoryVisitUrl(store, product)
  const storeUrl = getStoreDirectoryVisitUrl(store)
  const openStore = () => trackDirectoryEvent({ event_name: 'store_click', store_id: store.id, placement: 'directory', position: 1 })

  return <section id={foreground ? undefined : 'kruk-kruk'} ref={ref} className="kruk-offer" aria-labelledby={headingId}>
    <a className="kruk-offer__product" href={storeUrl} onClick={openStore}
      onAuxClick={event => { if (event.button === 1) openStore() }}>
      {store.name} <span aria-hidden="true">↗</span>
    </a>
    <h2 id={headingId} className="kruk-offer__headline">{foreground ? 'Viska nokk ette.' : 'Võta müts maha.'}</h2>
    <p className="kruk-offer__aside">Rähn jääb meile.</p>
    <button type="button" className="kruk-offer__buy" onClick={event => { void buy(event.currentTarget) }}
      disabled={busy} aria-busy={busy} aria-haspopup="dialog">
      <span>{busy ? 'Avan tellimust…' : 'NOKKMÜTS "2RÄHN"'}</span>
      <span className="kruk-offer__price">
        <strong>{formatStoreDirectoryPrice(product.salePrice ?? product.price!)}</strong>
        {product.salePrice !== null && <del>{formatStoreDirectoryPrice(product.price!)}</del>}
      </span>
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
    </button>
    {error && <p className="kruk-offer__error" role="alert">{error} <a href={productUrl}>Ava tooteleht ↗</a></p>}
  </section>
}
import { useId } from 'react'
