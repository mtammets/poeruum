import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import StorefrontCart from '../../StorefrontCart'
import { getProductStockLimit } from '../../storefrontModel'
import type { KrukPurchase } from './krukPurchase'
import { useDirectoryTheme } from '../../lib/directoryTheme'

export default function KrukCheckout({ purchase, onClose, returnFocusTo }: {
  purchase: KrukPurchase
  onClose: () => void
  returnFocusTo: RefObject<HTMLButtonElement | null>
}) {
  const root = useRef<HTMLDivElement>(null)
  const [items, setItems] = useState([purchase.item])
  const { keepCampaignVisible } = useDirectoryTheme()
  useEffect(() => keepCampaignVisible(), [keepCampaignVisible])

  useEffect(() => {
    const previousFocus = returnFocusTo.current
    const app = document.getElementById('root')
    const wasInert = app?.inert ?? false
    if (app) app.inert = true
    const dialog = root.current?.querySelector<HTMLElement>('[role="dialog"]')
    if (dialog) { dialog.tabIndex = -1; dialog.focus({ preventScroll: true }) }
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab' || !dialog) return
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], summary, [tabindex="0"]')]
        .filter(element => element.offsetParent !== null)
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault(); last?.focus()
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
        event.preventDefault(); first?.focus()
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      if (app) app.inert = wasInert
      previousFocus?.focus({ preventScroll: true })
    }
  }, [onClose, returnFocusTo])

  return createPortal(<div ref={root} className="kruk-checkout">
    <StorefrontCart storeId={purchase.storeId} items={items} initialStep="checkout"
      returnsText={purchase.returnsText} contactEmail={purchase.contactEmail}
      paymentProvider="stripe" paymentsReady deliverySettings={purchase.deliverySettings}
      vatRegistered={purchase.vatRegistered} onClose={onClose}
      onRemove={onClose}
      onQuantityChange={(cartKey, quantity) => {
        if (quantity <= 0) { onClose(); return }
        setItems(current => current.map(item => item.cartKey === cartKey
          ? { ...item, quantity: Math.min(quantity, getProductStockLimit(item)) } : item))
      }} />
  </div>, document.body)
}
