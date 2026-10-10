const themes = {
  midnight: { background: '#151512', ink: '#f0ede5', scheme: 'dark' },
  paper: { background: '#e8deca', ink: '#342d26', scheme: 'light' },
  pop: { background: '#f3ff63', ink: '#321c5b', scheme: 'light' },
}

export const closedStoreMessage = 'Pood on hetkel suletud.'
const escapeHtml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')

export function normalizeClosedStore(value) {
  if (!value || typeof value !== 'object' || typeof value.name !== 'string' || !value.name.trim()) return null
  const logo = typeof value.logo === 'string' ? value.logo.trim() : ''
  return {
    name: value.name.replace(/\s+/g, ' ').trim().slice(0, 120),
    logo: /^(?:https:\/\/[^\s]+|\/(?![/\\])[^\s]*)$/i.test(logo) ? logo : null,
    theme: Object.hasOwn(themes, value.theme) ? value.theme : 'midnight',
    accent: /^#[\da-f]{6}$/i.test(value.accent) ? value.accent : '#e5f25a',
  }
}

export const closedStoreStyles = `
@font-face { font-family: ClosedStore; src: url('/campaigns/manrope.woff2') format('woff2'); font-weight: 200 800; font-display: swap; }
.closed-store { --closed-bg: #151512; --closed-ink: #f0ede5; position: relative; isolation: isolate; display: grid; box-sizing: border-box; width: 100%; min-height: 100svh; padding: max(2rem, env(safe-area-inset-top)) max(1.5rem, env(safe-area-inset-right)) max(2rem, env(safe-area-inset-bottom)) max(1.5rem, env(safe-area-inset-left)); place-items: center; overflow: hidden; background: var(--closed-bg); color: var(--closed-ink); font-family: ClosedStore, Manrope, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; }
.closed-store::before { position: absolute; z-index: -1; inset: 0; background: radial-gradient(ellipse 48rem 38rem at 50% 43%, color-mix(in srgb, var(--closed-accent) 9%, transparent), transparent 72%); content: ''; pointer-events: none; }
.closed-store__content { display: grid; justify-items: center; gap: clamp(1.75rem, 4vh, 2.75rem); width: 100%; max-width: 40rem; padding-bottom: 6svh; text-align: center; animation: closed-store-arrive 650ms ease-out both; }
.closed-store__brand { display: grid; place-items: center; max-width: 100%; min-height: 5rem; color: inherit; font-size: clamp(2.25rem, 5vw, 3.25rem); font-weight: 650; line-height: 1.15; letter-spacing: -.045em; overflow-wrap: anywhere; }
.closed-store__brand img { display: block; width: auto; height: auto; max-width: min(16rem, 65vw); max-height: clamp(5rem, 10vw, 7.5rem); object-fit: contain; }
.closed-store .closed-store__message { max-width: 24ch; margin: 0; color: inherit; font: 450 clamp(1.5rem, 3vw, 2.5rem)/1.3 ClosedStore, Manrope, 'Segoe UI', sans-serif; letter-spacing: -.045em; text-wrap: balance; }
@keyframes closed-store-arrive { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { .closed-store__content { animation: none; } }
`

export function renderClosedStoreContent(value) {
  const store = normalizeClosedStore(value)
  if (!store) throw new TypeError('A closed storefront needs a store name.')
  const palette = themes[store.theme]
  const identity = store.logo
    ? `<img src="${escapeHtml(store.logo)}" alt="${escapeHtml(store.name)}" fetchpriority="high" decoding="async" />`
    : escapeHtml(store.name)
  return `<main class="closed-store" data-store-theme="${store.theme}" style="--closed-bg:${palette.background};--closed-ink:${palette.ink};--closed-accent:${store.accent};color-scheme:${palette.scheme}"><div class="closed-store__content"><div class="closed-store__brand">${identity}</div><h1 class="closed-store__message">${closedStoreMessage}</h1></div></main>`
}

export function renderClosedStoreDocument(value) {
  const store = normalizeClosedStore(value)
  if (!store) throw new TypeError('A closed storefront needs a store name.')
  const palette = themes[store.theme]
  return `<!doctype html><html lang="et"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" /><meta name="robots" content="noindex, nofollow" /><meta name="theme-color" content="${palette.background}" /><title>${escapeHtml(store.name)} — ${closedStoreMessage}</title>${store.logo ? `<link rel="icon" href="${escapeHtml(store.logo)}" />` : ''}<link rel="preload" href="/campaigns/manrope.woff2" as="font" type="font/woff2" crossorigin /><style>html,body{margin:0;background:${palette.background};color-scheme:${palette.scheme}}${closedStoreStyles}</style><script src="/closed-storefront.js" defer></script></head><body>${renderClosedStoreContent(store)}</body></html>`
}
