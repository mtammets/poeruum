import { useEffect, useRef, useState } from 'react'
import { products, type Product } from './products'

const getProductPrice = (product: Product) =>
  product.salePrice !== undefined && product.price !== undefined && product.salePrice < product.price
    ? product.salePrice
    : product.price ?? 0

type OmnivaLocation = { ZIP: string; NAME: string; TYPE: string; A0_NAME: string; A1_NAME: string; A2_NAME: string; A3_NAME: string }

function Cart({ items, initialStep, onRemove, onClose }: { items: Product[]; initialStep: 'cart' | 'checkout'; onRemove: (index: number) => void; onClose: () => void }) {
  const [step, setStep] = useState<'cart' | 'checkout'>(initialStep)
  const [paymentMethod, setPaymentMethod] = useState<'bank' | 'card'>('bank')
  const [bank, setBank] = useState('swedbank')
  const [delivery, setDelivery] = useState<'parcel' | 'pickup'>('parcel')
  const [parcelMachines, setParcelMachines] = useState<{ id: string; label: string }[]>([])
  const itemTotal = items.reduce((sum, item) => sum + getProductPrice(item), 0)
  const deliveryPrice = delivery === 'parcel' ? 2.9 : 0
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
        .map((location) => ({ id: location.ZIP, label: `${location.A3_NAME || location.A2_NAME || location.A1_NAME} · ${location.NAME}` }))
        .sort((a, b) => a.label.localeCompare(b.label, 'et'))))
      .catch(() => undefined)
    return () => controller.abort()
  }, [step, delivery, parcelMachines.length])

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
                <button type="button" className={delivery === 'pickup' ? 'is-selected' : ''} onClick={() => setDelivery('pickup')}>Tulen ise järele</button>
              </div>
              {delivery === 'parcel' ? <label className="parcel-select">Pakiautomaat<select required defaultValue=""><option value="" disabled>{parcelMachines.length ? 'Vali pakiautomaat' : 'Laadin pakiautomaate…'}</option>{parcelMachines.map((machine) => <option key={machine.id} value={machine.id}>{machine.label}</option>)}</select></label> : <div className="pickup-note"><a href="https://www.google.com/maps/place//data=!4m2!3m1!1s0x4692948419d85985:0x11a43bd7c43d6ee3?sa=X&ved=1t:8290&ictx=111" target="_blank" rel="noreferrer">Paldiski mnt 25, 10612 Tallinn</a><span>Järeletulemise aeg lepitakse kokku pärast tellimust.</span></div>}
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
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [addedProducts, setAddedProducts] = useState<Product[]>([])
  const [deletedProductIds, setDeletedProductIds] = useState<string[]>([])
  const [productEdits, setProductEdits] = useState<Record<string, Partial<Product>>>({})

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
    if (!isLoginOpen && !isEditOpen && !isAddOpen && !isSearchOpen) return
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
  }, [isLoginOpen, isEditOpen, isAddOpen, isSearchOpen])

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

  const buyNow = () => {
    setCart((items) => items.some((item) => item.id === activeProduct.id) ? items : [...items, activeProduct])
    setCartStep('checkout')
    setIsCartOpen(true)
  }

  const deleteActiveProduct = () => {
    if (displayProducts.length <= 1) return
    setDeletedProductIds((ids) => [...ids, activeProduct.id])
    setCart((items) => items.filter((item) => item.id !== activeProduct.id))
    setActiveIndex(0)
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
            <button className={`cart-button${addedProductId ? ' is-bumping' : ''}`} onClick={() => { setCartStep('cart'); setIsCartOpen(true) }} aria-label={`Ostukorv, ${cart.length} toodet`}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2 11h10l2-8H6"/><circle cx="9" cy="19" r="1"/><circle cx="17" cy="19" r="1"/></svg>
              <span>{cart.length}</span>
            </button>
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

        <button className={`buy-now${activeProduct.salePrice !== undefined && activeProduct.price !== undefined && activeProduct.salePrice < activeProduct.price ? ' has-sale' : ''}`} onClick={buyNow}>
          <span>Osta kohe</span>
          <strong>{getProductPrice(activeProduct)} €</strong>
        </button>

        {isLoggedIn && (
          <div className="admin-global-actions">
            <button className="admin-add-product" onClick={() => setIsAddOpen(true)} aria-label="Lisa toode">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </button>
            <button className="admin-logout" onClick={() => setIsLoggedIn(false)} aria-label="Logi välja">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H5v14h5M14 8l4 4-4 4m4-4H9" /></svg>
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
          {isLoggedIn && <div className="admin-actions">
            <button onClick={() => setIsEditOpen(true)} aria-label="Muuda toodet"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-1 5 5-1L19 9l-4-4L4 16Zm9-9 4 4" /></svg></button>
            <button onClick={deleteActiveProduct} aria-label="Kustuta toode"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg></button>
          </div>}
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
      </section>

      {isCartOpen && <Cart items={cart} initialStep={cartStep} onRemove={(index) => setCart((items) => items.filter((_, itemIndex) => itemIndex !== index))} onClose={() => setIsCartOpen(false)} />}
      {isLoginOpen && (
        <div className="overlay login-overlay" onMouseDown={(event) => event.target === event.currentTarget && setIsLoginOpen(false)}>
          <section className="login-sheet" role="dialog" aria-modal="true" aria-label="Logi sisse">
            <button className="login-sheet__close" onClick={() => setIsLoginOpen(false)} aria-label="Sulge">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
            <h2>Logi sisse</h2>
            <form onSubmit={(event) => { event.preventDefault(); setIsLoggedIn(true); setIsLoginOpen(false) }}>
              <label>E-post<input type="email" autoComplete="username" /></label>
              <label>Parool<input type="password" autoComplete="current-password" /></label>
              <button type="submit">Logi sisse</button>
            </form>
          </section>
        </div>
      )}
      {isEditOpen && (
        <div className="overlay login-overlay" onMouseDown={(event) => event.target === event.currentTarget && setIsEditOpen(false)}>
          <section className="login-sheet edit-sheet" role="dialog" aria-modal="true" aria-label="Muuda toodet">
            <button className="login-sheet__close" onClick={() => setIsEditOpen(false)} aria-label="Sulge"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
            <h2>Muuda toodet</h2>
            <form onSubmit={(event) => {
              event.preventDefault()
              const data = new FormData(event.currentTarget)
              const files = data.getAll('images').filter((value): value is File => value instanceof File && value.size > 0)
              const uploadedImages = files.map((file) => URL.createObjectURL(file))
              setProductEdits((current) => ({ ...current, [activeProduct.id]: {
                name: String(data.get('name')),
                description: String(data.get('description')),
                price: Number(data.get('price')),
                salePrice: String(data.get('salePrice')).trim() ? Number(data.get('salePrice')) : undefined,
                ...(uploadedImages.length ? { image: uploadedImages[0], gallery: uploadedImages } : {}),
              } }))
              if (uploadedImages.length) setSelectedImages((current) => ({ ...current, [activeProduct.id]: 0 }))
              setIsEditOpen(false)
            }}>
              <label>Nimi<input name="name" defaultValue={activeProduct.name} /></label>
              <label>Kirjeldus<textarea name="description" defaultValue={activeProduct.description} /></label>
              <label>Hind<input name="price" type="number" min="0" step="0.01" defaultValue={activeProduct.price} /></label>
              <label>Soodushind<input name="salePrice" type="number" min="0" step="0.01" defaultValue={activeProduct.salePrice} placeholder="Valikuline" /></label>
              <label>Pildid<input className="image-upload" name="images" type="file" accept="image/*" multiple /></label>
              <button type="submit">Salvesta</button>
            </form>
          </section>
        </div>
      )}
      {isAddOpen && (
        <div className="overlay login-overlay" onMouseDown={(event) => event.target === event.currentTarget && setIsAddOpen(false)}>
          <section className="login-sheet edit-sheet" role="dialog" aria-modal="true" aria-label="Lisa toode">
            <button className="login-sheet__close" onClick={() => setIsAddOpen(false)} aria-label="Sulge"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
            <h2>Lisa toode</h2>
            <form onSubmit={(event) => {
              event.preventDefault()
              const data = new FormData(event.currentTarget)
              const files = data.getAll('images').filter((value): value is File => value instanceof File && value.size > 0)
              if (!files.length) return
              const images = files.map((file) => URL.createObjectURL(file))
              const name = String(data.get('name'))
              const product: Product = { id: `product-${Date.now()}`, name, description: String(data.get('description')), price: Number(data.get('price')), salePrice: String(data.get('salePrice')).trim() ? Number(data.get('salePrice')) : undefined, image: images[0], gallery: images, alt: name }
              setAddedProducts((current) => [...current, product])
              setActiveIndex(displayProducts.length)
              setIsAddOpen(false)
            }}>
              <label>Nimi<input name="name" required /></label>
              <label>Kirjeldus<textarea name="description" required /></label>
              <label>Hind<input name="price" type="number" min="0" step="0.01" required /></label>
              <label>Soodushind<input name="salePrice" type="number" min="0" step="0.01" placeholder="Valikuline" /></label>
              <label>Pildid<input className="image-upload" name="images" type="file" accept="image/*" multiple required /></label>
              <button type="submit">Lisa toode</button>
            </form>
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
