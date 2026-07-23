import { useEffect, useRef, useState } from 'react'
import type { ClipboardEvent as ReactClipboardEvent, CSSProperties } from 'react'
import { flushSync } from 'react-dom'
import { products, type Product, type ProductImageAsset, type ProductImageTransform } from './products'
import { cancelStripeBilling, listOrders, listProducts, manageCustomDomain, refundStripeOrder, removeProduct, removeStoredProductImages, saveProduct, startStripeBillingCheckout, startStripeStoreCheckout, updateOrderStatus, updateStore, uploadImages, uploadProductImages, type CustomDomainRecord, type ImageUploadPhase, type StoreRecord } from './lib/database'
import { isSupabaseConfigured, requireSupabase } from './lib/supabase'

const getProductPrice = (product: Product) =>
  product.salePrice !== undefined && product.price !== undefined && product.salePrice < product.price
    ? product.salePrice
    : product.price ?? 0

const formatEuro = (value: number) => `${value.toFixed(2).replace('.', ',')} €`
export const DEFAULT_RETURNS_TEXT = 'Tarbijal on õigus e-poest ostetud kaubast 14 päeva jooksul pärast kauba kättesaamist taganeda. Taganemiseks saada müüja kontakt-e-postile ühemõtteline avaldus. Kauba tagastamise otsesed kulud kannab ostja, välja arvatud puudusega kauba korral. Raha tagastatakse 14 päeva jooksul pärast taganemisavalduse saamist; müüja võib tagasimaksega oodata, kuni kaup on tagastatud või ostja on esitanud tõendi selle saatmise kohta. Taganemisõigusele kehtivad seaduses sätestatud erandid.'
const DEFAULT_IMAGE_TRANSFORM: ProductImageTransform = { x: 0, y: 0, scale: 1 }
const clampImageScale = (scale: number) => Math.min(3, Math.max(1, scale))
const clampImageOffset = (offset: number, scale: number) => {
  const limit = scale <= 1 ? 0 : (scale - 1) * 50 / scale
  return Math.min(limit, Math.max(-limit, offset))
}
const isImageFile = (file: File) => file.type.startsWith('image/') || /\.(?:heic|heif)$/i.test(file.name)
const createCheckoutRequestId = () => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const getResponsiveImageProps = (product: Product, image: string, preferred: 'thumb' | 'medium' | 'large' = 'large') => {
  const asset = product.imageVariants?.[image]
  if (!asset) return { src: image }
  const variants = Object.values(asset.variants)
    .filter((variant, index, all) => all.findIndex((candidate) => candidate.url === variant.url) === index)
    .sort((left, right) => left.width - right.width)
  return {
    src: asset.variants[preferred].url,
    srcSet: variants.map((variant) => `${variant.url} ${variant.width}w`).join(', '),
  }
}

const copyTextToClipboard = async (text: string) => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // HTTP previews on a local IP are not a secure clipboard context.
    }
  }

  const focusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const scrollX = window.scrollX
  const scrollY = window.scrollY
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.setAttribute('aria-hidden', 'true')
  Object.assign(textarea.style, {
    position: 'fixed',
    top: '0',
    left: '-9999px',
    width: '1px',
    height: '1px',
    padding: '0',
    border: '0',
    opacity: '0',
    fontSize: '16px',
  })
  document.body.appendChild(textarea)
  textarea.focus({ preventScroll: true })
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)
  document.execCommand('copy')
  textarea.remove()
  focusedElement?.focus({ preventScroll: true })

  if (window.scrollX !== scrollX || window.scrollY !== scrollY) {
    window.scrollTo({ top: scrollY, left: scrollX, behavior: 'auto' })
  }
}

const selectEditableContents = (element: HTMLElement) => {
  window.requestAnimationFrame(() => {
    if (!element.isConnected) return
    const range = document.createRange()
    range.selectNodeContents(element)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  })
}

const pastePlainText = (event: ReactClipboardEvent<HTMLElement>, singleLine = false) => {
  event.preventDefault()
  const clipboardText = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n')
  const text = singleLine ? clipboardText.replace(/\s+/g, ' ').trim() : clipboardText
  const selection = window.getSelection()
  if (!selection?.rangeCount) return
  const range = selection.getRangeAt(0)
  range.deleteContents()
  const textNode = document.createTextNode(text)
  range.insertNode(textNode)
  range.setStartAfter(textNode)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

const getReadableTextColor = (hex: string) => {
  const channels = hex.slice(1).match(/.{2}/g)?.map((channel) => Number.parseInt(channel, 16) / 255) ?? [1, 1, 1]
  const [red, green, blue] = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
  return luminance > 0.179 ? '#111111' : '#ffffff'
}

const ACCENT_PRESETS = ['#e5f25a', '#ff7a59', '#73e2a7', '#77d4ff', '#d3a6ff', '#ff8fbd']
const EMPTY_PRODUCT_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 900 1200'%3E%3Crect width='900' height='1200' fill='%2315171a'/%3E%3Cg fill='none' stroke='%236b7682' stroke-width='18' stroke-linecap='round' stroke-linejoin='round' opacity='.8'%3E%3Crect x='310' y='460' width='280' height='220' rx='32'/%3E%3Cpath d='m342 638 82-82 62 62 38-38 38 38'/%3E%3Ccircle cx='506' cy='526' r='24'/%3E%3C/g%3E%3C/svg%3E"

type OmnivaLocation = { ZIP: string; NAME: string; TYPE: string; A0_NAME: string; A1_NAME: string; A2_NAME: string; A3_NAME: string }
type ShippingProvider = 'omniva' | 'dpd' | 'smartposti'
type ParcelMachine = { provider: ShippingProvider; id: string; name: string; city: string; address?: string; searchText: string }
type AksAddress = { adr_id: string; aadresstekst: string; ipikkaadress: string; omavalitsus: string; asustusyksus: string; sihtnumber: string; liikVal: string }
type DemoOrder = {
  id: string
  items: CartItem[]
  customerName: string
  customerEmail: string
  delivery: string
  productSubtotal: number
  total: number
  createdAt: string
  status: 'new' | 'fulfilled' | 'refunded'
  stripeProcessingFee?: number
  stripePlatformFee?: number
  stripeSellerNet?: number
}

type CartItem = Product & {
  cartKey: string
  quantity: number
  selectedOptions: Record<string, string>
}

const createCartKey = (productId: string, selectedOptions: Record<string, string>) =>
  `${productId}:${Object.entries(selectedOptions).sort(([left], [right]) => left.localeCompare(right)).map(([name, value]) => `${name}=${value}`).join('|')}`

const createCartItem = (product: Product, quantity = 1, selectedOptions: Record<string, string> = {}): CartItem => ({
  ...product,
  cartKey: createCartKey(product.id, selectedOptions),
  quantity,
  selectedOptions,
})

const getDefaultProductOptions = (product: Product) => Object.fromEntries(
  (product.options ?? []).map((option) => [option.name, option.values[0] ?? '']),
)

const getProductStockLimit = (product: Product) => product.oneOfAKind ? 1 : product.stock ?? Number.POSITIVE_INFINITY

const createDemoOrders = (): DemoOrder[] => {
  const createdAt = (daysAgo: number, hour: number) => {
    const date = new Date()
    date.setDate(date.getDate() - daysAgo)
    date.setHours(hour, 15, 0, 0)
    return date.toISOString()
  }

  return [
    {
      id: 'PR-10714',
      items: [createCartItem(products[0])],
      customerName: 'Maris Põld',
      customerEmail: 'maris.pold@example.com',
      delivery: 'Omniva · Tallinna Kristiine keskuse pakiautomaat',
      productSubtotal: 18,
      total: 20.9,
      createdAt: createdAt(0, 18),
      status: 'new',
    },
    {
      id: 'PR-10712',
      items: [createCartItem(products[4]), createCartItem(products[3])],
      customerName: 'Rasmus Vaher',
      customerEmail: 'rasmus.vaher@example.com',
      delivery: 'Kuller · Narva mnt 7, Tallinn',
      productSubtotal: 50,
      total: 54.9,
      createdAt: createdAt(0, 12),
      status: 'fulfilled',
    },
    {
      id: 'PR-10709',
      items: [createCartItem(products[1], 1, { Värv: 'Grafiit' }), createCartItem(products[0])],
      customerName: 'Kadi Oja',
      customerEmail: 'kadi.oja@example.com',
      delivery: 'DPD · Tartu Kvartali pakiautomaat',
      productSubtotal: 50,
      total: 52.9,
      createdAt: createdAt(1, 17),
      status: 'new',
    },
    {
      id: 'PR-10703',
      items: [createCartItem(products[6])],
      customerName: 'Marten Ilves',
      customerEmail: 'marten.ilves@example.com',
      delivery: 'Tulen ise järele · Paldiski mnt 25, Tallinn',
      productSubtotal: 34,
      total: 34,
      createdAt: createdAt(1, 10),
      status: 'fulfilled',
    },
    {
      id: 'PR-10699',
      items: [createCartItem(products[2]), createCartItem(products[4])],
      customerName: 'Helena Sild',
      customerEmail: 'helena.sild@example.com',
      delivery: 'SmartPosti · Pärnu Kaubamajaka pakiautomaat',
      productSubtotal: 67,
      total: 69.9,
      createdAt: createdAt(2, 15),
      status: 'new',
    },
    {
      id: 'PR-10698',
      items: [createCartItem(products[5], 1, { Värv: 'Kuldne' }), createCartItem(products[6])],
      customerName: 'Liisa Kask',
      customerEmail: 'liisa.kask@example.com',
      delivery: 'SmartPosti · Tartu Lõunakeskuse pakiautomaat',
      productSubtotal: 63,
      total: 65.9,
      createdAt: createdAt(1, 14),
      status: 'new',
    },
    {
      id: 'PR-10691',
      items: [createCartItem(products[2])],
      customerName: 'Karl Tamm',
      customerEmail: 'karl.tamm@example.com',
      delivery: 'Omniva · Tallinna Viru Keskuse pakiautomaat',
      productSubtotal: 45,
      total: 47.9,
      createdAt: createdAt(3, 11),
      status: 'fulfilled',
    },
    {
      id: 'PR-10694',
      items: [createCartItem(products[0]), createCartItem(products[3], 1, { Suurus: 'Keskmine' }), createCartItem(products[4])],
      customerName: 'Triin Rebane',
      customerEmail: 'triin.rebane@example.com',
      delivery: 'Kuller · Rüütli 18, Pärnu',
      productSubtotal: 68,
      total: 72.9,
      createdAt: createdAt(4, 13),
      status: 'fulfilled',
    },
    {
      id: 'PR-10687',
      items: [createCartItem(products[5], 1, { Värv: 'Hõbedane' })],
      customerName: 'Sander Kivi',
      customerEmail: 'sander.kivi@example.com',
      delivery: 'Omniva · Viljandi Uku keskuse pakiautomaat',
      productSubtotal: 29,
      total: 31.9,
      createdAt: createdAt(5, 9),
      status: 'refunded',
    },
    {
      id: 'PR-10684',
      items: [createCartItem(products[1], 1, { Värv: 'Roheline' })],
      customerName: 'Anna Saar',
      customerEmail: 'anna.saar@example.com',
      delivery: 'DPD · Pärnu Kaubamajaka pakiautomaat',
      productSubtotal: 32,
      total: 34.9,
      createdAt: createdAt(6, 16),
      status: 'refunded',
    },
  ]
}
const MAX_PRODUCT_IMAGES = 3
const PLATFORM_FEE_RATE = 0.04
const PLATFORM_FEE_CAP = 39
const FIXED_PLAN_MONTHLY_FEE = 29
const FIXED_PLAN_TRIAL_DAYS = 30
export type PricingPlan = 'flexible' | 'fixed'
type StoreTheme = 'midnight' | 'paper' | 'pop'
type BuyButtonSize = 'small' | 'medium' | 'large'
type SaleBadgeStyle = 'quirky' | 'classic' | 'price' | 'elegant' | 'minimal'
type AnnouncementSpeed = 'slow' | 'normal' | 'fast'
type AnnouncementDirection = 'left' | 'right'
type EditImageUpload = {
  id: string
  file: File
  previewUrl: string
  mode: 'add' | 'replace'
  previousUrl?: string
  phase: ImageUploadPhase | 'error'
  slow: boolean
  error?: string
}
export type PaymentProvider = 'stripe' | 'montonio'
type SettingsSection = 'store' | 'appearance' | 'payments' | 'delivery' | 'business' | 'links' | 'notifications' | 'billing' | 'account'
type CustomDomainStatus = 'idle' | CustomDomainRecord['status']
const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string; description: string }> = [
  { id: 'store', label: 'Pood', description: 'Põhiandmed ja nähtavus' },
  { id: 'appearance', label: 'Kujundus', description: 'Logo, värvid ja stiil' },
  { id: 'payments', label: 'Maksed', description: 'Makseviisid ja ühendused' },
  { id: 'delivery', label: 'Tarne', description: 'Pakiautomaadid ja hinnad' },
  { id: 'business', label: 'Müüja', description: 'Ettevõtte andmed' },
  { id: 'links', label: 'Lingid', description: 'Kontakt ja sotsiaalmeedia' },
  { id: 'notifications', label: 'Teavitused', description: 'E-kirjad ja märguanded' },
  { id: 'billing', label: 'Plaan ja arved', description: 'Pakett, tasud ja arved' },
  { id: 'account', label: 'Konto', description: 'Väljalogimine ja kustutamine' },
]

function SettingsSectionIcon({ section }: { section: SettingsSection }) {
  const paths: Record<SettingsSection, string> = {
    store: 'M3 10 12 3l9 7v10H3V10Zm6 10v-6h6v6',
    appearance: 'M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 0-4H12a2 2 0 0 1 0-4h5.5A3.5 3.5 0 0 0 21 9.5C21 5.9 17 3 12 3Z',
    payments: 'M3 6h18v12H3V6Zm0 4h18M7 15h4',
    delivery: 'M3 7h11v10H3V7Zm11 4h4l3 3v3h-7v-6ZM7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
    business: 'M4 21V7l8-4 8 4v14M8 10h2m4 0h2m-8 4h2m4 0h2m-5 7v-4h2v4',
    links: 'M10 13a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7L11.2 6M14 11a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 1 0 5.7 5.7l1.6-1.5',
    notifications: 'M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Zm-8 12h4',
    billing: 'M5 3h14v18l-2-1.5L15 21l-3-1.5L9 21l-2-1.5L5 21V3Zm4 5h6m-6 4h6m-6 4h4',
    account: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 9a7 7 0 0 0-14 0',
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[section]} /></svg>
}
type DeliverySettings = {
  parcelProviders: Record<ShippingProvider, { enabled: boolean; price: number }>
  courierEnabled: boolean
  pickupEnabled: boolean
  courierPrice: number
  freeShippingFrom: number
  pickupAddress: string
}

export function BillingCardDemo({ onClose, onConfirm, confirmLabel = 'Jätka Stripe’is' }: { onClose: () => void; onConfirm: (checkoutRequestId: string) => Promise<void>; confirmLabel?: string }) {
  const [isConfirming, setIsConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState('')
  const [billingDragY, setBillingDragY] = useState(0)
  const [isBillingDragging, setIsBillingDragging] = useState(false)
  const [hasBillingDragged, setHasBillingDragged] = useState(false)
  const billingDragStartRef = useRef<number | null>(null)
  const billingTouchStartRef = useRef<number | null>(null)
  const billingTouchCurrentRef = useRef(0)
  const billingDragAreaRef = useRef<HTMLDivElement>(null)
  const billingCloseTimerRef = useRef<number | null>(null)
  const checkoutRequestIdRef = useRef(createCheckoutRequestId())
  const trialStartsAt = new Date()
  const firstPaymentAt = new Date(trialStartsAt)
  firstPaymentAt.setDate(firstPaymentAt.getDate() + FIXED_PLAN_TRIAL_DAYS)
  const firstPaymentLabel = firstPaymentAt.toLocaleDateString('et-EE', { day: '2-digit', month: '2-digit', year: 'numeric' })

  const confirm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isConfirming) return
    setIsConfirming(true)
    setConfirmError('')
    try { await onConfirm(checkoutRequestIdRef.current) }
    catch (error) { setConfirmError(error instanceof Error ? error.message : 'Stripe’i arvelduse avamine ebaõnnestus.'); setIsConfirming(false) }
  }

  useEffect(() => () => {
    if (billingCloseTimerRef.current !== null) window.clearTimeout(billingCloseTimerRef.current)
  }, [])

  useEffect(() => {
    const handle = billingDragAreaRef.current
    if (!handle) return
    const startTouchDrag = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!touch) return
      event.preventDefault()
      billingTouchStartRef.current = touch.clientY
      billingTouchCurrentRef.current = touch.clientY
      setHasBillingDragged(true)
      setIsBillingDragging(true)
    }
    const moveTouchDrag = (event: TouchEvent) => {
      if (billingTouchStartRef.current === null) return
      const touch = event.touches[0]
      if (!touch) return
      event.preventDefault()
      billingTouchCurrentRef.current = touch.clientY
      setBillingDragY(Math.max(0, touch.clientY - billingTouchStartRef.current))
    }
    const finishTouchDrag = (event: TouchEvent) => {
      if (billingTouchStartRef.current === null) return
      event.preventDefault()
      const distance = Math.max(0, billingTouchCurrentRef.current - billingTouchStartRef.current)
      billingTouchStartRef.current = null
      setIsBillingDragging(false)
      if (distance >= Math.min(120, window.innerHeight * .12)) {
        setBillingDragY(window.innerHeight)
        billingCloseTimerRef.current = window.setTimeout(onClose, 260)
        return
      }
      setBillingDragY(0)
    }
    const cancelTouchDrag = (event: TouchEvent) => {
      if (billingTouchStartRef.current === null) return
      event.preventDefault()
      billingTouchStartRef.current = null
      setIsBillingDragging(false)
      setBillingDragY(0)
    }
    const options: AddEventListenerOptions = { passive: false }
    handle.addEventListener('touchstart', startTouchDrag, options)
    handle.addEventListener('touchmove', moveTouchDrag, options)
    handle.addEventListener('touchend', finishTouchDrag, options)
    handle.addEventListener('touchcancel', cancelTouchDrag, options)
    return () => {
      handle.removeEventListener('touchstart', startTouchDrag)
      handle.removeEventListener('touchmove', moveTouchDrag)
      handle.removeEventListener('touchend', finishTouchDrag)
      handle.removeEventListener('touchcancel', cancelTouchDrag)
    }
  }, [onClose])

  const startBillingDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!window.matchMedia('(max-width: 599px)').matches) return
    if (event.pointerType === 'touch') return
    billingDragStartRef.current = event.clientY
    setHasBillingDragged(true)
    setIsBillingDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveBillingDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (billingDragStartRef.current === null) return
    setBillingDragY(Math.max(0, event.clientY - billingDragStartRef.current))
  }

  const endBillingDrag = (event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    if (billingDragStartRef.current === null) return
    const distance = Math.max(0, event.clientY - billingDragStartRef.current)
    billingDragStartRef.current = null
    setIsBillingDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!cancelled && distance >= Math.min(120, window.innerHeight * .12)) {
      setBillingDragY(window.innerHeight)
      billingCloseTimerRef.current = window.setTimeout(onClose, 260)
      return
    }
    setBillingDragY(0)
  }

  return <div className="overlay login-overlay billing-card-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className={`login-sheet billing-card-demo${isBillingDragging ? ' is-dragging' : ''}${hasBillingDragged ? ' has-dragged' : ''}`} style={hasBillingDragged ? { transform: `translateY(${billingDragY}px)` } : undefined} role="dialog" aria-modal="true" aria-label="Poeruumi Kindla paketi aktiveerimine">
      <div ref={billingDragAreaRef} className="billing-card-demo__drag-area" aria-hidden="true" onPointerDown={startBillingDrag} onPointerMove={moveBillingDrag} onPointerUp={(event) => endBillingDrag(event)} onPointerCancel={(event) => endBillingDrag(event, true)}><span className="billing-card-demo__handle" /></div>
      <button className="login-sheet__close" type="button" onClick={onClose} aria-label="Sulge"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
      <span className="login-sheet__eyebrow">KINDEL · 30 PÄEVA TASUTA</span>
      <div className="billing-card-demo__title">
        <span className="billing-card-demo__visual" aria-hidden="true">
          <svg viewBox="0 0 64 48">
            <rect className="billing-card-demo__visual-card" x="2" y="5" width="60" height="38" rx="9" />
            <path className="billing-card-demo__visual-stripe" d="M3 15h58" />
            <rect className="billing-card-demo__visual-chip" x="11" y="21" width="14" height="10" rx="2" />
            <path className="billing-card-demo__visual-chip-line" d="M18 21v10M11 26h14" />
            <g className="billing-card-demo__visual-contactless">
              <path d="M43 23c3 2 3 6 0 8" />
              <path d="M47 20c6 4 6 11 0 15" />
              <path d="M51 17c9 6 9 15 0 21" />
            </g>
          </svg>
        </span>
        <h2>Aktiveeri Kindel pakett</h2>
      </div>
      <div className="billing-card-demo__summary">
        <div className="billing-card-demo__today"><span>Täna tasuda</span><strong>0 €</strong></div>
        <div className="billing-card-demo__next-payment">
          <i aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="14" rx="3" /><path d="M8 4v4M16 4v4M4 10h16" /></svg></i>
          <span><small>Järgmine makse</small><strong>{firstPaymentLabel}</strong></span>
          <b>29 € / kuu + km</b>
        </div>
      </div>
      <form onSubmit={confirm}>
        <label className="billing-card-demo__consent"><input required type="checkbox" defaultChecked /><span>Nõustun pärast prooviperioodi 29 € + km kuutasuga.</span></label>
        {confirmError && <p className="add-product-error" role="alert">{confirmError}</p>}
        <button type="submit" disabled={isConfirming}>{isConfirming ? 'Kinnitan…' : confirmLabel}<span aria-hidden="true">{isConfirming ? '◌' : '→'}</span></button>
      </form>
      <small className="billing-card-demo__note"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" /></svg><span>Kaardiandmed sisestad turvaliselt Stripe’is</span></small>
    </section>
  </div>
}

const SHIPPING_PROVIDERS: ShippingProvider[] = ['omniva', 'dpd', 'smartposti']
const SHIPPING_PROVIDER_LABELS: Record<ShippingProvider, string> = {
  omniva: 'Omniva',
  dpd: 'DPD',
  smartposti: 'SmartPosti',
}

const normalizeSearch = (value: string) => value
  .toLocaleLowerCase('et')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')

const createUrlSlug = (value: string) => normalizeSearch(value)
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 60)

const createParcelMachine = (provider: ShippingProvider, id: string, city: string, name: string, address?: string): ParcelMachine => ({
  provider,
  id,
  city,
  name,
  address,
  searchText: normalizeSearch(`${SHIPPING_PROVIDER_LABELS[provider]} ${city} ${name} ${address ?? ''} ${id}`),
})

const demoParcelMachines: ParcelMachine[] = [
  createParcelMachine('omniva', 'omniva:demo-1', 'Tallinn', 'Viru Keskuse pakiautomaat'),
  createParcelMachine('dpd', 'dpd:demo-1', 'Tallinn', 'Kristiine Keskuse pakiautomaat'),
  createParcelMachine('smartposti', 'smartposti:demo-1', 'Tallinn', 'Ülemiste Keskuse pakiautomaat'),
  createParcelMachine('omniva', 'omniva:demo-2', 'Tartu', 'Lõunakeskuse pakiautomaat'),
  createParcelMachine('dpd', 'dpd:demo-2', 'Tartu', 'Kvartali pakiautomaat'),
  createParcelMachine('smartposti', 'smartposti:demo-2', 'Pärnu', 'Kaubamajaka pakiautomaat'),
]

const normalizeExternalUrl = (value: string) => {
  const url = value.trim()
  if (!url) return ''
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

const findParcelMachines = (machines: ParcelMachine[], query: string) => {
  const terms = normalizeSearch(query).trim().split(/\s+/).filter(Boolean)
  if (!terms.length) return machines.slice(0, 8)

  return machines
    .filter((machine) => terms.every((term) => machine.searchText.includes(term)))
    .sort((a, b) => {
      const queryStart = terms[0]
      const aStarts = normalizeSearch(a.city).startsWith(queryStart) || normalizeSearch(a.name).startsWith(queryStart)
      const bStarts = normalizeSearch(b.city).startsWith(queryStart) || normalizeSearch(b.name).startsWith(queryStart)
      return Number(bStarts) - Number(aStarts) || a.city.localeCompare(b.city, 'et') || a.name.localeCompare(b.name, 'et')
    })
    .slice(0, 8)
}

function Cart({ storeId, items, initialStep, paymentProvider, paymentsReady, deliverySettings, onRemove, onQuantityChange, onClose }: { storeId?: string; items: CartItem[]; initialStep: 'cart' | 'checkout'; paymentProvider: PaymentProvider; paymentsReady: boolean; deliverySettings: DeliverySettings; onRemove: (cartKey: string) => void; onQuantityChange: (cartKey: string, quantity: number) => void; onClose: () => void }) {
  const checkoutRef = useRef<HTMLElement>(null)
  const checkoutRequestIdRef = useRef(createCheckoutRequestId())
  const [step, setStep] = useState<'cart' | 'checkout'>(initialStep)
  const enabledParcelProviders = SHIPPING_PROVIDERS.filter((provider) => deliverySettings.parcelProviders[provider].enabled)
  const enabledParcelProviderKey = enabledParcelProviders.join(',')
  const parcelEnabled = enabledParcelProviders.length > 0
  const [delivery, setDelivery] = useState<'parcel' | 'courier' | 'pickup'>(() => parcelEnabled ? 'parcel' : deliverySettings.courierEnabled ? 'courier' : 'pickup')
  const [parcelMachines, setParcelMachines] = useState<ParcelMachine[]>(() => demoParcelMachines.filter((machine) => enabledParcelProviders.includes(machine.provider)))
  const [parcelQuery, setParcelQuery] = useState('')
  const [selectedParcelId, setSelectedParcelId] = useState('')
  const [isParcelSearchOpen, setIsParcelSearchOpen] = useState(false)
  const [activeParcelIndex, setActiveParcelIndex] = useState(0)
  const [parcelLoadFailed, setParcelLoadFailed] = useState(false)
  const [courierAddress, setCourierAddress] = useState('')
  const [courierCity, setCourierCity] = useState('')
  const [courierPostalCode, setCourierPostalCode] = useState('')
  const [courierAddressResults, setCourierAddressResults] = useState<AksAddress[]>([])
  const [isCourierAddressOpen, setIsCourierAddressOpen] = useState(false)
  const [selectedCourierAddressId, setSelectedCourierAddressId] = useState('')
  const [isPaying, setIsPaying] = useState(false)
  const [paymentError, setPaymentError] = useState('')
  const itemTotal = items.reduce((sum, item) => sum + getProductPrice(item) * item.quantity, 0)
  const selectedParcelMachine = parcelMachines.find((machine) => machine.id === selectedParcelId)
  const defaultParcelPrice = enabledParcelProviders.length
    ? Math.min(...enabledParcelProviders.map((provider) => deliverySettings.parcelProviders[provider].price))
    : 0
  const baseDeliveryPrice = delivery === 'parcel'
    ? selectedParcelMachine ? deliverySettings.parcelProviders[selectedParcelMachine.provider].price : defaultParcelPrice
    : delivery === 'courier' ? deliverySettings.courierPrice : 0
  const deliveryPrice = deliverySettings.freeShippingFrom > 0 && itemTotal >= deliverySettings.freeShippingFrom ? 0 : baseDeliveryPrice
  const orderTotal = itemTotal + deliveryPrice
  const vatAmount = orderTotal * 24 / 124

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  useEffect(() => {
    if (step !== 'checkout' || delivery !== 'parcel') return
    const controller = new AbortController()
    const requests: Promise<ParcelMachine[]>[] = []

    if (enabledParcelProviders.includes('omniva')) requests.push(fetch('https://www.omniva.ee/locations.json', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Omniva vastas ${response.status}`)
        return response.json()
      })
      .then((locations: OmnivaLocation[]) => locations
        .filter((location) => location.A0_NAME === 'EE' && location.TYPE === '0' && !location.NAME.toLowerCase().includes('picapac'))
        .map((location) => {
          const city = location.A3_NAME || location.A2_NAME || location.A1_NAME
          return createParcelMachine('omniva', `omniva:${location.ZIP}`, city, location.NAME)
        })))

    if (enabledParcelProviders.some((provider) => provider !== 'omniva')) requests.push(fetch('/data/parcel-machines.json', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Pakiautomaatide nimekiri vastas ${response.status}`)
        return response.json()
      })
      .then((machines: Array<Omit<ParcelMachine, 'searchText'>>) => machines
        .filter((machine) => enabledParcelProviders.includes(machine.provider))
        .map((machine) => createParcelMachine(machine.provider, machine.id, machine.city, machine.name, machine.address))))

    Promise.allSettled(requests).then((results) => {
      if (controller.signal.aborted) return
      const machines = results.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
        .sort((a, b) => a.city.localeCompare(b.city, 'et') || a.name.localeCompare(b.name, 'et'))
      setParcelLoadFailed(results.some((result) => result.status === 'rejected'))
      setParcelMachines(machines.length ? machines : demoParcelMachines.filter((machine) => enabledParcelProviders.includes(machine.provider)))
    })
    return () => controller.abort()
  }, [step, delivery, enabledParcelProviderKey])

  useEffect(() => {
    if (delivery !== 'courier' || courierAddress.trim().length < 3 || selectedCourierAddressId) {
      setCourierAddressResults([])
      return
    }
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams({ address: courierAddress.trim(), results: '8' })
      fetch(`https://aks.geoportaal.ee/inaks/inaadress/gazetteer?${params}`, { signal: controller.signal })
        .then((response) => response.json())
        .then((data: { addresses?: AksAddress[] }) => setCourierAddressResults((data.addresses ?? [])
          .filter((address) => ['EHITISHOONE', 'EHITISHOONEOSA', 'HOONEOSA'].includes(address.liikVal))
          .slice(0, 6)))
        .catch((error) => { if (error.name !== 'AbortError') setCourierAddressResults([]) })
    }, 280)
    return () => { window.clearTimeout(timeout); controller.abort() }
  }, [delivery, courierAddress, selectedCourierAddressId])

  const parcelResults = findParcelMachines(parcelMachines, parcelQuery)
  const selectParcelMachine = (machine: ParcelMachine) => {
    setSelectedParcelId(machine.id)
    setParcelQuery(`${SHIPPING_PROVIDER_LABELS[machine.provider]} · ${machine.city} · ${machine.name}`)
    setIsParcelSearchOpen(false)
  }

  const keepContactFieldVisible = (field: HTMLInputElement) => {
    const revealField = () => {
      const checkout = checkoutRef.current
      if (!checkout || !field.isConnected) return

      const checkoutRect = checkout.getBoundingClientRect()
      const fieldRect = field.getBoundingClientRect()
      const viewport = window.visualViewport
      const visibleTop = Math.max(checkoutRect.top, viewport?.offsetTop ?? 0) + 16
      const visibleBottom = Math.min(checkoutRect.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight)) - 20

      if (fieldRect.top < visibleTop) checkout.scrollTop -= visibleTop - fieldRect.top
      else if (fieldRect.bottom > visibleBottom) checkout.scrollTop += fieldRect.bottom - visibleBottom
    }

    window.requestAnimationFrame(() => window.requestAnimationFrame(revealField))
    window.setTimeout(revealField, 180)
    window.setTimeout(revealField, 420)
  }

  const completeCheckout = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isPaying) return
    const data = new FormData(event.currentTarget)
    const deliveryLabel = delivery === 'parcel' ? parcelQuery : delivery === 'courier' ? [courierAddress, courierCity, courierPostalCode].filter(Boolean).join(', ') : 'Tulen ise järele'
    if (paymentProvider !== 'stripe') {
      setPaymentError('See makseviis ei ole praegu saadaval.')
      return
    }
    if (!storeId) { setPaymentError('Päris makse jaoks peab pood olema serverisse salvestatud.'); return }
    setIsPaying(true)
    setPaymentError('')
    try {
      const url = await startStripeStoreCheckout({
        storeId,
        checkoutRequestId: checkoutRequestIdRef.current,
        items: items.map((item) => ({ id: item.id, quantity: item.quantity, selectedOptions: item.selectedOptions })),
        customer: { name: String(data.get('customerName')), email: String(data.get('customerEmail')), phone: String(data.get('customerPhone')) },
        delivery: { type: delivery, provider: selectedParcelMachine?.provider, label: deliveryLabel },
      })
      window.location.assign(url)
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : 'Makse algatamine ebaõnnestus.')
      checkoutRequestIdRef.current = createCheckoutRequestId()
      setIsPaying(false)
    }
  }

  return (
    <div className="overlay cart-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={checkoutRef} className="checkout" role="dialog" aria-modal="true" aria-label="Ostukorv">
        <button className="checkout__close" onClick={onClose} aria-label="Sulge">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
        <h2>{step === 'cart' ? 'Ostukorv' : 'Vormista tellimus'}</h2>
        {items.length === 0 ? <p className="cart-empty">Ostukorv on tühi.</p> : <>
          {step === 'cart' ? <>
            <div className="cart-items">
              {items.map((item) => (
                <div className="cart-item" key={item.cartKey}>
                  <img {...getResponsiveImageProps(item, item.image, 'thumb')} sizes="8rem" alt={item.alt} />
                  <div className="cart-item__copy">
                    <strong>{item.name}</strong>
                    {Object.keys(item.selectedOptions).length > 0 && <small>{Object.entries(item.selectedOptions).map(([name, value]) => `${name}: ${value}`).join(' · ')}</small>}
                    <span>{formatEuro(getProductPrice(item) * item.quantity)}</span>
                    <div className="cart-item__quantity" role="group" aria-label={`${item.name} kogus`}>
                      <button type="button" onClick={() => onQuantityChange(item.cartKey, item.quantity - 1)} aria-label="Vähenda kogust">−</button>
                      <output aria-live="polite">{item.quantity}</output>
                      <button type="button" disabled={items.filter((candidate) => candidate.id === item.id).reduce((sum, candidate) => sum + candidate.quantity, 0) >= getProductStockLimit(item)} onClick={() => onQuantityChange(item.cartKey, item.quantity + 1)} aria-label="Suurenda kogust">+</button>
                    </div>
                  </div>
                  <button className="cart-item__remove" onClick={() => onRemove(item.cartKey)} aria-label="Eemalda ostukorvist">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg>
                  </button>
                </div>
              ))}
            </div>
            <div className="cart-total"><span>Kokku</span><strong>{itemTotal} €</strong></div>
            <button className="pay" type="button" onClick={() => setStep('checkout')}>Vormista tellimus</button>
          </> : <form onSubmit={completeCheckout}>
            <label>Nimi<input required name="customerName" autoComplete="name" onFocus={(event) => keepContactFieldVisible(event.currentTarget)} onInput={(event) => keepContactFieldVisible(event.currentTarget)} /></label>
            <label>E-post<input required name="customerEmail" type="email" autoComplete="email" onFocus={(event) => keepContactFieldVisible(event.currentTarget)} onInput={(event) => keepContactFieldVisible(event.currentTarget)} /></label>
            <label>Telefon<input required name="customerPhone" type="tel" autoComplete="tel" onFocus={(event) => keepContactFieldVisible(event.currentTarget)} onInput={(event) => keepContactFieldVisible(event.currentTarget)} /></label>
            <fieldset className="payment delivery">
              <legend>Tarneviis</legend>
              <div className="payment-tabs">
                {parcelEnabled && <button type="button" className={delivery === 'parcel' ? 'is-selected' : ''} onClick={() => setDelivery('parcel')}>Pakiautomaat</button>}
                {deliverySettings.courierEnabled && <button type="button" className={delivery === 'courier' ? 'is-selected' : ''} onClick={() => setDelivery('courier')}>Kuller</button>}
                {deliverySettings.pickupEnabled && <button type="button" className={delivery === 'pickup' ? 'is-selected' : ''} onClick={() => setDelivery('pickup')}>Tulen ise järele</button>}
              </div>
              {delivery === 'parcel' ? <div className="parcel-select">
                <label htmlFor="parcel-search">Pakiautomaat</label>
                <div className="parcel-combobox">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>
                  <input
                    id="parcel-search"
                    value={parcelQuery}
                    autoComplete="off"
                    placeholder="Otsi linna või pakiautomaati"
                    role="combobox"
                    aria-expanded={isParcelSearchOpen}
                    aria-controls="parcel-results"
                    aria-autocomplete="list"
                    onFocus={() => setIsParcelSearchOpen(true)}
                    onBlur={() => window.setTimeout(() => setIsParcelSearchOpen(false), 150)}
                    onChange={(event) => {
                      setParcelQuery(event.target.value)
                      setSelectedParcelId('')
                      setActiveParcelIndex(0)
                      setIsParcelSearchOpen(true)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown') { event.preventDefault(); setActiveParcelIndex((index) => Math.min(index + 1, parcelResults.length - 1)) }
                      if (event.key === 'ArrowUp') { event.preventDefault(); setActiveParcelIndex((index) => Math.max(index - 1, 0)) }
                      if (event.key === 'Enter' && isParcelSearchOpen && parcelResults[activeParcelIndex]) { event.preventDefault(); selectParcelMachine(parcelResults[activeParcelIndex]) }
                      if (event.key === 'Escape') setIsParcelSearchOpen(false)
                    }}
                  />
                  {parcelQuery && <button type="button" aria-label="Tühjenda otsing" onMouseDown={(event) => event.preventDefault()} onClick={() => { setParcelQuery(''); setSelectedParcelId(''); setActiveParcelIndex(0); setIsParcelSearchOpen(true) }}>×</button>}
                  <select className="parcel-required" required value={selectedParcelId} onChange={() => undefined} aria-label="Valitud pakiautomaat" tabIndex={-1}>
                    <option value="" />
                    {selectedParcelId && <option value={selectedParcelId}>{selectedParcelId}</option>}
                  </select>
                </div>
                {isParcelSearchOpen && <div className="parcel-results" id="parcel-results" role="listbox">
                  {parcelResults.length ? parcelResults.map((machine, index) => <button
                    type="button"
                    role="option"
                    aria-selected={machine.id === selectedParcelId}
                    className={index === activeParcelIndex ? 'is-active' : ''}
                    key={machine.id}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveParcelIndex(index)}
                    onClick={() => selectParcelMachine(machine)}
                  ><strong>{machine.city}</strong><span>{machine.name}</span><small>{SHIPPING_PROVIDER_LABELS[machine.provider]} · {formatEuro(deliverySettings.parcelProviders[machine.provider].price)}</small></button>) : <p>Sellist pakiautomaati ei leidnud.</p>}
                </div>}
                {parcelLoadFailed && <p className="parcel-status">Kõiki pakiautomaate ei õnnestunud laadida.</p>}
                {!selectedParcelId && parcelMachines.length > 0 && <small>Kirjuta näiteks „Tartu Lõunakeskus“.</small>}
              </div> : delivery === 'courier' ? <div className="courier-fields">
                <label className="courier-address">Aadress<input required autoComplete="off" placeholder="Tänav, maja ja korter" value={courierAddress} onFocus={() => setIsCourierAddressOpen(true)} onBlur={() => window.setTimeout(() => setIsCourierAddressOpen(false), 150)} onChange={(event) => { setCourierAddress(event.target.value); setSelectedCourierAddressId(''); setIsCourierAddressOpen(true) }} />
                  <select className="parcel-required" required value={selectedCourierAddressId} onChange={() => undefined} aria-label="Kinnitatud kulleriaadress" tabIndex={-1}>
                    <option value="" />
                    {selectedCourierAddressId && <option value={selectedCourierAddressId}>{selectedCourierAddressId}</option>}
                  </select>
                  {isCourierAddressOpen && courierAddressResults.length > 0 && <div className="courier-address__results">
                    {courierAddressResults.map((address) => <button type="button" key={address.adr_id} onMouseDown={(event) => event.preventDefault()} onClick={() => {
                      setCourierAddress(address.ipikkaadress || address.aadresstekst)
                      setCourierCity(address.omavalitsus || address.asustusyksus)
                      setCourierPostalCode(address.sihtnumber)
                      setSelectedCourierAddressId(address.adr_id)
                      setIsCourierAddressOpen(false)
                    }}><strong>{address.aadresstekst}</strong><span>{[address.asustusyksus, address.omavalitsus, address.sihtnumber].filter(Boolean).join(' · ')}</span></button>)}
                  </div>}
                </label>
                <div><label>Linn<input required autoComplete="address-level2" value={courierCity} onChange={(event) => setCourierCity(event.target.value)} /></label><label>Sihtnumber<input required inputMode="numeric" autoComplete="postal-code" value={courierPostalCode} onChange={(event) => setCourierPostalCode(event.target.value)} /></label></div>
                <small>Vali täpne aadress soovituste seast · {deliverySettings.courierPrice.toFixed(2).replace('.', ',')} €</small>
              </div> : <div className="pickup-note"><strong>{deliverySettings.pickupAddress || 'Järeletulemise aadress täpsustamisel'}</strong><span>Järeletulemise aeg lepitakse kokku pärast tellimust.</span></div>}
            </fieldset>
            {!paymentsReady || paymentProvider !== 'stripe' ? <div className="payment-pending"><span>…</span><div><strong>Maksed pole veel aktiivsed</strong><small>Poe omanik peab enne ostude vastuvõtmist Stripe’i ühendama.</small></div></div> : <fieldset className="payment stripe-payment">
              <legend>Makseviis</legend>
              <div className="stripe-payment__card">
                <div className="stripe-secure"><span>⌁</span><strong>Turvaline makse Stripe’is</strong><small>Kaart · Apple Pay · Google Pay</small></div>
                <small>Pärast tellimuse kinnitamist avaneb Stripe’i turvaline makseleht. Poeruum ei näe ega salvesta sinu kaardiandmeid.</small>
              </div>
            </fieldset>}
            <div className="checkout-summary">
              {items.map((item) => (
                <div className="summary-item" key={item.cartKey}>
                  <span>{item.name}{item.quantity > 1 ? ` × ${item.quantity}` : ''}{Object.keys(item.selectedOptions).length ? ` · ${Object.values(item.selectedOptions).join(', ')}` : ''}</span>
                  <span>{formatEuro(getProductPrice(item) * item.quantity)}</span>
                </div>
              ))}
              <div><span>Tarne</span><span>{deliveryPrice.toFixed(2).replace('.', ',')} €</span></div>
              <strong><span>Kokku</span><span>{orderTotal.toFixed(2).replace('.', ',')} €</span></strong>
              <div className="vat-row"><span>sh käibemaks 24%</span><span>{vatAmount.toFixed(2).replace('.', ',')} €</span></div>
              <small>Hinnad sisaldavad käibemaksu.</small>
            </div>
            {paymentError && <p className="add-product-error" role="alert">{paymentError}</p>}
            <button className="pay" type="submit" disabled={isPaying || !paymentsReady || paymentProvider !== 'stripe'}>{!paymentsReady || paymentProvider !== 'stripe' ? 'Maksed pole aktiivsed' : isPaying ? 'Töötlen makset…' : `Maksa ${orderTotal.toFixed(2).replace('.', ',')} €`}</button>
            <button className="checkout-back" type="button" onClick={() => setStep('cart')}>Tagasi ostukorvi</button>
          </form>}
        </>}
      </section>
    </div>
  )
}

export type StorefrontProps = {
  storeId?: string
  seedProducts?: Product[]
  storeName?: string
  storeSlug?: string
  theme?: StoreTheme
  paymentProvider?: PaymentProvider
  paymentsReady?: boolean
  initialShipping?: string[]
  merchantMode?: boolean
  adminDemoMode?: boolean
  pricingPlan?: PricingPlan
  fixedPlanTrialStartedAt?: string | null
  onConnectPaymentProvider?: (provider: PaymentProvider) => void
  onStoreChange?: (store: StoreRecord) => void
  onAccountDeleted?: () => void
  ownerEmail?: string
  onOwnerLogin?: (email: string, password: string) => Promise<void>
  onBackToSetup?: () => void
  onExit?: () => void
  initialSettings?: Record<string, unknown>
}

export function Storefront({ storeId, seedProducts = products, storeName = 'POERUUM', storeSlug, theme = 'midnight', paymentProvider = 'stripe', paymentsReady = true, initialShipping, merchantMode = false, adminDemoMode = false, pricingPlan = 'flexible', fixedPlanTrialStartedAt: initialFixedPlanTrialStartedAt, onConnectPaymentProvider, onStoreChange, onAccountDeleted, ownerEmail = '', onOwnerLogin, onBackToSetup, onExit, initialSettings = {} }: StorefrontProps = {}) {
  const isPublicDemo = Boolean(onExit && !merchantMode)
  const hasPreviewBar = Boolean(onExit && (!merchantMode || adminDemoMode))
  const trackRef = useRef<HTMLDivElement>(null)
  const activeIndexRef = useRef(0)
  const logoTapCountRef = useRef(0)
  const logoTapTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const storeLogoObjectUrlRef = useRef<string | null>(null)
  const storeAboutImageObjectUrlRef = useRef<string | null>(null)
  const storeDescriptionInputRef = useRef<HTMLTextAreaElement>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [cart, setCart] = useState<CartItem[]>([])
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [cartStep, setCartStep] = useState<'cart' | 'checkout'>('cart')
  const [addedProductId, setAddedProductId] = useState<string | null>(null)
  const [isScreensaverActive, setIsScreensaverActive] = useState(false)
  const [selectedImages, setSelectedImages] = useState<Record<string, number>>({})
  const [selectedProductOptions, setSelectedProductOptions] = useState<Record<string, Record<string, string>>>({})
  const [isLoginOpen, setIsLoginOpen] = useState(false)
  const [loginEmail, setLoginEmail] = useState(ownerEmail)
  const [isOwnerLoginBusy, setIsOwnerLoginBusy] = useState(false)
  const [loginRecoveryMessage, setLoginRecoveryMessage] = useState('')
  const [isLoggedIn, setIsLoggedIn] = useState(merchantMode)
  const [isCustomerPreview, setIsCustomerPreview] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isSettingsHome, setIsSettingsHome] = useState(true)
  const [settingsSaveStatus, setSettingsSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [settingsHydrated, setSettingsHydrated] = useState(!storeId)
  const savedSettingsSnapshotRef = useRef('')
  const [isAboutOpen, setIsAboutOpen] = useState(false)
  const [isSetupChecklistOpen, setIsSetupChecklistOpen] = useState(true)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('store')
  const [isOrdersOpen, setIsOrdersOpen] = useState(false)
  const [orders, setOrders] = useState<DemoOrder[]>(() => merchantMode && !storeId ? createDemoOrders() : [])
  const [orderLayout, setOrderLayout] = useState<'grid' | 'list'>('grid')
  const [orderSearch, setOrderSearch] = useState('')
  const [storeTheme, setStoreTheme] = useState<StoreTheme>(theme)
  const [storeAccent, setStoreAccent] = useState('#e5f25a')
  const [buyButtonSize, setBuyButtonSize] = useState<BuyButtonSize>('medium')
  const [saleBadgeStyle, setSaleBadgeStyle] = useState<SaleBadgeStyle>('quirky')
  const [announcementEnabled, setAnnouncementEnabled] = useState(false)
  const [announcementText, setAnnouncementText] = useState('Tasuta tarne alates 50 €')
  const [announcementLink, setAnnouncementLink] = useState('')
  const [announcementSpeed, setAnnouncementSpeed] = useState<AnnouncementSpeed>('normal')
  const [announcementDirection, setAnnouncementDirection] = useState<AnnouncementDirection>('left')
  const [announcementBackground, setAnnouncementBackground] = useState('#e5f25a')
  const [announcementColor, setAnnouncementColor] = useState('#111111')
  const [storeLogo, setStoreLogo] = useState<string | null>(null)
  const [editableStoreName, setEditableStoreName] = useState(storeName)
  const [storeTagline, setStoreTagline] = useState('')
  const [storeDescription, setStoreDescription] = useState(() => storeSlug ? '' : 'Hoolikalt valitud esemed, mis muudavad argipäeva natuke põnevamaks.')
  const [storeAboutImage, setStoreAboutImage] = useState<string | null>(null)
  const [isStoreVisible, setIsStoreVisible] = useState(true)
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [instagramUrl, setInstagramUrl] = useState('')
  const [facebookUrl, setFacebookUrl] = useState('')
  const [tiktokUrl, setTiktokUrl] = useState('')
  const [activePaymentProvider, setActivePaymentProvider] = useState<PaymentProvider>(paymentProvider)
  const [deliverySettings, setDeliverySettings] = useState<DeliverySettings>(() => {
    const selectedShipping = new Set(initialShipping ?? [...SHIPPING_PROVIDERS, 'courier', 'pickup'])
    return {
      parcelProviders: {
        omniva: { enabled: selectedShipping.has('omniva'), price: 2.9 },
        dpd: { enabled: selectedShipping.has('dpd'), price: 2.9 },
        smartposti: { enabled: selectedShipping.has('smartposti'), price: 2.9 },
      },
      courierEnabled: selectedShipping.has('courier'),
      pickupEnabled: selectedShipping.has('pickup'),
      courierPrice: 4.9,
      freeShippingFrom: 50,
      pickupAddress: 'Paldiski mnt 25, 10612 Tallinn',
    }
  })
  const [businessName, setBusinessName] = useState('')
  const [registryCode, setRegistryCode] = useState('')
  const [businessAddress, setBusinessAddress] = useState('')
  const [returnsText, setReturnsText] = useState(DEFAULT_RETURNS_TEXT)
  const [legalView, setLegalView] = useState<'seller' | 'terms' | null>(null)
  const [orderNotificationEmail, setOrderNotificationEmail] = useState('')
  const [billingEmail, setBillingEmail] = useState('')
  const [billingPlan, setBillingPlan] = useState<PricingPlan>(pricingPlan)
  const [fixedPlanTrialStartedAt, setFixedPlanTrialStartedAt] = useState<Date | null>(() => pricingPlan === 'fixed' ? new Date(initialFixedPlanTrialStartedAt ?? Date.now()) : null)
  const [isBillingCardOpen, setIsBillingCardOpen] = useState(false)
  const [sellerNotifications, setSellerNotifications] = useState(true)
  const [customerConfirmations, setCustomerConfirmations] = useState(true)
  const [customDomain, setCustomDomain] = useState('')
  const [customDomainStatus, setCustomDomainStatus] = useState<CustomDomainStatus>('idle')
  const [customDomainRecord, setCustomDomainRecord] = useState<CustomDomainRecord | null>(null)
  const [customDomainError, setCustomDomainError] = useState('')
  const [isCustomDomainBusy, setIsCustomDomainBusy] = useState(false)
  const [autoSwipeEnabled, setAutoSwipeEnabled] = useState(() => localStorage.getItem('autoSwipeEnabled') !== 'false')
  const [autoSwipeDelay, setAutoSwipeDelay] = useState(() => Number(localStorage.getItem('autoSwipeDelay')) || 30)
  const [autoSwipeSpeed, setAutoSwipeSpeed] = useState(() => Number(localStorage.getItem('autoSwipeSpeed')) || 10)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isExitAttentionActive, setIsExitAttentionActive] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [isPasswordChangeOpen, setIsPasswordChangeOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState('')
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [passwordChangeError, setPasswordChangeError] = useState('')
  const [accountEmail, setAccountEmail] = useState('')
  const [isEmailChangeOpen, setIsEmailChangeOpen] = useState(false)
  const [newAccountEmail, setNewAccountEmail] = useState('')
  const [emailChangePassword, setEmailChangePassword] = useState('')
  const [isChangingEmail, setIsChangingEmail] = useState(false)
  const [emailChangeError, setEmailChangeError] = useState('')
  const [isSessionActionBusy, setIsSessionActionBusy] = useState(false)
  const [isAccountDeleteOpen, setIsAccountDeleteOpen] = useState(false)
  const [accountDeleteConfirmation, setAccountDeleteConfirmation] = useState('')
  const [isDeletingAccount, setIsDeletingAccount] = useState(false)
  const [accountDeleteError, setAccountDeleteError] = useState('')
  const [showAddedToast, setShowAddedToast] = useState(false)
  const [showDeletedToast, setShowDeletedToast] = useState(false)
  const [showCopiedToast, setShowCopiedToast] = useState(false)
  const [authToast, setAuthToast] = useState<string | null>(null)
  const [shareUrl, setShareUrl] = useState('')
  const [isShareOpen, setIsShareOpen] = useState(false)
  const [shareDragY, setShareDragY] = useState(0)
  const [isShareDragging, setIsShareDragging] = useState(false)
  const shareDragStartRef = useRef<number | null>(null)
  const editProductNameRef = useRef<HTMLHeadingElement>(null)
  const saveProductButtonRef = useRef<HTMLButtonElement>(null)
  const exitAttentionTimerRef = useRef<number | null>(null)
  const editProductDescriptionRef = useRef<HTMLParagraphElement>(null)
  const editProductPriceRef = useRef<HTMLElement>(null)
  const editProductSalePriceRef = useRef<HTMLElement>(null)
  const editProductImageInputRef = useRef<HTMLInputElement>(null)
  const editProductImageModeRef = useRef<'add' | 'replace'>('add')
  const imageGesturePointersRef = useRef(new Map<number, { x: number; y: number }>())
  const imageGestureStartRef = useRef<{ centroid: { x: number; y: number }; distance: number; transform: ProductImageTransform } | null>(null)
  const imageGestureLastTapRef = useRef(0)
  const editImageTransformsRef = useRef<Record<string, ProductImageTransform>>({})
  const editSessionImageUrlsRef = useRef<Set<string>>(new Set())
  const committedEditImageUrlsRef = useRef<Set<string>>(new Set())
  const uploadedDuringEditRef = useRef<Set<string>>(new Set())
  const editImageUploadTimersRef = useRef(new Map<string, number>())
  const [editProductImages, setEditProductImages] = useState<string[]>([])
  const [editImageTransforms, setEditImageTransforms] = useState<Record<string, ProductImageTransform>>({})
  const [editProductImageVariants, setEditProductImageVariants] = useState<Record<string, ProductImageAsset>>({})
  const [editImageUploads, setEditImageUploads] = useState<EditImageUpload[]>([])
  const [editProductStock, setEditProductStock] = useState('')
  const [editProductOneOfAKind, setEditProductOneOfAKind] = useState(false)
  const [editProductOptionType, setEditProductOptionType] = useState<'none' | 'Suurus' | 'Värv'>('none')
  const [editProductOptionValues, setEditProductOptionValues] = useState('')
  const [isCustomProductOptionOpen, setIsCustomProductOptionOpen] = useState(false)
  const [customProductOption, setCustomProductOption] = useState('')
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [addProductStep, setAddProductStep] = useState<'source' | 'details'>('source')
  const [addProductImages, setAddProductImages] = useState<string[]>([])
  const [imageUpload, setImageUpload] = useState<{ images: string[]; progress: number; phase: 'preparing' | 'uploading' | 'ready'; slow?: boolean } | null>(null)
  const [addProductName, setAddProductName] = useState('')
  const [addProductDescription, setAddProductDescription] = useState('')
  const [addProductPrice, setAddProductPrice] = useState('')
  const [addProductSalePrice, setAddProductSalePrice] = useState('')
  const [addProductSeoTitle, setAddProductSeoTitle] = useState('')
  const [addProductSlug, setAddProductSlug] = useState('')
  const [isAddProductSlugCustom, setIsAddProductSlugCustom] = useState(false)
  const [isAddProductSearchVisible, setIsAddProductSearchVisible] = useState(true)
  const [addProductError, setAddProductError] = useState('')
  const [isProductDropActive, setIsProductDropActive] = useState(false)
  const addProductSubmitLockRef = useRef(false)
  const productDropDepthRef = useRef(0)
  const editorOriginScrollRef = useRef(0)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const moreCameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const desktopGalleryInputRef = useRef<HTMLInputElement>(null)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [addedProducts, setAddedProducts] = useState<Product[]>([])
  const [persistedProducts, setPersistedProducts] = useState<Product[]>(seedProducts)
  const [draftProductId, setDraftProductId] = useState<string | null>(null)
  const [deletedProductIds, setDeletedProductIds] = useState<string[]>([])
  const [productEdits, setProductEdits] = useState<Record<string, Partial<Product>>>({})
  const settingsSnapshot = JSON.stringify({
    storeTheme, storeAccent, buyButtonSize, saleBadgeStyle, announcementEnabled, announcementText, announcementLink,
    announcementSpeed, announcementDirection, announcementBackground, announcementColor, storeLogo, editableStoreName, storeTagline, storeDescription, storeAboutImage,
    isStoreVisible, contactEmail, contactPhone, instagramUrl, facebookUrl, tiktokUrl, activePaymentProvider,
    deliverySettings, businessName, registryCode, businessAddress, returnsText, orderNotificationEmail,
    billingEmail, billingPlan, sellerNotifications, customerConfirmations,
    autoSwipeEnabled, autoSwipeDelay, autoSwipeSpeed,
  })
  const hasUnsavedSettings = isSettingsOpen && Boolean(savedSettingsSnapshotRef.current) && savedSettingsSnapshotRef.current !== settingsSnapshot

  useEffect(() => {
    if (!storeId) { setSettingsHydrated(true); return }
    setSettingsHydrated(false)
    const value = initialSettings as Record<string, any>
    if (value.storeTheme) setStoreTheme(value.storeTheme)
    if (value.storeAccent) setStoreAccent(value.storeAccent)
    if (value.buyButtonSize) setBuyButtonSize(value.buyButtonSize)
    if (value.saleBadgeStyle) setSaleBadgeStyle(value.saleBadgeStyle)
    if (typeof value.announcementEnabled === 'boolean') setAnnouncementEnabled(value.announcementEnabled)
    if (value.announcementText != null) setAnnouncementText(value.announcementText)
    if (value.announcementLink != null) setAnnouncementLink(value.announcementLink)
    if (value.announcementSpeed) setAnnouncementSpeed(value.announcementSpeed)
    if (value.announcementDirection) setAnnouncementDirection(value.announcementDirection)
    if (value.announcementBackground) setAnnouncementBackground(value.announcementBackground)
    if (value.announcementColor) setAnnouncementColor(value.announcementColor)
    if ('storeLogo' in value) setStoreLogo(value.storeLogo)
    if (value.editableStoreName) setEditableStoreName(value.editableStoreName)
    if (value.storeTagline != null) setStoreTagline(value.storeTagline)
    if (value.storeDescription != null) setStoreDescription(value.storeDescription)
    if ('storeAboutImage' in value) setStoreAboutImage(value.storeAboutImage)
    if (typeof value.isStoreVisible === 'boolean') setIsStoreVisible(value.isStoreVisible)
    if (value.contactEmail != null) setContactEmail(value.contactEmail)
    if (value.contactPhone != null) setContactPhone(value.contactPhone)
    if (value.instagramUrl != null) setInstagramUrl(value.instagramUrl)
    if (value.facebookUrl != null) setFacebookUrl(value.facebookUrl)
    if (value.tiktokUrl != null) setTiktokUrl(value.tiktokUrl)
    if (value.activePaymentProvider) setActivePaymentProvider(value.activePaymentProvider)
    if (value.deliverySettings) setDeliverySettings(value.deliverySettings)
    if (value.businessName != null) setBusinessName(value.businessName)
    if (value.registryCode != null) setRegistryCode(value.registryCode)
    if (value.businessAddress != null) setBusinessAddress(value.businessAddress)
    if (value.returnsText != null) setReturnsText(value.returnsText)
    if (value.orderNotificationEmail != null) setOrderNotificationEmail(value.orderNotificationEmail)
    if (value.billingEmail != null) setBillingEmail(value.billingEmail)
    if (value.billingPlan) setBillingPlan(value.billingPlan)
    if (typeof value.sellerNotifications === 'boolean') setSellerNotifications(value.sellerNotifications)
    if (typeof value.customerConfirmations === 'boolean') setCustomerConfirmations(value.customerConfirmations)
    if (typeof value.autoSwipeEnabled === 'boolean') setAutoSwipeEnabled(value.autoSwipeEnabled)
    if (value.autoSwipeDelay) setAutoSwipeDelay(value.autoSwipeDelay)
    if (value.autoSwipeSpeed) setAutoSwipeSpeed(value.autoSwipeSpeed)
    setSettingsHydrated(true)
  }, [storeId, initialSettings])

  useEffect(() => setPersistedProducts(seedProducts), [seedProducts])

  useEffect(() => {
    if (!storeId || !merchantMode) return
    let active = true
    setIsCustomDomainBusy(true)
    manageCustomDomain('status', storeId).then((domain) => {
      if (!active) return
      setCustomDomainRecord(domain)
      setCustomDomain(domain?.hostname ?? '')
      setCustomDomainStatus(domain?.status ?? 'idle')
      setCustomDomainError(domain?.error ?? '')
    }).catch((error) => {
      if (active) setCustomDomainError(error instanceof Error ? error.message : 'Domeeni oleku laadimine ebaõnnestus.')
    }).finally(() => {
      if (active) setIsCustomDomainBusy(false)
    })
    return () => { active = false }
  }, [storeId, merchantMode])

  useEffect(() => {
    if (!storeId || !customDomainRecord || !['pending_dns', 'verifying'].includes(customDomainStatus)) return
    const interval = window.setInterval(() => {
      manageCustomDomain('status', storeId).then((domain) => {
        setCustomDomainRecord(domain)
        setCustomDomain(domain?.hostname ?? '')
        setCustomDomainStatus(domain?.status ?? 'idle')
        if (domain?.error) setCustomDomainError(domain.error)
      }).catch(() => undefined)
    }, 15_000)
    return () => window.clearInterval(interval)
  }, [storeId, customDomainRecord?.id, customDomainStatus])

  useEffect(() => {
    if (!storeId) return
    let active = true
    const refreshProducts = () => listProducts(storeId)
      .then((nextProducts) => { if (active) setPersistedProducts(nextProducts) })
      .catch((error) => { if (active) setAuthToast(error instanceof Error ? error.message : 'Toodete laadimine ebaõnnestus') })
    refreshProducts()
    window.addEventListener('focus', refreshProducts)
    return () => { active = false; window.removeEventListener('focus', refreshProducts) }
  }, [storeId])

  useEffect(() => {
    if (!storeId || !merchantMode) return
    listOrders(storeId).then((rows) => setOrders(rows.map((row) => ({
      id: row.order_number, items: row.items as CartItem[], customerName: row.customer_name,
      customerEmail: row.customer_email, delivery: row.delivery, productSubtotal: Number(row.product_subtotal),
      total: Number(row.total), createdAt: row.created_at, status: row.status,
      stripeProcessingFee: Number(row.stripe_processing_fee_cents) / 100,
      stripePlatformFee: Number(row.stripe_platform_fee_cents) / 100,
      stripeSellerNet: Number(row.stripe_seller_net_cents) / 100,
    })))).catch((error) => setAuthToast(error instanceof Error ? error.message : 'Tellimuste laadimine ebaõnnestus'))
  }, [storeId, merchantMode])

  useEffect(() => setActivePaymentProvider(paymentProvider), [paymentProvider])
  useEffect(() => { editImageTransformsRef.current = editImageTransforms }, [editImageTransforms])
  useEffect(() => {
    if (ownerEmail && !loginEmail.trim()) setLoginEmail(ownerEmail)
  }, [ownerEmail])

  useEffect(() => {
    if (!merchantMode || !isSupabaseConfigured) return
    requireSupabase().auth.getUser().then(({ data }) => setAccountEmail(data.user?.email ?? ''))
  }, [merchantMode])

  useEffect(() => {
    if (!settingsHydrated) return
    if (!isSettingsOpen) {
      savedSettingsSnapshotRef.current = settingsSnapshot
      setSettingsSaveStatus('idle')
      return
    }
    if (!savedSettingsSnapshotRef.current) {
      savedSettingsSnapshotRef.current = settingsSnapshot
      return
    }
  }, [isSettingsOpen, settingsHydrated])

  const persistSettings = async (snapshot: string) => {
    if (!storeId) return
    const enabledShipping = [
      ...SHIPPING_PROVIDERS.filter((provider) => deliverySettings.parcelProviders[provider].enabled),
      ...(deliverySettings.courierEnabled ? ['courier'] : []),
      ...(deliverySettings.pickupEnabled ? ['pickup'] : []),
    ]
    const savedStore = await updateStore(storeId, {
      settings: JSON.parse(snapshot),
      name: editableStoreName,
      is_published: isStoreVisible,
      payment_provider: activePaymentProvider,
      pricing_plan: billingPlan,
      trial_started_at: fixedPlanTrialStartedAt?.toISOString() ?? null,
      shipping: enabledShipping,
    })
    onStoreChange?.(savedStore)
  }

  const saveSettings = async () => {
    if (!hasUnsavedSettings || settingsSaveStatus === 'saving') return
    setSettingsSaveStatus('saving')
    try {
      await persistSettings(settingsSnapshot)
      savedSettingsSnapshotRef.current = settingsSnapshot
      setSettingsSaveStatus('saved')
    } catch (error) {
      setSettingsSaveStatus('idle')
      setAuthToast(error instanceof Error ? error.message : 'Seadete salvestamine ebaõnnestus')
    }
  }

  useEffect(() => {
    if (!storeId || !merchantMode || !settingsHydrated) return
    if (!savedSettingsSnapshotRef.current || savedSettingsSnapshotRef.current === settingsSnapshot) return
    setSettingsSaveStatus('saving')
    const snapshot = settingsSnapshot
    const timeout = window.setTimeout(() => {
      persistSettings(snapshot).then(() => {
        savedSettingsSnapshotRef.current = snapshot
        setSettingsSaveStatus('saved')
      }).catch((error) => {
        setSettingsSaveStatus('idle')
        setAuthToast(error instanceof Error ? error.message : 'Automaatne salvestamine ebaõnnestus')
      })
    }, 700)
    return () => window.clearTimeout(timeout)
  }, [settingsSnapshot, settingsHydrated, storeId, merchantMode])

  useEffect(() => {
    if (settingsSaveStatus !== 'saved') return
    const timeout = window.setTimeout(() => setSettingsSaveStatus('idle'), 1500)
    return () => window.clearTimeout(timeout)
  }, [settingsSaveStatus])

  useEffect(() => {
    // Keep iOS Safari's browser chrome stable. The store theme is scoped to
    // .app-shell; changing the document color lets Safari tint its bottom bar
    // from bright controls near the viewport edge.
    const browserChromeColor = '#000000'
    const previousHtmlBackground = document.documentElement.style.backgroundColor
    const previousBodyBackground = document.body.style.backgroundColor
    const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    const previousThemeColor = themeMeta?.content
    document.documentElement.style.backgroundColor = browserChromeColor
    document.body.style.backgroundColor = browserChromeColor
    if (themeMeta) themeMeta.content = browserChromeColor
    return () => {
      document.documentElement.style.backgroundColor = previousHtmlBackground
      document.body.style.backgroundColor = previousBodyBackground
      if (themeMeta && previousThemeColor) themeMeta.content = previousThemeColor
    }
  }, [])

  useEffect(() => () => {
    if (storeLogoObjectUrlRef.current) URL.revokeObjectURL(storeLogoObjectUrlRef.current)
    if (storeAboutImageObjectUrlRef.current) URL.revokeObjectURL(storeAboutImageObjectUrlRef.current)
    editSessionImageUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    committedEditImageUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    if (exitAttentionTimerRef.current !== null) window.clearTimeout(exitAttentionTimerRef.current)
  }, [])

  useEffect(() => {
    if (isEditOpen) return
    setIsExitAttentionActive(false)
    if (exitAttentionTimerRef.current !== null) window.clearTimeout(exitAttentionTimerRef.current)
    exitAttentionTimerRef.current = null
  }, [isEditOpen])

  useEffect(() => {
    if (!isPublicDemo) return
    setIsLoggedIn(false)
    setIsLoginOpen(false)
    setIsCustomerPreview(false)
    setIsSettingsOpen(false)
    setIsOrdersOpen(false)
    setIsEditOpen(false)
  }, [isPublicDemo])

  useEffect(() => {
    if (!isPublicDemo || !onExit) return
    const exitDemoOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onExit()
    }
    window.addEventListener('keydown', exitDemoOnEscape)
    return () => window.removeEventListener('keydown', exitDemoOnEscape)
  }, [isPublicDemo, onExit])

  const changeStoreLogo = async (file: File | undefined) => {
    if (!file || !isImageFile(file)) return
    if (storeId) {
      let uploadedUrl = ''
      try {
        uploadedUrl = (await uploadImages(storeId, [file]))[0]
        const snapshot = JSON.stringify({ ...JSON.parse(settingsSnapshot), storeLogo: uploadedUrl })
        await persistSettings(snapshot)
        const previousUrl = storeLogo
        setStoreLogo(uploadedUrl)
        savedSettingsSnapshotRef.current = snapshot
        setSettingsSaveStatus('saved')
        if (previousUrl) void removeStoredProductImages(undefined, [previousUrl]).catch(() => undefined)
        return
      }
      catch (error) {
        if (uploadedUrl) void removeStoredProductImages(undefined, [uploadedUrl]).catch(() => undefined)
        setAuthToast(error instanceof Error ? error.message : 'Logo üleslaadimine ebaõnnestus'); return
      }
    }
    if (storeLogoObjectUrlRef.current) URL.revokeObjectURL(storeLogoObjectUrlRef.current)
    const objectUrl = URL.createObjectURL(file)
    storeLogoObjectUrlRef.current = objectUrl
    setStoreLogo(objectUrl)
  }

  const removeStoreLogo = async () => {
    if (storeLogoObjectUrlRef.current) URL.revokeObjectURL(storeLogoObjectUrlRef.current)
    storeLogoObjectUrlRef.current = null
    const previousUrl = storeLogo
    if (storeId) {
      const snapshot = JSON.stringify({ ...JSON.parse(settingsSnapshot), storeLogo: null })
      try {
        await persistSettings(snapshot); setStoreLogo(null); savedSettingsSnapshotRef.current = snapshot; setSettingsSaveStatus('saved')
        if (previousUrl) void removeStoredProductImages(undefined, [previousUrl]).catch(() => undefined)
      }
      catch (error) { setAuthToast(error instanceof Error ? error.message : 'Logo eemaldamine ebaõnnestus') }
    } else setStoreLogo(null)
  }

  const changeStoreAboutImage = async (file: File | undefined) => {
    if (!file || !isImageFile(file)) return
    if (storeId) {
      let uploadedUrl = ''
      try {
        uploadedUrl = (await uploadImages(storeId, [file]))[0]
        const snapshot = JSON.stringify({ ...JSON.parse(settingsSnapshot), storeAboutImage: uploadedUrl })
        await persistSettings(snapshot)
        const previousUrl = storeAboutImage
        setStoreAboutImage(uploadedUrl)
        savedSettingsSnapshotRef.current = snapshot
        setSettingsSaveStatus('saved')
        if (previousUrl) void removeStoredProductImages(undefined, [previousUrl]).catch(() => undefined)
        return
      }
      catch (error) {
        if (uploadedUrl) void removeStoredProductImages(undefined, [uploadedUrl]).catch(() => undefined)
        setAuthToast(error instanceof Error ? error.message : 'Pildi üleslaadimine ebaõnnestus'); return
      }
    }
    if (storeAboutImageObjectUrlRef.current) URL.revokeObjectURL(storeAboutImageObjectUrlRef.current)
    const objectUrl = URL.createObjectURL(file)
    storeAboutImageObjectUrlRef.current = objectUrl
    setStoreAboutImage(objectUrl)
  }

  const removeStoreAboutImage = async () => {
    if (storeAboutImageObjectUrlRef.current) URL.revokeObjectURL(storeAboutImageObjectUrlRef.current)
    storeAboutImageObjectUrlRef.current = null
    const previousUrl = storeAboutImage
    if (storeId) {
      const snapshot = JSON.stringify({ ...JSON.parse(settingsSnapshot), storeAboutImage: null })
      try {
        await persistSettings(snapshot); setStoreAboutImage(null); savedSettingsSnapshotRef.current = snapshot; setSettingsSaveStatus('saved')
        if (previousUrl) void removeStoredProductImages(undefined, [previousUrl]).catch(() => undefined)
      }
      catch (error) { setAuthToast(error instanceof Error ? error.message : 'Pildi eemaldamine ebaõnnestus') }
    } else setStoreAboutImage(null)
  }

  const openEditProduct = () => {
    if (!activeProduct) return
    uploadedDuringEditRef.current.clear()
    setEditProductImages([...(activeProduct.gallery ?? [activeProduct.image])])
    setEditImageTransforms(activeProduct.imageTransforms ?? {})
    setEditProductImageVariants(activeProduct.imageVariants ?? {})
    setEditProductStock(activeProduct.stock === undefined ? '' : String(activeProduct.stock))
    setEditProductOneOfAKind(Boolean(activeProduct.oneOfAKind))
    const option = activeProduct.options?.[0]
    setEditProductOptionType(option?.name === 'Suurus' || option?.name === 'Värv' ? option.name : 'none')
    setEditProductOptionValues(option?.values.join(', ') ?? '')
    setIsCustomProductOptionOpen(false)
    setCustomProductOption('')
    setIsEditOpen(true)
  }

  const closeEditProduct = () => {
    if (editImageUploads.some((upload) => upload.phase !== 'error')) {
      setAuthToast('Oota, kuni pilt on üles laaditud')
      return
    }
    if (draftProductId) {
      editProductImages.forEach((url) => {
        committedEditImageUrlsRef.current.delete(url)
        URL.revokeObjectURL(url)
      })
      setAddedProducts((current) => current.filter((product) => product.id !== draftProductId))
      setProductEdits((current) => {
        const next = { ...current }
        delete next[draftProductId]
        return next
      })
      setActiveIndex((index) => Math.max(0, index - 1))
      setDraftProductId(null)
    }
    if (storeId && uploadedDuringEditRef.current.size) {
      void removeStoredProductImages(editProductImageVariants, [...uploadedDuringEditRef.current])
        .catch(() => setAuthToast('Kasutamata pildifailide eemaldamine ebaõnnestus'))
    }
    uploadedDuringEditRef.current.clear()
    editSessionImageUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    editSessionImageUrlsRef.current.clear()
    editImageUploadTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    editImageUploadTimersRef.current.clear()
    setEditImageUploads([])
    setEditProductImages([])
    setEditImageTransforms({})
    setEditProductImageVariants({})
    imageGesturePointersRef.current.clear()
    imageGestureStartRef.current = null
    setEditProductStock('')
    setEditProductOneOfAKind(false)
    setEditProductOptionType('none')
    setEditProductOptionValues('')
    setIsCustomProductOptionOpen(false)
    setCustomProductOption('')
    setIsEditOpen(false)
  }

  const requestExit = () => {
    if (!onExit) return
    if (!adminDemoMode || !isEditOpen) {
      onExit()
      return
    }

    setIsExitAttentionActive(false)
    if (exitAttentionTimerRef.current !== null) window.clearTimeout(exitAttentionTimerRef.current)
    window.requestAnimationFrame(() => {
      setIsExitAttentionActive(true)
      saveProductButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      exitAttentionTimerRef.current = window.setTimeout(() => {
        setIsExitAttentionActive(false)
        exitAttentionTimerRef.current = null
      }, 1800)
    })
  }

  const toggleProductOptionValue = (value: string) => {
    setEditProductOptionValues((current) => {
      const values = current.split(',').map((item) => item.trim()).filter(Boolean)
      const next = values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
      return next.join(', ')
    })
  }

  const addCustomProductOption = () => {
    const value = customProductOption.trim()
    if (!value) return
    setEditProductOptionValues((current) => {
      const values = current.split(',').map((item) => item.trim()).filter(Boolean)
      return values.includes(value) ? current : [...values, value].join(', ')
    })
    setCustomProductOption('')
    setIsCustomProductOptionOpen(false)
  }

  const updateEditImageUpload = (id: string, changes: Partial<EditImageUpload>) => {
    setEditImageUploads((current) => current.map((upload) => upload.id === id ? { ...upload, ...changes } : upload))
  }

  const startEditImageUpload = async (upload: EditImageUpload) => {
    if (!storeId) return
    updateEditImageUpload(upload.id, { phase: 'preparing', slow: false, error: undefined })
    const previousTimer = editImageUploadTimersRef.current.get(upload.id)
    if (previousTimer) window.clearTimeout(previousTimer)
    editImageUploadTimersRef.current.set(upload.id, window.setTimeout(() => updateEditImageUpload(upload.id, { slow: true }), 4500))
    try {
      const [uploaded] = await uploadProductImages(storeId, [upload.file], (_index, phase) => updateEditImageUpload(upload.id, { phase }))
      const uploadedUrl = uploaded.url
      const transform = editImageTransformsRef.current[upload.previewUrl] ?? DEFAULT_IMAGE_TRANSFORM
      setEditProductImages((current) => current.map((image) => image === upload.previewUrl ? uploadedUrl : image))
      setEditImageTransforms((current) => {
        const next = { ...current, [uploadedUrl]: transform }
        delete next[upload.previewUrl]
        if (upload.previousUrl) delete next[upload.previousUrl]
        return next
      })
      setEditProductImageVariants((current) => {
        const next = { ...current, [uploadedUrl]: uploaded.asset }
        delete next[upload.previewUrl]
        if (upload.previousUrl) delete next[upload.previousUrl]
        return next
      })
      uploadedDuringEditRef.current.add(uploadedUrl)
      editSessionImageUrlsRef.current.delete(upload.previewUrl)
      URL.revokeObjectURL(upload.previewUrl)
      setEditImageUploads((current) => current.filter((item) => item.id !== upload.id))
    } catch (error) {
      updateEditImageUpload(upload.id, { phase: 'error', slow: false, error: error instanceof Error ? error.message : 'Üleslaadimine ebaõnnestus' })
    } finally {
      const timer = editImageUploadTimersRef.current.get(upload.id)
      if (timer) window.clearTimeout(timer)
      editImageUploadTimersRef.current.delete(upload.id)
    }
  }

  const dismissEditImageUpload = (upload: EditImageUpload) => {
    setEditImageUploads((current) => current.filter((item) => item.id !== upload.id))
    setEditProductImages((current) => upload.mode === 'replace' && upload.previousUrl
      ? current.map((image) => image === upload.previewUrl ? upload.previousUrl! : image)
      : current.filter((image) => image !== upload.previewUrl))
    setEditImageTransforms((current) => {
      const next = { ...current }
      delete next[upload.previewUrl]
      return next
    })
    setEditProductImageVariants((current) => {
      const next = { ...current }
      delete next[upload.previewUrl]
      return next
    })
    editSessionImageUrlsRef.current.delete(upload.previewUrl)
    URL.revokeObjectURL(upload.previewUrl)
  }

  const chooseEditProductImages = (files: FileList | null) => {
    if (!activeProduct || editImageUploads.length) return
    const mode = editProductImageModeRef.current
    const available = mode === 'replace' ? 1 : Math.max(0, MAX_PRODUCT_IMAGES - editProductImages.length)
    const imageFiles = Array.from(files ?? []).filter(isImageFile).slice(0, available)
    if (!imageFiles.length) return
    if (!storeId) {
      const urls = imageFiles.map((file) => URL.createObjectURL(file))
      urls.forEach((url) => editSessionImageUrlsRef.current.add(url))
      if (mode === 'replace') {
        const index = Math.min(selectedImages[activeProduct.id] ?? 0, Math.max(0, editProductImages.length - 1))
        setEditProductImages((current) => current.map((image, imageIndex) => imageIndex === index ? urls[0] : image))
      } else setEditProductImages((current) => [...current, ...urls])
      return
    }

    const selectedIndex = Math.min(selectedImages[activeProduct.id] ?? 0, Math.max(0, editProductImages.length - 1))
    const uploads = imageFiles.map((file, index): EditImageUpload => {
      const previewUrl = URL.createObjectURL(file)
      editSessionImageUrlsRef.current.add(previewUrl)
      return {
        id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl,
        mode,
        previousUrl: mode === 'replace' ? editProductImages[selectedIndex] : undefined,
        phase: 'preparing',
        slow: false,
      }
    })
    setEditImageUploads((current) => [...current, ...uploads])
    setEditImageTransforms((current) => ({ ...current, ...Object.fromEntries(uploads.map((upload) => [upload.previewUrl, DEFAULT_IMAGE_TRANSFORM])) }))
    if (mode === 'replace') {
      setEditProductImages((current) => current.map((image, index) => index === selectedIndex ? uploads[0].previewUrl : image))
    } else {
      setEditProductImages((current) => [...current, ...uploads.map((upload) => upload.previewUrl)])
      setSelectedImages((current) => ({ ...current, [activeProduct.id]: editProductImages.length }))
    }
    uploads.forEach((upload) => { startEditImageUpload(upload) })
  }

  const removeEditProductImage = (index: number) => {
    if (!activeProduct) return
    const removed = editProductImages[index]
    if (editSessionImageUrlsRef.current.has(removed)) {
      URL.revokeObjectURL(removed)
      editSessionImageUrlsRef.current.delete(removed)
    }
    const next = editProductImages.filter((_, imageIndex) => imageIndex !== index)
    setEditProductImages(next)
    setEditImageTransforms((current) => {
      const nextTransforms = { ...current }
      delete nextTransforms[removed]
      return nextTransforms
    })
    setEditProductImageVariants((current) => {
      const nextVariants = { ...current }
      delete nextVariants[removed]
      return nextVariants
    })
    setSelectedImages((current) => ({ ...current, [activeProduct.id]: Math.max(0, Math.min(current[activeProduct.id] ?? 0, next.length - 1)) }))
  }

  const closeAddProduct = () => {
    addProductImages.forEach((image) => URL.revokeObjectURL(image))
    setIsAddOpen(false)
    setAddProductStep('source')
    setAddProductImages([])
    setAddProductName('')
    setAddProductDescription('')
    setAddProductPrice('')
    setAddProductSalePrice('')
    setAddProductSeoTitle('')
    setAddProductSlug('')
    setIsAddProductSlugCustom(false)
    setIsAddProductSearchVisible(true)
    setAddProductError('')
  }

  const chooseAddProductImages = async (files: FileList | null) => {
    const imageFiles = Array.from(files ?? []).filter(isImageFile).slice(0, MAX_PRODUCT_IMAGES)
    if (!imageFiles.length) return
    addProductImages.forEach((image) => URL.revokeObjectURL(image))
    const previews = imageFiles.map((file) => URL.createObjectURL(file))
    setIsAddOpen(false)
    setAddProductStep('source')
    setAddProductImages([])
    setAddProductError('')
    setImageUpload({ images: previews, progress: 18, phase: 'preparing' })
    const slowTimer = window.setTimeout(() => setImageUpload((current) => current ? { ...current, slow: true } : null), 4500)
    let images: string[]
    let imageVariants: Record<string, ProductImageAsset> = {}
    try {
      if (storeId) {
        const uploaded = await uploadProductImages(storeId, imageFiles, (_index, phase) => setImageUpload((current) => current ? { ...current, phase, progress: phase === 'preparing' ? 18 : 62 } : null))
        images = uploaded.map((item) => item.url)
        imageVariants = Object.fromEntries(uploaded.map((item) => [item.url, item.asset]))
      } else images = previews
      window.clearTimeout(slowTimer)
      if (storeId) previews.forEach((preview) => URL.revokeObjectURL(preview))
      setImageUpload({ images, progress: 100, phase: 'ready' })
      await new Promise((resolve) => window.setTimeout(resolve, 350))
      const id = `product-${Date.now()}`
      images.forEach((url) => committedEditImageUrlsRef.current.add(url))
      if (storeId) images.forEach((url) => uploadedDuringEditRef.current.add(url))
      setAddedProducts((current) => [...current, {
        id,
        name: '',
        description: '',
        image: images[0],
        gallery: images,
        imageVariants,
        alt: 'Uue toote pilt',
        searchVisible: true,
      }])
      setActiveIndex(displayProducts.length)
      setSelectedImages((current) => ({ ...current, [id]: 0 }))
      setEditProductImages(images)
      setEditImageTransforms({})
      setEditProductImageVariants(imageVariants)
      setEditProductStock('1')
      setEditProductOneOfAKind(true)
      setEditProductOptionType('none')
      setEditProductOptionValues('')
      setDraftProductId(id)
      setImageUpload(null)
      setIsEditOpen(true)
    } catch (error) {
      window.clearTimeout(slowTimer)
      previews.forEach((preview) => URL.revokeObjectURL(preview))
      setImageUpload(null)
      setIsAddOpen(true)
      setAddProductStep('source')
      setAuthToast(error instanceof Error ? error.message : 'Piltide üleslaadimine ebaõnnestus')
    }
  }

  const addCameraProductImage = (files: FileList | null) => {
    const file = files?.[0]
    if (!file || addProductImages.length >= MAX_PRODUCT_IMAGES) return
    setAddProductImages((images) => [...images, URL.createObjectURL(file)].slice(0, MAX_PRODUCT_IMAGES))
  }

  const openAddProductChooser = () => {
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      desktopGalleryInputRef.current?.click()
      return
    }
    setAddProductStep('source')
    setIsAddOpen(true)
  }

  activeIndexRef.current = activeIndex
  const displayProducts = [...persistedProducts, ...addedProducts]
    .filter((product) => !deletedProductIds.includes(product.id))
    .map((product) => ({ ...product, ...(productEdits[product.id] ?? {}) }))
  const renderedProducts = displayProducts.length
    ? [displayProducts[displayProducts.length - 1], ...displayProducts, displayProducts[0]]
    : []
  const isAdminMode = isLoggedIn && !isCustomerPreview

  useEffect(() => {
    const track = trackRef.current
    if (!track || !displayProducts.length) return
    let frame = 0
    let normalizeTimeout: ReturnType<typeof window.setTimeout> | undefined
    const normalizePosition = () => {
      const width = Math.max(track.clientWidth, 1)
      const physicalIndex = Math.round(track.scrollLeft / width)
      const snappedPosition = physicalIndex * width
      const loopTarget = physicalIndex === 0
        ? displayProducts.length * width
        : physicalIndex === displayProducts.length + 1
          ? width
          : null

      if (loopTarget === null) {
        if (Math.abs(track.scrollLeft - snappedPosition) > 1) {
          track.scrollTo({ left: snappedPosition, behavior: 'smooth' })
        }
        return
      }

      const previousSnap = track.style.scrollSnapType
      track.style.scrollSnapType = 'none'
      track.scrollLeft = loopTarget
      void track.offsetWidth
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { track.style.scrollSnapType = previousSnap })
      })
    }
    const syncIndex = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const width = Math.max(track.clientWidth, 1)
        const position = track.scrollLeft / width
        const physicalIndex = Math.round(position)
        const logicalIndex = physicalIndex <= 0
          ? displayProducts.length - 1
          : physicalIndex >= displayProducts.length + 1
            ? 0
            : physicalIndex - 1
        setActiveIndex(logicalIndex)

        if (normalizeTimeout !== undefined) window.clearTimeout(normalizeTimeout)
        normalizeTimeout = window.setTimeout(normalizePosition, 180)
      })
    }
    const alignPosition = () => track.scrollTo({ left: (activeIndexRef.current + 1) * track.clientWidth, behavior: 'auto' })
    track.addEventListener('scroll', syncIndex, { passive: true })
    track.addEventListener('scrollend', normalizePosition)
    window.addEventListener('resize', alignPosition)
    requestAnimationFrame(alignPosition)
    return () => {
      cancelAnimationFrame(frame)
      if (normalizeTimeout !== undefined) window.clearTimeout(normalizeTimeout)
      track.removeEventListener('scroll', syncIndex)
      track.removeEventListener('scrollend', normalizePosition)
      window.removeEventListener('resize', alignPosition)
    }
  }, [displayProducts.length])

  useEffect(() => {
    if (!isLoginOpen && !isEditOpen && !isAddOpen && !imageUpload && !isSearchOpen && !isDeleteOpen && !isPasswordChangeOpen && !isEmailChangeOpen && !isAccountDeleteOpen && !isShareOpen && !isSettingsOpen && !isOrdersOpen && !isAboutOpen && !legalView && !isBillingCardOpen) return
    // On phones the product details editor is a regular document page. Let the
    // browser own vertical scrolling instead of combining a fixed body with a
    // nested fixed scroller (an unreliable combination in iOS Safari).
    if (isEditOpen || (isAddOpen && addProductStep === 'details')) return
    const scrollY = window.scrollY
    const previous = {
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
      overflow: document.body.style.overflow,
    }
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.width = '100%'
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.position = previous.position
      document.body.style.top = previous.top
      document.body.style.width = previous.width
      document.body.style.overflow = previous.overflow
      window.scrollTo(0, scrollY)
    }
  }, [isLoginOpen, isEditOpen, isAddOpen, Boolean(imageUpload), addProductStep, isSearchOpen, isDeleteOpen, isPasswordChangeOpen, isEmailChangeOpen, isAccountDeleteOpen, isShareOpen, isSettingsOpen, isOrdersOpen, isAboutOpen, legalView, isBillingCardOpen])

  useEffect(() => {
    const isProductEditorOpen = isAddOpen && addProductStep === 'details'
    if (!isProductEditorOpen || !window.matchMedia('(max-width: 599px)').matches) return
    const originScroll = window.scrollY
    editorOriginScrollRef.current = originScroll
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    return () => {
      window.requestAnimationFrame(() => window.scrollTo({ top: originScroll, left: 0, behavior: 'auto' }))
    }
  }, [isAddOpen, addProductStep])

  useEffect(() => {
    localStorage.setItem('autoSwipeEnabled', String(autoSwipeEnabled))
    localStorage.setItem('autoSwipeDelay', String(autoSwipeDelay))
    localStorage.setItem('autoSwipeSpeed', String(autoSwipeSpeed))
  }, [autoSwipeEnabled, autoSwipeDelay, autoSwipeSpeed])

  useEffect(() => {
    if (!showAddedToast) return
    const timeout = window.setTimeout(() => setShowAddedToast(false), 2400)
    return () => window.clearTimeout(timeout)
  }, [showAddedToast])

  useEffect(() => {
    if (!showDeletedToast) return
    const timeout = window.setTimeout(() => setShowDeletedToast(false), 2400)
    return () => window.clearTimeout(timeout)
  }, [showDeletedToast])

  useEffect(() => {
    if (!showCopiedToast) return
    const timeout = window.setTimeout(() => setShowCopiedToast(false), 2400)
    return () => window.clearTimeout(timeout)
  }, [showCopiedToast])

  useEffect(() => {
    if (!authToast) return
    const timeout = window.setTimeout(() => setAuthToast(null), 2400)
    return () => window.clearTimeout(timeout)
  }, [authToast])

  useEffect(() => {
    const checkoutResult = new URLSearchParams(window.location.search).get('checkout')
    if (!checkoutResult) return
    setAuthToast(checkoutResult === 'success' ? 'Makse õnnestus. Tellimus on kinnitatud.' : 'Makse katkestati. Ostukorvi eest tasu ei võetud.')
    if (checkoutResult === 'success') setCart([])
    const cleanUrl = new URL(window.location.href)
    cleanUrl.searchParams.delete('checkout')
    cleanUrl.searchParams.delete('session_id')
    window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`)
  }, [])

  useEffect(() => {
    if (!autoSwipeEnabled || isEditOpen) {
      setIsScreensaverActive(false)
      return
    }
    let idleTimeout: ReturnType<typeof window.setTimeout> | undefined
    let autoplayInterval: ReturnType<typeof window.setInterval> | undefined

    const stopScreensaver = () => {
      if (idleTimeout !== undefined) window.clearTimeout(idleTimeout)
      if (autoplayInterval !== undefined) window.clearInterval(autoplayInterval)
      idleTimeout = undefined
      autoplayInterval = undefined
      setIsScreensaverActive(false)
    }

    const showNextProduct = () => {
      const track = trackRef.current
      if (!track || !displayProducts.length) return
      let physicalIndex = Math.round(track.scrollLeft / Math.max(track.clientWidth, 1))
      if (physicalIndex >= displayProducts.length + 1) {
        physicalIndex = 1
        const previousSnap = track.style.scrollSnapType
        track.style.scrollSnapType = 'none'
        track.scrollTo({ left: track.clientWidth, behavior: 'auto' })
        void track.offsetWidth
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            track.style.scrollSnapType = previousSnap
            track.scrollTo({
              left: 2 * track.clientWidth,
              behavior: 'smooth',
            })
          })
        })
        return
      }
      track.scrollTo({
        left: (physicalIndex + 1) * track.clientWidth,
        behavior: 'smooth',
      })
    }

    const startScreensaver = () => {
      if (document.hidden || isCartOpen) return
      setIsScreensaverActive(true)
      showNextProduct()
      autoplayInterval = window.setInterval(showNextProduct, autoSwipeSpeed * 1000)
    }

    const scheduleScreensaver = () => {
      stopScreensaver()
      if (!document.hidden && !isCartOpen) {
        idleTimeout = window.setTimeout(startScreensaver, autoSwipeDelay * 1000)
      }
    }

    const handleVisibility = () => scheduleScreensaver()
    const activityEvents: Array<keyof WindowEventMap> = ['pointerdown', 'touchstart', 'mousemove', 'wheel', 'keydown']
    activityEvents.forEach((eventName) => window.addEventListener(eventName, scheduleScreensaver, { passive: true }))
    document.addEventListener('visibilitychange', handleVisibility)
    scheduleScreensaver()

    return () => {
      stopScreensaver()
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, scheduleScreensaver))
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [isCartOpen, isEditOpen, displayProducts.length, autoSwipeEnabled, autoSwipeDelay, autoSwipeSpeed])

  const goToProduct = (index: number) => {
    const track = trackRef.current
    track?.scrollTo({ left: (index + 1) * track.clientWidth, behavior: 'smooth' })
  }

  const getSelectionsForProduct = (product: Product) => ({
    ...getDefaultProductOptions(product),
    ...(selectedProductOptions[product.id] ?? {}),
  })

  const addToCart = (product: Product) => {
    const stockLimit = getProductStockLimit(product)
    if (stockLimit <= 0) return
    const selections = getSelectionsForProduct(product)
    const cartKey = createCartKey(product.id, selections)
    setCart((items) => {
      const productQuantity = items.filter((item) => item.id === product.id).reduce((sum, item) => sum + item.quantity, 0)
      if (productQuantity >= stockLimit) return items
      const existing = items.find((item) => item.cartKey === cartKey)
      return existing
        ? items.map((item) => item.cartKey === cartKey ? { ...item, quantity: item.quantity + 1 } : item)
        : [...items, createCartItem(product, 1, selections)]
    })
    setAddedProductId(product.id)
    setCartStep('cart')
    setIsCartOpen(true)
    window.setTimeout(() => setAddedProductId((id) => id === product.id ? null : id), 1600)
  }

  const openOwnerLogin = () => {
    // A stale modal must never sit above the login dialog and capture taps.
    setIsCartOpen(false)
    setIsAboutOpen(false)
    setIsSettingsOpen(false)
    setIsOrdersOpen(false)
    setIsAddOpen(false)
    setIsEditOpen(false)
    setIsDeleteOpen(false)
    setIsPasswordChangeOpen(false)
    setIsEmailChangeOpen(false)
    setIsAccountDeleteOpen(false)
    setIsShareOpen(false)
    setIsSearchOpen(false)
    setIsBillingCardOpen(false)
    setLoginRecoveryMessage('')
    setIsLoginOpen(true)
  }

  const handleLogoTap = () => {
    if (isPublicDemo) return
    if (isLoggedIn) {
      logoTapCountRef.current = 0
      return
    }
    logoTapCountRef.current += 1
    if (logoTapTimerRef.current) window.clearTimeout(logoTapTimerRef.current)
    if (logoTapCountRef.current >= 3) {
      logoTapCountRef.current = 0
      openOwnerLogin()
      return
    }
    logoTapTimerRef.current = window.setTimeout(() => { logoTapCountRef.current = 0 }, 900)
  }

  const activeProduct = displayProducts[activeIndex]
  const activeProductHasSale = activeProduct !== undefined && activeProduct.salePrice !== undefined && activeProduct.price !== undefined && activeProduct.salePrice < activeProduct.price
  const activeProductDiscount = activeProductHasSale ? Math.round((1 - activeProduct.salePrice! / activeProduct.price!) * 100) : 0
  const activeProductSelections = activeProduct ? getSelectionsForProduct(activeProduct) : {}
  const activeProductCartKey = activeProduct ? createCartKey(activeProduct.id, activeProductSelections) : ''
  const activeProductCartItem = cart.find((item) => item.cartKey === activeProductCartKey)
  const isActiveProductInCart = Boolean(activeProductCartItem)
  const activeProductStockLimit = activeProduct ? getProductStockLimit(activeProduct) : 0
  const activeProductCartQuantity = activeProduct ? cart.filter((item) => item.id === activeProduct.id).reduce((sum, item) => sum + item.quantity, 0) : 0
  const isActiveProductSoldOut = activeProductStockLimit <= 0
  const isActiveProductAtCartLimit = activeProductCartQuantity >= activeProductStockLimit
  const editOptionValues = editProductOptionValues.split(',').map((value) => value.trim()).filter(Boolean)
  const editOptionPresets = editProductOptionType === 'Suurus' ? ['XS', 'S', 'M', 'L', 'XL'] : ['Must', 'Valge', 'Sinine', 'Roheline', 'Punane']
  const editCustomOptionValues = editOptionValues.filter((value) => !editOptionPresets.includes(value))
  const editColorSwatches: Record<string, string> = { Must: '#242424', Valge: '#f5f2e9', Sinine: '#6caef0', Roheline: '#70bd8d', Punane: '#ed766f' }
  const getDisplayedProductImage = (product: Product) => {
    if (isEditOpen && activeProduct?.id === product.id) {
      return editProductImages[Math.min(selectedImages[product.id] ?? 0, Math.max(0, editProductImages.length - 1))] ?? EMPTY_PRODUCT_IMAGE
    }
    const images = product.gallery?.length ? product.gallery : [product.image]
    return images[Math.min(selectedImages[product.id] ?? 0, images.length - 1)]
  }

  const getDisplayedProductImageProps = (product: Product, preferred: 'thumb' | 'medium' | 'large' = 'large') => {
    const image = getDisplayedProductImage(product)
    const sourceProduct = isEditOpen && activeProduct?.id === product.id
      ? { ...product, imageVariants: editProductImageVariants }
      : product
    return getResponsiveImageProps(sourceProduct, image, preferred)
  }

  const getDisplayedImageTransform = (product: Product) => {
    const image = getDisplayedProductImage(product)
    return isEditOpen && activeProduct?.id === product.id
      ? editImageTransforms[image] ?? DEFAULT_IMAGE_TRANSFORM
      : product.imageTransforms?.[image] ?? DEFAULT_IMAGE_TRANSFORM
  }

  const activeEditImage = activeProduct && isEditOpen ? getDisplayedProductImage(activeProduct) : null
  const activeEditImageTransform = activeEditImage ? editImageTransforms[activeEditImage] ?? DEFAULT_IMAGE_TRANSFORM : DEFAULT_IMAGE_TRANSFORM
  const setActiveEditImageTransform = (transform: ProductImageTransform) => {
    if (!activeEditImage) return
    const normalized = {
      scale: clampImageScale(transform.scale),
      x: clampImageOffset(transform.x, clampImageScale(transform.scale)),
      y: clampImageOffset(transform.y, clampImageScale(transform.scale)),
    }
    setEditImageTransforms((current) => ({ ...current, [activeEditImage]: normalized }))
  }

  const getGestureGeometry = () => {
    const points = [...imageGesturePointersRef.current.values()]
    if (!points.length) return null
    const centroid = {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    }
    const distance = points.length > 1 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0
    return { centroid, distance }
  }

  const beginImageGesture = () => {
    const geometry = getGestureGeometry()
    if (!geometry || !activeEditImage) { imageGestureStartRef.current = null; return }
    imageGestureStartRef.current = {
      ...geometry,
      transform: editImageTransformsRef.current[activeEditImage] ?? DEFAULT_IMAGE_TRANSFORM,
    }
  }

  const handleImagePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') event.preventDefault()
    const now = Date.now()
    if (event.pointerType === 'touch' && imageGesturePointersRef.current.size === 0 && now - imageGestureLastTapRef.current < 280) {
      imageGestureLastTapRef.current = 0
      setActiveEditImageTransform(activeEditImageTransform.scale > 1.05 ? DEFAULT_IMAGE_TRANSFORM : { x: 0, y: 0, scale: 2 })
      return
    }
    imageGestureLastTapRef.current = now
    if (event.pointerType !== 'touch') event.currentTarget.setPointerCapture(event.pointerId)
    imageGesturePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    beginImageGesture()
  }

  const handleImagePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!imageGesturePointersRef.current.has(event.pointerId) || !imageGestureStartRef.current) return
    if (event.pointerType === 'touch' && imageGesturePointersRef.current.size < 2) return
    event.preventDefault()
    imageGesturePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const geometry = getGestureGeometry()
    if (!geometry) return
    const start = imageGestureStartRef.current
    const rect = event.currentTarget.getBoundingClientRect()
    const scale = clampImageScale(start.distance > 0 && geometry.distance > 0 ? start.transform.scale * geometry.distance / start.distance : start.transform.scale)
    setActiveEditImageTransform({
      scale,
      x: start.transform.x + (geometry.centroid.x - start.centroid.x) / Math.max(rect.width, 1) * 100,
      y: start.transform.y + (geometry.centroid.y - start.centroid.y) / Math.max(rect.height, 1) * 100,
    })
  }

  const endImagePointer = (event: React.PointerEvent<HTMLDivElement>) => {
    imageGesturePointersRef.current.delete(event.pointerId)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    beginImageGesture()
  }

  const handleImageWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    setActiveEditImageTransform({ ...activeEditImageTransform, scale: activeEditImageTransform.scale + (event.deltaY < 0 ? .12 : -.12) })
  }

  const saveEditedProduct = async () => {
    if (!activeProduct) return
    if (editImageUploads.length) {
      setAuthToast(editImageUploads.some((upload) => upload.phase === 'error') ? 'Paranda ebaõnnestunud pildi üleslaadimine' : 'Oota, kuni pildid on üles laaditud')
      return
    }
    const name = editProductNameRef.current?.textContent?.trim() ?? ''
    const description = editProductDescriptionRef.current?.textContent?.trim() ?? ''
    const parsePrice = (value: string | null | undefined) => {
      const normalized = (value ?? '').replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, '')
      return normalized ? Number(normalized) : Number.NaN
    }
    const price = parsePrice(editProductPriceRef.current?.textContent)
    const salePriceText = editProductSalePriceRef.current?.textContent?.trim() ?? ''
    const salePrice = salePriceText ? parsePrice(salePriceText) : undefined
    if (!name || !Number.isFinite(price) || price < 0) {
      setAuthToast('Kontrolli toote nime ja hinda')
      return
    }
    if (salePrice !== undefined && (!Number.isFinite(salePrice) || salePrice < 0 || salePrice >= price)) {
      setAuthToast('Soodushind peab olema tavahinnast väiksem')
      return
    }
    if (!editProductImages.length) {
      setAuthToast('Lisa vähemalt üks tootepilt')
      return
    }
    const stock = editProductStock.trim() === '' ? undefined : Number(editProductStock)
    if (stock !== undefined && (!Number.isInteger(stock) || stock < 0)) {
      setAuthToast('Laoseis peab olema positiivne täisarv või 0')
      return
    }
    const optionValues = editProductOptionValues.split(',').map((value) => value.trim()).filter(Boolean)
    const changes: Partial<Product> = {
      name,
      description,
      price,
      salePrice,
      image: editProductImages[0] ?? activeProduct.image,
      gallery: editProductImages.length ? editProductImages : (activeProduct.gallery ?? [activeProduct.image]),
      imageTransforms: Object.fromEntries(editProductImages.flatMap((image) => editImageTransforms[image] ? [[image, editImageTransforms[image]]] : [])),
      imageVariants: Object.fromEntries(editProductImages.flatMap((image) => editProductImageVariants[image] ? [[image, editProductImageVariants[image]]] : [])),
      slug: activeProduct.slug || createUrlSlug(name),
      stock: editProductOneOfAKind ? 1 : stock,
      oneOfAKind: editProductOneOfAKind,
      options: editProductOptionType !== 'none' && optionValues.length ? [{ name: editProductOptionType, values: optionValues }] : [],
    }
    const saved = { ...activeProduct, ...changes }
    let persisted = saved
    try { if (storeId) persisted = await saveProduct(storeId, saved) }
    catch (error) { setAuthToast(error instanceof Error ? error.message : 'Toote salvestamine ebaõnnestus'); return }
    if (storeId) {
      setPersistedProducts((current) => {
        const exists = current.some((product) => product.id === persisted.id)
        return exists ? current.map((product) => product.id === persisted.id ? persisted : product) : [...current, persisted]
      })
      setAddedProducts((current) => current.filter((product) => product.id !== persisted.id))
      setProductEdits((current) => {
        const next = { ...current }
        delete next[persisted.id]
        return next
      })
      const previousImages = activeProduct.gallery?.length ? activeProduct.gallery : [activeProduct.image]
      const removedPreviousImages = previousImages.filter((image) => !editProductImages.includes(image))
      const abandonedUploads = [...uploadedDuringEditRef.current].filter((image) => !editProductImages.includes(image))
      if (removedPreviousImages.length) void removeStoredProductImages(activeProduct.imageVariants, removedPreviousImages).catch(() => undefined)
      if (abandonedUploads.length) void removeStoredProductImages(editProductImageVariants, abandonedUploads).catch(() => undefined)
      uploadedDuringEditRef.current.clear()
    } else {
      setProductEdits((current) => ({ ...current, [activeProduct.id]: changes }))
    }
    editSessionImageUrlsRef.current.forEach((url) => committedEditImageUrlsRef.current.add(url))
    editSessionImageUrlsRef.current.clear()
    if (draftProductId === activeProduct.id) {
      setDraftProductId(null)
      setShowAddedToast(true)
    }
    setEditProductImages([])
    setEditProductImageVariants({})
    setEditProductStock('')
    setEditProductOneOfAKind(false)
    setEditProductOptionType('none')
    setEditProductOptionValues('')
    setIsEditOpen(false)
  }

  useEffect(() => {
    // Existing products enter edit mode without forcing iOS to open the
    // keyboard and resize the page. A new draft still starts in the name field.
    if (!isEditOpen || !activeProduct || draftProductId !== activeProduct.id) return
    const frame = window.requestAnimationFrame(() => {
      const nameField = editProductNameRef.current
      if (!nameField) return
      nameField.focus()
      if (!nameField.textContent?.trim()) return
      const range = document.createRange()
      range.selectNodeContents(nameField)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [isEditOpen, activeProduct?.id, draftProductId])

  const buyNow = () => {
    if (!activeProduct || isActiveProductSoldOut) return
    addToCart(activeProduct)
    setCartStep('checkout')
    setIsCartOpen(true)
  }

  const showStoreAsCustomer = () => {
    setIsLoggedIn(false)
    setIsCustomerPreview(false)
    setIsLoginOpen(false)
    setIsCartOpen(false)
    setIsAboutOpen(false)
    setIsSettingsOpen(false)
    setIsOrdersOpen(false)
    setIsAddOpen(false)
    setIsEditOpen(false)
    setIsDeleteOpen(false)
    setIsPasswordChangeOpen(false)
    setIsEmailChangeOpen(false)
    setIsAccountDeleteOpen(false)
    setIsShareOpen(false)
    setIsSearchOpen(false)
    setIsBillingCardOpen(false)
  }

  const logOut = async () => {
    if (isSupabaseConfigured) await requireSupabase().auth.signOut({ scope: 'local' })
    showStoreAsCustomer()
  }

  const requestLoginPasswordReset = async () => {
    setLoginRecoveryMessage('')
    if (!loginEmail.trim()) { setAuthToast('Sisesta esmalt e-posti aadress'); return }
    try {
      if (!isSupabaseConfigured) throw new Error('Supabase ei ole seadistatud.')
      const { error } = await requireSupabase().auth.resetPasswordForEmail(loginEmail.trim(), { redirectTo: window.location.origin })
      if (error) throw error
      setLoginRecoveryMessage('Taastamislink on saadetud sinu e-postile.')
    } catch (error) {
      setAuthToast(error instanceof Error ? error.message : 'Taastamislingi saatmine ebaõnnestus')
    }
  }

  const logOutOtherSessions = async () => {
    if (!isSupabaseConfigured || isSessionActionBusy) return
    setIsSessionActionBusy(true)
    const { error } = await requireSupabase().auth.signOut({ scope: 'others' })
    setIsSessionActionBusy(false)
    setAuthToast(error ? error.message : 'Teised seadmed on välja logitud')
  }

  const logOutEverywhere = async () => {
    if (!isSupabaseConfigured || isSessionActionBusy) return
    setIsSessionActionBusy(true)
    await requireSupabase().auth.signOut({ scope: 'global' })
    setIsSessionActionBusy(false)
    showStoreAsCustomer()
  }

  const openAccountDeletion = () => {
    setAccountDeleteConfirmation('')
    setAccountDeleteError('')
    setIsAccountDeleteOpen(true)
  }

  const openPasswordChange = () => {
    setCurrentPassword('')
    setNewPassword('')
    setNewPasswordConfirmation('')
    setPasswordChangeError('')
    setIsPasswordChangeOpen(true)
  }

  const openEmailChange = () => {
    setNewAccountEmail('')
    setEmailChangePassword('')
    setEmailChangeError('')
    setIsEmailChangeOpen(true)
  }

  const changeEmail = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isChangingEmail) return
    const nextEmail = newAccountEmail.trim().toLowerCase()
    if (!nextEmail || nextEmail === accountEmail.toLowerCase()) { setEmailChangeError('Sisesta praegusest erinev e-posti aadress.'); return }
    setIsChangingEmail(true)
    setEmailChangeError('')
    try {
      if (!isSupabaseConfigured) throw new Error('Supabase ei ole seadistatud.')
      const supabase = requireSupabase()
      const { error: verificationError } = await supabase.auth.signInWithPassword({ email: accountEmail, password: emailChangePassword })
      if (verificationError) throw new Error('Praegune parool ei ole õige.')
      const { error: updateError } = await supabase.auth.updateUser({ email: nextEmail }, { emailRedirectTo: window.location.origin })
      if (updateError) throw updateError
      setIsEmailChangeOpen(false)
      setAuthToast('Kinnituskiri on saadetud uuele e-postile')
    } catch (error) {
      setEmailChangeError(error instanceof Error ? error.message : 'E-posti muutmine ebaõnnestus.')
    } finally {
      setIsChangingEmail(false)
    }
  }

  const changePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isChangingPassword) return
    if (newPassword.length < 8) { setPasswordChangeError('Uus parool peab olema vähemalt 8 tähemärki pikk.'); return }
    if (newPassword !== newPasswordConfirmation) { setPasswordChangeError('Uued paroolid ei ühti.'); return }
    if (currentPassword === newPassword) { setPasswordChangeError('Uus parool peab erinema praegusest paroolist.'); return }
    setIsChangingPassword(true)
    setPasswordChangeError('')
    try {
      if (!isSupabaseConfigured) throw new Error('Supabase ei ole seadistatud.')
      const supabase = requireSupabase()
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError || !user?.email) throw new Error('Sessioon on aegunud. Logi uuesti sisse.')
      const { error: verificationError } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword })
      if (verificationError) throw new Error('Praegune parool ei ole õige.')
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
      if (updateError) throw updateError
      setIsPasswordChangeOpen(false)
      setCurrentPassword('')
      setNewPassword('')
      setNewPasswordConfirmation('')
      setAuthToast('Parool on muudetud')
    } catch (error) {
      setPasswordChangeError(error instanceof Error ? error.message : 'Parooli muutmine ebaõnnestus.')
    } finally {
      setIsChangingPassword(false)
    }
  }

  const deleteAccount = async () => {
    if (accountDeleteConfirmation !== 'KUSTUTA' || isDeletingAccount) return
    setIsDeletingAccount(true)
    setAccountDeleteError('')
    try {
      if (!isSupabaseConfigured) throw new Error('Supabase ei ole seadistatud.')
      const { error } = await requireSupabase().functions.invoke('delete-account', {
        body: { confirmation: accountDeleteConfirmation },
      })
      if (error) throw error
      await requireSupabase().auth.signOut({ scope: 'local' })
      setIsAccountDeleteOpen(false)
      setIsSettingsOpen(false)
      setIsLoggedIn(false)
      onAccountDeleted?.()
    } catch (error) {
      setAccountDeleteError(error instanceof Error ? error.message : 'Konto kustutamine ebaõnnestus.')
    } finally {
      setIsDeletingAccount(false)
    }
  }

  const shareActiveProduct = async () => {
    if (!activeProduct) return
    const url = new URL(window.location.href)
    url.hash = `toode=${encodeURIComponent(activeProduct.id)}`
    const shareData = { title: activeProduct.name, text: activeProduct.description || activeProduct.name, url: url.toString() }
    if (navigator.share) {
      try { await navigator.share(shareData); return } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
    setShareUrl(url.toString())
    setIsShareOpen(true)
  }

  const copyShareUrl = async () => {
    await copyTextToClipboard(shareUrl)
    setIsShareOpen(false)
    setShowCopiedToast(true)
  }

  const storePublicUrl = `${storeSlug || createUrlSlug(editableStoreName) || 'minu-pood'}.poeruum.ee`
  const copyStoreUrl = async () => {
    const url = `https://${storePublicUrl}`
    await copyTextToClipboard(url)
    setShowCopiedToast(true)
  }

  const normalizeCustomDomain = (value: string) => value.trim().toLocaleLowerCase('et')
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .replace(/\.$/, '')

  const applyCustomDomainRecord = (domain: CustomDomainRecord | null) => {
    setCustomDomainRecord(domain)
    setCustomDomain(domain?.hostname ?? '')
    setCustomDomainStatus(domain?.status ?? 'idle')
    setCustomDomainError(domain?.error ?? '')
  }

  const startCustomDomainConnection = async () => {
    if (!storeId || isCustomDomainBusy) return
    const domain = normalizeCustomDomain(customDomain)
    if (!/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
      setCustomDomainError('Sisesta kehtiv domeen, näiteks www.sinupood.ee.')
      return
    }
    if (domain.endsWith('.poeruum.ee')) {
      setCustomDomainError('Poeruumi aadress on sul juba olemas. Siia lisa enda domeen.')
      return
    }
    setIsCustomDomainBusy(true)
    setCustomDomainError('')
    try {
      applyCustomDomainRecord(await manageCustomDomain('create', storeId, domain))
    } catch (error) {
      setCustomDomainError(error instanceof Error ? error.message : 'Domeeni lisamine ebaõnnestus.')
    } finally {
      setIsCustomDomainBusy(false)
    }
  }

  const refreshCustomDomain = async (verify = false, silent = false) => {
    if (!storeId || isCustomDomainBusy) return
    if (!silent) setIsCustomDomainBusy(true)
    setCustomDomainError('')
    try {
      if (verify) setCustomDomainStatus('verifying')
      applyCustomDomainRecord(await manageCustomDomain(verify ? 'verify' : 'status', storeId))
    } catch (error) {
      if (!silent) setCustomDomainError(error instanceof Error ? error.message : 'Domeeni kontrollimine ebaõnnestus.')
    } finally {
      if (!silent) setIsCustomDomainBusy(false)
    }
  }

  const removeCustomDomain = async () => {
    if (!storeId || isCustomDomainBusy) return
    setIsCustomDomainBusy(true)
    setCustomDomainError('')
    try {
      applyCustomDomainRecord(await manageCustomDomain('delete', storeId))
    } catch (error) {
      setCustomDomainError(error instanceof Error ? error.message : 'Domeeni eemaldamine ebaõnnestus.')
    } finally {
      setIsCustomDomainBusy(false)
    }
  }

  const copyDomainRecord = async (value: string) => {
    await copyTextToClipboard(value)
    setShowCopiedToast(true)
  }

  const endShareDrag = (clientY: number) => {
    const distance = shareDragStartRef.current === null ? 0 : Math.max(0, clientY - shareDragStartRef.current)
    if (distance > 80) setIsShareOpen(false)
    setShareDragY(0)
    setIsShareDragging(false)
    shareDragStartRef.current = null
  }

  const deleteActiveProduct = async () => {
    if (!activeProduct) return
    try {
      if (storeId) {
        await removeProduct(activeProduct.id)
        void removeStoredProductImages(activeProduct.imageVariants, activeProduct.gallery?.length ? activeProduct.gallery : [activeProduct.image]).catch(() => undefined)
      }
    }
    catch (error) { setAuthToast(error instanceof Error ? error.message : 'Toote kustutamine ebaõnnestus'); return }
    setPersistedProducts((current) => current.filter((product) => product.id !== activeProduct.id))
    setAddedProducts((current) => current.filter((product) => product.id !== activeProduct.id))
    setDeletedProductIds((ids) => [...ids, activeProduct.id])
    setCart((items) => items.filter((item) => item.id !== activeProduct.id))
    setActiveIndex(0)
    setIsDeleteOpen(false)
    setShowDeletedToast(true)
  }

  const changeOrderStatus = async (orderNumber: string, status: DemoOrder['status']) => {
    try {
      if (storeId && status === 'refunded' && activePaymentProvider === 'stripe') await refundStripeOrder(storeId, orderNumber)
      else if (storeId) await updateOrderStatus(storeId, orderNumber, status)
      setOrders((current) => current.map((item) => item.id === orderNumber ? { ...item, status } : item))
    } catch (error) { setAuthToast(error instanceof Error ? error.message : 'Tellimuse uuendamine ebaõnnestus') }
  }

  const searchResults = displayProducts.filter((product) =>
    `${product.name} ${product.description ?? ''}`.toLocaleLowerCase('et').includes(searchQuery.trim().toLocaleLowerCase('et')),
  )
  const storeInitial = editableStoreName.trim().charAt(0).toLocaleUpperCase('et') || 'P'
  const contactLine = [contactEmail, contactPhone].filter(Boolean).join(' · ')
  const sellerDetailsComplete = Boolean(businessName.trim() && /^\d{8}$/.test(registryCode.trim()) && businessAddress.trim() && contactEmail.trim())
  const newOrderCount = orders.filter((order) => order.status === 'new').length
  const sortedOrders = [...orders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  const normalizedOrderSearch = orderSearch.trim().toLocaleLowerCase('et')
  const visibleOrders = normalizedOrderSearch
    ? sortedOrders.filter((order) => `${order.id} ${order.customerName} ${order.customerEmail} ${order.delivery} ${order.items.map((item) => item.name).join(' ')}`.toLocaleLowerCase('et').includes(normalizedOrderSearch))
    : sortedOrders
  const now = new Date()
  const currentMonthOrders = orders.filter((order) => {
    const createdAt = new Date(order.createdAt)
    return createdAt.getFullYear() === now.getFullYear() && createdAt.getMonth() === now.getMonth()
  })
  const monthlyProductSales = currentMonthOrders.reduce((sum, order) => order.status === 'refunded' ? sum : sum + order.productSubtotal, 0)
  const fixedPlanTrialEndsAt = fixedPlanTrialStartedAt ? new Date(fixedPlanTrialStartedAt) : null
  fixedPlanTrialEndsAt?.setDate(fixedPlanTrialEndsAt.getDate() + FIXED_PLAN_TRIAL_DAYS)
  const isFixedPlanTrialActive = billingPlan === 'fixed' && Boolean(fixedPlanTrialEndsAt && now < fixedPlanTrialEndsAt)
  const fixedPlanTrialDaysLeft = fixedPlanTrialEndsAt ? Math.max(0, Math.ceil((fixedPlanTrialEndsAt.getTime() - now.getTime()) / 86_400_000)) : 0
  const fixedPlanTrialEndLabel = fixedPlanTrialEndsAt?.toLocaleDateString('et-EE', { day: 'numeric', month: 'long', year: 'numeric' })
  const monthlyPlatformFee = billingPlan === 'fixed' ? isFixedPlanTrialActive ? 0 : FIXED_PLAN_MONTHLY_FEE : Math.min(monthlyProductSales * PLATFORM_FEE_RATE, PLATFORM_FEE_CAP)
  const remainingPlatformFee = billingPlan === 'fixed' ? 0 : Math.max(0, PLATFORM_FEE_CAP - monthlyPlatformFee)
  const platformFeeProgress = billingPlan === 'fixed' ? isFixedPlanTrialActive ? 0 : 100 : Math.min(100, monthlyPlatformFee / PLATFORM_FEE_CAP * 100)
  const billingMonth = now.toLocaleDateString('et-EE', { month: 'long', year: 'numeric' })
  const selectBillingPlan = async (plan: PricingPlan) => {
    if (plan === 'fixed' && billingPlan !== 'fixed') {
      setIsBillingCardOpen(true)
      return
    }
    if (plan === 'flexible' && billingPlan === 'fixed' && storeId) {
      try {
        const result = await cancelStripeBilling()
        if (result.effectiveImmediately) setBillingPlan('flexible')
        setAuthToast(result.effectiveImmediately
          ? 'Paindlik pakett on aktiivne.'
          : `Paindlik pakett rakendub ${result.cancelAt ? new Date(result.cancelAt).toLocaleDateString('et-EE') : 'praeguse arveldusperioodi lõpus'}.`)
      } catch (error) { setAuthToast(error instanceof Error ? error.message : 'Paketi muutmine ebaõnnestus') }
      return
    }
    setBillingPlan(plan)
  }
  const setupChecklist = [
    { id: 'store', label: 'Poe põhiandmed', done: Boolean(editableStoreName.trim()), section: 'store' as const },
    { id: 'payments', label: 'Maksed ühendatud', done: paymentsReady, section: 'payments' as const },
    { id: 'delivery', label: 'Tarneviis valitud', done: SHIPPING_PROVIDERS.some((provider) => deliverySettings.parcelProviders[provider].enabled) || deliverySettings.courierEnabled || deliverySettings.pickupEnabled, section: 'delivery' as const },
    { id: 'product', label: 'Esimene toode lisatud', done: displayProducts.length > 0, section: null },
    { id: 'business', label: 'Müüja andmed', done: sellerDetailsComplete, section: 'business' as const },
    { id: 'visible', label: 'Pood avalikustatud', done: isStoreVisible, section: 'store' as const },
  ]
  const completedSetupSteps = setupChecklist.filter((item) => item.done).length
  const setupProgress = Math.round(completedSetupSteps / setupChecklist.length * 100)
  const availableSettingsSections = adminDemoMode
    ? SETTINGS_SECTIONS.filter((section) => !['payments', 'business', 'notifications', 'billing', 'account'].includes(section.id))
    : SETTINGS_SECTIONS
  const activeSettingsSection = availableSettingsSections.find((section) => section.id === settingsSection) ?? availableSettingsSections[0]
  const settingsSectionStatus = (section: SettingsSection) => {
    if (section === 'store') return isStoreVisible ? 'Avalik' : 'Peidetud'
    if (section === 'appearance') return storeTheme === 'midnight' ? 'Tume' : storeTheme === 'paper' ? 'Hele' : 'Värviline'
    if (section === 'payments') return paymentsReady ? 'Ühendatud' : 'Seadista'
    if (section === 'delivery') {
      const count = SHIPPING_PROVIDERS.filter((provider) => deliverySettings.parcelProviders[provider].enabled).length
        + Number(deliverySettings.courierEnabled) + Number(deliverySettings.pickupEnabled)
      return `${count} ${count === 1 ? 'viis' : 'viisi'}`
    }
    if (section === 'business') return sellerDetailsComplete ? 'Lisatud' : 'Pooleli'
    if (section === 'links') {
      const count = [instagramUrl, facebookUrl, tiktokUrl].filter((url) => url.trim()).length
      return count ? `${count} ${count === 1 ? 'link' : 'linki'}` : 'Lisa lingid'
    }
    if (section === 'notifications') return `${Number(sellerNotifications) + Number(customerConfirmations)} aktiivset`
    if (section === 'billing') return billingPlan === 'fixed' ? 'Kindel' : 'Paindlik'
    return null
  }

  const openSetupItem = (item: (typeof setupChecklist)[number]) => {
    setIsSetupChecklistOpen(false)
    if (item.id === 'product') {
      setIsSettingsOpen(false)
      openAddProductChooser()
      return
    }
    if (item.section) {
      setSettingsSection(item.section)
      setIsSettingsHome(false)
      setIsSettingsOpen(true)
    }
  }

  const openStoreDescriptionSettings = () => {
    // Commit the settings view during the user's tap so iOS permits the
    // newly mounted textarea to receive focus and open the keyboard.
    flushSync(() => {
      setSettingsSection('store')
      setIsSettingsHome(false)
      setIsSetupChecklistOpen(false)
      setIsSettingsOpen(true)
    })
    const field = storeDescriptionInputRef.current
    if (!field) return
    field.focus({ preventScroll: true })
    field.scrollIntoView({ block: 'center', behavior: 'auto' })
    window.requestAnimationFrame(() => field.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  }

  const saveNewProduct = async () => {
    if (addProductSubmitLockRef.current) return
    const name = addProductName.trim()
    const price = Number(addProductPrice)
    if (!name || addProductPrice.trim() === '' || !Number.isFinite(price) || price < 0) {
      setAddProductError(!name ? 'Lisa toote nimi.' : 'Lisa korrektne hind.')
      return
    }
    if (!addProductImages.length) {
      setAddProductError('Lisa vähemalt üks tootepilt.')
      return
    }
    addProductSubmitLockRef.current = true
    const product: Product = {
      id: `product-${Date.now()}`,
      name,
      description: addProductDescription.trim(),
      price,
      salePrice: addProductSalePrice.trim() ? Number(addProductSalePrice) : undefined,
      image: addProductImages[0],
      gallery: addProductImages,
      alt: name,
      slug: addProductSlug || createUrlSlug(name),
      seoTitle: addProductSeoTitle.trim() || undefined,
      searchVisible: isAddProductSearchVisible,
    }
    try {
      if (storeId) {
        const persisted = await saveProduct(storeId, product)
        setPersistedProducts((current) => [...current, persisted])
      } else {
        setAddedProducts((current) => [...current, product])
      }
    } catch (error) {
      addProductSubmitLockRef.current = false
      setAddProductError(error instanceof Error ? error.message : 'Toote salvestamine ebaõnnestus')
      return
    }
    setActiveIndex(displayProducts.length)
    setIsAddOpen(false)
    setAddProductStep('source')
    setAddProductImages([])
    setAddProductName('')
    setAddProductDescription('')
    setAddProductPrice('')
    setAddProductSalePrice('')
    setAddProductSeoTitle('')
    setAddProductSlug('')
    setIsAddProductSlugCustom(false)
    setIsAddProductSearchVisible(true)
    setAddProductError('')
    setShowAddedToast(true)
    window.setTimeout(() => { addProductSubmitLockRef.current = false }, 300)
  }

  const announcementTrack = <div className="announcement-bar__track">
    {[0, 1].map((group) => <span className="announcement-bar__group" aria-hidden={group === 1 ? 'true' : undefined} key={group}>
      {[0, 1, 2, 3].map((item) => <span key={item}><b>{announcementText}</b><i>✦</i></span>)}
    </span>)}
  </div>

  return (
    <main className="app-shell" style={{ '--store-accent': storeAccent, '--store-accent-ink': getReadableTextColor(storeAccent), '--announcement-bg': announcementBackground, '--announcement-color': announcementColor } as CSSProperties} data-screensaver={isScreensaverActive ? 'active' : 'idle'} data-store-theme={storeTheme} data-buy-button-size={buyButtonSize} data-announcement={announcementEnabled && announcementText.trim() && !isEditOpen ? 'true' : 'false'} data-announcement-speed={announcementSpeed} data-announcement-direction={announcementDirection} data-store-empty={activeProduct ? 'false' : 'true'} data-inline-editing={isEditOpen ? 'true' : 'false'} data-merchant={merchantMode ? 'true' : 'false'} data-demo={hasPreviewBar ? 'true' : 'false'} data-editing={isAdminMode ? 'true' : 'false'} data-product-editor={isAddOpen && addProductStep === 'details' ? 'true' : 'false'}>
      <input ref={desktopGalleryInputRef} className="source-file-input" type="file" accept="image/*" multiple onChange={(event) => { chooseAddProductImages(event.target.files); event.target.value = '' }} />
      <section className="story-stage">
        {hasPreviewBar && onExit && <div className={`demo-preview-bar${isExitAttentionActive ? ' is-exit-blocked' : ''}`}>
          <button type="button" onClick={requestExit} aria-label={adminDemoMode && isEditOpen ? 'Salvesta muudatused enne administraatori töölauale naasmist' : adminDemoMode ? 'Tagasi administraatori töölauale' : 'Välju näidispoest ja mine tagasi Poeruumi avalehele'}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 7-5 5 5 5M5 12h14" /></svg>
            <span className="demo-preview-bar__exit-long">{adminDemoMode ? 'Tagasi admini' : 'Välju näidispoest'}</span>
            <span className="demo-preview-bar__exit-short">{adminDemoMode ? 'Admin' : 'Välju'}</span>
            {!adminDemoMode && <kbd>Esc</kbd>}
          </button>
          <div><span>Poeruum</span><i aria-hidden="true" />{adminDemoMode ? 'Näidispoe haldus' : 'Näidispood'}</div>
        </div>}
        {merchantMode && isCustomerPreview && <button className="merchant-preview-return" type="button" onClick={() => { setIsLoggedIn(true); setIsCustomerPreview(false) }} aria-label="Tagasi poe muutmisvaatesse">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-1 5 5-1L19 9l-4-4L4 16Z"/><path d="m13 7 4 4"/></svg>
        </button>}
        <nav className="story-progress" aria-label="Tooted">
          {displayProducts.map((product, index) => (
            <button key={product.id} className={index === activeIndex ? 'is-active' : ''} onClick={() => goToProduct(index)} aria-label={`Toode ${index + 1}`}>
              <span />
            </button>
          ))}
        </nav>

        <header className="story-header">
          <div className="story-brand">
            <button className="secret-login-trigger" onClick={handleLogoTap} aria-label={editableStoreName}>
              {storeLogo ? <img src={storeLogo} alt="" /> : <span className="story-logo-fallback" aria-hidden="true">{storeInitial}</span>}
            </button>
            <strong>{editableStoreName.toLocaleUpperCase('et')}</strong>
          </div>
          {!isEditOpen && <div className="header-actions">
            <button className="search-button" onClick={() => setIsSearchOpen(true)} aria-label="Otsi tooteid"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg></button>
            {isAdminMode ? !adminDemoMode && <button className="logout-button" onClick={logOut} aria-label="Logi välja">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H5v14h5M14 8l4 4-4 4m4-4H9" /></svg>
            </button> : <button className={`cart-button${addedProductId ? ' is-bumping' : ''}`} onClick={() => { setCartStep('cart'); setIsCartOpen(true) }} aria-label={`Ostukorv, ${cart.reduce((sum, item) => sum + item.quantity, 0)} toodet`}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2 11h10l2-8H6"/><circle cx="9" cy="19" r="1"/><circle cx="17" cy="19" r="1"/></svg>
              <span>{cart.reduce((sum, item) => sum + item.quantity, 0)}</span>
            </button>}
          </div>}
        </header>

        {announcementEnabled && announcementText.trim() && !isEditOpen && <div className="announcement-bar" aria-label={announcementText}>
          {announcementLink.trim()
            ? <a href={normalizeExternalUrl(announcementLink)} target="_blank" rel="noreferrer">{announcementTrack}</a>
            : <div>{announcementTrack}</div>}
        </div>}

        <div className="story-track" ref={trackRef}>
          {renderedProducts.map((product, index) => (
            <article className="story-slide" key={`${product.id}-${index}`}>
              <img {...getDisplayedProductImageProps(product)} sizes="100vw" alt={product.alt} style={{ objectPosition: product.objectPosition, transform: `translate3d(${getDisplayedImageTransform(product).x}%, ${getDisplayedImageTransform(product).y}%, 0) scale(${getDisplayedImageTransform(product).scale})`, transformOrigin: 'center' }} loading={Math.abs(index - (activeIndex + 1)) <= 1 ? 'eager' : 'lazy'} fetchPriority={Math.abs(index - (activeIndex + 1)) === 0 ? 'high' : 'auto'} decoding={Math.abs(index - (activeIndex + 1)) <= 1 ? 'sync' : 'async'} />
              <div className="story-shade" />
            </article>
          ))}
        </div>

        {!activeProduct && <div className={`empty-storefront${isAdminMode ? ' is-admin' : ''}`}>
          {!isAdminMode && <header className="empty-storefront__header">
            <div className="empty-storefront__identity"><span>{storeInitial}</span><div><strong>{editableStoreName}</strong><button type="button" onClick={copyStoreUrl} aria-label={`Kopeeri poe aadress ${storePublicUrl}`}>{storePublicUrl}<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></button></div></div>
          </header>}
          {isAdminMode && <>
            {onBackToSetup && <button className="empty-storefront__back" type="button" onClick={onBackToSetup} aria-label="Tagasi poe seadistusviisardisse"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6"/><path d="M8 12h11"/></svg></button>}
            <button className="empty-storefront__settings" type="button" onClick={() => { setIsSettingsHome(true); setIsSettingsOpen(true) }} aria-label="Seaded"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A7 7 0 0 0 15 6l-.3-2.6h-4L10.4 6A7 7 0 0 0 8.5 7L6.1 6 4 9.5 6.1 11a7 7 0 0 0 0 2L4 14.5 6.1 18l2.4-1a7 7 0 0 0 1.9 1l.3 2.6h4L15 18a7 7 0 0 0 1.5-1l2.4 1 2-3.5-2-1.5a7 7 0 0 0 .1-1Z"/></svg></button>
          </>}
          {isAdminMode ? <div className="empty-storefront__content">
            <section className="empty-storefront__intro">
              <span><i>✓</i> Pood on aktiivne</span>
              <h1>Hea algus.<br />Nüüd esimene toode.</h1>
              <p>Pildista või vali foto galeriist.</p>
            </section>
            <button
              className={`empty-storefront__product-card${isProductDropActive ? ' is-drop-active' : ''}`}
              type="button"
              onClick={openAddProductChooser}
              onDragEnter={(event) => { event.preventDefault(); productDropDepthRef.current += 1; setIsProductDropActive(true) }}
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}
              onDragLeave={(event) => { event.preventDefault(); productDropDepthRef.current = Math.max(0, productDropDepthRef.current - 1); if (productDropDepthRef.current === 0) setIsProductDropActive(false) }}
              onDrop={(event) => { event.preventDefault(); productDropDepthRef.current = 0; setIsProductDropActive(false); chooseAddProductImages(event.dataTransfer.files) }}
            >
              <span className="empty-storefront__product-visual"><svg viewBox="0 0 48 48" aria-hidden="true"><rect x="7" y="11" width="34" height="27" rx="5"/><path d="m11 33 9-9 6 6 4-4 7 7"/><circle cx="31.5" cy="19" r="3"/></svg><i>+</i></span>
              <span className="empty-storefront__product-copy"><small>{isProductDropActive ? 'FOTOD VALMIS' : 'JÄRGMINE SAMM'}</small><strong>{isProductDropActive ? 'Lase fotod lahti' : 'Alusta lisamist'}</strong><em className="empty-storefront__drop-copy">Vali arvutist või lohista fotod siia</em></span>
              <svg className="empty-storefront__arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M14 7l5 5-5 5"/></svg>
            </button>
          </div> : <div className="empty-storefront__customer"><h1>Pood avaneb peagi.</h1><p>Esimesed tooted on juba teel.</p>{!isCustomerPreview && <button className="empty-storefront__owner-login" type="button" onClick={openOwnerLogin}>Poe omanik? Logi sisse</button>}</div>}
        </div>}

        {activeProduct && isEditOpen && <div className="product-image-editor">
          {editImageUploads.length > 0 && <div className={`product-image-editor__upload-status${editImageUploads.some((upload) => upload.phase === 'error') ? ' is-error' : ''}`} role="status" aria-live="polite">
            {editImageUploads.some((upload) => upload.phase === 'error') ? <span>!</span> : <i />}
            <div><strong>{editImageUploads.some((upload) => upload.phase === 'error') ? 'Pildi üleslaadimine ebaõnnestus' : editImageUploads.some((upload) => upload.phase === 'preparing') ? 'Valmistan fotot ette…' : 'Laen pilti üles…'}</strong><small>{editImageUploads.some((upload) => upload.phase === 'error') ? 'Proovi pisipildi juures uuesti.' : editImageUploads.some((upload) => upload.slow) ? 'Foto on suur, läheb veel veidi.' : 'Võid oodata — aken jääb avatuks.'}</small></div>
          </div>}
          <div className="product-image-editor__gesture-area" aria-label="Tootepildi paigutamine" onPointerDown={handleImagePointerDown} onPointerMove={handleImagePointerMove} onPointerUp={endImagePointer} onPointerCancel={endImagePointer} onWheel={handleImageWheel} onDoubleClick={() => setActiveEditImageTransform(activeEditImageTransform.scale > 1.05 ? DEFAULT_IMAGE_TRANSFORM : { x: 0, y: 0, scale: 2 })} />
          <div className="product-image-editor__tray">
            {editProductImages.map((image, index) => {
              const upload = editImageUploads.find((item) => item.previewUrl === image)
              return <div className={`${(selectedImages[activeProduct.id] ?? 0) === index ? 'is-active' : ''}${upload ? ` is-upload-${upload.phase}` : ''}`} key={`${image}-${index}`}>
              <button type="button" onClick={() => setSelectedImages((current) => ({ ...current, [activeProduct.id]: index }))} aria-label={`Vali pilt ${index + 1}`}><img {...getResponsiveImageProps({ ...activeProduct, imageVariants: editProductImageVariants }, image, 'thumb')} sizes="5rem" alt="" /></button>
              {upload && <span className="product-image-editor__thumbnail-status">{upload.phase === 'error' ? '!' : <i />}</span>}
              {upload?.phase === 'error' ? <><button className="product-image-editor__retry" type="button" onClick={() => startEditImageUpload(upload)}>Proovi uuesti</button><button className="product-image-editor__remove" type="button" aria-label="Eemalda ebaõnnestunud pilt" onClick={() => dismissEditImageUpload(upload)}>×</button></> : !upload && <button className="product-image-editor__remove" type="button" title="Eemalda pilt" aria-label={`Eemalda pilt ${index + 1}`} onClick={() => removeEditProductImage(index)}>×</button>}
              {!upload && (selectedImages[activeProduct.id] ?? 0) === index && <button className="product-image-editor__replace" type="button" title="Vaheta valitud pilt" aria-label="Vaheta valitud pilt" onClick={() => { editProductImageModeRef.current = 'replace'; editProductImageInputRef.current?.click() }}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5"/><path d="M18.2 16.4A7 7 0 1 1 19.5 9L20 12"/></svg>
              </button>}
            </div>})}
            {editProductImages.length < MAX_PRODUCT_IMAGES && <button className="product-image-editor__add" type="button" title="Lisa pilt" aria-label="Lisa pilt" disabled={editImageUploads.length > 0} onClick={() => { editProductImageModeRef.current = 'add'; editProductImageInputRef.current?.click() }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>}
          </div>
          <input ref={editProductImageInputRef} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={(event) => { chooseEditProductImages(event.target.files); event.target.value = '' }} />
        </div>}

        {activeProduct && !isEditOpen && (activeProduct.gallery?.length ?? 1) > 1 && (
          <div className="gallery-thumbnails" aria-label="Toote pildid">
            {(activeProduct.gallery ?? [activeProduct.image]).map((image, index) => (
              <button
                key={image}
                className={(selectedImages[activeProduct.id] ?? 0) === index ? 'is-active' : ''}
                onClick={() => setSelectedImages((current) => ({ ...current, [activeProduct.id]: index }))}
                aria-label={`Pilt ${index + 1}`}
              >
                <img {...getResponsiveImageProps(activeProduct, image, 'thumb')} sizes="5rem" alt="" />
              </button>
            ))}
          </div>
        )}

        {activeProductHasSale && saleBadgeStyle !== 'price' && <div className={`sale-badge sale-badge--${saleBadgeStyle}`} aria-label={`Soodushind, ${activeProductDiscount}% odavam`}>
          {saleBadgeStyle === 'quirky' && <><span aria-hidden="true">Veider</span><strong aria-hidden="true"><i>S</i><i>o</i><i>o</i><i>d</i><i>u</i><i>k</i><i>a</i><i>s</i></strong></>}
          {saleBadgeStyle === 'classic' && <span className="sale-badge__classic" aria-hidden="true">−{activeProductDiscount}%</span>}
          {saleBadgeStyle === 'elegant' && <span className="sale-badge__elegant" aria-hidden="true">Eripakkumine</span>}
          {saleBadgeStyle === 'minimal' && <span className="sale-badge__minimal" aria-hidden="true">Soodus · −{activeProductDiscount}%</span>}
        </div>}
        {activeProduct && <button disabled={isActiveProductSoldOut} className={`buy-now${activeProductHasSale ? ' has-sale' : ''}${activeProductHasSale && saleBadgeStyle === 'price' ? ' has-inline-sale-price' : ''}${isActiveProductSoldOut ? ' is-sold-out' : ''}`} onClick={buyNow}>
          <span>{isActiveProductSoldOut ? 'Välja müüdud' : activeProductHasSale ? 'Osta kohe' : 'Osta'}</span>
          <strong>{activeProductHasSale && saleBadgeStyle === 'price' ? <><s>{activeProduct.price} €</s><span>{activeProduct.salePrice} €</span></> : `${getProductPrice(activeProduct)} €`}</strong>
        </button>}

        {isAdminMode && activeProduct && (
          <div className="admin-global-actions">
            {activeProduct && <button className="admin-add-product" onClick={openAddProductChooser} aria-label="Lisa toode">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </button>}
            <button className="admin-settings" onClick={() => { setIsSettingsHome(true); setIsSettingsOpen(true) }} aria-label={setupProgress < 100 && merchantMode ? `Seaded, ${setupChecklist.length - completedSetupSteps} sammu lõpetamata` : 'Seaded'}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.5 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.08a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.08a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15Z" />
              </svg>
              {setupProgress < 100 && merchantMode && <span className="admin-settings__incomplete" />}
            </button>
            {!adminDemoMode && activeProduct && <button className="admin-orders" type="button" onClick={() => setIsOrdersOpen(true)} aria-label={`Tellimused${newOrderCount ? `, ${newOrderCount} uut` : ''}`}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/></svg>
              {newOrderCount > 0 && <span>{newOrderCount}</span>}
            </button>}
            {merchantMode && activeProduct && <button className="admin-preview" type="button" onClick={() => { setIsLoggedIn(false); setIsCustomerPreview(true) }} aria-label="Vaata poodi kliendina">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>
            </button>}
          </div>
        )}

        {activeProduct && <div className="desktop-arrows" aria-label="Toote vahetamine">
          <button onClick={() => goToProduct(Math.max(0, activeIndex - 1))} disabled={activeIndex === 0} aria-label="Eelmine toode">←</button>
          <button onClick={() => goToProduct(Math.min(displayProducts.length - 1, activeIndex + 1))} disabled={activeIndex === displayProducts.length - 1} aria-label="Järgmine toode">→</button>
        </div>}

      </section>

      {activeProduct && <section className={`product-details${isEditOpen ? ' is-inline-editing' : ''}`} aria-label={isEditOpen ? 'Muuda toodet' : 'Eseme info'}>
        <div className="product-details__heading">
          <h1
            key={isEditOpen ? 'editing-name' : 'viewing-name'}
            ref={isEditOpen ? editProductNameRef : undefined}
            contentEditable={isEditOpen}
            suppressContentEditableWarning
            role={isEditOpen ? 'textbox' : undefined}
            aria-label={isEditOpen ? 'Toote nimi' : undefined}
            data-placeholder={isEditOpen && activeProduct.id === draftProductId ? 'Lisa toote nimi' : undefined}
            spellCheck={isEditOpen}
            onPaste={(event) => pastePlainText(event, true)}
            onKeyDown={(event) => event.key === 'Enter' && event.preventDefault()}
          >{activeProduct.name}</h1>
          <div className="product-heading-actions">
            <button className="share-product" disabled={isEditOpen} onClick={shareActiveProduct} tabIndex={isEditOpen ? -1 : 0} aria-label={isEditOpen ? 'Jaga toodet pärast muudatuste salvestamist' : 'Jaga toodet'}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5"/></svg></button>
            {isAdminMode && <div className="admin-actions">
              {isEditOpen ? <>
                <button onClick={closeEditProduct} tabIndex={-1} aria-label="Loobu muudatustest" title="Loobu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
                <button ref={saveProductButtonRef} className={`save-product-edit${isExitAttentionActive ? ' is-exit-target' : ''}`} disabled={editImageUploads.length > 0} onClick={saveEditedProduct} tabIndex={-1} aria-label="Salvesta muudatused" title="Salvesta"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg></button>
              </> : <>
                <button onClick={openEditProduct} aria-label="Muuda toodet"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-1 5 5-1L19 9l-4-4L4 16Zm9-9 4 4" /></svg></button>
                <button onClick={() => setIsDeleteOpen(true)} aria-label="Kustuta toode"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg></button>
              </>}
            </div>}
          </div>
        </div>
        <div>
          <span>Kirjeldus</span>
          <p
            key={isEditOpen ? 'editing-description' : 'viewing-description'}
            ref={isEditOpen ? editProductDescriptionRef : undefined}
            contentEditable={isEditOpen}
            suppressContentEditableWarning
            role={isEditOpen ? 'textbox' : undefined}
            aria-label={isEditOpen ? 'Toote kirjeldus' : undefined}
            data-placeholder={isEditOpen && activeProduct.id === draftProductId ? 'Lisa toote kirjeldus' : undefined}
            spellCheck={isEditOpen}
            onFocus={(event) => selectEditableContents(event.currentTarget)}
            onPaste={pastePlainText}
          >{activeProduct.description || (activeProduct.id === draftProductId ? '' : '—')}</p>
        </div>
        <div className="product-price">
          <span>Hind</span>
          <div className="price-value">
            {activeProductHasSale ? <>
              <del key={isEditOpen ? 'editing-price' : 'viewing-price'} ref={isEditOpen ? (node) => { editProductPriceRef.current = node } : undefined} contentEditable={isEditOpen} suppressContentEditableWarning role={isEditOpen ? 'textbox' : undefined} aria-label={isEditOpen ? 'Toote tavahind' : undefined} onFocus={(event) => selectEditableContents(event.currentTarget)} onPaste={(event) => pastePlainText(event, true)} onKeyDown={(event) => event.key === 'Enter' && event.preventDefault()}>{activeProduct.price} €</del>
              <strong key={isEditOpen ? 'editing-sale-price' : 'viewing-sale-price'} ref={isEditOpen ? (node) => { editProductSalePriceRef.current = node } : undefined} contentEditable={isEditOpen} suppressContentEditableWarning role={isEditOpen ? 'textbox' : undefined} aria-label={isEditOpen ? 'Toote soodushind' : undefined} onFocus={(event) => selectEditableContents(event.currentTarget)} onPaste={(event) => pastePlainText(event, true)} onKeyDown={(event) => event.key === 'Enter' && event.preventDefault()}>{activeProduct.salePrice} €</strong>
            </> : <>
              <strong key={isEditOpen ? 'editing-price' : 'viewing-price'} ref={isEditOpen ? (node) => { editProductPriceRef.current = node } : undefined} contentEditable={isEditOpen} suppressContentEditableWarning role={isEditOpen ? 'textbox' : undefined} aria-label={isEditOpen ? 'Toote hind' : undefined} data-placeholder={isEditOpen && activeProduct.id === draftProductId ? 'Lisa hind' : undefined} onFocus={(event) => selectEditableContents(event.currentTarget)} onPaste={(event) => pastePlainText(event, true)} onKeyDown={(event) => event.key === 'Enter' && event.preventDefault()}>{activeProduct.price !== undefined ? `${activeProduct.price} €` : activeProduct.id === draftProductId ? '' : '—'}</strong>
              {isEditOpen && <strong className="editable-sale-price" ref={(node) => { editProductSalePriceRef.current = node }} contentEditable suppressContentEditableWarning role="textbox" aria-label="Toote soodushind" data-placeholder="Lisa soodushind" onFocus={(event) => selectEditableContents(event.currentTarget)} onPaste={(event) => pastePlainText(event, true)} onKeyDown={(event) => event.key === 'Enter' && event.preventDefault()} />}
            </>}
          </div>
        </div>
        {isEditOpen && <div className="product-inventory-editor product-inventory-editor--compact">
          <div className="product-inventory-editor__compact-top">
            <label className={editProductOneOfAKind ? 'is-active' : ''}><span><strong>Unikaalne</strong><small>Ainult 1 tk</small></span><input type="checkbox" checked={editProductOneOfAKind} onChange={(event) => { setEditProductOneOfAKind(event.target.checked); if (event.target.checked) setEditProductStock('1') }} /><i aria-hidden="true"><b /></i></label>
            <div className={editProductOneOfAKind ? 'is-disabled' : ''}><span><strong>Laoseis</strong><small>{editProductOneOfAKind ? '1 tk' : editProductStock === '' ? 'Piiramata' : `${editProductStock} tk`}</small></span><div className="product-inventory-editor__stepper"><button type="button" disabled={editProductOneOfAKind || Number(editProductStock || 0) <= 0} onClick={() => setEditProductStock(String(Math.max(0, Number(editProductStock || 0) - 1)))} aria-label="Vähenda laoseisu">−</button><input type="number" aria-label="Laoseis" inputMode="numeric" min="0" step="1" disabled={editProductOneOfAKind} value={editProductStock} onChange={(event) => setEditProductStock(event.target.value)} placeholder="∞" /><button type="button" disabled={editProductOneOfAKind} onClick={() => setEditProductStock(String(Number(editProductStock || 0) + 1))} aria-label="Suurenda laoseisu">+</button></div></div>
          </div>
          <div className="product-inventory-editor__compact-type"><span>Valikud</span><div role="radiogroup" aria-label="Valiku tüüp">{(['none', 'Suurus', 'Värv'] as const).map((type) => <button className={editProductOptionType === type ? 'is-selected' : ''} data-option-type={type} type="button" role="radio" aria-checked={editProductOptionType === type} onClick={() => { if (editProductOptionType !== type) setEditProductOptionValues(''); setEditProductOptionType(type); setIsCustomProductOptionOpen(false) }} key={type}>{type === 'none' ? 'Puuduvad' : type}</button>)}</div></div>
          {editProductOptionType !== 'none' && <div className={`product-inventory-editor__presets is-${editProductOptionType.toLowerCase()}`}>
            {editOptionPresets.map((value) => <button className={editOptionValues.includes(value) ? 'is-selected' : ''} type="button" aria-pressed={editOptionValues.includes(value)} onClick={() => toggleProductOptionValue(value)} key={value}>{editProductOptionType === 'Värv' && <i style={{ background: editColorSwatches[value] }} />}{value}</button>)}
            {editCustomOptionValues.map((value) => <button className="is-selected is-custom" type="button" aria-label={`Eemalda valik ${value}`} onClick={() => toggleProductOptionValue(value)} key={value}>{value}<span aria-hidden="true">×</span></button>)}
            <button className="is-add" type="button" onClick={() => setIsCustomProductOptionOpen((open) => !open)}>+ Muu</button>
            {isCustomProductOptionOpen && <div><input autoFocus value={customProductOption} onChange={(event) => setCustomProductOption(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustomProductOption() } }} placeholder="Lisa valik" /><button type="button" onClick={addCustomProductOption} aria-label="Lisa valik">+</button></div>}
          </div>}
        </div>}
        {!isEditOpen && activeProduct.options?.map((option) => <fieldset className="product-option" key={option.name}>
          <legend><span>{option.name}</span><small>{activeProductSelections[option.name]}</small></legend>
          <div>{option.values.map((value) => <button
            type="button"
            className={activeProductSelections[option.name] === value ? 'is-selected' : ''}
            aria-pressed={activeProductSelections[option.name] === value}
            onClick={() => setSelectedProductOptions((current) => ({ ...current, [activeProduct.id]: { ...getDefaultProductOptions(activeProduct), ...(current[activeProduct.id] ?? {}), [option.name]: value } }))}
            key={value}
          >{value}</button>)}</div>
        </fieldset>)}
        {!isEditOpen && (activeProduct.oneOfAKind || activeProduct.stock !== undefined) && <div className={`product-availability${isActiveProductSoldOut ? ' is-sold-out' : activeProduct.oneOfAKind || activeProduct.stock === 1 ? ' is-last' : ' is-available'}`}>
          <i aria-hidden="true" />
          <span><strong>{isActiveProductSoldOut ? 'Välja müüdud' : activeProduct.oneOfAKind ? 'Ainueksemplar' : activeProduct.stock === 1 ? 'Viimane eksemplar' : 'Laos olemas'}</strong><small>{isActiveProductSoldOut ? 'Hetkel pole tellitav' : 'Saadame 1–2 tööpäevaga'}</small></span>
        </div>}
        <button
          disabled={isEditOpen ? editImageUploads.length > 0 : isActiveProductSoldOut || Boolean(storeSlug && !sellerDetailsComplete)}
          className={`product-details__buy${isEditOpen ? ' is-publish' : `${isActiveProductInCart ? ' is-in-cart' : ''}${addedProductId === activeProduct.id ? ' is-added' : ''}${isActiveProductSoldOut ? ' is-sold-out' : ''}`}`}
          onClick={() => {
            if (isEditOpen) {
              saveEditedProduct()
              return
            }
            if (storeSlug && !sellerDetailsComplete) return
            if (isActiveProductInCart) {
              setCartStep('cart')
              setIsCartOpen(true)
              return
            }
            addToCart(activeProduct)
          }}
        >
          {isEditOpen ? <span>Salvesta ja avalda</span> : storeSlug && !sellerDetailsComplete ? <span>Müük pole veel avatud</span> : isActiveProductSoldOut ? <span>Välja müüdud</span> : isActiveProductInCart ? (
            <span>Ostukorvis · {activeProductCartItem?.quantity} tk</span>
          ) : isActiveProductAtCartLimit ? <span>Saadaval kogus on ostukorvis</span> : <span>Lisa ostukorvi</span>}
        </button>
        <footer className="site-footer">
          {isAdminMode && !storeDescription.trim() && <button className="store-description-missing" type="button" onClick={openStoreDescriptionSettings}>
            <span aria-hidden="true">＋</span>
            <span><strong>Poe tutvustus on puudu</strong><small>Lisa lühike kirjeldus, mida ostja näeb poe jaluses.</small></span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M14 7l5 5-5 5" /></svg>
          </button>}
          {(storeDescription.trim() || storeAboutImage) && <div className={`site-footer__about${storeAboutImage ? ' has-image' : ''}`}>
            {storeAboutImage && <button className="site-footer__about-image" type="button" onClick={() => setIsAboutOpen(true)} aria-label="Ava poe tutvustus"><img src={storeAboutImage} alt="" /></button>}
            <div>{storeDescription.trim() && <p>{storeDescription}</p>}
            {(storeAboutImage || storeDescription.trim().length > 110) && <button type="button" onClick={() => setIsAboutOpen(true)}>Vaata tutvustust →</button>}</div>
          </div>}
          <div className="site-footer__top">
            {storeSlug ? <div className="site-footer__address"><strong>{editableStoreName}</strong>{storeTagline.trim() && <small>{storeTagline.trim()}</small>}{contactLine && <small>{contactLine}</small>}</div> : <a className="site-footer__address" href="https://www.google.com/maps/place//data=!4m2!3m1!1s0x4692948419d85985:0x11a43bd7c43d6ee3?sa=X&ved=1t:8290&ictx=111" target="_blank" rel="noreferrer">
              <strong>Mavi Stuudio</strong><small>Paldiski mnt 25, Tallinn</small>
            </a>}
            {(instagramUrl.trim() || facebookUrl.trim() || tiktokUrl.trim()) && <div className="social-links" aria-label="Sotsiaalmeedia">
              {instagramUrl.trim() && <a href={normalizeExternalUrl(instagramUrl)} target="_blank" rel="noreferrer" aria-label="Instagram">
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" className="social-dot"/></svg>
              </a>}
              {facebookUrl.trim() && <a href={normalizeExternalUrl(facebookUrl)} target="_blank" rel="noreferrer" aria-label="Facebook">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 21v-8h3l.5-3H14V8.5c0-1 .4-1.5 1.7-1.5H18V4.2c-.7-.1-1.7-.2-2.8-.2C12.5 4 11 5.6 11 8.3V10H8v3h3v8"/></svg>
              </a>}
              {tiktokUrl.trim() && <a href={normalizeExternalUrl(tiktokUrl)} target="_blank" rel="noreferrer" aria-label="TikTok">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4v10.3a4.2 4.2 0 1 1-3.3-4.1"/><path d="M14 4c.5 2.7 2.1 4.3 4.8 4.8"/></svg>
              </a>}
            </div>}
          </div>
          {storeSlug && <nav className="site-footer__legal" aria-label="Poe õiguslik teave">
            <button type="button" onClick={() => setLegalView('seller')}>Müüja andmed</button>
            <button type="button" onClick={() => setLegalView('terms')}>Müügitingimused</button>
          </nav>}
          <div className="site-footer__bottom">
            <span>© 2026 {editableStoreName}</span>
            <div className="site-footer__meta">
              {storeSlug ? <span>{storeSlug}.poeruum.ee</span> : <a href="https://poeruum.ee">poeruum.ee</a>}
              {!isLoggedIn && !isCustomerPreview && <><i aria-hidden="true" /><button type="button" onClick={openOwnerLogin} aria-label="Poe omanikule: ava poe halduse sisselogimine">Poe haldus →</button></>}
            </div>
          </div>
        </footer>
      </section>}

      {isAboutOpen && <div className="overlay login-overlay store-about-overlay" onMouseDown={(event) => event.target === event.currentTarget && setIsAboutOpen(false)}>
        <section className="login-sheet store-about-sheet" role="dialog" aria-modal="true" aria-label={`Poest ${editableStoreName}`}>
          <button className="login-sheet__close" type="button" onClick={() => setIsAboutOpen(false)} aria-label="Sulge"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
          {storeAboutImage && <img className="store-about-sheet__image" src={storeAboutImage} alt={`${editableStoreName} tutvustus`} />}
          <span>POEST</span>
          <h2>{editableStoreName}</h2>
          {storeDescription.trim() && <p>{storeDescription}</p>}
          {contactLine && <small>{contactLine}</small>}
        </section>
      </div>}

      {legalView && <div className="overlay login-overlay store-about-overlay" onMouseDown={(event) => event.target === event.currentTarget && setLegalView(null)}>
        <section className="login-sheet store-about-sheet store-legal-sheet" role="dialog" aria-modal="true" aria-label={legalView === 'seller' ? 'Müüja andmed' : 'Müügitingimused'}>
          <button className="login-sheet__close" type="button" onClick={() => setLegalView(null)} aria-label="Sulge"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
          <span>{legalView === 'seller' ? 'KELLELT SA OSTAD' : 'OSTUINFO'}</span>
          <h2>{legalView === 'seller' ? 'Müüja andmed' : 'Müügitingimused'}</h2>
          {legalView === 'seller' ? <dl>
            <div><dt>Ettevõte</dt><dd>{businessName || editableStoreName}</dd></div>
            {registryCode && <div><dt>Registrikood</dt><dd>{registryCode} · Eesti äriregister</dd></div>}
            {businessAddress && <div><dt>Aadress</dt><dd>{businessAddress}</dd></div>}
            {contactEmail && <div><dt>E-post</dt><dd><a href={`mailto:${contactEmail}`}>{contactEmail}</a></dd></div>}
            {contactPhone && <div><dt>Telefon</dt><dd><a href={`tel:${contactPhone.replace(/\s/g, '')}`}>{contactPhone}</a></dd></div>}
          </dl> : <div className="store-legal-sheet__terms">
            <section><h3>Taganemine ja tagastamine</h3><p>{returnsText || DEFAULT_RETURNS_TEXT}</p></section>
            <section><h3>Tarne ja maksmine</h3><p>Tarneviis, selle hind ja eeldatav kättesaamine kuvatakse ostukorvis enne tellimuse kinnitamist. Makseviisid kuvatakse kassas.</p></section>
            <section><h3>Pretensioonid</h3><p>Kaubaga seotud küsimuse või pretensiooni korral võta ühendust aadressil {contactEmail || 'poe kontakt-e-post'}. Tarbijal on õigus pöörduda vaidluse lahendamiseks Tarbijavaidluste komisjoni.</p></section>
            <button type="button" onClick={() => setLegalView('seller')}>Vaata müüja andmeid →</button>
          </div>}
        </section>
      </div>}

      {isCartOpen && <Cart storeId={storeId} items={cart} initialStep={cartStep} paymentProvider={activePaymentProvider} paymentsReady={paymentsReady} deliverySettings={deliverySettings} onRemove={(cartKey) => setCart((items) => items.filter((item) => item.cartKey !== cartKey))} onQuantityChange={(cartKey, quantity) => setCart((items) => {
        const target = items.find((item) => item.cartKey === cartKey)
        if (!target || quantity <= 0) return items.filter((item) => item.cartKey !== cartKey)
        const otherQuantity = items.filter((item) => item.id === target.id && item.cartKey !== cartKey).reduce((sum, item) => sum + item.quantity, 0)
        const allowedQuantity = Math.max(1, Math.min(quantity, getProductStockLimit(target) - otherQuantity))
        return items.map((item) => item.cartKey === cartKey ? { ...item, quantity: allowedQuantity } : item)
      })} onClose={() => setIsCartOpen(false)} />}
      {isOrdersOpen && <div className="overlay login-overlay orders-overlay" onMouseDown={(event) => event.target === event.currentTarget && setIsOrdersOpen(false)}>
        <section className="login-sheet orders-sheet" role="dialog" aria-modal="true" aria-label="Tellimused">
          <button className="login-sheet__close" onClick={() => setIsOrdersOpen(false)} aria-label="Sulge"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
          <div className="orders-heading">
            <span>TELLIMUSED</span><h2>{newOrderCount ? newOrderCount === 1 ? '1 uus tellimus' : `${newOrderCount} uut tellimust` : 'Kõik on tehtud'}</h2><p>Siin näed sinu poele tehtud oste. Uuemad on alati ees.</p>
            <label className="orders-search">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg>
              <input type="text" inputMode="search" value={orderSearch} onChange={(event) => setOrderSearch(event.target.value)} placeholder="Otsi tellimusi" aria-label="Otsi tellimuse, kliendi või toote järgi" />
            </label>
            <div className="orders-layout-toggle" role="group" aria-label="Tellimuste paigutus">
              <button type="button" className={orderLayout === 'grid' ? 'is-active' : ''} aria-pressed={orderLayout === 'grid'} onClick={() => setOrderLayout('grid')}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>Ruudustik</button>
              <button type="button" className={orderLayout === 'list' ? 'is-active' : ''} aria-pressed={orderLayout === 'list'} onClick={() => setOrderLayout('list')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="5" cy="6" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="18" r="1"/></svg>Nimekiri</button>
            </div>
          </div>
          {orders.length ? <div className={`order-list${orderLayout === 'list' ? ' is-list' : ''}`}>{visibleOrders.length ? visibleOrders.map((order) => <article className={order.status === 'new' ? 'is-new' : order.status === 'refunded' ? 'is-refunded' : ''} key={order.id}>
            <header><div><strong>{order.id}</strong><small>{new Date(order.createdAt).toLocaleString('et-EE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></div><span>{order.status === 'new' ? 'Uus' : order.status === 'refunded' ? 'Tagastatud' : 'Täidetud'}</span></header>
            <div className="order-customer"><strong>{order.customerName}</strong><a href={`mailto:${order.customerEmail}`}>{order.customerEmail}</a><small>{order.delivery}</small></div>
            <ul>{order.items.map((item) => <li key={item.cartKey}><img {...getResponsiveImageProps(item, item.image, 'thumb')} sizes="4rem" alt="" /><span>{item.name}{item.quantity > 1 ? ` × ${item.quantity}` : ''}{Object.keys(item.selectedOptions).length ? <small>{Object.values(item.selectedOptions).join(' · ')}</small> : null}</span><strong>{formatEuro(getProductPrice(item) * item.quantity)}</strong></li>)}</ul>
            {Boolean(order.stripeSellerNet) && <dl className="order-settlement"><div><dt>Stripe’i maksetasu</dt><dd>−{formatEuro(order.stripeProcessingFee ?? 0)}</dd></div><div><dt>Poeruumi teenustasu</dt><dd>−{formatEuro(order.stripePlatformFee ?? 0)}</dd></div><div><dt>Sulle laekub</dt><dd>{formatEuro(order.stripeSellerNet ?? 0)}</dd></div></dl>}
            <footer><strong>{order.status === 'refunded' ? <s>{order.total.toFixed(2).replace('.', ',')} €</s> : `${order.total.toFixed(2).replace('.', ',')} €`}</strong>{order.status === 'new' ? <button type="button" onClick={() => changeOrderStatus(order.id, 'fulfilled')}>Märgi täidetuks</button> : order.status === 'fulfilled' ? <button className="order-refund" type="button" onClick={() => changeOrderStatus(order.id, 'refunded')}>Märgi tagastatuks</button> : <small>Poeruumi tasu krediteeritud</small>}</footer>
          </article>) : <div className="orders-no-results"><span>⌕</span><h3>Tellimusi ei leitud</h3><p>Proovi tellimuse numbrit, kliendi nime või toodet.</p><button type="button" onClick={() => setOrderSearch('')}>Tühjenda otsing</button></div>}</div> : <div className="orders-empty"><span>□</span><h3>Tellimusi veel pole</h3><p>Uued ostud ilmuvad siia automaatselt.</p></div>}
        </section>
      </div>}
      {isSettingsOpen && <div className="overlay login-overlay settings-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) { setIsSettingsOpen(false); setIsSettingsHome(true) } }}>
        <section className={`login-sheet settings-sheet${isSettingsHome ? ' is-home' : ''}`} role="dialog" aria-modal="true" aria-label="Seaded">
          <button className="login-sheet__close" onClick={() => { setIsSettingsOpen(false); setIsSettingsHome(true) }} aria-label="Sulge"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
          <div className="settings-titlebar">
            {!isSettingsHome && <button className="settings-titlebar__back" type="button" onClick={() => setIsSettingsHome(true)} aria-label="Kõik seaded"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg><span>Seaded</span></button>}
            <h2>{isSettingsHome ? 'Seaded' : activeSettingsSection.label}</h2>
            <button className={`settings-save-button is-${settingsSaveStatus}${hasUnsavedSettings ? ' has-changes' : ''}`} type="button" disabled={!hasUnsavedSettings || settingsSaveStatus === 'saving'} onClick={saveSettings}>
              {settingsSaveStatus === 'saving' ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.35-5.65"/></svg> : settingsSaveStatus === 'saved' && !hasUnsavedSettings ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg> : null}
              <span>{settingsSaveStatus === 'saving' ? 'Salvestan…' : settingsSaveStatus === 'saved' && !hasUnsavedSettings ? 'Salvestatud' : 'Salvesta'}</span>
            </button>
          </div>
          {isSettingsHome ? <div className="settings-home">
            <p>Vali, mida soovid muuta.</p>
            <div>{availableSettingsSections.map((section) => {
              const status = settingsSectionStatus(section.id)
              return <button type="button" data-section={section.id} onClick={() => { setSettingsSection(section.id); setIsSettingsHome(false) }} key={section.id}>
                <span className="settings-home__icon"><SettingsSectionIcon section={section.id} /></span>
                <span className="settings-home__copy"><strong>{section.label}</strong><small>{section.description}</small></span>
                {status && <em>{status}</em>}
                <svg className="settings-home__arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
              </button>
            })}</div>
          </div> : null}
          {settingsSection === 'store' && <div className="settings-panel" role="tabpanel">
            <header><span>POE SEADED</span><p>Halda poe nähtavust ja põhiandmeid.</p></header>
            {merchantMode && <div className={`settings-onboarding${isSetupChecklistOpen ? ' is-open' : ''}`}>
              <button className="settings-onboarding__summary" type="button" aria-expanded={isSetupChecklistOpen} onClick={() => setIsSetupChecklistOpen((open) => !open)}>
                <span><strong>{setupProgress === 100 ? 'Pood on valmis' : 'Poe seadistus'}</strong><small>{completedSetupSteps}/{setupChecklist.length} tehtud</small></span>
                <b>{setupProgress}%</b>
                <i><span style={{ width: `${setupProgress}%` }} /></i>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4" /></svg>
              </button>
              {isSetupChecklistOpen && <div className="settings-onboarding__list">
                {[...setupChecklist].sort((first, second) => Number(first.done) - Number(second.done)).map((item) => <button type="button" className={item.done ? 'is-done' : 'is-next'} onClick={() => !item.done && openSetupItem(item)} key={item.id}>
                  <i>{item.done ? '✓' : ''}</i><span>{item.label}{!item.done && <small>Järgmine samm</small>}</span>{!item.done && <b>Alusta <span aria-hidden="true">→</span></b>}
                </button>)}
              </div>}
            </div>}
            {!adminDemoMode && <label className="settings-toggle settings-visibility"><span><strong>Pood on avalik</strong><small>{isStoreVisible ? 'Kliendid saavad sinu poodi külastada' : sellerDetailsComplete ? 'Poodi näed praegu ainult sina' : 'Lisa enne avaldamist müüja andmed'}</small></span><input type="checkbox" checked={isStoreVisible} onChange={(event) => {
              if (event.target.checked && !sellerDetailsComplete) {
                setAuthToast('Enne poe avaldamist lisa täielikud müüja andmed')
                setSettingsSection('business')
                setIsSettingsHome(false)
                return
              }
              setIsStoreVisible(event.target.checked)
            }} /><i /></label>}
            <div className="settings-fields">
              <label>Poe nimi<input value={editableStoreName} onChange={(event) => setEditableStoreName(event.target.value)} placeholder="Minu pood" /></label>
              <label>Poe slogan<input value={storeTagline} maxLength={100} onChange={(event) => setStoreTagline(event.target.value)} placeholder="Lühike lause sinu poe kohta" /><small className="settings-field-note">Valikuline · kuvatakse poe nime all jaluses · {storeTagline.length}/100</small></label>
              <label>Poe tutvustus<textarea ref={storeDescriptionInputRef} rows={4} maxLength={600} value={storeDescription} onChange={(event) => setStoreDescription(event.target.value)} placeholder="Kirjuta lühidalt, mida sinu pood pakub ja miks see eriline on." /><small className="settings-field-note">Kuvatakse ostjale poe jaluses · {storeDescription.length}/600</small></label>
              <div className="settings-about-image">
                <span className="settings-section-label">Tutvustuse pilt <small>valikuline</small></span>
                <div>
                  <label className="settings-about-image__upload">
                    <span className="settings-about-image__preview">{storeAboutImage ? <img src={storeAboutImage} alt="Tutvustuse pildi eelvaade" /> : <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m5 17 5-5 3 3 2-2 4 4"/><circle cx="16.5" cy="9.5" r="1.5"/></svg>}</span>
                    <span className="settings-about-image__copy"><strong>{storeAboutImage ? 'Vaheta pilti' : 'Lisa pilt'}</strong><small>JPG, PNG või WebP · soovituslikult horisontaalne</small></span>
                    <span className="settings-about-image__icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V5M8 9l4-4 4 4"/><path d="M5 14v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4"/></svg></span>
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { changeStoreAboutImage(event.target.files?.[0]); event.target.value = '' }} />
                  </label>
                  {storeAboutImage && <button className="settings-about-image__remove" type="button" onClick={removeStoreAboutImage} aria-label="Eemalda tutvustuse pilt">×</button>}
                </div>
                <small>Demos pilti serverisse ei salvestata.</small>
              </div>
              <div><label>Kontakt-e-post<input type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} placeholder="tere@minupood.ee" /></label><label>Telefon<input type="tel" value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} placeholder="+372 5555 5555" /></label></div>
              <div className="settings-store-address">
                <span><small>Poe aadress</small><strong>{storePublicUrl}</strong></span>
                <button type="button" onClick={copyStoreUrl} aria-label={`Kopeeri poe aadress ${storePublicUrl}`}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>Kopeeri</button>
              </div>
              <div className="settings-domain-flow" data-status={customDomainStatus}>
                <div className="settings-domain-flow__heading">
                  <span><strong>Oma domeen</strong><small>Ühenda domeen, mille oled ostnud Zone’ist, Veebimajutusest või mujalt.</small></span>
                  {customDomainStatus !== 'idle' && <b>{customDomainStatus === 'pending_dns' ? 'Ootan DNS-i' : customDomainStatus === 'verifying' ? 'HTTPS loomisel' : customDomainStatus === 'active' ? 'Ühendatud' : 'Vajab tähelepanu'}</b>}
                </div>
                {customDomainStatus === 'idle' && <div className="settings-domain-connect">
                  <div className="settings-domain-flow__start">
                    <label>Sinu olemasolev domeen<input value={customDomain} onChange={(event) => { setCustomDomain(event.target.value); setCustomDomainError('') }} onKeyDown={(event) => event.key === 'Enter' && startCustomDomainConnection()} placeholder="www.sinupood.ee" autoCapitalize="none" autoCorrect="off" spellCheck={false} /></label>
                    {customDomainError && <p role="alert">{customDomainError}</p>}
                    <button type="button" disabled={isCustomDomainBusy} onClick={() => void startCustomDomainConnection()}>{isCustomDomainBusy ? 'Lisan domeeni…' : 'Alusta ühendamist'} <span>→</span></button>
                    <small>Domeen jääb sinu praeguse registripidaja juurde. Poeruum annab järgmises sammus vajaliku DNS-kirje.</small>
                  </div>
                </div>}

                {customDomainRecord && customDomainStatus !== 'active' && <div className="settings-domain-connect">
                  <div className="settings-domain-flow__steps" aria-label="Domeeni ühendamise edenemine">
                    <span className="is-done"><i>1</i><small>Domeen</small></span>
                    <span className={customDomainStatus === 'pending_dns' ? 'is-active' : 'is-done'}><i>2</i><small>DNS</small></span>
                    <span className={customDomainStatus === 'verifying' ? 'is-active' : ''}><i>3</i><small>HTTPS</small></span>
                  </div>
                  {customDomainRecord.dnsRecord && <div className="settings-domain-flow__dns">
                    <div className="settings-domain-flow__intro"><span>2</span><p><strong>Lisa domeenihalduris järgmine DNS-kirje</strong><small>Ava teenus, kust domeeni ostsid, ja sisesta täpselt need väärtused.</small></p></div>
                    <div className="settings-domain-record"><b>{customDomainRecord.dnsRecord.type}</b><span><small>Nimi / host</small><code>{customDomainRecord.dnsRecord.name}</code></span><span><small>Väärtus</small><code>{customDomainRecord.dnsRecord.value}</code></span><button type="button" onClick={() => copyDomainRecord(customDomainRecord.dnsRecord!.value)} aria-label="Kopeeri DNS-kirje väärtus"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></button></div>
                    <p className="settings-domain-flow__notice"><span>i</span>Ära muuda MX-kirjeid ega nimeservereid. DNS-i levimine võib võtta mõnest minutist kuni 48 tunnini.</p>
                    {customDomainStatus === 'verifying' && <div className="settings-domain-flow__checking" role="status"><i /><strong>DNS on leitud</strong><p>Render loob domeenile turvalist HTTPS-sertifikaati.</p><small>Kontrollime olekut automaatselt iga 15 sekundi järel.</small></div>}
                    <div className="settings-domain-flow__actions"><button type="button" disabled={isCustomDomainBusy} onClick={() => void removeCustomDomain()}>Eemalda</button><button type="button" disabled={isCustomDomainBusy} onClick={() => void refreshCustomDomain(true)}>{isCustomDomainBusy ? 'Kontrollin…' : 'Kontrolli ühendust'} <span>→</span></button></div>
                  </div>}
                  {customDomainError && <p className="settings-domain-error" role="alert">{customDomainError}</p>}
                  {customDomainStatus === 'error' && <div className="settings-domain-flow__actions"><button type="button" disabled={isCustomDomainBusy} onClick={() => void removeCustomDomain()}>Eemalda</button><button type="button" disabled={isCustomDomainBusy} onClick={() => void startCustomDomainConnection()}>Proovi uuesti <span>→</span></button></div>}
                </div>}

                {customDomainStatus === 'active' && <div className="settings-domain-flow__connected">
                  <div className="settings-domain-connected__summary">
                    <span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg></span>
                    <div><small>DNS JA HTTPS AKTIIVSED</small><strong>{customDomain}</strong><p>Domeen suunab turvaliselt sinu Poeruumi poodi.</p></div>
                  </div>
                  <a className="settings-domain-open" href={`https://${customDomain}`} target="_blank" rel="noreferrer">Ava pood <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M19 5l-9 9"/><path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg></a>
                  {customDomainError && <p className="settings-domain-error" role="alert">{customDomainError}</p>}
                  <button className="settings-domain-remove" type="button" disabled={isCustomDomainBusy} onClick={() => void removeCustomDomain()}>{isCustomDomainBusy ? 'Eemaldan…' : 'Eemalda ühendus'}</button>
                </div>}
              </div>
            </div>
            <div className="settings-seo-status"><span>✓</span><div><strong>Google’iks valmis</strong><small>Tootelehed, otsinguandmed ja sitemap luuakse automaatselt.</small></div><b>Automaatne</b></div>
          </div>}
          {settingsSection === 'appearance' && <div className="settings-panel" role="tabpanel">
            <header><span>VÄLIMUS</span><p>Kohanda poe ilmet ja toodete esitlemist.</p></header>
            <div className="settings-logo">
              <span className="settings-section-label">Poe logo</span>
              <div>
                <label className="settings-logo__upload">
                  <span className="settings-logo__preview">{storeLogo ? <img src={storeLogo} alt="Poe logo eelvaade" /> : <b>{storeInitial}</b>}</span>
                  <span className="settings-logo__copy"><strong>{storeLogo ? 'Vaheta logo' : 'Lisa logo'}</strong><small>PNG, JPG, WebP või SVG</small></span>
                  <span className="settings-logo__icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V5M8 9l4-4 4 4"/><path d="M5 14v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4"/></svg></span>
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => { changeStoreLogo(event.target.files?.[0]); event.target.value = '' }} />
                </label>
                {storeLogo && <button className="settings-logo__remove" type="button" onClick={removeStoreLogo} aria-label="Eemalda poe logo">×</button>}
              </div>
              <small>Demos pilti serverisse ei salvestata.</small>
            </div>
            <div className="settings-theme">
              <span>Kujundus</span>
              <div>{([
                ['midnight', 'Öö', 'Tume ja elegantne'], ['paper', 'Paber', 'Hele ja rahulik'], ['pop', 'Popp', 'Julge ja värviline'],
              ] as Array<[StoreTheme, string, string]>).map(([id, label, description]) => <button type="button" aria-pressed={storeTheme === id} className={`settings-theme__choice settings-theme__choice--${id}${storeTheme === id ? ' is-selected' : ''}`} onClick={() => setStoreTheme(id)} key={id}>
                <span className="settings-theme__preview"><i /><em>{storeInitial}</em><b>32 €</b></span>
                <span className="settings-theme__meta"><strong>{label}</strong><small>{description}</small></span>
                <span className="settings-theme__check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 12 4 4 8-9" /></svg></span>
              </button>)}</div>
            </div>
            <div className="settings-accent">
              <span className="settings-section-label">Aktsentvärv</span>
              <p>Valitud värvi kasutatakse „Osta”, „Lisa ostukorvi” ja „Maksa” nuppudel.</p>
              <div className="settings-accent__choices">
                {ACCENT_PRESETS.map((color) => <button type="button" className={storeAccent.toLowerCase() === color ? 'is-selected' : ''} style={{ backgroundColor: color }} aria-label={`Vali aktsentvärv ${color}`} aria-pressed={storeAccent.toLowerCase() === color} onClick={() => setStoreAccent(color)} key={color}><span>✓</span></button>)}
                <label className="settings-accent__custom" aria-label="Vali oma aktsentvärv">
                  <input type="color" value={storeAccent} onChange={(event) => setStoreAccent(event.target.value)} />
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>
                </label>
              </div>
              <div className="settings-accent__preview" data-size={buyButtonSize}><span>Osta <strong>32 €</strong></span><small>{storeAccent.toUpperCase()}</small></div>
              <div className="settings-buy-size">
                <span><strong>„Osta” nupu suurus</strong><small>Muudab tootepildil oleva nupu suurust.</small></span>
                <div role="group" aria-label="Osta nupu suurus">
                  {([['small', 'Väike'], ['medium', 'Tavaline'], ['large', 'Suur']] as Array<[BuyButtonSize, string]>).map(([size, label]) => <button type="button" className={buyButtonSize === size ? 'is-selected' : ''} aria-pressed={buyButtonSize === size} onClick={() => setBuyButtonSize(size)} key={size}>{label}</button>)}
                </div>
              </div>
            </div>
            <div className="settings-sale-style">
              <span className="settings-section-label">Soodushinna stiil</span>
              <div>{([
                ['quirky', 'Veider', 'Veider\nSoodukas'],
                ['classic', 'Klassikaline', '−30%'],
                ['price', 'Hinnasilt', '18 €|12 €'],
                ['elegant', 'Elegantne', 'Eripakkumine'],
                ['minimal', 'Minimalistlik', 'Soodus · −30%'],
              ] as Array<[SaleBadgeStyle, string, string]>).map(([style, label, preview]) => <button type="button" className={saleBadgeStyle === style ? 'is-selected' : ''} aria-pressed={saleBadgeStyle === style} onClick={() => setSaleBadgeStyle(style)} key={style}>
                <span className={`settings-sale-style__preview is-${style}`}>{style === 'price' ? <><s>18 €</s><b>12 €</b></> : preview.split('\n').map((line) => <i key={line}>{line}</i>)}</span>
                <strong>{label}</strong>
                <em aria-hidden="true">✓</em>
              </button>)}</div>
            </div>
            <div className={`settings-announcement${announcementEnabled ? ' is-enabled' : ''}`}>
              <label className="settings-toggle"><span><strong>Liikuv teateriba</strong><small>Kuvatakse poe päise all</small></span><input type="checkbox" checked={announcementEnabled} onChange={(event) => setAnnouncementEnabled(event.target.checked)} /><i /></label>
              {announcementEnabled && <div className="settings-announcement__content">
                <div className="settings-announcement__preview" style={{ '--announcement-bg': announcementBackground, '--announcement-color': announcementColor } as CSSProperties}>{announcementTrack}</div>
                <label>Teade<input value={announcementText} maxLength={120} onChange={(event) => setAnnouncementText(event.target.value)} placeholder="Tasuta tarne alates 50 €" /></label>
                <label>Link <small>valikuline</small><input type="url" value={announcementLink} onChange={(event) => setAnnouncementLink(event.target.value)} placeholder="https://minupood.ee/pakkumine" /></label>
                <div className="settings-announcement__option"><span>Kiirus</span><div>{([['slow', 'Aeglane'], ['normal', 'Tavaline'], ['fast', 'Kiire']] as Array<[AnnouncementSpeed, string]>).map(([speed, label]) => <button type="button" className={announcementSpeed === speed ? 'is-selected' : ''} aria-pressed={announcementSpeed === speed} onClick={() => setAnnouncementSpeed(speed)} key={speed}>{label}</button>)}</div></div>
                <div className="settings-announcement__option is-direction"><span>Suund</span><div>{([['left', '← Vasakule'], ['right', 'Paremale →']] as Array<[AnnouncementDirection, string]>).map(([direction, label]) => <button type="button" className={announcementDirection === direction ? 'is-selected' : ''} aria-pressed={announcementDirection === direction} onClick={() => setAnnouncementDirection(direction)} key={direction}>{label}</button>)}</div></div>
                <div className="settings-announcement__colors"><span>Värvid</span><div><label aria-label="Teateriba taustavärv"><input type="color" value={announcementBackground} onChange={(event) => setAnnouncementBackground(event.target.value)} /><i style={{ background: announcementBackground }} /></label><label aria-label="Teateriba tekstivärv"><input type="color" value={announcementColor} onChange={(event) => setAnnouncementColor(event.target.value)} /><i style={{ background: announcementColor }} /></label></div></div>
              </div>}
            </div>
            <label className="settings-toggle"><span><strong>Automaatne vahetamine</strong><small>Vahetab tegevuseta olekus tooteid</small></span><input type="checkbox" checked={autoSwipeEnabled} onChange={(event) => setAutoSwipeEnabled(event.target.checked)} /><i /></label>
            <fieldset disabled={!autoSwipeEnabled}>
              <label>Käivitub pärast<select value={autoSwipeDelay} onChange={(event) => setAutoSwipeDelay(Number(event.target.value))}><option value="15">15 sekundit</option><option value="30">30 sekundit</option><option value="60">1 minut</option></select></label>
              <label>Vahetamise kiirus<select value={autoSwipeSpeed} onChange={(event) => setAutoSwipeSpeed(Number(event.target.value))}><option value="5">5 sekundit</option><option value="10">10 sekundit</option><option value="15">15 sekundit</option></select></label>
            </fieldset>
          </div>}
          {settingsSection === 'payments' && <div className="settings-panel payments-panel" role="tabpanel">
            <header><p>Vali, kuidas kliendid sinu poes maksavad.</p></header>
            <div className="settings-provider-list">
              {([
                ['stripe', 'Stripe', 'Kliendid saavad maksta kaardi, Apple Pay või Google Payga. Raha liigub sinu kontole.', 'Ühenda, et võtta vastu kaardi- ja nutimakseid.'],
              ] as Array<[PaymentProvider, string, string, string]>).map(([id, name, connectedDetail, disconnectedDetail]) => {
                const isCurrentProvider = activePaymentProvider === id
                return <button type="button" disabled={isCurrentProvider} aria-pressed={isCurrentProvider} className={isCurrentProvider ? `is-active${paymentsReady ? '' : ' is-pending'}` : ''} onClick={() => onConnectPaymentProvider ? onConnectPaymentProvider(id) : setAuthToast('Makseteenuse ühendamine on saadaval kaupmehe vaates')} key={id}>
                <span className="settings-provider-logo is-stripe">S</span>
                <span><strong>{name}</strong><small>{isCurrentProvider ? paymentsReady ? connectedDetail : 'Teenusepakkuja kontrollib sinu andmeid. Makseid saab vastu võtta pärast kinnitamist.' : disconnectedDetail}</small></span>
                <i className="settings-provider-status">{isCurrentProvider ? paymentsReady ? <><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12 4 4 8-9" /></svg><span>Ühendatud</span></> : <span>Kontrollimisel</span> : <span>Ühenda</span>}</i>
              </button>})}
            </div>
            {paymentsReady && activePaymentProvider === 'stripe' && <button className="settings-secondary-action" type="button" onClick={() => setAuthToast('Stripe’i töölaud avaneb päris ühenduses')}>
              <span>Ava Stripe’i töölaud</span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8"/><path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>
            </button>}
          </div>}
          {settingsSection === 'delivery' && <div className="settings-panel delivery-panel" role="tabpanel">
            <header><span>TARNE</span><p>Vali tarneviisid ja määra, kui palju ostja nende eest maksab.</p></header>
            <div className="settings-delivery-list">
              {SHIPPING_PROVIDERS.map((provider) => {
                const providerSettings = deliverySettings.parcelProviders[provider]
                const otherParcelProviderEnabled = SHIPPING_PROVIDERS.some((item) => item !== provider && deliverySettings.parcelProviders[item].enabled)
                return <div className="settings-delivery-provider" key={provider}>
                  <label className="settings-toggle"><span><strong>{SHIPPING_PROVIDER_LABELS[provider]} pakiautomaat</strong><small>Asukohad kuvatakse ostjale kassas</small></span><input type="checkbox" checked={providerSettings.enabled} disabled={providerSettings.enabled && !otherParcelProviderEnabled && !deliverySettings.courierEnabled && !deliverySettings.pickupEnabled} onChange={(event) => setDeliverySettings((current) => ({ ...current, parcelProviders: { ...current.parcelProviders, [provider]: { ...current.parcelProviders[provider], enabled: event.target.checked } } }))} /><i /></label>
                  {providerSettings.enabled && <label className="settings-price-field">Tarne hind<input type="number" min="0" step="0.1" value={providerSettings.price} onChange={(event) => setDeliverySettings((current) => ({ ...current, parcelProviders: { ...current.parcelProviders, [provider]: { ...current.parcelProviders[provider], price: Number(event.target.value) } } }))} /><span>€</span></label>}
                </div>
              })}
              <div className="settings-delivery-provider">
                <label className="settings-toggle"><span><strong>Kuller</strong><small>Tarne kliendi aadressile</small></span><input type="checkbox" checked={deliverySettings.courierEnabled} disabled={deliverySettings.courierEnabled && !SHIPPING_PROVIDERS.some((provider) => deliverySettings.parcelProviders[provider].enabled) && !deliverySettings.pickupEnabled} onChange={(event) => setDeliverySettings((current) => ({ ...current, courierEnabled: event.target.checked }))} /><i /></label>
                {deliverySettings.courierEnabled && <label className="settings-price-field">Tarne hind<input type="number" min="0" step="0.1" value={deliverySettings.courierPrice} onChange={(event) => setDeliverySettings((current) => ({ ...current, courierPrice: Number(event.target.value) }))} /><span>€</span></label>}
              </div>
              <div className="settings-delivery-provider">
                <label className="settings-toggle"><span><strong>Tulen ise järele</strong><small>Ostjale tasuta</small></span><input type="checkbox" checked={deliverySettings.pickupEnabled} disabled={deliverySettings.pickupEnabled && !SHIPPING_PROVIDERS.some((provider) => deliverySettings.parcelProviders[provider].enabled) && !deliverySettings.courierEnabled} onChange={(event) => setDeliverySettings((current) => ({ ...current, pickupEnabled: event.target.checked }))} /><i /></label>
              </div>
            </div>
            <div className="settings-fields">
              {deliverySettings.pickupEnabled && <label>Järeletulemise aadress<input value={deliverySettings.pickupAddress} onChange={(event) => setDeliverySettings((current) => ({ ...current, pickupAddress: event.target.value }))} /></label>}
              <label>Ostjale tasuta tarne alates<input type="number" min="0" value={deliverySettings.freeShippingFrom} onChange={(event) => setDeliverySettings((current) => ({ ...current, freeShippingFrom: Number(event.target.value) }))} /><small className="settings-field-note">Sisesta 0, kui tasuta tarne piiri ei ole.</small></label>
            </div>
          </div>}
          {settingsSection === 'business' && <div className="settings-panel" role="tabpanel">
            <header><span>ETTEVÕTE JA TINGIMUSED</span><p>Need andmed kuvatakse kliendile poe tingimustes.</p></header>
            <div className="settings-fields">
              <label>Ettevõtte nimi <small>kohustuslik</small><input required value={businessName} onChange={(event) => setBusinessName(event.target.value)} placeholder="Minu Ettevõte OÜ" /></label>
              <div><label>Registrikood <small>kohustuslik</small><input required inputMode="numeric" pattern="[0-9]{8}" maxLength={8} value={registryCode} onChange={(event) => setRegistryCode(event.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="12345678" /></label><label>Ettevõtte aadress <small>kohustuslik</small><input required value={businessAddress} onChange={(event) => setBusinessAddress(event.target.value)} placeholder="Tänav 1, Tallinn, Eesti" /></label></div>
              <label>Klientide kontakt-e-post <small>kohustuslik</small><input required type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} placeholder="tere@minupood.ee" /></label>
              <label>Tagastustingimused<textarea rows={4} value={returnsText} onChange={(event) => setReturnsText(event.target.value)} /></label>
            </div>
            <div className="settings-info-note"><span>i</span><p>Müüja nimi, 8-kohaline registrikood, aadress ja poe kontakt-e-post peavad olema enne avaldamist lisatud. Andmed kuvatakse ostjale poe jaluses.</p></div>
          </div>}
          {settingsSection === 'links' && <div className="settings-panel" role="tabpanel">
            <header><span>SOTSIAALMEEDIA</span><p>Lisa lingid, mis kuvatakse poe jaluses.</p></header>
            <div className="settings-fields settings-social">
              <label className={`settings-social-card is-instagram${instagramUrl.trim() ? ' has-value' : ''}`}>
                <span className="settings-social-card__brand"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" className="social-dot"/></svg></span>
                <span className="settings-social-card__field"><strong>Instagram</strong><input type="url" value={instagramUrl} onChange={(event) => setInstagramUrl(event.target.value)} placeholder="instagram.com/minupood" /></span>
                <i aria-hidden="true">✓</i>
              </label>
              <label className={`settings-social-card is-facebook${facebookUrl.trim() ? ' has-value' : ''}`}>
                <span className="settings-social-card__brand"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 21v-8h3l.5-3H14V8.5c0-1 .4-1.5 1.7-1.5H18V4.2c-.7-.1-1.7-.2-2.8-.2C12.5 4 11 5.6 11 8.3V10H8v3h3v8"/></svg></span>
                <span className="settings-social-card__field"><strong>Facebook</strong><input type="url" value={facebookUrl} onChange={(event) => setFacebookUrl(event.target.value)} placeholder="facebook.com/minupood" /></span>
                <i aria-hidden="true">✓</i>
              </label>
              <label className={`settings-social-card is-tiktok${tiktokUrl.trim() ? ' has-value' : ''}`}>
                <span className="settings-social-card__brand"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4v10.3a4.2 4.2 0 1 1-3.3-4.1"/><path d="M14 4c.5 2.7 2.1 4.3 4.8 4.8"/></svg></span>
                <span className="settings-social-card__field"><strong>TikTok</strong><input type="url" value={tiktokUrl} onChange={(event) => setTiktokUrl(event.target.value)} placeholder="tiktok.com/@minupood" /></span>
                <i aria-hidden="true">✓</i>
              </label>
            </div>
          </div>}
          {settingsSection === 'notifications' && <div className="settings-panel" role="tabpanel">
            <header><span>TEAVITUSED</span><p>Vali, kellele tellimuste kohta teated saadetakse.</p></header>
            <div className="settings-fields"><label>Tellimuste e-post<input type="email" value={orderNotificationEmail} onChange={(event) => setOrderNotificationEmail(event.target.value)} placeholder={contactEmail || 'tellimused@minupood.ee'} /></label></div>
            <label className="settings-toggle"><span><strong>Uue tellimuse teavitus</strong><small>Saadame müüjale kohe e-kirja</small></span><input type="checkbox" checked={sellerNotifications} onChange={(event) => setSellerNotifications(event.target.checked)} /><i /></label>
            <label className="settings-toggle"><span><strong>Kinnitus kliendile</strong><small>Klient saab tellimuse kokkuvõtte e-postile</small></span><input type="checkbox" checked={customerConfirmations} onChange={(event) => setCustomerConfirmations(event.target.checked)} /><i /></label>
          </div>}
          {settingsSection === 'billing' && <div className="settings-panel billing-panel" role="tabpanel">
            <header><span>ARVELDUS</span><p>Vali müügimahule sobiv pakett. Vahetada saad igal ajal.</p></header>
            <div className="billing-plan-options" role="radiogroup" aria-label="Poeruumi pakett">
              <button type="button" className={billingPlan === 'flexible' ? 'is-selected' : ''} role="radio" aria-checked={billingPlan === 'flexible'} onClick={() => selectBillingPlan('flexible')}>
                <span>PAINDLIK</span><strong>0 € <small>/ kuu</small></strong><p>4% toodete müügilt</p><em>Kuni 39 € kuus + km</em><b>{billingPlan === 'flexible' ? '✓ Valitud' : 'Vali pakett'}</b>
              </button>
              <button type="button" className={billingPlan === 'fixed' ? 'is-selected' : ''} role="radio" aria-checked={billingPlan === 'fixed'} onClick={() => selectBillingPlan('fixed')}>
                <span>KINDEL · 30 PÄEVA TASUTA</span><strong>29 € <small>/ kuu + km</small></strong><p>0% Poeruumi müügitasu</p><em>Esimesed 30 päeva tasuta</em><b>{billingPlan === 'fixed' ? '✓ Valitud' : 'Alusta tasuta'}</b>
              </button>
            </div>
            <div className="billing-current">
              <header><span>{billingMonth}</span><strong>{formatEuro(monthlyPlatformFee)}</strong></header>
              <div className="billing-current__progress"><i style={{ width: `${platformFeeProgress}%` }} /></div>
              <div><span>Toodete müük <strong>{formatEuro(monthlyProductSales)}</strong></span><span>{billingPlan === 'fixed' ? isFixedPlanTrialActive ? `${fixedPlanTrialDaysLeft} päeva tasuta` : '0% müügitasu' : remainingPlatformFee > 0 ? `Kuulaeni ${formatEuro(remainingPlatformFee)}` : 'Hinnalagi täis'}</span></div>
              <small>{billingPlan === 'fixed' ? isFixedPlanTrialActive ? `Prooviperiood lõpeb ${fixedPlanTrialEndLabel}. Seejärel 29 € kuus + km.` : 'Kuutasu ei muutu koos müügimahuga.' : monthlyPlatformFee >= PLATFORM_FEE_CAP ? 'Sel kuul rohkem Poeruumi tasu ei lisandu.' : 'Tasu uuendatakse pärast iga edukat tellimust.'}</small>
            </div>
            <div className="billing-rules">
              <div><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12 4 4 8-9" /></svg></span><p><strong>{billingPlan === 'fixed' ? 'Müügilt 0% Poeruumile' : 'Tarne ei kuulu arvestusse'}</strong><small>{billingPlan === 'fixed' ? 'Müügimahu kasv ei suurenda kuutasu.' : '4% arvutatakse ainult toodete summalt.'}</small></p></div>
              <div><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8H4V4"/><path d="M4.5 8a8 8 0 1 1-.1 7"/></svg></span><p><strong>{billingPlan === 'fixed' ? 'Paketti saad vahetada' : 'Tagastuse tasu krediteeritakse'}</strong><small>{billingPlan === 'fixed' ? isFixedPlanTrialActive ? 'Prooviperiood algas Kindla paketi esmakordsel valimisel.' : 'Uus valik hakkab kehtima järgmisest arvelduskuust.' : 'Tagastatud toodete müük vähendatakse arvestusest.'}</small></p></div>
              <div><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 8.5c-4.5 0-4.5 7 0 7 3.5 0 4.5-7 7-7 4.5 0 4.5 7 0 7-3.5 0-4.5-7-7-7Z"/></svg></span><p><strong>{billingPlan === 'fixed' ? isFixedPlanTrialActive ? '30 päeva tasuta' : 'Kindel kulu iga kuu' : 'Pärast 39 € müüd tasuta'}</strong><small>{billingPlan === 'fixed' ? isFixedPlanTrialActive ? 'Pärast prooviperioodi on kuutasu 29 € + km.' : 'Poeruumi kuutasu on 29 € + km.' : 'Kuu hinnalagi kaitseb sinu kasvu.'}</small></p></div>
            </div>
            <div className="settings-fields billing-fields"><label>Arvete e-post<input type="email" value={billingEmail} onChange={(event) => setBillingEmail(event.target.value)} placeholder={contactEmail || 'arved@minupood.ee'} /><small className="settings-field-note">Kuu kokkuvõte saadetakse järgmise kuu alguses.</small></label></div>
            <div className="settings-info-note"><span>i</span><p>Stripe’i tegelik maksetöötlustasu ja Poeruumi paketipõhine teenustasu arvestatakse iga tehingu järel sinu väljamaksest maha. Ostjale eraldi maksetasu ei lisandu.</p></div>
          </div>}
          {settingsSection === 'account' && <div className="settings-panel account-panel" role="tabpanel">
            <header><span>KONTO</span><p>Halda oma Poeruumi kontot ja sisselogimist.</p></header>
            <div className="account-panel__action account-panel__action--email">
              <span><strong>Sisselogimise e-post</strong><small>{accountEmail || 'Laadin e-posti…'}</small></span>
              <button type="button" onClick={openEmailChange}>Muuda</button>
            </div>
            <div className="account-panel__action">
              <span><strong>Muuda parooli</strong><small>Kinnitamiseks küsime sinu praegust parooli.</small></span>
              <button type="button" onClick={openPasswordChange}>Muuda</button>
            </div>
            <div className="account-panel__action">
              <span><strong>Logi sellest seadmest välja</strong><small>Teistes seadmetes jääd sisse logituks.</small></span>
              <button type="button" onClick={logOut}>Logi välja</button>
            </div>
            <div className="account-sessions">
              <span className="account-sessions__label">SESSIOONID</span>
              <p>Kui kasutasid võõrast seadet või kahtlustad ligipääsu, lõpeta teised aktiivsed sessioonid.</p>
              <div><button type="button" disabled={isSessionActionBusy} onClick={logOutOtherSessions}>Logi teistest seadmetest välja</button><button type="button" disabled={isSessionActionBusy} onClick={logOutEverywhere}>Logi kõikjalt välja</button></div>
            </div>
            <div className="account-danger-zone">
              <span className="account-danger-zone__label">OHUTSOON</span>
              <h3>Kustuta konto jäädavalt</h3>
              <p>Kustutatakse sinu konto, poed, tooted, tellimused ja üles laaditud pildid. Seda toimingut ei saa tagasi võtta.</p>
              <button type="button" onClick={openAccountDeletion}>Kustuta minu konto</button>
            </div>
          </div>}
        </section>
      </div>}
      {isBillingCardOpen && <BillingCardDemo onClose={() => setIsBillingCardOpen(false)} onConfirm={async (checkoutRequestId) => { const url = await startStripeBillingCheckout(checkoutRequestId); window.location.assign(url) }} />}
      {isEmailChangeOpen && <div className="overlay login-overlay account-subdialog-overlay" onMouseDown={(event) => !isChangingEmail && event.target === event.currentTarget && setIsEmailChangeOpen(false)}>
        <section className="login-sheet password-change-sheet" role="dialog" aria-modal="true" aria-labelledby="email-change-title">
          <button className="login-sheet__close" type="button" disabled={isChangingEmail} onClick={() => setIsEmailChangeOpen(false)} aria-label="Sulge"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
          <span className="login-sheet__eyebrow">SISSELOGIMISE E-POST</span>
          <h2 id="email-change-title">Muuda e-posti</h2>
          <p className="password-change-sheet__intro">Praegune aadress on <strong>{accountEmail}</strong>. Uus aadress hakkab kehtima pärast kinnitamist.</p>
          <form onSubmit={changeEmail}>
            <label>Uus e-posti aadress<input type="email" value={newAccountEmail} onChange={(event) => { setNewAccountEmail(event.target.value); setEmailChangeError('') }} autoComplete="email" required disabled={isChangingEmail} autoFocus /></label>
            <label>Praegune parool<input type="password" value={emailChangePassword} onChange={(event) => { setEmailChangePassword(event.target.value); setEmailChangeError('') }} autoComplete="current-password" required disabled={isChangingEmail} /></label>
            {emailChangeError && <p className="password-change-sheet__error" role="alert">{emailChangeError}</p>}
            <button type="submit" disabled={isChangingEmail || !newAccountEmail.trim() || !emailChangePassword}>{isChangingEmail ? 'Saadan…' : 'Saada kinnituskiri'}</button>
          </form>
        </section>
      </div>}
      {isPasswordChangeOpen && <div className="overlay login-overlay account-subdialog-overlay" onMouseDown={(event) => !isChangingPassword && event.target === event.currentTarget && setIsPasswordChangeOpen(false)}>
        <section className="login-sheet password-change-sheet" role="dialog" aria-modal="true" aria-labelledby="password-change-title">
          <button className="login-sheet__close" type="button" disabled={isChangingPassword} onClick={() => setIsPasswordChangeOpen(false)} aria-label="Sulge"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
          <span className="login-sheet__eyebrow">KONTO TURVALISUS</span>
          <h2 id="password-change-title">Muuda parooli</h2>
          <p className="password-change-sheet__intro">Sisesta praegune parool ja vali uus vähemalt 8 tähemärgi pikkune parool.</p>
          <form onSubmit={changePassword}>
            <label>Praegune parool<input type="password" value={currentPassword} onChange={(event) => { setCurrentPassword(event.target.value); setPasswordChangeError('') }} autoComplete="current-password" required disabled={isChangingPassword} /></label>
            <label>Uus parool<input type="password" value={newPassword} onChange={(event) => { setNewPassword(event.target.value); setPasswordChangeError('') }} autoComplete="new-password" minLength={8} required disabled={isChangingPassword} /><small className="settings-field-note">Vähemalt 8 tähemärki</small></label>
            <label>Korda uut parooli<input type="password" value={newPasswordConfirmation} onChange={(event) => { setNewPasswordConfirmation(event.target.value); setPasswordChangeError('') }} autoComplete="new-password" minLength={8} required disabled={isChangingPassword} /></label>
            {passwordChangeError && <p className="password-change-sheet__error" role="alert">{passwordChangeError}</p>}
            <button type="submit" disabled={isChangingPassword || !currentPassword || newPassword.length < 8 || !newPasswordConfirmation}>{isChangingPassword ? 'Muudan…' : 'Muuda parool'}</button>
          </form>
        </section>
      </div>}
      {isAccountDeleteOpen && <div className="overlay login-overlay account-subdialog-overlay" onMouseDown={(event) => !isDeletingAccount && event.target === event.currentTarget && setIsAccountDeleteOpen(false)}>
        <section className="login-sheet delete-confirm account-delete-confirm" role="alertdialog" aria-modal="true" aria-labelledby="account-delete-title" aria-describedby="account-delete-description">
          <div className="delete-confirm__icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg></div>
          <span className="delete-confirm__eyebrow">KONTO KUSTUTAMINE</span>
          <h2 id="account-delete-title">Kustuta konto jäädavalt?</h2>
          <p id="account-delete-description">Koos kontoga kustutatakse kõik sinu poe andmed ja pildid. Seda toimingut ei saa tagasi võtta.</p>
          <label className="account-delete-confirm__field">Kinnitamiseks kirjuta <strong>KUSTUTA</strong>
            <input value={accountDeleteConfirmation} onChange={(event) => { setAccountDeleteConfirmation(event.target.value); setAccountDeleteError('') }} autoComplete="off" autoCapitalize="characters" disabled={isDeletingAccount} placeholder="KUSTUTA" />
          </label>
          {accountDeleteError && <p className="account-delete-confirm__error" role="alert">{accountDeleteError}</p>}
          <div className="delete-confirm__actions">
            <button type="button" disabled={isDeletingAccount} onClick={() => setIsAccountDeleteOpen(false)}>Loobu</button>
            <button type="button" disabled={accountDeleteConfirmation !== 'KUSTUTA' || isDeletingAccount} onClick={deleteAccount}>{isDeletingAccount ? 'Kustutan…' : 'Kustuta konto'}</button>
          </div>
        </section>
      </div>}
      {activeProduct && isShareOpen && <div className="overlay share-overlay" onMouseDown={(event) => event.target === event.currentTarget && setIsShareOpen(false)}>
        <section className={`share-sheet${isShareDragging ? ' is-dragging' : ''}`} style={shareDragY ? { transform: `translateY(${shareDragY}px)` } : undefined} role="dialog" aria-modal="true" aria-label="Jaga toodet">
          <div
            className="share-sheet__handle-area"
            onPointerDown={(event) => { shareDragStartRef.current = event.clientY; setIsShareDragging(true); event.currentTarget.setPointerCapture(event.pointerId) }}
            onPointerMove={(event) => { if (shareDragStartRef.current !== null) setShareDragY(Math.max(0, event.clientY - shareDragStartRef.current)) }}
            onPointerUp={(event) => endShareDrag(event.clientY)}
            onPointerCancel={(event) => endShareDrag(event.clientY)}
          ><div className="share-sheet__handle" /></div>
          <div className="share-sheet__product"><img {...getResponsiveImageProps(activeProduct, activeProduct.image, 'thumb')} sizes="5rem" alt="" /><strong>{activeProduct.name}</strong><button type="button" onClick={() => setIsShareOpen(false)} aria-label="Sulge">×</button></div>
          <div className="share-sheet__actions">
            <button type="button" onClick={copyShareUrl}><span><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></span><small>Kopeeri</small></button>
            <a href={`https://wa.me/?text=${encodeURIComponent(`${activeProduct.name} ${shareUrl}`)}`} target="_blank" rel="noreferrer"><span className="is-whatsapp"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.4-4A8 8 0 1 1 20 11.5Z"/><path d="M9 8c.5 2.7 2.3 4.5 5 5l1-1"/></svg></span><small>WhatsApp</small></a>
            <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noreferrer"><span className="is-facebook"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 21v-8h3l.5-3H14V8.5c0-1 .4-1.5 1.7-1.5H18V4.2c-.7-.1-1.7-.2-2.8-.2C12.5 4 11 5.6 11 8.3V10H8v3h3v8"/></svg></span><small>Facebook</small></a>
          </div>
        </section>
      </div>}
      {showDeletedToast && <div className="toast" role="status">
        <span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 12.5 3.5 3.5 7.5-8" /></svg></span>
        <strong>Toode kustutatud</strong>
      </div>}
      {showAddedToast && <div className="toast" role="status">
        <span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 12.5 3.5 3.5 7.5-8" /></svg></span>
        <strong>Toode lisatud</strong>
      </div>}
      {showCopiedToast && <div className="toast" role="status">
        <span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 12.5 3.5 3.5 7.5-8" /></svg></span>
        <strong>Link kopeeritud</strong>
      </div>}
      {authToast && <div className="toast" role="status">
        <span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 12.5 3.5 3.5 7.5-8" /></svg></span>
        <strong>{authToast}</strong>
      </div>}
      {isDeleteOpen && <div className="overlay login-overlay" onMouseDown={(event) => event.target === event.currentTarget && setIsDeleteOpen(false)}>
        <section className="login-sheet delete-confirm" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description">
          <div className="delete-confirm__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg></div>
          <span className="delete-confirm__eyebrow">TOOTE KUSTUTAMINE</span>
          <h2 id="delete-title">Kustuta „{activeProduct?.name}”?</h2>
          <p id="delete-description">Toode eemaldatakse poest jäädavalt. Seda toimingut ei saa tagasi võtta.</p>
          {activeProduct && <div className="delete-confirm__product"><img {...getDisplayedProductImageProps(activeProduct, 'thumb')} sizes="5rem" alt="" /><span><strong>{activeProduct.name}</strong><small>{getProductPrice(activeProduct).toFixed(2).replace('.', ',')} € · {activeProduct.gallery?.length ?? 1} {(activeProduct.gallery?.length ?? 1) === 1 ? 'pilt' : 'pilti'}</small></span></div>}
          <div className="delete-confirm__actions">
            <button type="button" autoFocus onClick={() => setIsDeleteOpen(false)}>Hoia alles</button>
            <button type="button" onClick={deleteActiveProduct}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg>Kustuta toode</button>
          </div>
        </section>
      </div>}
      {isLoginOpen && !isLoggedIn && (
        <div className="overlay login-overlay owner-login-overlay" onMouseDown={(event) => event.target === event.currentTarget && setIsLoginOpen(false)}>
          <section className="login-sheet" role="dialog" aria-modal="true" aria-label="Logi sisse">
            <button className="login-sheet__close" onClick={() => setIsLoginOpen(false)} aria-label="Sulge">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
            <span className="login-sheet__eyebrow">POE OMANIKULE</span>
            <h2>Logi sisse</h2>
            <form onSubmit={async (event) => {
              event.preventDefault()
              if (isOwnerLoginBusy) return
              const form = new FormData(event.currentTarget)
              const normalizedEmail = loginEmail.trim().toLowerCase()
              const password = String(form.get('password') ?? '')
              setIsOwnerLoginBusy(true)
              try {
                if (onOwnerLogin) await onOwnerLogin(normalizedEmail, password)
                else if (storeId && isSupabaseConfigured) {
                  const { error } = await requireSupabase().auth.signInWithPassword({ email: normalizedEmail, password })
                  if (error) throw error
                }
                setLoginEmail(normalizedEmail)
                setIsLoggedIn(true); setIsCustomerPreview(false); setIsLoginOpen(false); setAuthToast('Sisse logitud')
              } catch (error) {
                const message = error instanceof Error ? error.message : 'Sisselogimine ebaõnnestus'
                setAuthToast(message === 'Invalid login credentials' ? 'E-post või parool ei ole õige' : message)
              } finally {
                setIsOwnerLoginBusy(false)
              }
            }}>
              <label>E-post<input name="email" type="email" value={loginEmail} onChange={(event) => { setLoginEmail(event.target.value); setLoginRecoveryMessage('') }} autoComplete="username" required /></label>
              <label>Parool<input name="password" type="password" autoComplete="current-password" required /></label>
              <button className="login-forgot-password" type="button" onClick={requestLoginPasswordReset}>Unustasid parooli?</button>
              {loginRecoveryMessage && <p className="login-recovery-message" role="status">{loginRecoveryMessage}</p>}
              <button type="submit" disabled={isOwnerLoginBusy}>{isOwnerLoginBusy ? 'Login sisse…' : 'Logi sisse'}</button>
            </form>
          </section>
        </div>
      )}
      {imageUpload && <div className={`image-upload-overlay is-${imageUpload.phase}`} role="dialog" aria-modal="true" aria-label="Piltide lisamine poodi">
        <section className="image-upload-progress" role="status" aria-live="polite">
          <div className="image-upload-progress__visuals">
            {imageUpload.images.map((image, index) => {
              const imageProgress = Math.max(0, Math.min(100, imageUpload.progress * 1.35 - index * 30))
              return <div className="image-upload-progress__image" style={{ '--image-progress': `${imageProgress}%`, '--image-delay': `${index * 70}ms` } as CSSProperties} key={image}>
                <span><img src={image} alt="" /></span>
                {imageProgress >= 100 && <i aria-hidden="true">✓</i>}
              </div>
            })}
          </div>
          <div className="image-upload-progress__copy">
            <small>{imageUpload.phase === 'preparing' ? 'VALMISTAN ETTE' : imageUpload.phase === 'uploading' ? 'LAEN PILTE' : 'VALMIS'}</small>
            <strong>{imageUpload.phase === 'ready' ? 'Pildid on poes' : imageUpload.slow ? 'Foto on suur, läheb veel veidi…' : imageUpload.images.length === 1 ? 'Lisan tootepildi…' : `Lisan ${imageUpload.images.length} tootepilti…`}</strong>
          </div>
          <div className="image-upload-progress__track" aria-label={`${imageUpload.progress}%`}><span style={{ width: `${imageUpload.progress}%` }}><i /></span></div>
          <div className="image-upload-progress__meta"><span>{imageUpload.phase === 'ready' ? 'Kõik valmis' : imageUpload.phase === 'preparing' ? 'Töötlen fotot' : 'Üleslaadimine käib'}</span><span>{imageUpload.images.length}/{MAX_PRODUCT_IMAGES} pilti</span></div>
        </section>
      </div>}
      {isAddOpen && (
        <div className={`overlay login-overlay${addProductStep === 'details' ? ' product-editor-overlay' : ' add-source-overlay'}`} onMouseDown={(event) => event.target === event.currentTarget && closeAddProduct()}>
          <section className={`login-sheet edit-sheet${addProductStep === 'details' ? ' product-editor-sheet product-editor-sheet--add' : ''}`} role="dialog" aria-modal="true" aria-label="Lisa toode">
            <button className="login-sheet__close" onClick={closeAddProduct} aria-label="Sulge"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
            {addProductStep === 'source' ? <div className="add-source">
              <h2>Lisa foto</h2>
              <p>Vali, kuidas soovid alustada.</p>
              <div className="add-source__choices">
                <button type="button" aria-label="Pildista toodet" onClick={() => cameraInputRef.current?.click()}>
                  <span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.5-2h7L17 8h3v11H4V8Z"/><circle cx="12" cy="13" r="3.5"/></svg></span>
                  <strong>Pildista kohe</strong>
                  <svg className="add-source__arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
                </button>
                <button type="button" aria-label="Vali tootefotod galeriist" onClick={() => galleryInputRef.current?.click()}>
                  <span><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m4 18 5-5 3 3 2-2 6 5"/></svg></span>
                  <strong>Vali galeriist</strong>
                  <svg className="add-source__arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
                </button>
              </div>
              <input ref={cameraInputRef} className="source-file-input" type="file" accept="image/*" capture="environment" onChange={(event) => { chooseAddProductImages(event.target.files); event.target.value = '' }} />
              <input ref={galleryInputRef} className="source-file-input" type="file" accept="image/*" multiple onChange={(event) => { chooseAddProductImages(event.target.files); event.target.value = '' }} />
            </div> : <>
            <h2>Toote andmed</h2>
            <div className="add-image-preview">
              <img src={addProductImages[0]} alt="Valitud tootepildi eelvaade" draggable={false} />
              {addProductImages.length > 1 && <span>+{addProductImages.length - 1}</span>}
              {addProductImages.length < MAX_PRODUCT_IMAGES && <button className="add-image-preview__camera" type="button" onClick={() => moreCameraInputRef.current?.click()}>Pildista veel</button>}
              <button type="button" onClick={() => { addProductImages.forEach((image) => URL.revokeObjectURL(image)); setAddProductImages([]); setAddProductStep('source') }}>Muuda pilti</button>
              <input ref={moreCameraInputRef} className="source-file-input" type="file" accept="image/*" capture="environment" onChange={(event) => { addCameraProductImage(event.target.files); event.target.value = '' }} />
            </div>
            <form className="product-editor-form product-editor-form--add" noValidate onSubmit={(event) => { event.preventDefault(); saveNewProduct() }}>
              <div className="product-editor-form__scroll">
              <label>Nimi<input name="name" value={addProductName} onChange={(event) => { const value = event.target.value; setAddProductName(value); if (!isAddProductSlugCustom) setAddProductSlug(createUrlSlug(value)); setAddProductError('') }} /></label>
              <label className="ai-description-field"><span>Kirjeldus <small>valikuline</small></span><textarea name="description" value={addProductDescription} onChange={(event) => setAddProductDescription(event.target.value)} placeholder="Kirjelda toodet, materjale ja omadusi…" /></label>
              <label>Hind<input name="price" type="number" inputMode="decimal" min="0" step="0.01" value={addProductPrice} onChange={(event) => { setAddProductPrice(event.target.value); setAddProductError('') }} /></label>
              <label>Soodushind<input name="salePrice" type="number" inputMode="decimal" min="0" step="0.01" value={addProductSalePrice} onChange={(event) => setAddProductSalePrice(event.target.value)} placeholder="Valikuline" /></label>
              <details className="product-seo">
                <summary><span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg></span><div><strong>Google’i eelvaade</strong><small>Loodud automaatselt</small></div><b>Valmis</b><i /></summary>
                <div className="product-seo__content">
                  <div className="product-seo__preview">
                    <small>{customDomainStatus === 'active' ? customDomain : `${storeSlug || 'minupood'}.poeruum.ee`} › toode › {addProductSlug || 'toote-nimi'}</small>
                    <strong>{addProductSeoTitle || `${addProductName || 'Toote nimi'} – ${editableStoreName}`}</strong>
                    <p>{addProductDescription || 'Toote kirjeldus kuvatakse siin automaatselt.'}</p>
                  </div>
                  <label>Otsingu pealkiri <small>{(addProductSeoTitle || `${addProductName || 'Toote nimi'} – ${editableStoreName}`).length}/60</small><input value={addProductSeoTitle} maxLength={60} onChange={(event) => setAddProductSeoTitle(event.target.value)} placeholder={`${addProductName || 'Toote nimi'} – ${editableStoreName}`} /></label>
                  <label>Lehe aadress<div className="product-seo__slug"><span>/toode/</span><input value={addProductSlug} onChange={(event) => { setIsAddProductSlugCustom(true); setAddProductSlug(createUrlSlug(event.target.value)) }} placeholder="toote-nimi" /></div></label>
                  <label className="settings-toggle product-seo__toggle"><span><strong>Nähtav otsingumootorites</strong><small>Väljalülitamisel toodet Google’isse ei lisata</small></span><input type="checkbox" checked={isAddProductSearchVisible} onChange={(event) => setIsAddProductSearchVisible(event.target.checked)} /><i /></label>
                  <div className="product-seo__automatic"><span>✓</span><p><strong>Tehniline SEO on automaatne</strong><small>Tooteandmed, canonical ja sitemap ei vaja seadistamist.</small></p></div>
                </div>
              </details>
              {addProductError && <p className="add-product-error" role="alert">{addProductError}</p>}
              </div>
              <button type="submit">Lisa toode</button>
            </form>
            </>}
          </section>
        </div>
      )}
      {isSearchOpen && (
        <div className="search-overlay" role="dialog" aria-modal="true" aria-label="Tooteotsing">
          <div className="search-topbar">
            <div className="search-field"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg><input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Mida sa otsid?" /></div>
            <button onClick={() => { setIsSearchOpen(false); setSearchQuery('') }} aria-label="Sulge otsing"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
          </div>
          <div className="search-results">
            {searchResults.map((product) => {
              const index = displayProducts.findIndex((item) => item.id === product.id)
              return <button key={product.id} onClick={() => { setIsSearchOpen(false); setSearchQuery(''); requestAnimationFrame(() => goToProduct(index)) }}>
                <img {...getResponsiveImageProps(product, product.image, 'thumb')} sizes="4rem" alt="" />
                <span><strong>{product.name}</strong><small>{getProductPrice(product)} €</small></span>
              </button>
            })}
            {!searchResults.length && <p>Tooteid ei leitud.</p>}
          </div>
        </div>
      )}
    </main>
  )
}
