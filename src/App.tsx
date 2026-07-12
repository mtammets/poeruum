import { useEffect, useRef, useState } from 'react'
import { products, type Product } from './products'

const getProductPrice = (product: Product) =>
  product.salePrice !== undefined && product.price !== undefined && product.salePrice < product.price
    ? product.salePrice
    : product.price ?? 0

type OmnivaLocation = { ZIP: string; NAME: string; TYPE: string; A0_NAME: string; A1_NAME: string; A2_NAME: string; A3_NAME: string }
type ParcelMachine = { id: string; name: string; city: string; searchText: string }
type AksAddress = { adr_id: string; aadresstekst: string; ipikkaadress: string; omavalitsus: string; asustusyksus: string; sihtnumber: string; liikVal: string }
const MAX_PRODUCT_IMAGES = 3

const normalizeSearch = (value: string) => value
  .toLocaleLowerCase('et')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')

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

function Cart({ items, initialStep, onRemove, onClose }: { items: Product[]; initialStep: 'cart' | 'checkout'; onRemove: (index: number) => void; onClose: () => void }) {
  const [step, setStep] = useState<'cart' | 'checkout'>(initialStep)
  const [paymentMethod, setPaymentMethod] = useState<'bank' | 'card'>('bank')
  const [bank, setBank] = useState('swedbank')
  const [delivery, setDelivery] = useState<'parcel' | 'courier' | 'pickup'>('parcel')
  const [parcelMachines, setParcelMachines] = useState<ParcelMachine[]>([])
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
  const itemTotal = items.reduce((sum, item) => sum + getProductPrice(item), 0)
  const deliveryPrice = delivery === 'parcel' ? 2.9 : delivery === 'courier' ? 4.9 : 0
  const orderTotal = itemTotal + deliveryPrice
  const vatAmount = orderTotal * 24 / 124

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  useEffect(() => {
    if (step !== 'checkout' || delivery !== 'parcel' || parcelMachines.length) return
    const controller = new AbortController()
    fetch('https://www.omniva.ee/locations.json', { signal: controller.signal })
      .then((response) => response.json())
      .then((locations: OmnivaLocation[]) => setParcelMachines(locations
        .filter((location) => location.A0_NAME === 'EE' && location.TYPE === '0' && !location.NAME.toLowerCase().includes('picapac'))
        .map((location) => {
          const city = location.A3_NAME || location.A2_NAME || location.A1_NAME
          return { id: location.ZIP, name: location.NAME, city, searchText: normalizeSearch(`${city} ${location.NAME} ${location.ZIP}`) }
        })
        .sort((a, b) => a.city.localeCompare(b.city, 'et') || a.name.localeCompare(b.name, 'et'))))
      .catch((error) => { if (error.name !== 'AbortError') setParcelLoadFailed(true) })
    return () => controller.abort()
  }, [step, delivery, parcelMachines.length])

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
    setParcelQuery(`${machine.city} · ${machine.name}`)
    setIsParcelSearchOpen(false)
  }

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="checkout" role="dialog" aria-modal="true" aria-label="Ostukorv">
        <button className="checkout__close" onClick={onClose} aria-label="Sulge">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
        <h2>{step === 'cart' ? 'Ostukorv' : 'Vormista tellimus'}</h2>
        {items.length === 0 ? <p className="cart-empty">Ostukorv on tühi.</p> : <>
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
          </> : <form onSubmit={(event) => event.preventDefault()}>
            <label>Nimi<input required autoComplete="name" /></label>
            <label>E-post<input required type="email" autoComplete="email" /></label>
            <label>Telefon<input required type="tel" autoComplete="tel" /></label>
            <fieldset className="payment delivery">
              <legend>Tarneviis</legend>
              <div className="payment-tabs">
                <button type="button" className={delivery === 'parcel' ? 'is-selected' : ''} onClick={() => setDelivery('parcel')}>Pakiautomaat</button>
                <button type="button" className={delivery === 'courier' ? 'is-selected' : ''} onClick={() => setDelivery('courier')}>Kuller</button>
                <button type="button" className={delivery === 'pickup' ? 'is-selected' : ''} onClick={() => setDelivery('pickup')}>Tulen ise järele</button>
              </div>
              {delivery === 'parcel' ? <div className="parcel-select">
                <label htmlFor="parcel-search">Pakiautomaat</label>
                <div className="parcel-combobox">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>
                  <input
                    id="parcel-search"
                    value={parcelQuery}
                    autoComplete="off"
                    placeholder={parcelMachines.length ? 'Otsi linna või pakiautomaati' : parcelLoadFailed ? 'Pakiautomaate ei saanud laadida' : 'Laadin pakiautomaate…'}
                    disabled={!parcelMachines.length}
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
                  ><strong>{machine.city}</strong><span>{machine.name}</span></button>) : <p>Sellist pakiautomaati ei leidnud.</p>}
                </div>}
                {parcelLoadFailed && <p className="parcel-status">Pakiautomaatide laadimine ebaõnnestus. Palun proovi lehte värskendada.</p>}
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
                <small>Vali täpne aadress soovituste seast · 4,90 €</small>
              </div> : <div className="pickup-note"><a href="https://www.google.com/maps/place//data=!4m2!3m1!1s0x4692948419d85985:0x11a43bd7c43d6ee3?sa=X&ved=1t:8290&ictx=111" target="_blank" rel="noreferrer">Paldiski mnt 25, 10612 Tallinn</a><span>Järeletulemise aeg lepitakse kokku pärast tellimust.</span></div>}
            </fieldset>
            <fieldset className="payment">
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
            </fieldset>
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
            <button className="pay" type="submit">Maksa</button>
            <button className="checkout-back" type="button" onClick={() => setStep('cart')}>Tagasi ostukorvi</button>
          </form>}
        </>}
      </section>
    </div>
  )
}

export default function App() {
  const trackRef = useRef<HTMLDivElement>(null)
  const activeIndexRef = useRef(0)
  const logoTapCountRef = useRef(0)
  const logoTapTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [cart, setCart] = useState<Product[]>([])
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [cartStep, setCartStep] = useState<'cart' | 'checkout'>('cart')
  const [addedProductId, setAddedProductId] = useState<string | null>(null)
  const [isScreensaverActive, setIsScreensaverActive] = useState(false)
  const [selectedImages, setSelectedImages] = useState<Record<string, number>>({})
  const [isLoginOpen, setIsLoginOpen] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [showDeletedToast, setShowDeletedToast] = useState(false)
  const [showCopiedToast, setShowCopiedToast] = useState(false)
  const [authToast, setAuthToast] = useState<'Sisse logitud' | 'Välja logitud' | null>(null)
  const [shareUrl, setShareUrl] = useState('')
  const [isShareOpen, setIsShareOpen] = useState(false)
  const [shareDragY, setShareDragY] = useState(0)
  const [isShareDragging, setIsShareDragging] = useState(false)
  const shareDragStartRef = useRef<number | null>(null)
  const [editProductImages, setEditProductImages] = useState<string[]>([])
  const [editNewImages, setEditNewImages] = useState<string[]>([])
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [addProductStep, setAddProductStep] = useState<'source' | 'details'>('source')
  const [addProductImages, setAddProductImages] = useState<string[]>([])
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const moreCameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [addedProducts, setAddedProducts] = useState<Product[]>([])
  const [deletedProductIds, setDeletedProductIds] = useState<string[]>([])
  const [productEdits, setProductEdits] = useState<Record<string, Partial<Product>>>({})

  const openEditProduct = () => {
    setEditProductImages([...(activeProduct.gallery ?? [activeProduct.image])].slice(0, MAX_PRODUCT_IMAGES))
    setEditNewImages([])
    setIsEditOpen(true)
  }

  const closeEditProduct = () => {
    editNewImages.forEach((image) => URL.revokeObjectURL(image))
    setEditProductImages([])
    setEditNewImages([])
    setIsEditOpen(false)
  }

  const addEditProductImages = (files: FileList | null) => {
    if (!files?.length) return
    const availableSlots = MAX_PRODUCT_IMAGES - editProductImages.length
    const images = Array.from(files).slice(0, availableSlots).map((file) => URL.createObjectURL(file))
    if (!images.length) return
    setEditProductImages((current) => [...current, ...images])
    setEditNewImages((current) => [...current, ...images])
  }

  const removeEditProductImage = (image: string, index: number) => {
    if (editNewImages.includes(image)) {
      URL.revokeObjectURL(image)
      setEditNewImages((current) => current.filter((item) => item !== image))
    }
    setEditProductImages((images) => images.filter((_, imageIndex) => imageIndex !== index))
  }

  const closeAddProduct = () => {
    addProductImages.forEach((image) => URL.revokeObjectURL(image))
    setIsAddOpen(false)
    setAddProductStep('source')
    setAddProductImages([])
  }

  const chooseAddProductImages = (files: FileList | null) => {
    if (!files?.length) return
    addProductImages.forEach((image) => URL.revokeObjectURL(image))
    setAddProductImages(Array.from(files).slice(0, MAX_PRODUCT_IMAGES).map((file) => URL.createObjectURL(file)))
    setAddProductStep('details')
  }

  const addCameraProductImage = (files: FileList | null) => {
    const file = files?.[0]
    if (!file || addProductImages.length >= MAX_PRODUCT_IMAGES) return
    setAddProductImages((images) => [...images, URL.createObjectURL(file)].slice(0, MAX_PRODUCT_IMAGES))
  }

  activeIndexRef.current = activeIndex
  const displayProducts = [...products, ...addedProducts]
    .filter((product) => !deletedProductIds.includes(product.id))
    .map((product) => ({ ...product, ...(productEdits[product.id] ?? {}) }))
  const renderedProducts = [displayProducts[displayProducts.length - 1], ...displayProducts, displayProducts[0]]

  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    let frame = 0
    let normalizeTimeout: ReturnType<typeof window.setTimeout> | undefined
    const normalizePosition = () => {
      const physicalIndex = Math.round(track.scrollLeft / Math.max(track.clientWidth, 1))
      if (physicalIndex === 0) track.scrollTo({ left: displayProducts.length * track.clientWidth, behavior: 'auto' })
      if (physicalIndex === displayProducts.length + 1) track.scrollTo({ left: track.clientWidth, behavior: 'auto' })
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
        if (physicalIndex === 0 || physicalIndex === displayProducts.length + 1) {
          if (Math.abs(position - physicalIndex) < 0.02) {
            normalizePosition()
          } else {
            normalizeTimeout = window.setTimeout(normalizePosition, 120)
          }
        }
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
    if (!isLoginOpen && !isEditOpen && !isAddOpen && !isSearchOpen && !isDeleteOpen && !isShareOpen) return
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
  }, [isLoginOpen, isEditOpen, isAddOpen, isSearchOpen, isDeleteOpen, isShareOpen])

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
      if (!track) return
      let physicalIndex = Math.round(track.scrollLeft / Math.max(track.clientWidth, 1))
      if (physicalIndex >= displayProducts.length + 1) {
        physicalIndex = 1
        track.scrollTo({ left: track.clientWidth, behavior: 'auto' })
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
      autoplayInterval = window.setInterval(showNextProduct, 10_000)
    }

    const scheduleScreensaver = () => {
      stopScreensaver()
      if (!document.hidden && !isCartOpen) {
        idleTimeout = window.setTimeout(startScreensaver, 30_000)
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
  }, [isCartOpen, displayProducts.length])

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
  const activeProductHasSale = activeProduct.salePrice !== undefined && activeProduct.price !== undefined && activeProduct.salePrice < activeProduct.price

  const buyNow = () => {
    setCart((items) => items.some((item) => item.id === activeProduct.id) ? items : [...items, activeProduct])
    setCartStep('checkout')
    setIsCartOpen(true)
  }

  const logOut = () => {
    setIsLoggedIn(false)
    setAuthToast('Välja logitud')
  }

  const shareActiveProduct = async () => {
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
    try {
      await navigator.clipboard.writeText(shareUrl)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = shareUrl
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      textarea.remove()
    }
    setIsShareOpen(false)
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
    if (displayProducts.length <= 1) return
    setDeletedProductIds((ids) => [...ids, activeProduct.id])
    setCart((items) => items.filter((item) => item.id !== activeProduct.id))
    setActiveIndex(0)
    setIsDeleteOpen(false)
    setShowDeletedToast(true)
  }

  const searchResults = displayProducts.filter((product) =>
    `${product.name} ${product.description ?? ''}`.toLocaleLowerCase('et').includes(searchQuery.trim().toLocaleLowerCase('et')),
  )

  return (
    <main className="app-shell" data-screensaver={isScreensaverActive ? 'active' : 'idle'}>
      <section className="story-stage">
        <nav className="story-progress" aria-label="Tooted">
          {displayProducts.map((product, index) => (
            <button key={product.id} className={index === activeIndex ? 'is-active' : ''} onClick={() => goToProduct(index)} aria-label={`Toode ${index + 1}`}>
              <span />
            </button>
          ))}
        </nav>

        <header className="story-header">
          <div className="story-brand">
            <button className="secret-login-trigger" onClick={handleLogoTap} aria-label="Veidrad Asjad">
              <img src="/images/logo.png" alt="" />
            </button>
            <strong>VEIDRAD ASJAD</strong>
          </div>
          <div className="header-actions">
            <button className="search-button" onClick={() => setIsSearchOpen(true)} aria-label="Otsi tooteid"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg></button>
            {isLoggedIn ? <button className="logout-button" onClick={logOut} aria-label="Logi välja">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H5v14h5M14 8l4 4-4 4m4-4H9" /></svg>
            </button> : <button className={`cart-button${addedProductId ? ' is-bumping' : ''}`} onClick={() => { setCartStep('cart'); setIsCartOpen(true) }} aria-label={`Ostukorv, ${cart.length} toodet`}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2 11h10l2-8H6"/><circle cx="9" cy="19" r="1"/><circle cx="17" cy="19" r="1"/></svg>
              <span>{cart.length}</span>
            </button>}
          </div>
        </header>

        <div className="story-track" ref={trackRef}>
          {renderedProducts.map((product, index) => (
            <article className="story-slide" key={`${product.id}-${index}`}>
              <img src={(product.gallery ?? [product.image])[selectedImages[product.id] ?? 0]} alt={product.alt} style={{ objectPosition: product.objectPosition }} />
              <div className="story-shade" />
            </article>
          ))}
        </div>

        {(activeProduct.gallery?.length ?? 1) > 1 && (
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

        {activeProductHasSale && <div className="sale-badge" aria-label="Veider soodukas">
          <span aria-hidden="true">Veider</span>
          <strong aria-hidden="true"><i>S</i><i>o</i><i>o</i><i>d</i><i>u</i><i>k</i><i>a</i><i>s</i></strong>
        </div>}
        <button className={`buy-now${activeProductHasSale ? ' has-sale' : ''}`} onClick={buyNow}>
          <span>{activeProductHasSale ? 'Osta kohe' : 'Osta'}</span>
          <strong>{getProductPrice(activeProduct)} €</strong>
        </button>

        {isLoggedIn && (
          <div className="admin-global-actions">
            <button className="admin-add-product" onClick={() => { setAddProductStep('source'); setIsAddOpen(true) }} aria-label="Lisa toode">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </div>
        )}

        <div className="desktop-arrows" aria-label="Toote vahetamine">
          <button onClick={() => goToProduct(Math.max(0, activeIndex - 1))} disabled={activeIndex === 0} aria-label="Eelmine toode">←</button>
          <button onClick={() => goToProduct(Math.min(displayProducts.length - 1, activeIndex + 1))} disabled={activeIndex === displayProducts.length - 1} aria-label="Järgmine toode">→</button>
        </div>

      </section>

      <section className="product-details" aria-label="Eseme info">
        <div className="product-details__heading">
          <h1>{activeProduct.name}</h1>
          <div className="product-heading-actions">
            <button className="share-product" onClick={shareActiveProduct} aria-label="Jaga toodet"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5"/></svg></button>
            {isLoggedIn && <div className="admin-actions">
              <button onClick={openEditProduct} aria-label="Muuda toodet"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-1 5 5-1L19 9l-4-4L4 16Zm9-9 4 4" /></svg></button>
              <button onClick={() => displayProducts.length > 1 && setIsDeleteOpen(true)} aria-label="Kustuta toode"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg></button>
            </div>}
          </div>
        </div>
        <div>
          <span>Kirjeldus</span>
          <p>{activeProduct.description || '—'}</p>
        </div>
        <div className="product-price">
          <span>Hind</span>
          <div className="price-value">
            {activeProduct.salePrice !== undefined && activeProduct.price !== undefined && activeProduct.salePrice < activeProduct.price ? <><del>{activeProduct.price} €</del><strong>{activeProduct.salePrice} €</strong></> : <strong>{activeProduct.price !== undefined ? `${activeProduct.price} €` : '—'}</strong>}
          </div>
        </div>
        <button
          className={`product-details__buy${cart.some((item) => item.id === activeProduct.id) ? ' is-in-cart' : ''}${addedProductId === activeProduct.id ? ' is-added' : ''}`}
          onClick={() => addToCart(activeProduct)}
          disabled={cart.some((item) => item.id === activeProduct.id)}
        >
          {cart.some((item) => item.id === activeProduct.id) ? (
            <span>Ostukorvis</span>
          ) : <span>Lisa ostukorvi</span>}
        </button>
        <footer className="site-footer">
          <div className="site-footer__top">
            <a className="site-footer__address" href="https://www.google.com/maps/place//data=!4m2!3m1!1s0x4692948419d85985:0x11a43bd7c43d6ee3?sa=X&ved=1t:8290&ictx=111" target="_blank" rel="noreferrer">
              <strong>Mavi Stuudio</strong><small>Paldiski mnt 25, Tallinn</small>
            </a>
            <div className="social-links" aria-label="Sotsiaalmeedia">
              <a href="https://www.instagram.com/veidradasjad/" target="_blank" rel="noreferrer" aria-label="Instagram">
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" className="social-dot"/></svg>
              </a>
              <a href="https://www.facebook.com/profile.php?id=61580779397203" target="_blank" rel="noreferrer" aria-label="Facebook">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 21v-8h3l.5-3H14V8.5c0-1 .4-1.5 1.7-1.5H18V4.2c-.7-.1-1.7-.2-2.8-.2C12.5 4 11 5.6 11 8.3V10H8v3h3v8"/></svg>
              </a>
            </div>
          </div>
          <div className="site-footer__bottom"><span>© 2026 Veidrad Asjad</span><a href="https://veidradasjad.ee">veidradasjad.ee</a></div>
        </footer>
      </section>

      {isCartOpen && <Cart items={cart} initialStep={cartStep} onRemove={(index) => setCart((items) => items.filter((_, itemIndex) => itemIndex !== index))} onClose={() => setIsCartOpen(false)} />}
      {isShareOpen && <div className="overlay share-overlay" onMouseDown={(event) => event.target === event.currentTarget && setIsShareOpen(false)}>
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
      {showCopiedToast && <div className="toast" role="status">
        <span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 12.5 3.5 3.5 7.5-8" /></svg></span>
        <strong>Link kopeeritud</strong>
      </div>}
      {authToast && <div className="toast" role="status">
        <span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 12.5 3.5 3.5 7.5-8" /></svg></span>
        <strong>{authToast}</strong>
      </div>}
      {isDeleteOpen && <div className="overlay login-overlay" onMouseDown={(event) => event.target === event.currentTarget && setIsDeleteOpen(false)}>
        <section className="login-sheet delete-confirm" role="alertdialog" aria-modal="true" aria-labelledby="delete-title">
          <h2 id="delete-title">Kustuta toode?</h2>
          <div>
            <button type="button" onClick={() => setIsDeleteOpen(false)}>Loobu</button>
            <button type="button" onClick={deleteActiveProduct}>Kustuta</button>
          </div>
        </section>
      </div>}
      {isLoginOpen && (
        <div className="overlay login-overlay" onMouseDown={(event) => event.target === event.currentTarget && setIsLoginOpen(false)}>
          <section className="login-sheet" role="dialog" aria-modal="true" aria-label="Logi sisse">
            <button className="login-sheet__close" onClick={() => setIsLoginOpen(false)} aria-label="Sulge">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
            <h2>Logi sisse</h2>
            <form onSubmit={(event) => { event.preventDefault(); setIsLoggedIn(true); setIsLoginOpen(false); setAuthToast('Sisse logitud') }}>
              <label>E-post<input type="email" autoComplete="username" /></label>
              <label>Parool<input type="password" autoComplete="current-password" /></label>
              <button type="submit">Logi sisse</button>
            </form>
          </section>
        </div>
      )}
      {isEditOpen && (
        <div className="overlay login-overlay" onMouseDown={(event) => event.target === event.currentTarget && closeEditProduct()}>
          <section className="login-sheet edit-sheet" role="dialog" aria-modal="true" aria-label="Muuda toodet">
            <button className="login-sheet__close" onClick={closeEditProduct} aria-label="Sulge"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
            <h2>Muuda toodet</h2>
            <form onSubmit={(event) => {
              event.preventDefault()
              const data = new FormData(event.currentTarget)
              if (!editProductImages.length) return
              setProductEdits((current) => ({ ...current, [activeProduct.id]: {
                name: String(data.get('name')),
                description: String(data.get('description')),
                price: Number(data.get('price')),
                salePrice: String(data.get('salePrice')).trim() ? Number(data.get('salePrice')) : undefined,
                image: editProductImages[0],
                gallery: editProductImages,
              } }))
              setSelectedImages((current) => ({ ...current, [activeProduct.id]: 0 }))
              setIsEditOpen(false)
              setEditProductImages([])
              setEditNewImages([])
            }}>
              <label>Nimi<input name="name" defaultValue={activeProduct.name} /></label>
              <label>Kirjeldus<textarea name="description" defaultValue={activeProduct.description} /></label>
              <label>Hind<input name="price" type="number" min="0" step="0.01" defaultValue={activeProduct.price} /></label>
              <label>Soodushind<input name="salePrice" type="number" min="0" step="0.01" defaultValue={activeProduct.salePrice} placeholder="Valikuline" /></label>
              <fieldset className="edit-gallery">
                <legend>Pildid</legend>
                <div className="edit-gallery__grid">
                  {editProductImages.map((image, index) => <div className={index === 0 ? 'is-primary' : ''} key={`${image}-${index}`}>
                    <img src={image} alt={`Tootepilt ${index + 1}`} />
                    {index === 0 ? <span>Põhifoto</span> : <button type="button" className="set-primary" onClick={() => setEditProductImages((images) => [images[index], ...images.slice(0, index), ...images.slice(index + 1)])}>Põhifotoks</button>}
                    <button type="button" className="remove-image" disabled={editProductImages.length === 1} aria-label={`Eemalda pilt ${index + 1}`} onClick={() => removeEditProductImage(image, index)}>×</button>
                  </div>)}
                  {editProductImages.length < MAX_PRODUCT_IMAGES && <label className="edit-gallery__add">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                    <span>Lisa pilte</span>
                    <input type="file" accept="image/*" multiple onChange={(event) => { addEditProductImages(event.target.files); event.target.value = '' }} />
                  </label>}
                </div>
                <small>{editProductImages.length}/{MAX_PRODUCT_IMAGES} pilti · Esimene pilt on toote põhifoto.</small>
              </fieldset>
              <button type="submit">Salvesta</button>
            </form>
          </section>
        </div>
      )}
      {isAddOpen && (
        <div className="overlay login-overlay" onMouseDown={(event) => event.target === event.currentTarget && closeAddProduct()}>
          <section className="login-sheet edit-sheet" role="dialog" aria-modal="true" aria-label="Lisa toode">
            {addProductStep === 'details' && <button className="login-sheet__close" onClick={closeAddProduct} aria-label="Sulge"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>}
            {addProductStep === 'source' ? <div className="add-source">
              <div className="add-source__choices">
                <button type="button" aria-label="Pildista toodet" onClick={() => cameraInputRef.current?.click()}>
                  <span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.5-2h7L17 8h3v11H4V8Z"/><circle cx="12" cy="13" r="3.5"/></svg></span>
                  <strong>Pildista</strong>
                </button>
                <button type="button" aria-label="Vali tootefotod galeriist" onClick={() => galleryInputRef.current?.click()}>
                  <span><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m4 18 5-5 3 3 2-2 6 5"/></svg></span>
                  <strong>Vali galeriist</strong>
                </button>
              </div>
              <input ref={cameraInputRef} className="source-file-input" type="file" accept="image/*" capture="environment" onChange={(event) => { chooseAddProductImages(event.target.files); event.target.value = '' }} />
              <input ref={galleryInputRef} className="source-file-input" type="file" accept="image/*" multiple onChange={(event) => { chooseAddProductImages(event.target.files); event.target.value = '' }} />
            </div> : <>
            <h2>Toote andmed</h2>
            <div className="add-image-preview">
              <img src={addProductImages[0]} alt="Valitud tootepildi eelvaade" />
              {addProductImages.length > 1 && <span>+{addProductImages.length - 1}</span>}
              {addProductImages.length < MAX_PRODUCT_IMAGES && <button className="add-image-preview__camera" type="button" onClick={() => moreCameraInputRef.current?.click()}>Pildista veel</button>}
              <button type="button" onClick={() => { addProductImages.forEach((image) => URL.revokeObjectURL(image)); setAddProductImages([]); setAddProductStep('source') }}>Muuda pilti</button>
              <input ref={moreCameraInputRef} className="source-file-input" type="file" accept="image/*" capture="environment" onChange={(event) => { addCameraProductImage(event.target.files); event.target.value = '' }} />
            </div>
            <form onSubmit={(event) => {
              event.preventDefault()
              const data = new FormData(event.currentTarget)
              if (!addProductImages.length) return
              const name = String(data.get('name'))
              const product: Product = { id: `product-${Date.now()}`, name, description: String(data.get('description')), price: Number(data.get('price')), salePrice: String(data.get('salePrice')).trim() ? Number(data.get('salePrice')) : undefined, image: addProductImages[0], gallery: addProductImages, alt: name }
              setAddedProducts((current) => [...current, product])
              setActiveIndex(displayProducts.length)
              setIsAddOpen(false)
              setAddProductStep('source')
              setAddProductImages([])
            }}>
              <label>Nimi<input name="name" required /></label>
              <label>Kirjeldus<textarea name="description" required /></label>
              <label>Hind<input name="price" type="number" min="0" step="0.01" required /></label>
              <label>Soodushind<input name="salePrice" type="number" min="0" step="0.01" placeholder="Valikuline" /></label>
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
