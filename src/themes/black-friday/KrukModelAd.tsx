import { useId } from 'react'
import type { StoreDirectoryEntry } from '../../../shared/store-directory.mjs'
import { formatStoreDirectoryPrice, getStoreDirectoryVisitUrl } from '../../../shared/store-directory.mjs'
import { ArrowUpRight } from '../../StoreDirectoryLayout'
import { trackDirectoryEvent } from '../../lib/directoryAnalytics'
import { useDirectoryImpression } from '../../useDirectoryImpression'
import KrukCheckout from './KrukCheckout'
import { useKrukPurchase } from './useKrukPurchase'
import './krukModelAd.css'

export default function KrukModelAd({ store, index }: { store: StoreDirectoryEntry; index: number }) {
  const headingId = useId()
  const ref = useDirectoryImpression(store.id, 'directory', index + 1)
  const purchase = useKrukPurchase(store, index + 1)
  const { product, busy, error, buy } = purchase
  if (!product) return null
  const openStore = () => trackDirectoryEvent({ event_name: 'store_click', store_id: store.id, placement: 'directory', position: index + 1 })

  return <article className="store-directory__card kruk-model-ad" ref={ref} aria-labelledby={headingId}>
    <img className="kruk-model-ad__photo" src="/images/campaigns/kruk-cap-forest-model-v1.webp" width="1254" height="1254"
      alt={'Krük-Krüki nokkmütsi "2rähn" kandev modell soojas õhtuvalguses männimetsas.'} loading="lazy" decoding="async" draggable="false" />
    <div className="kruk-model-ad__stage">
      <a className="kruk-model-ad__brand" href={getStoreDirectoryVisitUrl(store)} onClick={openStore}
        onAuxClick={event => { if (event.button === 1) openStore() }}>
        {store.logoUrl && <img className="kruk-model-ad__logo" src={store.logoUrl} alt="" width="44" height="44"
          loading="lazy" decoding="async" onError={event => { event.currentTarget.style.display = 'none' }} />}
        <span>{store.name}</span><ArrowUpRight />
      </a>
      <span className="kruk-model-ad__label">Reklaam</span>
      <h3 className="kruk-model-ad__headline" id={headingId}><span>Loodusest</span>{' '}<span>nokk</span>{' '}<span>ees.</span></h3>
    </div>
    <div className="kruk-model-ad__offer">
      <div>
        <p className="kruk-model-ad__product">{product.name}</p>
        <p className="kruk-model-ad__price"><strong>{formatStoreDirectoryPrice(product.salePrice ?? product.price!)}</strong>
          {product.salePrice !== null && <del>{formatStoreDirectoryPrice(product.price!)}</del>}</p>
      </div>
      <button type="button" className="kruk-model-ad__buy" disabled={busy} aria-busy={busy} aria-haspopup="dialog"
        onClick={event => { void buy(event.currentTarget) }}>
        <span>{busy ? 'Avan tellimust…' : 'Osta nokkmüts'}</span>
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 10h14M11 4l6 6-6 6" /></svg>
      </button>
      {error && <p className="kruk-model-ad__error" role="alert">{error} <a href={getStoreDirectoryVisitUrl(store, product)}>Ava tooteleht ↗</a></p>}
    </div>
    {purchase.purchase && <KrukCheckout purchase={purchase.purchase} onClose={purchase.close} returnFocusTo={purchase.returnFocusTo} />}
  </article>
}
