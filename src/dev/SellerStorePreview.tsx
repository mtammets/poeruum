import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Storefront } from '../App'
import { listProducts, type StoreRecord } from '../lib/database'
import { requireSupabase } from '../lib/supabase'
import type { Product } from '../products'
import '../styles.css'
import '../brand.css'
import '../platform.css'

function SellerStorePreview() {
  const [data, setData] = useState<{ store: StoreRecord; products: Product[] } | null>(null)
  const [error, setError] = useState('')
  const params = new URLSearchParams(window.location.search)
  const session = params.get('session')
  const settings = params.get('view') === 'settings'
  useEffect(() => {
    let active = true
    void (async () => {
      const auth = await fetch(`/__preview/sessions/${session}/auth`).then((response) => response.json())
      await requireSupabase().auth.setSession(auth)
      const fixture = await fetch(`/__preview/sessions/${session}/data`).then((response) => response.json())
      const products = await listProducts(fixture.store.id)
      if (active) setData({ store: fixture.store, products })
    })().catch(() => { if (active) setError('Eelvaadet ei saanud avada.') })
    return () => { active = false }
  }, [session])
  if (error) return <p role="alert">{error}</p>
  if (!data) return null
  return <Storefront storeId={data.store.id} seedProducts={data.products} initialSettings={data.store.settings}
    storeName={data.store.name} storeSlug={data.store.slug} initialShipping={data.store.shipping} initialPublished={data.store.is_published}
    paymentsReady={data.store.payment_status === 'connected'} sellerTypeLocked={Boolean(data.store.stripe_account_id)}
    merchantMode={settings} initialSettingsSection={settings ? 'business' : null}
    ownerEmail="liisa@example.com" />
}

if (import.meta.env.DEV) createRoot(document.getElementById('root')!).render(<SellerStorePreview />)
