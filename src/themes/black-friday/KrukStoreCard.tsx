import type { StoreDirectoryEntry } from '../../../shared/store-directory.mjs'
import { formatStoreDirectoryPrice, getStoreDirectoryVisitUrl } from '../../../shared/store-directory.mjs'
import { ArrowUpRight } from '../../StoreDirectoryLayout'
import StoreDirectoryCardContent from '../../StoreDirectoryCardContent'
import { trackDirectoryEvent } from '../../lib/directoryAnalytics'
import { useDirectoryImpression } from '../../useDirectoryImpression'
import KrukCheckout from './KrukCheckout'
import { useKrukPurchase } from './useKrukPurchase'
import { capImage } from './krukHatMotion'

export default function KrukStoreCard({ store, index }: { store: StoreDirectoryEntry; index: number }) {
  const ref = useDirectoryImpression(store.id, 'directory', index + 1)
  const purchase = useKrukPurchase(store)
  const { product, busy, error, buy, trackProduct } = purchase
  const storeUrl = getStoreDirectoryVisitUrl(store)
  const openStore = () => trackDirectoryEvent({ event_name: 'store_click', store_id: store.id, placement: 'directory', position: index + 1 })

  // Keep the store discoverable when the featured cap is no longer available.
  if (!product) return <article className="store-directory__card" ref={ref}>
    <a className="store-directory__card-link" href={storeUrl} onClick={openStore}
      onAuxClick={event => { if (event.button === 1) openStore() }} aria-label={`Ava pood ${store.name}`}>
      <StoreDirectoryCardContent store={store} index={index} />
    </a>
  </article>

  const productUrl = getStoreDirectoryVisitUrl(store, product)
  return <article className="store-directory__card kruk-store-card" ref={ref} aria-label={`${store.name} – Musta rähni eripakkumine`}>
    <div className="kruk-store-card__stage">
      <a className="kruk-store-card__store" href={storeUrl} onClick={openStore}
        onAuxClick={event => { if (event.button === 1) openStore() }} aria-label={`Ava pood ${store.name}`}>
        <span>{store.name}</span><span className="kruk-store-card__visit" aria-hidden="true">Ava pood <ArrowUpRight /></span>
      </a>
      <h3 className="kruk-store-card__campaign">
        <span className="kruk-store-card__title"><span>MUSTA</span> <span>RÄHNI</span></span>
        <span className="kruk-store-card__edition">ERIPAKKUMINE</span>
      </h3>
      <a className="kruk-store-card__photo" href={productUrl} onClick={trackProduct}
        onAuxClick={event => { if (event.button === 1) trackProduct() }} aria-label={`Vaata toodet ${product.name}`}>
        <img className="kruk-store-card__cap" src={capImage} alt="" loading="lazy" decoding="async"
          onError={event => {
            if (event.currentTarget.getAttribute('src') !== product.imageUrl) event.currentTarget.src = product.imageUrl!
          }} />
      </a>
      <div className="kruk-store-card__offer">
        <a className="kruk-store-card__product" href={productUrl} onClick={trackProduct}
          onAuxClick={event => { if (event.button === 1) trackProduct() }}>{product.name}</a>
        <div className="kruk-store-card__purchase">
          <p className="kruk-store-card__price">
            <strong>{formatStoreDirectoryPrice(product.salePrice ?? product.price!)}</strong>
            {product.salePrice !== null && <del>{formatStoreDirectoryPrice(product.price!)}</del>}
          </p>
          <button type="button" className="kruk-store-card__buy" disabled={busy} aria-busy={busy} aria-haspopup="dialog"
            onClick={event => { void buy(event.currentTarget) }}>
            <span>{busy ? 'Avan tellimust…' : 'Osta nokkmüts'}</span><ArrowUpRight />
          </button>
        </div>
        {error && <p className="kruk-store-card__error" role="alert">{error} <a href={productUrl}>Ava tooteleht ↗</a></p>}
      </div>
    </div>
    {purchase.purchase && <KrukCheckout purchase={purchase.purchase} onClose={purchase.close} returnFocusTo={purchase.returnFocusTo} />}
  </article>
}
