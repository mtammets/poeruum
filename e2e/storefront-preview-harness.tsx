import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Storefront } from '../src/App'

export function mountStorefrontPreviewHarness() {
  const root = document.createElement('div')
  document.body.replaceChildren(root)
  createRoot(root).render(createElement(Storefront, { seedProducts: [], onExit: () => undefined }))
}
