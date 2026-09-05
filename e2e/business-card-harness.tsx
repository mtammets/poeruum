import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { BusinessCardEditor } from '../src/AdminBusinessCard'
import { createDefaultCard, type CardDocument } from '../src/businessCard/model'
import { loadLocalCardDraft, saveLocalCardDraft } from '../src/businessCard/storage'
import '../src/admin.css'

const HARNESS_USER_ID = 'e2e-business-card-admin'

declare global {
  interface Window {
    __businessCardDocument?: CardDocument
    __businessCardSaved?: Promise<void>
  }
}

export async function mountBusinessCardHarness() {
  const saved = await loadLocalCardDraft(HARNESS_USER_ID)
  const initialDocument = saved?.document ?? createDefaultCard()
  window.__businessCardDocument = initialDocument

  const host = document.createElement('div')
  host.id = 'business-card-harness'
  document.body.replaceChildren(host)
  createRoot(host).render(createElement('main', { className: 'admin-shell' },
    createElement('aside', { className: 'admin-sidebar' },
      createElement('a', { className: 'platform-brand', href: '/admin' }, createElement('strong', null, 'Poeruum')),
      createElement('nav', { 'aria-label': 'Admini navigeerimine' },
        createElement('a', { className: 'is-active', href: '/admin/business-card' }, createElement('span', { 'aria-hidden': true }, '▤'), 'Visiitkaart'),
      ),
    ),
    createElement('section', { className: 'admin-main admin-main--business-card' },
      createElement('header', { className: 'admin-topbar' }, createElement('div', null, createElement('h1', null, 'Visiitkaart'))),
      createElement(BusinessCardEditor, {
        initialDocument,
        onDocumentChange: (document: CardDocument) => {
          window.__businessCardDocument = document
          window.__businessCardSaved = (window.__businessCardSaved ?? Promise.resolve()).then(() => saveLocalCardDraft(HARNESS_USER_ID, {
            document, dirty: true, baseRevision: null, updatedAt: new Date().toISOString(),
          }))
        },
        saveStatus: 'Salvestatud selles brauseris',
      }),
    ),
  ))
}
