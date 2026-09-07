import { stripeRequirementIssueCopies, type StripeRequirementSummary } from './lib/stripeRequirements'

export default function StripeAddressGuide({
  businessAddress,
  requirements,
  onManage,
}: {
  businessAddress?: string
  requirements?: StripeRequirementSummary | null
  onManage?: () => void
}) {
  const issues = stripeRequirementIssueCopies(requirements)
  const addressTypes = <dl className="stripe-embedded__address-types">
    <div><dt>Registrijärgne aadress</dt><dd>Ettevõtte kehtiv aadress Äriregistris.</dd></div>
    <div><dt>Tegevuskoha aadress</dt><dd>Koht, kus ettevõte päriselt tegutseb, ka kodu.</dd></div>
    <div><dt>Esindaja või omaniku elukoht</dt><dd>Selle inimese tegelik kodune aadress.</dd></div>
  </dl>

  return <aside className="stripe-embedded__address-guide" aria-label="Aadresside sisestamise juhis">
    {issues.length > 0 && <div className="stripe-embedded__verification-issues" role="status">
      <ul>{issues.map((issue, index) => <li key={`${issue.title}-${index}`}>
        <b>{issue.title}</b><p>{issue.detail}</p>
      </li>)}</ul>
    </div>}
    {onManage && <button className="stripe-embedded__address-action" type="button" onClick={onManage}>Muuda andmeid <span aria-hidden="true">→</span></button>}
    <details>
      <summary>Abi aadressi ja dokumendiga</summary>
      <div className="stripe-embedded__address-help">
        {addressTypes}
        <p>Registrijärgne aadress võib tegevuskohast ja elukohast erineda. Kui tegutsed kodust, on kodu sinu tegevuskoht. Vali dokument, mis tõendab vormis küsitud aadressi.</p>
        {businessAddress?.trim() && <div className="stripe-embedded__address-reference">
          <span>Registrijärgne aadress Poeruumis</span>
          <strong>{businessAddress.trim()}</strong>
          <p>Kasuta seda registrijärgse aadressi väljal. Tegevuskoha väljale sobib see siis, kui ettevõte seal ka tegutseb.</p>
        </div>}
        <p>Kui õige aadressi tõendamiseks sobiv dokument puudub, küsi Stripe’i toelt, milline tõend sobib. Poeruumis aadressi muutmine ei uuenda Stripe’i kontot.</p>
        <dl className="stripe-embedded__address-fields">
          <div><dt>Tänav / Address line 1</dt><dd>Tänav ja maja number.</dd></div>
          <div><dt>Aadressi lisarida / Address line 2</dt><dd>Korter või muu aadressi täpsustus, kui see on olemas.</dd></div>
          <div><dt>Linn / City</dt><dd>Linn, alevik või küla.</dd></div>
          <div><dt>Maakond / State</dt><dd>Maakond, kui vorm seda küsib.</dd></div>
          <div><dt>Postiindeks / Postal code</dt><dd>Selle aadressi postiindeks.</dd></div>
          <div><dt>Riik / Country</dt><dd>Ettevõtte või selle inimese aadressi riik.</dd></div>
        </dl>
        <p>Võrdle dokumendiga ka maja- ja korterinumbrit ning postiindeksit. Kasuta Stripe’i vormis selle kontrolli jaoks lubatud dokumenti.</p>
        <a href="https://docs.stripe.com/acceptable-verification-documents?country=EE" target="_blank" rel="noreferrer">Stripe’i lubatud tõendusdokumendid Eestis ↗</a>
      </div>
    </details>
  </aside>
}
