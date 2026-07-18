import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { flushSync } from 'react-dom'
import { products, type Product } from './products'

const getProductPrice = (product: Product) =>
  product.salePrice !== undefined && product.price !== undefined && product.salePrice < product.price
    ? product.salePrice
    : product.price ?? 0

const formatEuro = (value: number) => `${value.toFixed(2).replace('.', ',')} €`

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
  items: Product[]
  customerName: string
  customerEmail: string
  delivery: string
  productSubtotal: number
  total: number
  createdAt: string
  status: 'new' | 'fulfilled' | 'refunded'
}

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
      items: [products[0]],
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
      items: [products[4], products[3]],
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
      items: [products[1], products[0]],
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
      items: [products[6]],
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
      items: [products[2], products[4]],
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
      items: [products[5], products[6]],
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
      items: [products[2]],
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
      items: [products[0], products[3], products[4]],
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
      items: [products[5]],
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
      items: [products[1]],
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
export type PricingPlan = 'flexible' | 'fixed'
type StoreTheme = 'midnight' | 'paper' | 'pop'
type BuyButtonSize = 'small' | 'medium' | 'large'
type SaleBadgeStyle = 'quirky' | 'classic' | 'price' | 'elegant' | 'minimal'
type AnnouncementSpeed = 'slow' | 'normal' | 'fast'
type AnnouncementDirection = 'left' | 'right'
export type PaymentProvider = 'stripe' | 'montonio'
type SettingsSection = 'store' | 'appearance' | 'payments' | 'delivery' | 'business' | 'links' | 'notifications' | 'billing'
const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string; description: string }> = [
  { id: 'store', label: 'Pood', description: 'Põhiandmed ja nähtavus' },
  { id: 'appearance', label: 'Kujundus', description: 'Logo, värvid ja stiil' },
  { id: 'payments', label: 'Maksed', description: 'Makseviisid ja ühendused' },
  { id: 'delivery', label: 'Tarne', description: 'Pakiautomaadid ja hinnad' },
  { id: 'business', label: 'Müüja', description: 'Ettevõtte andmed' },
  { id: 'links', label: 'Lingid', description: 'Kontakt ja sotsiaalmeedia' },
  { id: 'notifications', label: 'Teavitused', description: 'E-kirjad ja märguanded' },
  { id: 'billing', label: 'Plaan ja arved', description: 'Pakett, tasud ja arved' },
]
type DeliverySettings = {
  parcelProviders: Record<ShippingProvider, { enabled: boolean; price: number }>
  courierEnabled: boolean
  pickupEnabled: boolean
  courierPrice: number
  freeShippingFrom: number
  pickupAddress: string
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

function Cart({ items, initialStep, paymentProvider, paymentsReady, deliverySettings, onRemove, onComplete, onClose }: { items: Product[]; initialStep: 'cart' | 'checkout'; paymentProvider: PaymentProvider; paymentsReady: boolean; deliverySettings: DeliverySettings; onRemove: (index: number) => void; onComplete: (order: DemoOrder) => void; onClose: () => void }) {
  const checkoutRef = useRef<HTMLElement>(null)
  const [step, setStep] = useState<'cart' | 'checkout' | 'success'>(initialStep)
  const [paymentMethod, setPaymentMethod] = useState<'bank' | 'card'>('bank')
  const [bank, setBank] = useState('swedbank')
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
  const [completedOrder, setCompletedOrder] = useState<{ id: string; total: number } | null>(null)
  const itemTotal = items.reduce((sum, item) => sum + getProductPrice(item), 0)
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

  const completeCheckout = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isPaying) return
    const data = new FormData(event.currentTarget)
    const id = `PR-${String(Date.now()).slice(-5)}`
    const deliveryLabel = delivery === 'parcel' ? parcelQuery : delivery === 'courier' ? courierAddress : 'Tulen ise järele'
    const order: DemoOrder = {
      id,
      items: [...items],
      customerName: String(data.get('customerName')),
      customerEmail: String(data.get('customerEmail')),
      delivery: deliveryLabel,
      productSubtotal: itemTotal,
      total: orderTotal,
      createdAt: new Date().toISOString(),
      status: 'new',
    }
    setIsPaying(true)
    window.setTimeout(() => {
      onComplete(order)
      setCompletedOrder({ id, total: orderTotal })
      setIsPaying(false)
      setStep('success')
    }, 850)
  }

  return (
    <div className="overlay cart-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={checkoutRef} className="checkout" role="dialog" aria-modal="true" aria-label="Ostukorv">
        <button className="checkout__close" onClick={onClose} aria-label="Sulge">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
        {step !== 'success' && <h2>{step === 'cart' ? 'Ostukorv' : 'Vormista tellimus'}</h2>}
        {step === 'success' && completedOrder ? <div className="checkout-success">
          <div>✓</div>
          <span>AITÄH!</span>
          <h3>Sinu tellimus on kinnitatud</h3>
          <p>Tellimuse kinnitus saadeti sinu e-postile.</p>
          <dl><div><dt>Tellimuse number</dt><dd>{completedOrder.id}</dd></div><div><dt>Kokku</dt><dd>{completedOrder.total.toFixed(2).replace('.', ',')} €</dd></div></dl>
          <button className="pay" type="button" onClick={onClose}>Tagasi poodi</button>
        </div> : items.length === 0 ? <p className="cart-empty">Ostukorv on tühi.</p> : <>
          {step === 'cart' ? <>
            <div className="cart-items">
              {items.map((item, index) => (
                <div className="cart-item" key={item.id}>
                  <img src={item.image} alt={item.alt} />
                  <div className="cart-item__copy"><strong>{item.name}</strong><span>{getProductPrice(item)} €</span></div>
                  <button className="cart-item__remove" onClick={() => onRemove(index)} aria-label="Eemalda ostukorvist">
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
            {!paymentsReady ? <div className="payment-pending"><span>…</span><div><strong>Maksed aktiveerimisel</strong><small>Montonio kontrollib poe andmeid. Ostjad saavad maksta pärast konto kinnitamist.</small></div></div> : paymentProvider === 'stripe' ? <fieldset className="payment stripe-payment">
              <legend>Makseviis</legend>
              <div className="stripe-wallets">
                <button type="button"><span></span> Pay</button>
                <button type="button"><b>G</b> Pay</button>
              </div>
              <div className="stripe-divider"><span>või maksa kaardiga</span></div>
              <div className="stripe-payment__card">
                <div className="stripe-secure"><span>⌁</span><strong>Turvaline kaardimakse</strong><small>Stripe</small></div>
                <label>Kaardi number
                  <div className="stripe-card-number"><input required inputMode="numeric" autoComplete="cc-number" placeholder="1234 5678 9012 3456" /><span>VISA&nbsp;&nbsp;●●</span></div>
                </label>
                <div className="stripe-card-row">
                  <label>Kehtiv kuni<input required inputMode="numeric" autoComplete="cc-exp" placeholder="KK / AA" /></label>
                  <label>CVC<input required inputMode="numeric" autoComplete="cc-csc" placeholder="123" /></label>
                </div>
                <small>Kaardiandmeid töötleb turvaliselt Stripe. Poeruum neid ei näe ega salvesta.</small>
              </div>
            </fieldset> : <fieldset className="payment">
              <legend>Makseviis</legend>
              <div className="payment-tabs">
                <button type="button" className={paymentMethod === 'bank' ? 'is-selected' : ''} onClick={() => setPaymentMethod('bank')}>Pangalink</button>
                <button type="button" className={paymentMethod === 'card' ? 'is-selected' : ''} onClick={() => setPaymentMethod('card')}>Kaart</button>
              </div>
              {paymentMethod === 'bank' ? (
                <div className="bank-grid">
                  {[
                    ['swedbank', 'Swedbank'],
                    ['seb', 'SEB'],
                    ['lhv', 'LHV'],
                    ['luminor', 'Luminor'],
                    ['coop', 'Coop Pank'],
                  ].map(([id, label]) => (
                    <button type="button" key={id} className={bank === id ? 'is-selected' : ''} onClick={() => setBank(id)} aria-label={label}>
                      <img src={`/images/banks/${id}.svg`} alt={label} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="card-fields">
                  <label>Kaardi number<input required inputMode="numeric" autoComplete="cc-number" placeholder="1234 5678 9012 3456" /></label>
                  <div>
                    <label>Kehtiv kuni<input required inputMode="numeric" autoComplete="cc-exp" placeholder="KK/AA" /></label>
                    <label>CVC<input required inputMode="numeric" autoComplete="cc-csc" placeholder="123" /></label>
                  </div>
                </div>
              )}
            </fieldset>}
            <div className="checkout-summary">
              {items.map((item) => (
                <div className="summary-item" key={item.id}>
                  <span>{item.name}</span>
                  <span>{getProductPrice(item).toFixed(2).replace('.', ',')} €</span>
                </div>
              ))}
              <div><span>Tarne</span><span>{deliveryPrice.toFixed(2).replace('.', ',')} €</span></div>
              <strong><span>Kokku</span><span>{orderTotal.toFixed(2).replace('.', ',')} €</span></strong>
              <div className="vat-row"><span>sh käibemaks 24%</span><span>{vatAmount.toFixed(2).replace('.', ',')} €</span></div>
              <small>Hinnad sisaldavad käibemaksu.</small>
            </div>
            <button className="pay" type="submit" disabled={isPaying || !paymentsReady}>{!paymentsReady ? 'Maksed aktiveerimisel' : isPaying ? 'Töötlen makset…' : paymentProvider === 'stripe' ? `Maksa ${orderTotal.toFixed(2).replace('.', ',')} €` : 'Maksa'}</button>
            <button className="checkout-back" type="button" onClick={() => setStep('cart')}>Tagasi ostukorvi</button>
          </form>}
        </>}
      </section>
    </div>
  )
}

export type StorefrontProps = {
  seedProducts?: Product[]
  storeName?: string
  storeSlug?: string
  theme?: StoreTheme
  paymentProvider?: PaymentProvider
  paymentsReady?: boolean
  initialShipping?: string[]
  merchantMode?: boolean
  pricingPlan?: PricingPlan
  onConnectPaymentProvider?: (provider: PaymentProvider) => void
  onExit?: () => void
}

export function Storefront({ seedProducts = products, storeName = 'VEIDRAD ASJAD', storeSlug, theme = 'midnight', paymentProvider = 'montonio', paymentsReady = true, initialShipping, merchantMode = false, pricingPlan = 'flexible', onConnectPaymentProvider, onExit }: StorefrontProps = {}) {
  const isPublicDemo = Boolean(onExit && !merchantMode)
  const trackRef = useRef<HTMLDivElement>(null)
  const activeIndexRef = useRef(0)
  const logoTapCountRef = useRef(0)
  const logoTapTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const storeLogoObjectUrlRef = useRef<string | null>(null)
  const storeAboutImageObjectUrlRef = useRef<string | null>(null)
  const storeDescriptionInputRef = useRef<HTMLTextAreaElement>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [cart, setCart] = useState<Product[]>([])
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [cartStep, setCartStep] = useState<'cart' | 'checkout'>('cart')
  const [addedProductId, setAddedProductId] = useState<string | null>(null)
  const [isScreensaverActive, setIsScreensaverActive] = useState(false)
  const [selectedImages, setSelectedImages] = useState<Record<string, number>>({})
  const [isLoginOpen, setIsLoginOpen] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(merchantMode)
  const [isCustomerPreview, setIsCustomerPreview] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isSettingsHome, setIsSettingsHome] = useState(true)
  const [settingsSaveStatus, setSettingsSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const savedSettingsSnapshotRef = useRef('')
  const [isAboutOpen, setIsAboutOpen] = useState(false)
  const [isSetupChecklistOpen, setIsSetupChecklistOpen] = useState(true)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('store')
  const [isOrdersOpen, setIsOrdersOpen] = useState(false)
  const [orders, setOrders] = useState<DemoOrder[]>(() => merchantMode ? createDemoOrders() : [])
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
  const [storeLogo, setStoreLogo] = useState<string | null>(() => storeSlug ? null : '/images/logo.png')
  const [editableStoreName, setEditableStoreName] = useState(storeName)
  const [storeDescription, setStoreDescription] = useState(() => storeSlug ? '' : 'Veidrad ja erilised esemed, mis muudavad argipäeva natuke põnevamaks.')
  const [storeAboutImage, setStoreAboutImage] = useState<string | null>(null)
  const [isStoreVisible, setIsStoreVisible] = useState(true)
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [instagramUrl, setInstagramUrl] = useState(() => storeSlug ? 'https://www.instagram.com/mtammets' : 'https://www.instagram.com/veidradasjad/')
  const [facebookUrl, setFacebookUrl] = useState(() => storeSlug ? 'https://www.facebook.com/mtammets' : 'https://www.facebook.com/profile.php?id=61580779397203')
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
  const [returnsText, setReturnsText] = useState('Kauba saab tagastada 14 päeva jooksul alates kättesaamisest.')
  const [orderNotificationEmail, setOrderNotificationEmail] = useState('')
  const [billingEmail, setBillingEmail] = useState('')
  const [billingPlan, setBillingPlan] = useState<PricingPlan>(pricingPlan)
  const [sellerNotifications, setSellerNotifications] = useState(true)
  const [customerConfirmations, setCustomerConfirmations] = useState(true)
  const [customDomain, setCustomDomain] = useState('')
  const [autoSwipeEnabled, setAutoSwipeEnabled] = useState(() => localStorage.getItem('autoSwipeEnabled') !== 'false')
  const [autoSwipeDelay, setAutoSwipeDelay] = useState(() => Number(localStorage.getItem('autoSwipeDelay')) || 30)
  const [autoSwipeSpeed, setAutoSwipeSpeed] = useState(() => Number(localStorage.getItem('autoSwipeSpeed')) || 10)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
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
  const editProductDescriptionRef = useRef<HTMLParagraphElement>(null)
  const editProductPriceRef = useRef<HTMLElement>(null)
  const editProductSalePriceRef = useRef<HTMLElement>(null)
  const editProductImageInputRef = useRef<HTMLInputElement>(null)
  const editProductImageModeRef = useRef<'add' | 'replace'>('add')
  const editSessionImageUrlsRef = useRef<Set<string>>(new Set())
  const committedEditImageUrlsRef = useRef<Set<string>>(new Set())
  const [editProductImages, setEditProductImages] = useState<string[]>([])
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [addProductStep, setAddProductStep] = useState<'source' | 'details'>('source')
  const [addProductImages, setAddProductImages] = useState<string[]>([])
  const [imageUpload, setImageUpload] = useState<{ images: string[]; progress: number; phase: 'preparing' | 'uploading' | 'ready' } | null>(null)
  const [addProductName, setAddProductName] = useState('')
  const [addProductDescription, setAddProductDescription] = useState('')
  const [addProductPrice, setAddProductPrice] = useState('')
  const [addProductSalePrice, setAddProductSalePrice] = useState('')
  const [addProductSeoTitle, setAddProductSeoTitle] = useState('')
  const [addProductSlug, setAddProductSlug] = useState('')
  const [isAddProductSlugCustom, setIsAddProductSlugCustom] = useState(false)
  const [isAddProductSearchVisible, setIsAddProductSearchVisible] = useState(true)
  const [addProductError, setAddProductError] = useState('')
  const [isAddAiGenerating, setIsAddAiGenerating] = useState(false)
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
  const [draftProductId, setDraftProductId] = useState<string | null>(null)
  const [deletedProductIds, setDeletedProductIds] = useState<string[]>([])
  const [productEdits, setProductEdits] = useState<Record<string, Partial<Product>>>({})
  const settingsSnapshot = JSON.stringify({
    storeTheme, storeAccent, buyButtonSize, saleBadgeStyle, announcementEnabled, announcementText, announcementLink,
    announcementSpeed, announcementDirection, announcementBackground, announcementColor, storeLogo, editableStoreName, storeDescription, storeAboutImage,
    isStoreVisible, contactEmail, contactPhone, instagramUrl, facebookUrl, tiktokUrl, activePaymentProvider,
    deliverySettings, businessName, registryCode, businessAddress, returnsText, orderNotificationEmail,
    billingEmail, billingPlan, sellerNotifications, customerConfirmations, customDomain,
    autoSwipeEnabled, autoSwipeDelay, autoSwipeSpeed,
  })
  const hasUnsavedSettings = isSettingsOpen && Boolean(savedSettingsSnapshotRef.current) && savedSettingsSnapshotRef.current !== settingsSnapshot

  useEffect(() => setActivePaymentProvider(paymentProvider), [paymentProvider])

  useEffect(() => {
    if (!isSettingsOpen) {
      savedSettingsSnapshotRef.current = settingsSnapshot
      setSettingsSaveStatus('idle')
      return
    }
    if (!savedSettingsSnapshotRef.current) {
      savedSettingsSnapshotRef.current = settingsSnapshot
      return
    }
  }, [isSettingsOpen])

  const saveSettings = () => {
    if (!hasUnsavedSettings || settingsSaveStatus === 'saving') return
    setSettingsSaveStatus('saving')
    window.setTimeout(() => {
      savedSettingsSnapshotRef.current = settingsSnapshot
      setSettingsSaveStatus('saved')
    }, 500)
  }

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
  }, [])

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

  const changeStoreLogo = (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return
    if (storeLogoObjectUrlRef.current) URL.revokeObjectURL(storeLogoObjectUrlRef.current)
    const objectUrl = URL.createObjectURL(file)
    storeLogoObjectUrlRef.current = objectUrl
    setStoreLogo(objectUrl)
  }

  const removeStoreLogo = () => {
    if (storeLogoObjectUrlRef.current) URL.revokeObjectURL(storeLogoObjectUrlRef.current)
    storeLogoObjectUrlRef.current = null
    setStoreLogo(null)
  }

  const changeStoreAboutImage = (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return
    if (storeAboutImageObjectUrlRef.current) URL.revokeObjectURL(storeAboutImageObjectUrlRef.current)
    const objectUrl = URL.createObjectURL(file)
    storeAboutImageObjectUrlRef.current = objectUrl
    setStoreAboutImage(objectUrl)
  }

  const removeStoreAboutImage = () => {
    if (storeAboutImageObjectUrlRef.current) URL.revokeObjectURL(storeAboutImageObjectUrlRef.current)
    storeAboutImageObjectUrlRef.current = null
    setStoreAboutImage(null)
  }

  const openEditProduct = () => {
    if (!activeProduct) return
    setEditProductImages([...(activeProduct.gallery ?? [activeProduct.image])])
    setIsEditOpen(true)
  }

  const closeEditProduct = () => {
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
    editSessionImageUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    editSessionImageUrlsRef.current.clear()
    setEditProductImages([])
    setIsEditOpen(false)
  }

  const chooseEditProductImages = (files: FileList | null) => {
    const imageFiles = Array.from(files ?? []).filter((file) => file.type.startsWith('image/'))
    if (!imageFiles.length || !activeProduct) return
    if (editProductImageModeRef.current === 'replace') {
      const file = imageFiles[0]
      const objectUrl = URL.createObjectURL(file)
      editSessionImageUrlsRef.current.add(objectUrl)
      setEditProductImages((current) => {
        const next = [...current]
        const index = Math.min(selectedImages[activeProduct.id] ?? 0, Math.max(0, next.length - 1))
        const previous = next[index]
        if (editSessionImageUrlsRef.current.has(previous)) {
          URL.revokeObjectURL(previous)
          editSessionImageUrlsRef.current.delete(previous)
        }
        next[index] = objectUrl
        return next
      })
      return
    }
    const available = Math.max(0, MAX_PRODUCT_IMAGES - editProductImages.length)
    const urls = imageFiles.slice(0, available).map((file) => URL.createObjectURL(file))
    urls.forEach((url) => editSessionImageUrlsRef.current.add(url))
    setEditProductImages((current) => [...current, ...urls].slice(0, MAX_PRODUCT_IMAGES))
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
    setIsAddAiGenerating(false)
  }

  const chooseAddProductImages = (files: FileList | null) => {
    const imageFiles = Array.from(files ?? []).filter((file) => file.type.startsWith('image/')).slice(0, MAX_PRODUCT_IMAGES)
    if (!imageFiles.length) return
    addProductImages.forEach((image) => URL.revokeObjectURL(image))
    const images = imageFiles.map((file) => URL.createObjectURL(file))
    const id = `product-${Date.now()}`
    setIsAddOpen(false)
    setAddProductStep('source')
    setAddProductImages([])
    setAddProductError('')
    setImageUpload({ images, progress: 7, phase: 'preparing' })

    const uploadSteps: Array<[number, number, 'preparing' | 'uploading' | 'ready']> = [
      [180, 18, 'preparing'],
      [380, 34, 'uploading'],
      [610, 57, 'uploading'],
      [840, 78, 'uploading'],
      [1060, 92, 'uploading'],
      [1240, 100, 'ready'],
    ]
    uploadSteps.forEach(([delay, progress, phase]) => window.setTimeout(() => setImageUpload((current) => current ? { ...current, progress, phase } : null), delay))

    window.setTimeout(() => {
      images.forEach((url) => committedEditImageUrlsRef.current.add(url))
      setAddedProducts((current) => [...current, {
        id,
        name: '',
        description: '',
        image: images[0],
        gallery: images,
        alt: 'Uue toote pilt',
        searchVisible: true,
      }])
      setActiveIndex(displayProducts.length)
      setSelectedImages((current) => ({ ...current, [id]: 0 }))
      setEditProductImages(images)
      setDraftProductId(id)
      setImageUpload(null)
      setIsEditOpen(true)
    }, 1600)
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
  const displayProducts = [...seedProducts, ...addedProducts]
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
    if (!isLoginOpen && !isEditOpen && !isAddOpen && !imageUpload && !isSearchOpen && !isDeleteOpen && !isShareOpen && !isSettingsOpen && !isOrdersOpen && !isAboutOpen) return
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
  }, [isLoginOpen, isEditOpen, isAddOpen, Boolean(imageUpload), addProductStep, isSearchOpen, isDeleteOpen, isShareOpen, isSettingsOpen, isOrdersOpen, isAboutOpen])

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

  const addToCart = (product: Product) => {
    setCart((items) => items.some((item) => item.id === product.id) ? items : [...items, product])
    setAddedProductId(product.id)
    setCartStep('cart')
    setIsCartOpen(true)
    window.setTimeout(() => setAddedProductId((id) => id === product.id ? null : id), 1600)
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
      setIsLoginOpen(true)
      return
    }
    logoTapTimerRef.current = window.setTimeout(() => { logoTapCountRef.current = 0 }, 900)
  }

  const activeProduct = displayProducts[activeIndex]
  const activeProductHasSale = activeProduct !== undefined && activeProduct.salePrice !== undefined && activeProduct.price !== undefined && activeProduct.salePrice < activeProduct.price
  const activeProductDiscount = activeProductHasSale ? Math.round((1 - activeProduct.salePrice! / activeProduct.price!) * 100) : 0
  const isActiveProductInCart = activeProduct !== undefined && cart.some((item) => item.id === activeProduct.id)
  const getDisplayedProductImage = (product: Product) => {
    if (isEditOpen && activeProduct?.id === product.id) {
      return editProductImages[Math.min(selectedImages[product.id] ?? 0, Math.max(0, editProductImages.length - 1))] ?? EMPTY_PRODUCT_IMAGE
    }
    const images = product.gallery?.length ? product.gallery : [product.image]
    return images[Math.min(selectedImages[product.id] ?? 0, images.length - 1)]
  }

  const saveEditedProduct = () => {
    if (!activeProduct) return
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
    setProductEdits((current) => ({ ...current, [activeProduct.id]: {
      name,
      description,
      price,
      salePrice,
      image: editProductImages[0] ?? activeProduct.image,
      gallery: editProductImages.length ? editProductImages : (activeProduct.gallery ?? [activeProduct.image]),
      slug: activeProduct.slug || createUrlSlug(name),
    } }))
    editSessionImageUrlsRef.current.forEach((url) => committedEditImageUrlsRef.current.add(url))
    editSessionImageUrlsRef.current.clear()
    if (draftProductId === activeProduct.id) {
      setDraftProductId(null)
      setShowAddedToast(true)
    }
    setEditProductImages([])
    setIsEditOpen(false)
  }

  useEffect(() => {
    if (!isEditOpen) return
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
  }, [isEditOpen, activeProduct?.id])

  const buyNow = () => {
    if (!activeProduct) return
    setCart((items) => items.some((item) => item.id === activeProduct.id) ? items : [...items, activeProduct])
    setCartStep('checkout')
    setIsCartOpen(true)
  }

  const logOut = () => {
    setIsLoggedIn(false)
    setIsCustomerPreview(false)
    setIsLoginOpen(false)
    setAuthToast('Välja logitud')
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

  const endShareDrag = (clientY: number) => {
    const distance = shareDragStartRef.current === null ? 0 : Math.max(0, clientY - shareDragStartRef.current)
    if (distance > 80) setIsShareOpen(false)
    setShareDragY(0)
    setIsShareDragging(false)
    shareDragStartRef.current = null
  }

  const deleteActiveProduct = () => {
    if (!activeProduct) return
    setDeletedProductIds((ids) => [...ids, activeProduct.id])
    setCart((items) => items.filter((item) => item.id !== activeProduct.id))
    setActiveIndex(0)
    setIsDeleteOpen(false)
    setShowDeletedToast(true)
  }

  const searchResults = displayProducts.filter((product) =>
    `${product.name} ${product.description ?? ''}`.toLocaleLowerCase('et').includes(searchQuery.trim().toLocaleLowerCase('et')),
  )
  const storeInitial = editableStoreName.trim().charAt(0).toLocaleUpperCase('et') || 'P'
  const contactLine = [contactEmail, contactPhone].filter(Boolean).join(' · ') || 'Valmistatud hoolega Eestis'
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
  const monthlyPlatformFee = billingPlan === 'fixed' ? FIXED_PLAN_MONTHLY_FEE : Math.min(monthlyProductSales * PLATFORM_FEE_RATE, PLATFORM_FEE_CAP)
  const remainingPlatformFee = billingPlan === 'fixed' ? 0 : Math.max(0, PLATFORM_FEE_CAP - monthlyPlatformFee)
  const platformFeeProgress = billingPlan === 'fixed' ? 100 : Math.min(100, monthlyPlatformFee / PLATFORM_FEE_CAP * 100)
  const billingMonth = now.toLocaleDateString('et-EE', { month: 'long', year: 'numeric' })
  const setupChecklist = [
    { id: 'store', label: 'Poe põhiandmed', done: Boolean(editableStoreName.trim()), section: 'store' as const },
    { id: 'payments', label: 'Maksed ühendatud', done: paymentsReady, section: 'payments' as const },
    { id: 'delivery', label: 'Tarneviis valitud', done: SHIPPING_PROVIDERS.some((provider) => deliverySettings.parcelProviders[provider].enabled) || deliverySettings.courierEnabled || deliverySettings.pickupEnabled, section: 'delivery' as const },
    { id: 'product', label: 'Esimene toode lisatud', done: displayProducts.length > 0, section: null },
    { id: 'business', label: 'Müüja andmed', done: Boolean(businessName.trim() && registryCode.trim()), section: 'business' as const },
    { id: 'visible', label: 'Pood avalikustatud', done: isStoreVisible, section: 'store' as const },
  ]
  const completedSetupSteps = setupChecklist.filter((item) => item.done).length
  const setupProgress = Math.round(completedSetupSteps / setupChecklist.length * 100)
  const activeSettingsSection = SETTINGS_SECTIONS.find((section) => section.id === settingsSection) ?? SETTINGS_SECTIONS[0]

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

  const saveNewProduct = () => {
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
    setAddedProducts((current) => [...current, product])
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
    <main className="app-shell" style={{ '--store-accent': storeAccent, '--store-accent-ink': getReadableTextColor(storeAccent), '--announcement-bg': announcementBackground, '--announcement-color': announcementColor } as CSSProperties} data-screensaver={isScreensaverActive ? 'active' : 'idle'} data-store-theme={storeTheme} data-buy-button-size={buyButtonSize} data-announcement={announcementEnabled && announcementText.trim() ? 'true' : 'false'} data-announcement-speed={announcementSpeed} data-announcement-direction={announcementDirection} data-store-empty={activeProduct ? 'false' : 'true'} data-inline-editing={isEditOpen ? 'true' : 'false'} data-merchant={merchantMode ? 'true' : 'false'} data-demo={onExit && !merchantMode ? 'true' : 'false'} data-editing={isAdminMode ? 'true' : 'false'} data-product-editor={isAddOpen && addProductStep === 'details' ? 'true' : 'false'}>
      <input ref={desktopGalleryInputRef} className="source-file-input" type="file" accept="image/*" multiple onChange={(event) => { chooseAddProductImages(event.target.files); event.target.value = '' }} />
      <section className="story-stage">
        {onExit && !merchantMode && <div className="demo-preview-bar">
          <button type="button" onClick={onExit} aria-label="Välju näidispoest ja mine tagasi Poeruumi avalehele">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 7-5 5 5 5M5 12h14" /></svg>
            <span className="demo-preview-bar__exit-long">Välju näidispoest</span>
            <span className="demo-preview-bar__exit-short">Välju</span>
            <kbd>Esc</kbd>
          </button>
          <div><span>Poeruum</span><i aria-hidden="true" />Näidispood</div>
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
          <div className="header-actions">
            <button className="search-button" onClick={() => setIsSearchOpen(true)} aria-label="Otsi tooteid"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg></button>
            {isAdminMode ? <button className="logout-button" onClick={logOut} aria-label="Logi välja">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H5v14h5M14 8l4 4-4 4m4-4H9" /></svg>
            </button> : <button className={`cart-button${addedProductId ? ' is-bumping' : ''}`} onClick={() => { setCartStep('cart'); setIsCartOpen(true) }} aria-label={`Ostukorv, ${cart.length} toodet`}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2 11h10l2-8H6"/><circle cx="9" cy="19" r="1"/><circle cx="17" cy="19" r="1"/></svg>
              <span>{cart.length}</span>
            </button>}
          </div>
        </header>

        {announcementEnabled && announcementText.trim() && <div className="announcement-bar" aria-label={announcementText}>
          {announcementLink.trim()
            ? <a href={normalizeExternalUrl(announcementLink)} target="_blank" rel="noreferrer">{announcementTrack}</a>
            : <div>{announcementTrack}</div>}
        </div>}

        <div className="story-track" ref={trackRef}>
          {renderedProducts.map((product, index) => (
            <article className="story-slide" key={`${product.id}-${index}`}>
              <img src={getDisplayedProductImage(product)} alt={product.alt} style={{ objectPosition: product.objectPosition }} loading={Math.abs(index - (activeIndex + 1)) <= 1 ? 'eager' : 'lazy'} decoding={Math.abs(index - (activeIndex + 1)) <= 1 ? 'sync' : 'async'} />
              <div className="story-shade" />
            </article>
          ))}
        </div>

        {!activeProduct && <div className={`empty-storefront${isAdminMode ? ' is-admin' : ''}`}>
          {!isAdminMode && <header className="empty-storefront__header">
            <div className="empty-storefront__identity"><span>{storeInitial}</span><div><strong>{editableStoreName}</strong><button type="button" onClick={copyStoreUrl} aria-label={`Kopeeri poe aadress ${storePublicUrl}`}>{storePublicUrl}<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></button></div></div>
          </header>}
          {isAdminMode && <button className="empty-storefront__settings" type="button" onClick={() => { setIsSettingsHome(true); setIsSettingsOpen(true) }} aria-label="Seaded"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A7 7 0 0 0 15 6l-.3-2.6h-4L10.4 6A7 7 0 0 0 8.5 7L6.1 6 4 9.5 6.1 11a7 7 0 0 0 0 2L4 14.5 6.1 18l2.4-1a7 7 0 0 0 1.9 1l.3 2.6h4L15 18a7 7 0 0 0 1.5-1l2.4 1 2-3.5-2-1.5a7 7 0 0 0 .1-1Z"/></svg></button>}
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
          </div> : <div className="empty-storefront__customer"><h1>Pood avaneb peagi.</h1><p>Esimesed tooted on juba teel.</p>{!isCustomerPreview && <button className="empty-storefront__owner-login" type="button" onClick={() => setIsLoginOpen(true)}>Poe omanik? Logi sisse</button>}</div>}
        </div>}

        {activeProduct && isEditOpen && <div className="product-image-editor">
          <div className="product-image-editor__tray">
            {editProductImages.map((image, index) => <div className={(selectedImages[activeProduct.id] ?? 0) === index ? 'is-active' : ''} key={`${image}-${index}`}>
              <button type="button" onClick={() => setSelectedImages((current) => ({ ...current, [activeProduct.id]: index }))} aria-label={`Vali pilt ${index + 1}`}><img src={image} alt="" /></button>
              <button className="product-image-editor__remove" type="button" title="Eemalda pilt" aria-label={`Eemalda pilt ${index + 1}`} onClick={() => removeEditProductImage(index)}>×</button>
              {(selectedImages[activeProduct.id] ?? 0) === index && <button className="product-image-editor__replace" type="button" title="Vaheta valitud pilt" aria-label="Vaheta valitud pilt" onClick={() => { editProductImageModeRef.current = 'replace'; editProductImageInputRef.current?.click() }}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5"/><path d="M18.2 16.4A7 7 0 1 1 19.5 9L20 12"/></svg>
              </button>}
            </div>)}
            {editProductImages.length < MAX_PRODUCT_IMAGES && <button className="product-image-editor__add" type="button" title="Lisa pilt" aria-label="Lisa pilt" onClick={() => { editProductImageModeRef.current = 'add'; editProductImageInputRef.current?.click() }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>}
          </div>
          <input ref={editProductImageInputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(event) => { chooseEditProductImages(event.target.files); event.target.value = '' }} />
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
                <img src={image} alt="" />
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
        {activeProduct && <button className={`buy-now${activeProductHasSale ? ' has-sale' : ''}${activeProductHasSale && saleBadgeStyle === 'price' ? ' has-inline-sale-price' : ''}`} onClick={buyNow}>
          <span>{activeProductHasSale ? 'Osta kohe' : 'Osta'}</span>
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
            {activeProduct && <button className="admin-orders" type="button" onClick={() => setIsOrdersOpen(true)} aria-label={`Tellimused${newOrderCount ? `, ${newOrderCount} uut` : ''}`}>
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
            onKeyDown={(event) => event.key === 'Enter' && event.preventDefault()}
          >{activeProduct.name}</h1>
          <div className="product-heading-actions">
            <button className="share-product" onClick={shareActiveProduct} tabIndex={isEditOpen ? -1 : 0} aria-label="Jaga toodet"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5"/></svg></button>
            {isAdminMode && <div className="admin-actions">
              {isEditOpen ? <>
                <button onClick={closeEditProduct} tabIndex={-1} aria-label="Loobu muudatustest" title="Loobu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
                <button className="save-product-edit" onClick={saveEditedProduct} tabIndex={-1} aria-label="Salvesta muudatused" title="Salvesta"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg></button>
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
          >{activeProduct.description || (activeProduct.id === draftProductId ? '' : '—')}</p>
        </div>
        <div className="product-price">
          <span>Hind</span>
          <div className="price-value">
            {activeProductHasSale ? <>
              <del key={isEditOpen ? 'editing-price' : 'viewing-price'} ref={isEditOpen ? (node) => { editProductPriceRef.current = node } : undefined} contentEditable={isEditOpen} suppressContentEditableWarning role={isEditOpen ? 'textbox' : undefined} aria-label={isEditOpen ? 'Toote tavahind' : undefined} onFocus={(event) => selectEditableContents(event.currentTarget)} onKeyDown={(event) => event.key === 'Enter' && event.preventDefault()}>{activeProduct.price} €</del>
              <strong key={isEditOpen ? 'editing-sale-price' : 'viewing-sale-price'} ref={isEditOpen ? (node) => { editProductSalePriceRef.current = node } : undefined} contentEditable={isEditOpen} suppressContentEditableWarning role={isEditOpen ? 'textbox' : undefined} aria-label={isEditOpen ? 'Toote soodushind' : undefined} onFocus={(event) => selectEditableContents(event.currentTarget)} onKeyDown={(event) => event.key === 'Enter' && event.preventDefault()}>{activeProduct.salePrice} €</strong>
            </> : <>
              <strong key={isEditOpen ? 'editing-price' : 'viewing-price'} ref={isEditOpen ? (node) => { editProductPriceRef.current = node } : undefined} contentEditable={isEditOpen} suppressContentEditableWarning role={isEditOpen ? 'textbox' : undefined} aria-label={isEditOpen ? 'Toote hind' : undefined} data-placeholder={isEditOpen && activeProduct.id === draftProductId ? 'Lisa hind' : undefined} onFocus={(event) => selectEditableContents(event.currentTarget)} onKeyDown={(event) => event.key === 'Enter' && event.preventDefault()}>{activeProduct.price !== undefined ? `${activeProduct.price} €` : activeProduct.id === draftProductId ? '' : '—'}</strong>
              {isEditOpen && <strong className="editable-sale-price" ref={(node) => { editProductSalePriceRef.current = node }} contentEditable suppressContentEditableWarning role="textbox" aria-label="Toote soodushind" data-placeholder="Lisa soodushind" onFocus={(event) => selectEditableContents(event.currentTarget)} onKeyDown={(event) => event.key === 'Enter' && event.preventDefault()} />}
            </>}
          </div>
        </div>
        <button
          className={`product-details__buy${isEditOpen ? ' is-publish' : `${isActiveProductInCart ? ' is-in-cart' : ''}${addedProductId === activeProduct.id ? ' is-added' : ''}`}`}
          onClick={() => {
            if (isEditOpen) {
              saveEditedProduct()
              return
            }
            if (isActiveProductInCart) {
              setCartStep('cart')
              setIsCartOpen(true)
              return
            }
            addToCart(activeProduct)
          }}
        >
          {isEditOpen ? <span>Salvesta ja avalda</span> : isActiveProductInCart ? (
            <span>Ostukorvis</span>
          ) : <span>Lisa ostukorvi</span>}
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
            {storeSlug ? <div className="site-footer__address"><strong>{editableStoreName}</strong><small>{contactLine}</small></div> : <a className="site-footer__address" href="https://www.google.com/maps/place//data=!4m2!3m1!1s0x4692948419d85985:0x11a43bd7c43d6ee3?sa=X&ved=1t:8290&ictx=111" target="_blank" rel="noreferrer">
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
          <div className="site-footer__bottom">
            <span>© 2026 {editableStoreName}</span>
            <div className="site-footer__meta">
              {storeSlug ? <span>{storeSlug}.poeruum.ee</span> : <a href="https://veidradasjad.ee">veidradasjad.ee</a>}
              {!isLoggedIn && !isCustomerPreview && <><i aria-hidden="true" /><button type="button" onClick={() => setIsLoginOpen(true)} aria-label="Poe omanikule: ava poe halduse sisselogimine">Poe haldus →</button></>}
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

      {isCartOpen && <Cart items={cart} initialStep={cartStep} paymentProvider={activePaymentProvider} paymentsReady={paymentsReady} deliverySettings={deliverySettings} onRemove={(index) => setCart((items) => items.filter((_, itemIndex) => itemIndex !== index))} onComplete={(order) => { setOrders((current) => [order, ...current]); setCart([]) }} onClose={() => setIsCartOpen(false)} />}
      {isOrdersOpen && <div className="overlay login-overlay orders-overlay" onMouseDown={(event) => event.target === event.currentTarget && setIsOrdersOpen(false)}>
        <section className="login-sheet orders-sheet" role="dialog" aria-modal="true" aria-label="Tellimused">
          <button className="login-sheet__close" onClick={() => setIsOrdersOpen(false)} aria-label="Sulge"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
          <div className="orders-heading">
            <span>TELLIMUSED</span><h2>{newOrderCount ? newOrderCount === 1 ? '1 uus tellimus' : `${newOrderCount} uut tellimust` : 'Kõik on tehtud'}</h2><p>Siin näed demopoele tehtud oste. Uuemad on alati ees.</p>
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
            <ul>{order.items.map((item) => <li key={item.id}><img src={item.image} alt="" /><span>{item.name}</span><strong>{getProductPrice(item).toFixed(2).replace('.', ',')} €</strong></li>)}</ul>
            <footer><strong>{order.status === 'refunded' ? <s>{order.total.toFixed(2).replace('.', ',')} €</s> : `${order.total.toFixed(2).replace('.', ',')} €`}</strong>{order.status === 'new' ? <button type="button" onClick={() => setOrders((current) => current.map((item) => item.id === order.id ? { ...item, status: 'fulfilled' } : item))}>Märgi täidetuks</button> : order.status === 'fulfilled' ? <button className="order-refund" type="button" onClick={() => setOrders((current) => current.map((item) => item.id === order.id ? { ...item, status: 'refunded' } : item))}>Märgi tagastatuks</button> : <small>Poeruumi tasu krediteeritud</small>}</footer>
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
            <div>{SETTINGS_SECTIONS.map((section) => <button type="button" onClick={() => { setSettingsSection(section.id); setIsSettingsHome(false) }} key={section.id}><span><strong>{section.label}</strong><small>{section.description}</small></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></button>)}</div>
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
            <label className="settings-toggle settings-visibility"><span><strong>Pood on avalik</strong><small>{isStoreVisible ? 'Kliendid saavad sinu poodi külastada' : 'Poodi näed praegu ainult sina'}</small></span><input type="checkbox" checked={isStoreVisible} onChange={(event) => setIsStoreVisible(event.target.checked)} /><i /></label>
            <div className="settings-fields">
              <label>Poe nimi<input value={editableStoreName} onChange={(event) => setEditableStoreName(event.target.value)} placeholder="Minu pood" /></label>
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
              <label>Oma domeen<input value={customDomain} onChange={(event) => setCustomDomain(event.target.value)} placeholder={`${storeSlug || 'minupood'}.poeruum.ee`} /><small className="settings-field-note">Oma domeeni ühendamine lisandub pärast DNS-i kontrolli.</small></label>
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
                ['montonio', 'Montonio', 'Kliendid saavad maksta Eesti pangalingi või kaardiga. Raha liigub sinu kontole.', 'Ühenda, et kliendid saaksid maksta Eesti pangalingi või kaardiga.'],
              ] as Array<[PaymentProvider, string, string, string]>).map(([id, name, connectedDetail, disconnectedDetail]) => {
                const isCurrentProvider = activePaymentProvider === id
                return <button type="button" disabled={isCurrentProvider} aria-pressed={isCurrentProvider} className={isCurrentProvider ? `is-active${paymentsReady ? '' : ' is-pending'}` : ''} onClick={() => onConnectPaymentProvider ? onConnectPaymentProvider(id) : setAuthToast('Makseteenuse ühendamine on saadaval kaupmehe vaates')} key={id}>
                <span className={`settings-provider-logo is-${id}`}>{id === 'stripe' ? 'S' : 'M'}</span>
                <span><strong>{name}</strong><small>{isCurrentProvider ? paymentsReady ? connectedDetail : 'Teenusepakkuja kontrollib sinu andmeid. Makseid saab vastu võtta pärast kinnitamist.' : disconnectedDetail}</small></span>
                <i className="settings-provider-status">{isCurrentProvider ? paymentsReady ? <><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12 4 4 8-9" /></svg><span>Ühendatud</span></> : <span>Kontrollimisel</span> : <span>Ühenda</span>}</i>
              </button>})}
            </div>
            {paymentsReady && <button className="settings-secondary-action" type="button" onClick={() => setAuthToast(`${activePaymentProvider === 'stripe' ? 'Stripe’i töölaud' : 'Montonio partnerportaal'} avaneb päris ühenduses`)}>
              <span>{activePaymentProvider === 'stripe' ? 'Ava Stripe’i töölaud' : 'Ava Montonio partnerportaal'}</span>
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
              <label>Ettevõtte nimi<input value={businessName} onChange={(event) => setBusinessName(event.target.value)} placeholder="Minu Ettevõte OÜ" /></label>
              <div><label>Registrikood<input inputMode="numeric" value={registryCode} onChange={(event) => setRegistryCode(event.target.value)} placeholder="12345678" /></label><label>Ettevõtte aadress<input value={businessAddress} onChange={(event) => setBusinessAddress(event.target.value)} placeholder="Tallinn, Eesti" /></label></div>
              <label>Tagastustingimused<textarea rows={4} value={returnsText} onChange={(event) => setReturnsText(event.target.value)} /></label>
            </div>
            <div className="settings-info-note"><span>i</span><p>Enne poe avalikustamist kontrolli, et müüja andmed ning tarne- ja tagastustingimused oleksid täielikud.</p></div>
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
              <button type="button" className={billingPlan === 'flexible' ? 'is-selected' : ''} role="radio" aria-checked={billingPlan === 'flexible'} onClick={() => setBillingPlan('flexible')}>
                <span>PAINDLIK</span><strong>0 € <small>/ kuu</small></strong><p>4% toodete müügilt</p><em>Kuni 39 € kuus + km</em><b>{billingPlan === 'flexible' ? '✓ Valitud' : 'Vali pakett'}</b>
              </button>
              <button type="button" className={billingPlan === 'fixed' ? 'is-selected' : ''} role="radio" aria-checked={billingPlan === 'fixed'} onClick={() => setBillingPlan('fixed')}>
                <span>KINDEL</span><strong>29 € <small>/ kuu + km</small></strong><p>0% Poeruumi müügitasu</p><em>Kasulik alates 725 € kuumüügist</em><b>{billingPlan === 'fixed' ? '✓ Valitud' : 'Vali pakett'}</b>
              </button>
            </div>
            <div className="billing-current">
              <header><span>{billingMonth}</span><strong>{formatEuro(monthlyPlatformFee)}</strong></header>
              <div className="billing-current__progress"><i style={{ width: `${platformFeeProgress}%` }} /></div>
              <div><span>Toodete müük <strong>{formatEuro(monthlyProductSales)}</strong></span><span>{billingPlan === 'fixed' ? '0% müügitasu' : remainingPlatformFee > 0 ? `Kuulaeni ${formatEuro(remainingPlatformFee)}` : 'Hinnalagi täis'}</span></div>
              <small>{billingPlan === 'fixed' ? 'Kuutasu ei muutu koos müügimahuga.' : monthlyPlatformFee >= PLATFORM_FEE_CAP ? 'Sel kuul rohkem Poeruumi tasu ei lisandu.' : 'Tasu uuendatakse pärast iga edukat tellimust.'}</small>
            </div>
            <div className="billing-rules">
              <div><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12 4 4 8-9" /></svg></span><p><strong>{billingPlan === 'fixed' ? 'Müügilt 0% Poeruumile' : 'Tarne ei kuulu arvestusse'}</strong><small>{billingPlan === 'fixed' ? 'Müügimahu kasv ei suurenda kuutasu.' : '4% arvutatakse ainult toodete summalt.'}</small></p></div>
              <div><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8H4V4"/><path d="M4.5 8a8 8 0 1 1-.1 7"/></svg></span><p><strong>{billingPlan === 'fixed' ? 'Paketti saad vahetada' : 'Tagastuse tasu krediteeritakse'}</strong><small>{billingPlan === 'fixed' ? 'Uus valik hakkab kehtima järgmisest arvelduskuust.' : 'Tagastatud toodete müük vähendatakse arvestusest.'}</small></p></div>
              <div><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 8.5c-4.5 0-4.5 7 0 7 3.5 0 4.5-7 7-7 4.5 0 4.5 7 0 7-3.5 0-4.5-7-7-7Z"/></svg></span><p><strong>{billingPlan === 'fixed' ? 'Kindel kulu iga kuu' : 'Pärast 39 € müüd tasuta'}</strong><small>{billingPlan === 'fixed' ? 'Poeruumi kuutasu on alati 29 € + km.' : 'Kuu hinnalagi kaitseb sinu kasvu.'}</small></p></div>
            </div>
            <div className="settings-fields billing-fields"><label>Arvete e-post<input type="email" value={billingEmail} onChange={(event) => setBillingEmail(event.target.value)} placeholder={contactEmail || 'arved@minupood.ee'} /><small className="settings-field-note">Kuu kokkuvõte saadetakse järgmise kuu alguses.</small></label></div>
            <div className="settings-info-note"><span>i</span><p>{activePaymentProvider === 'stripe' ? 'Stripe’i' : 'Montonio'} makseteenuse tasud ei kuulu Poeruumi tasu sisse ja arvestatakse teenusepakkuja hinnakirja järgi.</p></div>
          </div>}
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
          <div className="share-sheet__product"><img src={activeProduct.image} alt="" /><strong>{activeProduct.name}</strong><button type="button" onClick={() => setIsShareOpen(false)} aria-label="Sulge">×</button></div>
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
          {activeProduct && <div className="delete-confirm__product"><img src={getDisplayedProductImage(activeProduct)} alt="" /><span><strong>{activeProduct.name}</strong><small>{getProductPrice(activeProduct).toFixed(2).replace('.', ',')} € · {activeProduct.gallery?.length ?? 1} {(activeProduct.gallery?.length ?? 1) === 1 ? 'pilt' : 'pilti'}</small></span></div>}
          <div className="delete-confirm__actions">
            <button type="button" autoFocus onClick={() => setIsDeleteOpen(false)}>Hoia alles</button>
            <button type="button" onClick={deleteActiveProduct}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg>Kustuta toode</button>
          </div>
        </section>
      </div>}
      {isLoginOpen && !isLoggedIn && (
        <div className="overlay login-overlay" onMouseDown={(event) => event.target === event.currentTarget && setIsLoginOpen(false)}>
          <section className="login-sheet" role="dialog" aria-modal="true" aria-label="Logi sisse">
            <button className="login-sheet__close" onClick={() => setIsLoginOpen(false)} aria-label="Sulge">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
            <span className="login-sheet__eyebrow">POE OMANIKULE</span>
            <h2>Logi sisse</h2>
            <form onSubmit={(event) => { event.preventDefault(); setIsLoggedIn(true); setIsCustomerPreview(false); setIsLoginOpen(false); setAuthToast('Sisse logitud') }}>
              <label>E-post<input type="email" autoComplete="username" /></label>
              <label>Parool<input type="password" autoComplete="current-password" /></label>
              <button type="submit">Logi sisse</button>
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
            <strong>{imageUpload.phase === 'ready' ? 'Pildid on poes' : imageUpload.images.length === 1 ? 'Lisan tootepildi…' : `Lisan ${imageUpload.images.length} tootepilti…`}</strong>
          </div>
          <div className="image-upload-progress__track" aria-label={`${imageUpload.progress}%`}><span style={{ width: `${imageUpload.progress}%` }}><i /></span></div>
          <div className="image-upload-progress__meta"><span>{imageUpload.phase === 'ready' ? 'Kõik valmis' : `${imageUpload.progress}%`}</span><span>{imageUpload.images.length}/{MAX_PRODUCT_IMAGES} pilti</span></div>
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
              <label className="ai-description-field"><span>Kirjeldus <small>valikuline</small><button type="button" disabled={isAddAiGenerating} onClick={() => {
                setIsAddAiGenerating(true)
                window.setTimeout(() => {
                  setAddProductDescription(`${addProductName || 'See eriline toode'} on hoolega valitud ja loodud tooma sinu igapäeva veidi rohkem isikupära. Iga detail on läbimõeldud ning kordumatu.`)
                  setIsAddAiGenerating(false)
                }, 700)
              }}>{isAddAiGenerating ? '✦ AI kirjutab…' : '✦ Loo AI-ga'}</button></span><textarea name="description" value={addProductDescription} onChange={(event) => setAddProductDescription(event.target.value)} placeholder="Kirjuta ise või lase AI-l aidata…" /></label>
              <label>Hind<input name="price" type="number" inputMode="decimal" min="0" step="0.01" value={addProductPrice} onChange={(event) => { setAddProductPrice(event.target.value); setAddProductError('') }} /></label>
              <label>Soodushind<input name="salePrice" type="number" inputMode="decimal" min="0" step="0.01" value={addProductSalePrice} onChange={(event) => setAddProductSalePrice(event.target.value)} placeholder="Valikuline" /></label>
              <details className="product-seo">
                <summary><span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg></span><div><strong>Google’i eelvaade</strong><small>Loodud automaatselt</small></div><b>Valmis</b><i /></summary>
                <div className="product-seo__content">
                  <div className="product-seo__preview">
                    <small>{customDomain || `${storeSlug || 'minupood'}.poeruum.ee`} › toode › {addProductSlug || 'toote-nimi'}</small>
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
                <img src={product.image} alt="" />
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
