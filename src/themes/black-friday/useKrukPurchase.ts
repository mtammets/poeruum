import { useCallback, useRef, useState } from 'react'
import type { StoreDirectoryEntry } from '../../../shared/store-directory.mjs'
import { trackDirectoryEvent } from '../../lib/directoryAnalytics'
import { loadKrukPurchase, type KrukPurchase } from './krukPurchase'

export function useKrukPurchase(store?: StoreDirectoryEntry, position = 1) {
  const buying = useRef(false)
  const returnFocusTo = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [purchase, setPurchase] = useState<KrukPurchase | null>(null)
  const close = useCallback(() => setPurchase(null), [])
  const product = store?.products.find(product => product.slug === 'nokkmuts' && product.imageUrl && product.price !== null && product.stock !== 0)
  const trackProduct = () => {
    if (store && product) trackDirectoryEvent({ event_name: 'product_click', store_id: store.id, product_id: product.id, placement: 'directory', position })
  }
  const buy = async (trigger: HTMLButtonElement) => {
    if (!store || !product || buying.current) return
    returnFocusTo.current = trigger
    buying.current = true
    setBusy(true)
    setError('')
    trackProduct()
    try { setPurchase(await loadKrukPurchase(store.id, product.id)) }
    catch (error) { setError(error instanceof Error ? error.message : 'Ostu ei õnnestunud avada. Proovi uuesti.') }
    finally { buying.current = false; setBusy(false) }
  }
  return { product, busy, error, purchase, returnFocusTo, buy, close, trackProduct }
}
