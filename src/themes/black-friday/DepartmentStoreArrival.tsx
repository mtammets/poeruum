import { useId } from 'react'
import { publicAssetUrl } from '../../lib/publicAssetUrl'
import { gameCapImage } from './hatFlightPhysics'
import type { DeliveryPhase } from './hatDelivery'
import { Brand } from '../../Brand'
import './departmentStoreArrival.css'

export const destinationImage = publicAssetUrl('/images/campaigns/poeruum-flight-destination-v2.webp')

export function StoreBag() {
  return <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
    <path d="M10 16.5h20l-1.7 15H11.7L10 16.5Z M14.8 18v-3.2C14.8 11.3 16.9 9 20 9s5.2 2.3 5.2 5.8V18 M15.5 22.2h9" />
  </svg>
}

export default function DepartmentStoreArrival() {
  const id = useId()
  return <>
    <div className="hat-delivery__ground"><img className="hat-delivery__ground-image" src={publicAssetUrl('/images/campaigns/poeruum-flight-clearing-v1.webp')} alt="" draggable={false} decoding="async" /></div>
    <div className="hat-delivery__destination">
      <img className="hat-delivery__photograph" src={destinationImage} alt="" draggable={false} decoding="async" />
    </div>
    <span className="hat-delivery__shadow" />
    {/* The front wall covers the bird as it continues left through the open right side. */}
    <svg className="hat-delivery__facade" viewBox="0 0 1774 887" aria-hidden="true">
      <defs><clipPath id={id}><path d="M0 0H1774V375L1360 375V887H0Z" /></clipPath></defs>
      <image href={destinationImage} width="1774" height="887" clipPath={`url(#${id})`} />
    </svg>
    <div className="hat-delivery__branding"><div className="hat-delivery__sign"><Brand /><span className="hat-delivery__edition">Kaubamaja</span></div></div>
  </>
}

export function DeliveryCounter({ total, phase }: { total: number; phase: DeliveryPhase }) {
  return <div className="hat-delivery__counter" data-delivered={phase === 'delivered' || undefined}>
    <div className="hat-delivery__counter-symbols" aria-hidden="true">
      <img src={gameCapImage} alt="" />
    </div>
    <output className="hat-delivery__total" aria-label={`Kogutud mütse: ${total}`} aria-live="polite" aria-atomic="true">
      <span key={total}>{total}</span>
      <svg className="hat-delivery__check" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m6 17 6 6L27 8" /></svg>
    </output>
    <div className="hat-delivery__route" aria-hidden="true"><i /><StoreBag /></div>
  </div>
}
