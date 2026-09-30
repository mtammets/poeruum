import type { ReactNode } from 'react'
import type { SellerType } from '../shared/seller'
import './sellerDetails.css'

export type SellerDetailsValue = {
  sellerType: SellerType
  sellerFirstName: string
  sellerLastName: string
  entrepreneurPayoutConfirmed: boolean
  businessName: string
  registryCode: string
  businessAddress: string
  contactEmail: string
  vatRegistered: boolean
  vatNumber: string
}

export default function SellerDetailsFields({ value, onChange, typeLocked = false, registryStatus }: {
  value: SellerDetailsValue
  onChange: (patch: Partial<SellerDetailsValue>) => void
  typeLocked?: boolean
  registryStatus?: ReactNode
}) {
  const individual = value.sellerType === 'entrepreneur'
  return <div className="seller-details">
    <fieldset className="seller-type" disabled={typeLocked}>
      <legend>Müüja</legend>
      {([['company', 'Ettevõte'], ['entrepreneur', 'Ettevõtluskontoga eraisik']] as const).map(([type, label]) => <label key={type} className={`seller-type__option${value.sellerType === type ? ' is-selected' : ''}`}>
        <input type="radio" name="seller-type" value={type} checked={value.sellerType === type} onChange={() => onChange({ sellerType: type, ...(type === 'entrepreneur' ? { vatRegistered: false, vatNumber: '' } : {}) })} />
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{type === 'company'
          ? <><path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17M3 21h18M9 21v-5h6v5" /><path d="M8 7h2m4 0h2M8 11h2m4 0h2" /></>
          : <><circle cx="12" cy="7.5" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></>}</svg>
        <span>{label}</span><i aria-hidden="true">{value.sellerType === type ? '✓' : ''}</i>
      </label>)}
    </fieldset>
    {typeLocked && <small className="seller-details__hint">Müüja nime või registrikoodi muutmisel kontrollib Poeruum andmete vastavust Stripe’i kontoga uuesti. Poe nime saad muuta eraldi.</small>}
    {individual ? <div className="seller-details__names">
      <label>Eesnimi<input required autoComplete="given-name" maxLength={100} value={value.sellerFirstName} onChange={(event) => onChange({ sellerFirstName: event.target.value })} /></label>
      <label>Perekonnanimi<input required autoComplete="family-name" maxLength={100} value={value.sellerLastName} onChange={(event) => onChange({ sellerLastName: event.target.value })} /></label>
    </div> : <>
      <label>Registrikood<input required inputMode="numeric" pattern="[0-9]{8}" maxLength={8} value={value.registryCode} onChange={(event) => onChange({ registryCode: event.target.value.replace(/\D/g, '').slice(0, 8) })} /></label>
      {registryStatus}
      <label>Ettevõtte nimi<input required autoComplete="organization" maxLength={200} value={value.businessName} onChange={(event) => onChange({ businessName: event.target.value })} /></label>
    </>}
    <label>{individual ? 'Aadress' : 'Registrijärgne aadress'}<input required autoComplete="street-address" maxLength={400} value={value.businessAddress} onChange={(event) => onChange({ businessAddress: event.target.value })} /></label>
    {individual && <small className="seller-details__hint">Aadress kuvatakse ostjale müüja andmetes.</small>}
    <label>Kontakt-e-post<input required type="email" autoComplete="email" maxLength={254} value={value.contactEmail} onChange={(event) => onChange({ contactEmail: event.target.value })} /></label>
    {individual && <label className="seller-details__check"><input type="checkbox" required checked={value.entrepreneurPayoutConfirmed} onChange={(event) => onChange({ entrepreneurPayoutConfirmed: event.target.checked })} /><span>Kinnitan, et kasutan enda aktiivset LHV ettevõtluskontot ja suunan Stripe’i väljamaksed sellele kontole.</span></label>}
    {!individual && <>
      <label className="seller-details__check"><input type="checkbox" checked={value.vatRegistered} onChange={(event) => onChange({ vatRegistered: event.target.checked, ...(!event.target.checked ? { vatNumber: '' } : {}) })} /><span>Olen käibemaksukohustuslane</span></label>
      {value.vatRegistered && <label>KMKR number<input required pattern="EE[0-9]{9}" maxLength={11} value={value.vatNumber} onChange={(event) => onChange({ vatNumber: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11) })} /></label>}
    </>}
  </div>
}
