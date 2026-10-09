import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import SupportCenter from '../src/SupportCenter'
import { Storefront } from '../src/App'
import '../src/styles.css'
import '../src/brand.css'
import '../src/platform.css'

const store = new URLSearchParams(location.search).get('store')
createRoot(document.getElementById('root')!).render(createElement(SupportCenter, null, store && createElement(Storefront, {
  storeId: '10000000-0000-4000-8000-000000000071',
  merchantMode: store !== 'public',
  storeName: 'Mavi Stuudio',
  initialSettings: { editableStoreName: 'Mavi Stuudio' },
  seedProducts: store === 'empty' ? [] : [{ id: 'cup', name: 'Käsitöökruus', image: '/images/kaubamaja-example-ceramics.webp', alt: 'Keraamika', description: 'Käsitsi valmistatud kruus.', price: 25, stock: 20 }],
})))
