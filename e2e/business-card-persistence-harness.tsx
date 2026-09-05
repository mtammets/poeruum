import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import AdminBusinessCard from '../src/AdminBusinessCard'
import '../src/admin.css'

export function mountBusinessCardPersistenceHarness(userId: string) {
  const host = document.createElement('div')
  document.body.replaceChildren(host)
  createRoot(host).render(createElement('main', { className: 'admin-shell' },
    createElement('aside', { className: 'admin-sidebar' }),
    createElement('section', { className: 'admin-main admin-main--business-card' },
      createElement(AdminBusinessCard, { userId }),
    ),
  ))
}
