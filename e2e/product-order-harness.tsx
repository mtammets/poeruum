import { createRoot } from 'react-dom/client'
import { Storefront } from '../src/App'
import { requireSupabase } from '../src/lib/supabase'

export function mountProductOrderHarness() {
  // The test API is proxied under a prefix; public image URLs use the root,
  // just as they do on the production Supabase host.
  const storage = requireSupabase().storage
  const from = storage.from.bind(storage)
  storage.from = (bucket) => {
    const api = from(bucket), getPublicUrl = api.getPublicUrl.bind(api)
    api.getPublicUrl = (...args) => {
      const result = getPublicUrl(...args)
      result.data.publicUrl = result.data.publicUrl.replace('/__e2e_supabase/', '/')
      return result
    }
    return api
  }
  const root = document.createElement('div')
  document.body.replaceChildren(root)
  createRoot(root).render(<Storefront storeId="c7190001-0000-4000-8000-000000000001"
    storeName="Järjestuse pood" storeSlug="jarjestuse-pood" merchantMode seedProducts={[]} initialSettings={{ autoSwipeEnabled: false }} />)
}
