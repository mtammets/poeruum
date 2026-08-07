import { useEffect, useRef, useState } from 'react'
import {
  createCheckoutRequestId,
  FIXED_PLAN_MONTHLY_FEE,
  FIXED_PLAN_MONTHLY_TOTAL,
  FIXED_PLAN_MONTHLY_VAT,
  FIXED_PLAN_TRIAL_DAYS,
  formatPricingEuro,
} from './storefrontConfig'
import ModalCloseButton from './ModalCloseButton'

export default function BillingPlanDialog({ onClose, onConfirm, confirmLabel = 'Jätka Stripe’is' }: { onClose: () => void; onConfirm: (checkoutRequestId: string) => Promise<void>; confirmLabel?: string }) {
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
  const firstPaymentAt = new Date()
  firstPaymentAt.setDate(firstPaymentAt.getDate() + FIXED_PLAN_TRIAL_DAYS)
  const firstPaymentLabel = firstPaymentAt.toLocaleDateString('et-EE', { day: '2-digit', month: '2-digit', year: 'numeric' })

  const confirm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isConfirming) return
    setIsConfirming(true)
    setConfirmError('')
    try {
      await onConfirm(checkoutRequestIdRef.current)
    } catch (error) {
      setConfirmError(error instanceof Error ? error.message : 'Stripe’i arvelduse avamine ebaõnnestus.')
      setIsConfirming(false)
    }
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
    if (!window.matchMedia('(max-width: 599px)').matches || event.pointerType === 'touch') return
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
    <section className={`login-sheet billing-plan-dialog${isBillingDragging ? ' is-dragging' : ''}${hasBillingDragged ? ' has-dragged' : ''}`} style={hasBillingDragged ? { transform: `translateY(${billingDragY}px)` } : undefined} role="dialog" aria-modal="true" aria-label="Poeruumi Kindla paketi aktiveerimine">
      <div ref={billingDragAreaRef} className="billing-plan-dialog__drag-area" aria-hidden="true" onPointerDown={startBillingDrag} onPointerMove={moveBillingDrag} onPointerUp={(event) => endBillingDrag(event)} onPointerCancel={(event) => endBillingDrag(event, true)}><span className="billing-plan-dialog__handle" /></div>
      <ModalCloseButton onClose={onClose} />
      <span className="login-sheet__eyebrow">KINDEL · 30 PÄEVA TASUTA</span>
      <div className="billing-plan-dialog__title">
        <span className="billing-plan-dialog__visual" aria-hidden="true"><svg viewBox="0 0 64 48">
          <rect className="billing-plan-dialog__visual-card" x="2" y="5" width="60" height="38" rx="9" />
          <path className="billing-plan-dialog__visual-stripe" d="M3 15h58" />
          <rect className="billing-plan-dialog__visual-chip" x="11" y="21" width="14" height="10" rx="2" />
          <path className="billing-plan-dialog__visual-chip-line" d="M18 21v10M11 26h14" />
          <g className="billing-plan-dialog__visual-contactless"><path d="M43 23c3 2 3 6 0 8" /><path d="M47 20c6 4 6 11 0 15" /><path d="M51 17c9 6 9 15 0 21" /></g>
        </svg></span>
        <h2>Aktiveeri Kindel pakett</h2>
      </div>
      <div className="billing-plan-dialog__summary">
        <div className="billing-plan-dialog__today"><span>Täna tasuda</span><strong>0 €</strong></div>
        <div className="billing-plan-dialog__next-payment">
          <i aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="14" rx="3" /><path d="M8 4v4M16 4v4M4 10h16" /></svg></i>
          <span><small>Järgmine makse</small><strong>{firstPaymentLabel}</strong></span>
          <b>{formatPricingEuro(FIXED_PLAN_MONTHLY_TOTAL)} / kuu<small>{formatPricingEuro(FIXED_PLAN_MONTHLY_FEE)} + {formatPricingEuro(FIXED_PLAN_MONTHLY_VAT)} km</small></b>
        </div>
      </div>
      <form onSubmit={confirm}>
        <label className="billing-plan-dialog__consent"><input required type="checkbox" defaultChecked /><span>Nõustun pärast prooviperioodi {formatPricingEuro(FIXED_PLAN_MONTHLY_TOTAL)} kuutasuga (sisaldab 24% käibemaksu).</span></label>
        {confirmError && <p className="add-product-error" role="alert">{confirmError}</p>}
        <button type="submit" disabled={isConfirming}>{isConfirming ? 'Kinnitan…' : confirmLabel}<span aria-hidden="true">{isConfirming ? '◌' : '→'}</span></button>
      </form>
      <small className="billing-plan-dialog__note"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" /></svg><span>Kaardiandmed sisestad turvaliselt Stripe’is</span></small>
    </section>
  </div>
}
