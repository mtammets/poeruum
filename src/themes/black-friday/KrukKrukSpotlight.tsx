import type { StoreDirectoryEntry } from '../../../shared/store-directory.mjs'
import { formatStoreDirectoryPrice, getStoreDirectoryVisitUrl } from '../../../shared/store-directory.mjs'
import { useDirectoryImpression } from '../../useDirectoryImpression'
import { capImage } from './krukHatMotion'
import type { useKrukPurchase } from './useKrukPurchase'

export default function KrukKrukSpotlight({ store, purchase, foreground = false }: {
  store: StoreDirectoryEntry
  purchase: ReturnType<typeof useKrukPurchase>
  foreground?: boolean
}) {
  const ref = useDirectoryImpression(store.id, 'directory', 1)
  const { product, busy, error, buy } = purchase
  if (!product) return null
  const productUrl = getStoreDirectoryVisitUrl(store, product)
  const price = formatStoreDirectoryPrice(product.salePrice ?? product.price!)

  return <section id={foreground ? undefined : 'kruk-kruk'} ref={ref} className="kruk-offer"
    aria-label="Nokkmütsi pakkumine">
    <button type="button" className="kruk-offer__buy" onClick={event => { void buy(event.currentTarget) }}
      disabled={busy} aria-busy={busy} aria-haspopup="dialog"
      aria-label={busy ? `Avan tellimust: Võta nokkmüts, ${price}` : `Võta nokkmüts, ${price}`}>
      {!foreground && <img className="kruk-offer__cap" src={capImage} alt="" decoding="async" draggable="false" />}
      <span className="kruk-offer__details">
        <span className="kruk-offer__label">Võta nokkmüts</span>
        <span className="kruk-offer__price">{price}</span>
      </span>
    </button>
    {error && <p className="kruk-offer__error" role="alert">{error} <a href={productUrl}>Ava tooteleht ↗</a></p>}
  </section>
}
