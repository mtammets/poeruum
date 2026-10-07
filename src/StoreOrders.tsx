import { useEffect, useRef, useState, type ReactNode } from 'react'
import ModalCloseButton from './ModalCloseButton'
import OrderDocumentLinks from './OrderDocumentLinks'
import { getProductPrice, type CartItem, type StoreOrder } from './storefrontModel'
import type { SellerType } from '../shared/seller'
import './storeOrders.css'

const euro = (value: number) => `${value.toFixed(2).replace('.', ',')} €`
const filters = ['all', 'new', 'fulfilled', 'refunded'] as const
type OrderFilter = typeof filters[number]
const filterLabels = { all: 'Kõik', new: 'Uued', fulfilled: 'Täidetud', refunded: 'Tagastused' }
const isRefunding = (order: StoreOrder) => Boolean(order.refundStatus) || order.status === 'refunded'
const matchesFilter = (order: StoreOrder, filter: OrderFilter) => filter === 'all'
  || (filter === 'refunded' ? isRefunding(order) : order.status === filter && !isRefunding(order))

type IconName = 'bag' | 'search' | 'package' | 'pin' | 'check' | 'return' | 'wallet' | 'chevron' | 'clock' | 'alert' | 'phone'
function OrderIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    bag: <><path d="M5 7h14l1 14H4L5 7Z" /><path d="M8 8V6a4 4 0 0 1 8 0v2" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
    package: <><path d="m12 3 9 5v9l-9 5-9-5V8l9-5ZM3 8l9 5 9-5M12 13v9M7.5 5.5l9 5V15" /></>,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    return: <><path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12h-3" /></>,
    wallet: <><path d="M20 8V5H5a2 2 0 0 0 0 4h15v11H5a2 2 0 0 1-2-2V7" /><path d="M20 12h-5v5h5M17 14.5h.01" /></>,
    chevron: <path d="m9 5 7 7-7 7" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    alert: <><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v5M12 17h.01" /></>,
    phone: <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.8 2.1Z" />,
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}

function OrderCard({ order, storeId, sellerType, renderThumbnail, onChangeStatus }: {
  order: StoreOrder; storeId?: string; sellerType: SellerType; renderThumbnail: (item: CartItem) => ReactNode
  onChangeStatus: (id: string, status: StoreOrder['status']) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const refunded = order.status === 'refunded'
  const pending = order.refundStatus === 'requested' || order.refundStatus === 'pending'
  const needsHelp = Boolean(order.paymentIssue) || order.refundStatus === 'failed'
  const state = needsHelp ? 'issue' : refunded ? 'refunded' : pending ? 'pending' : order.status
  const status = { issue: 'Vajab tähelepanu', refunded: 'Tagastatud', pending: 'Tagastamisel', new: 'Uus', fulfilled: 'Täidetud' }[state]
  const statusIcon: IconName = needsHelp ? 'alert' : refunded ? 'return' : pending ? 'clock' : order.status === 'new' ? 'package' : 'check'
  const hasSettlement = Boolean(order.stripeSellerNet) && Number.isFinite(order.stripeSellerNet) && !refunded && !order.refundStatus && !needsHelp
  const [deliveryMethod, ...destination] = order.delivery.split(/\s[·–-]\s/)
  const deliveryPrice = Math.max(0, Math.round((order.total - order.productSubtotal) * 100) / 100)
  const initials = order.customerName.trim().split(/\s+/).slice(0, 2).map((name) => name[0]).join('')
  const phone = order.customerPhone?.trim()
  const changeStatus = async (next: StoreOrder['status']) => {
    if (busy) return
    setBusy(true)
    try { await onChangeStatus(order.id, next) } finally { setBusy(false) }
  }

  return <article className={`store-order is-${state}`} aria-label={`Tellimus ${order.id}`}>
    <header className="store-order__meta">
      <span className={`store-order__status is-${state}`}><OrderIcon name={statusIcon} />{status}</span>
      <span className="store-order__reference">{order.id}</span>
      <time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleString('et-EE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
    </header>
    <div className="store-order__headline">
      <div className="store-order__customer">
        <span className="store-order__avatar" aria-hidden="true">{initials || <OrderIcon name="bag" />}</span>
        <div>
          <h3>{order.customerName || 'Ostja'}</h3>
          <a href={`mailto:${order.customerEmail}`}>{order.customerEmail}</a>
          {phone ? <a className="store-order__phone" href={`tel:${phone.replace(/[^+\d]/g, '')}`}><OrderIcon name="phone" />{phone}</a>
            : <span className="store-order__phone is-missing"><OrderIcon name="phone" />Telefon puudub</span>}
        </div>
      </div>
      <div className="store-order__total"><span>Kokku</span><strong>{refunded ? <s>{euro(order.total)}</s> : euro(order.total)}</strong></div>
    </div>
    <ul className="store-order__items">{order.items.map((item) => <li key={item.cartKey}>
      <div className="store-order__image">{renderThumbnail(item)}<span aria-label={`Kogus: ${item.quantity}`}>{item.quantity}</span></div>
      <div><strong>{item.name}</strong>{Object.keys(item.selectedOptions).length > 0 && <small>{Object.values(item.selectedOptions).join(' · ')}</small>}</div>
      <strong>{euro(getProductPrice(item) * item.quantity)}</strong>
    </li>)}</ul>
    {order.delivery && <div className="store-order__delivery">
      <span className="store-order__delivery-icon"><OrderIcon name={/ise|järele/i.test(deliveryMethod) ? 'pin' : 'package'} /></span>
      <div><strong>{deliveryMethod}</strong>{destination.length > 0 && <span>{destination.join(' · ')}</span>}</div>
      {deliveryPrice > 0 && <span className="store-order__delivery-price">{euro(deliveryPrice)}</span>}
    </div>}
    {needsHelp && <p className="store-order__notice is-warning" role="status"><OrderIcon name="alert" /><span>{order.paymentIssue === 'funds_required'
      ? (refunded ? 'Raha on ostjale tagastatud. Stripe’i kontol ei jätku ülekande tagasipööramiseks raha. Võta ühendust Poeruumi toega.' : 'Tagastus ootab raha lisamist Stripe’i kontole. Võta ühendust Poeruumi toega.')
      : order.paymentIssue === 'partial_refund' ? 'Osaline tagastus. Arvestuse kontrollimiseks võta ühendust Poeruumi toega.'
        : order.paymentIssue === 'dispute' ? 'Makse on vaidlustatud. Kontrolli tähtaega Stripe’is ja võta ühendust Poeruumi toega.'
          : 'Makse arvestus vajab Poeruumi toe abi.'}</span></p>}
    {hasSettlement && <details className="store-order__finances">
      <summary><OrderIcon name="wallet" /><span>Stripe’i kontole</span><strong>{euro(order.stripeSellerNet!)}</strong><OrderIcon name="chevron" /></summary>
      <dl className="order-settlement">
        <div><dt>Tooted</dt><dd>{euro(order.productSubtotal)}</dd></div>
        <div><dt>Tarne</dt><dd>{euro(deliveryPrice)}</dd></div>
        <div className="order-settlement__subtotal"><dt>Tellimus kokku</dt><dd>{euro(order.total)}</dd></div>
        <div><dt>Stripe’i maksetasu</dt><dd>−{euro(order.stripeProcessingFee ?? 0)}</dd></div>
        <div><dt>Poeruumi teenustasu</dt><dd>−{euro(order.stripePlatformFee ?? 0)}</dd></div>
        {Boolean(order.stripePlatformFeeVat) && <div className="order-settlement__tax"><dt>sh neto {euro(order.stripePlatformFeeNet ?? 0)} + käibemaks {euro(order.stripePlatformFeeVat ?? 0)}</dt></div>}
        <div className="order-settlement__net"><dt>Stripe’i kontole</dt><dd>{euro(order.stripeSellerNet!)}</dd></div>
      </dl>
      <p>Panka laekub Stripe’i väljamaksegraafiku järgi.{sellerType === 'entrepreneur' && ' Ettevõtluskonto maksu peab pank kinni eraldi.'}</p>
    </details>}
    <footer className="store-order__actions">
      <div className="store-order__secondary">
        {storeId && order.hasInvoice && <OrderDocumentLinks lazy access={{ storeId, orderNumber: order.id }} refunded={refunded} />}
        {!refunded && !pending && !needsHelp && <button className="store-order__refund" type="button" disabled={busy} onClick={() => void changeStatus('refunded')}><OrderIcon name="return" />Tagasta makse</button>}
      </div>
      {refunded ? <span className="store-order__done"><OrderIcon name="return" />Makse tagastatud</span>
        : pending ? <span className="store-order__pending" role="status"><OrderIcon name="clock" />Tagastus on pooleli</span>
          : !needsHelp && order.status === 'new' ? <button className="store-order__fulfill" type="button" disabled={busy} onClick={() => void changeStatus('fulfilled')}><OrderIcon name="check" />{busy ? 'Uuendan…' : 'Märgi täidetuks'}</button>
            : !needsHelp && <span className="store-order__done"><OrderIcon name="check" />Täidetud</span>}
    </footer>
  </article>
}

export default function StoreOrders({ orders, storeId, sellerType, renderThumbnail, onChangeStatus, onClose }: {
  orders: StoreOrder[]; storeId?: string; sellerType: SellerType; renderThumbnail: (item: CartItem) => ReactNode
  onChangeStatus: (id: string, status: StoreOrder['status']) => Promise<void>; onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<OrderFilter>('all')
  const dialog = useRef<HTMLElement>(null)
  const query = search.trim().toLocaleLowerCase('et')
  const visible = [...orders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .filter((order) => matchesFilter(order, filter) && (!query || `${order.id} ${order.customerName} ${order.customerEmail} ${order.delivery} ${order.items.map((item) => item.name).join(' ')}`.toLocaleLowerCase('et').includes(query)))
  const newCount = orders.filter((order) => matchesFilter(order, 'new')).length

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.focus()
    return () => { previous?.focus({ preventScroll: true }) }
  }, [])

  return <div className="overlay login-overlay orders-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="login-sheet store-orders" role="dialog" aria-modal="true" aria-label="Tellimused" tabIndex={-1} ref={dialog} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose() }
      if (event.key !== 'Tab') return
      const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input, a[href], summary')].filter((element) => element.getClientRects().length > 0)
      const first = focusable[0], last = focusable.at(-1)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}>
      <header className="store-orders__header"><span className="store-orders__symbol"><OrderIcon name="bag" /></span><h2>Tellimused</h2>{newCount > 0 && <span className="store-orders__new">{newCount} {newCount === 1 ? 'uus' : 'uut'}</span>}<ModalCloseButton onClose={onClose} /></header>
      {orders.length > 1 && <div className="store-orders__toolbar">
        <div className="store-orders__filters" role="group" aria-label="Tellimuste olek">{filters.map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{filterLabels[value]}<span>{orders.filter((order) => matchesFilter(order, value)).length}</span></button>)}</div>
        <div className="store-orders__tools"><label className="store-orders__search"><OrderIcon name="search" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Otsi tellimust…" aria-label="Otsi tellimuse, kliendi või toote järgi" /></label>
        </div>
      </div>}
      <div className="store-orders__list">
        {visible.map((order) => <OrderCard key={order.id} order={order} storeId={storeId} sellerType={sellerType} renderThumbnail={renderThumbnail} onChangeStatus={onChangeStatus} />)}
        {!visible.length && <div className="store-orders__empty" role="status"><OrderIcon name={orders.length ? filter === 'new' && !query ? 'check' : 'search' : 'bag'} /><h3>{!orders.length ? 'Esimene tellimus on veel tulekul' : filter === 'new' && !query ? 'Kõik on tehtud' : 'Tellimusi ei leitud'}</h3>{(query || filter !== 'all') && <button type="button" onClick={() => { setSearch(''); setFilter('all') }}>Näita kõiki tellimusi</button>}</div>}
      </div>
    </section>
  </div>
}
