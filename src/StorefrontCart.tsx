import { useEffect, useRef, useState } from 'react'
import { startStripeStoreCheckout } from './lib/database'
import { createCheckoutRequestId, VAT_RATE } from './storefrontConfig'
import ModalCloseButton from './ModalCloseButton'
import {
  getProductPrice,
  getProductStockLimit,
  getResponsiveImageProps,
  SHIPPING_PROVIDERS,
  SHIPPING_PROVIDER_LABELS,
  type CartItem,
  type DeliverySettings,
  type PaymentProvider,
  type ShippingProvider,
} from './storefrontModel'

type OmnivaLocation = { ZIP: string; NAME: string; TYPE: string; A0_NAME: string; A1_NAME: string; A2_NAME: string; A3_NAME: string }
type ParcelMachine = { provider: ShippingProvider; id: string; name: string; city: string; address?: string; searchText: string }
type AksAddress = { adr_id: string; aadresstekst: string; ipikkaadress: string; omavalitsus: string; asustusyksus: string; sihtnumber: string; liikVal: string }

const formatEuro = (value: number) => `${value.toFixed(2).replace('.', ',')} €`
const normalizeSearch = (value: string) => value.toLocaleLowerCase('et').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const createParcelMachine = (provider: ShippingProvider, id: string, city: string, name: string, address?: string): ParcelMachine => ({ provider, id, city, name, address, searchText: normalizeSearch(`${SHIPPING_PROVIDER_LABELS[provider]} ${city} ${name} ${address ?? ''} ${id}`) })
const fallbackParcelMachines: ParcelMachine[] = [
  createParcelMachine('omniva', 'omniva:fallback-1', 'Tallinn', 'Viru Keskuse pakiautomaat'),
  createParcelMachine('dpd', 'dpd:fallback-1', 'Tallinn', 'Kristiine Keskuse pakiautomaat'),
  createParcelMachine('smartposti', 'smartposti:fallback-1', 'Tallinn', 'Ülemiste Keskuse pakiautomaat'),
  createParcelMachine('omniva', 'omniva:fallback-2', 'Tartu', 'Lõunakeskuse pakiautomaat'),
  createParcelMachine('dpd', 'dpd:fallback-2', 'Tartu', 'Kvartali pakiautomaat'),
  createParcelMachine('smartposti', 'smartposti:fallback-2', 'Pärnu', 'Kaubamajaka pakiautomaat'),
]
const findParcelMachines = (machines: ParcelMachine[], query: string) => {
  const terms = normalizeSearch(query).trim().split(/\s+/).filter(Boolean)
  if (!terms.length) return machines.slice(0, 8)
  return machines.filter((machine) => terms.every((term) => machine.searchText.includes(term))).sort((a, b) => {
    const queryStart = terms[0]
    const aStarts = normalizeSearch(a.city).startsWith(queryStart) || normalizeSearch(a.name).startsWith(queryStart)
    const bStarts = normalizeSearch(b.city).startsWith(queryStart) || normalizeSearch(b.name).startsWith(queryStart)
    return Number(bStarts) - Number(aStarts) || a.city.localeCompare(b.city, 'et') || a.name.localeCompare(b.name, 'et')
  }).slice(0, 8)
}

export default function StorefrontCart({ storeId, items, initialStep, paymentProvider, paymentsReady, deliverySettings, vatRegistered, onRemove, onQuantityChange, onClose }: { storeId?: string; items: CartItem[]; initialStep: 'cart' | 'checkout'; paymentProvider: PaymentProvider; paymentsReady: boolean; deliverySettings: DeliverySettings; vatRegistered: boolean; onRemove: (cartKey: string) => void; onQuantityChange: (cartKey: string, quantity: number) => void; onClose: () => void }) {
  const checkoutRef = useRef<HTMLElement>(null)
  const checkoutRequestIdRef = useRef(createCheckoutRequestId())
  const [step, setStep] = useState<'cart' | 'checkout'>(initialStep)
  const enabledParcelProviders = SHIPPING_PROVIDERS.filter((provider) => deliverySettings.parcelProviders[provider].enabled)
  const enabledParcelProviderKey = enabledParcelProviders.join(',')
  const parcelEnabled = enabledParcelProviders.length > 0
  const [delivery, setDelivery] = useState<'parcel' | 'courier' | 'pickup'>(() => parcelEnabled ? 'parcel' : deliverySettings.courierEnabled ? 'courier' : 'pickup')
  const [parcelMachines, setParcelMachines] = useState<ParcelMachine[]>(() => fallbackParcelMachines.filter((machine) => enabledParcelProviders.includes(machine.provider)))
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
  const vatAmount = vatRegistered ? orderTotal * VAT_RATE / (1 + VAT_RATE) : 0

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
      setParcelMachines(machines.length ? machines : fallbackParcelMachines.filter((machine) => enabledParcelProviders.includes(machine.provider)))
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
        <ModalCloseButton className="checkout__close" onClose={onClose} />
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
              {vatRegistered
                ? <><div className="vat-row"><span>sh käibemaks 24%</span><span>{vatAmount.toFixed(2).replace('.', ',')} €</span></div><small>Hinnad sisaldavad käibemaksu.</small></>
                : <small>Müüja ei ole käibemaksukohustuslane.</small>}
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
