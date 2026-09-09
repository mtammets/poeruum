import { stripeRequirementIssueCopies, type StripeRequirementSummary } from './lib/stripeRequirements'

export default function StripeAddressGuide({
  requirements,
  onManage,
}: {
  requirements?: StripeRequirementSummary | null
  onManage?: () => void
}) {
  const issues = stripeRequirementIssueCopies(requirements)
  if (!issues.length && !onManage) return null

  return <aside className="stripe-embedded__address-guide" aria-label="Andmete kontrolli teated">
    {issues.length > 0 && <div className="stripe-embedded__verification-issues" role="status">
      <ul>{issues.map((issue, index) => <li key={`${issue.title}-${index}`}>
        <b>{issue.title}</b><p>{issue.detail}</p>
      </li>)}</ul>
    </div>}
    {onManage && <button className="stripe-embedded__address-action" type="button" onClick={onManage}>Muuda andmeid <span aria-hidden="true">→</span></button>}
  </aside>
}
