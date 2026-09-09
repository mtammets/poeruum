import { createRoot } from 'react-dom/client'
import StorefrontCart from '../src/StorefrontCart'
import '../src/platform.css'

export function mountCheckoutHarness() {
  const root = document.createElement('div')
  document.body.replaceChildren(root)
  createRoot(root).render(<StorefrontCart storeId="10000000-0000-4000-8000-000000000001" initialStep="checkout" paymentProvider="stripe" paymentsReady vatRegistered={false}
    items={[{ id: 'test-product', name: 'Sinine kruus', price: 27.32, quantity: 1, image: '', alt: 'Kruus', cartKey: 'test-product', selectedOptions: {} }]}
    deliverySettings={{ parcelProviders: { omniva: { enabled: false, price: 3.32 }, dpd: { enabled: false, price: 3.32 }, smartposti: { enabled: false, price: 3.32 } }, courierEnabled: false, courierPrice: 5, pickupEnabled: true, pickupAddress: 'Testi 1', freeShippingFrom: 0 }}
    onClose={() => {}} onRemove={() => {}} onQuantityChange={() => {}} />)
}
