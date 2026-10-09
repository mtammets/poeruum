import { getStripeRequirementIssueCopies } from '../supabase/functions/_shared/stripe-requirement-issues.mjs'
type StripeRequirementIssue = { code: string; requirement: string | null }

export type PaymentDiagnostics = {
  version: 1
  userId: string
  storeId: string
  source: 'saved' | 'stripe'
  checkedAt: string | null
  connected: boolean
  mode: 'live' | 'test' | null
  chargesEnabled: boolean | null
  payoutsEnabled: boolean | null
  transfersStatus?: 'active' | 'inactive' | 'pending' | 'unrequested' | null
  detailsSubmitted: boolean | null
  identityError: string | null
  setupError: string | null
  disabledReason: string | null
  pendingVerification: boolean
  dueCount: number
  dueFields: string[] | null
  pendingFields: string[] | null
  futureFields: string[] | null
  deadline: string | null
  issues: StripeRequirementIssue[]
  dashboardUrl: string | null
}

export const safeRequirementFields = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((item): item is string => typeof item === 'string' && /^[a-zA-Z0-9_.]{1,200}$/.test(item)).map((item) => item.toLowerCase()))].sort().slice(0, 200)
  : []

export function requirementGroups(fields: string[] | null | undefined) {
  const groups = new Map<string, Set<string>>()
  const people = new Map<string, number>()
  for (const field of safeRequirementFields(fields)) {
    const [prefix] = field.split('.')
    let group = 'Muud andmed'
    if (prefix.startsWith('person_')) {
      if (!people.has(prefix)) people.set(prefix, people.size + 1)
      group = `Isik ${people.get(prefix)}`
    } else if (prefix === 'company') group = 'Ettevõte'
    else if (prefix === 'individual' || prefix === 'representative') group = prefix === 'individual' ? 'Isikuandmed' : 'Esindaja'
    else if (/^owners?$/.test(prefix)) group = 'Omanikud'
    else if (/^directors?$/.test(prefix)) group = 'Juhatuse liikmed'
    else if (/^executives?$/.test(prefix)) group = 'Juhtkond'
    else if (prefix === 'business_profile') group = 'Tegevusandmed'
    else if (/external_account|bank_account/.test(field)) group = 'Pangakonto'
    else if (prefix === 'tos_acceptance') group = 'Tingimused'
    let label = field
    if (/owners_provided/.test(field)) { group = 'Omanikud'; label = 'omanike kinnitus' }
    else if (/directors_provided/.test(field)) { group = 'Juhatuse liikmed'; label = 'juhatuse liikmete kinnitus' }
    else if (/executives_provided/.test(field)) { group = 'Juhtkond'; label = 'juhtkonna kinnitus' }
    else if (/additional_document/.test(field)) label = 'lisadokument'
    else if (/verification\.document/.test(field)) label = field.endsWith('.back') ? 'dokumendi tagakülg' : field.endsWith('.front') ? 'dokumendi esikülg' : 'tõendusdokument'
    else if (/address/.test(field)) label = 'aadress'
    else if (/\.dob\./.test(field)) label = 'sünnikuupäev'
    else if (/tax_id|registration_number/.test(field)) label = 'registri- või maksunumber'
    else if (/external_account|bank_account/.test(field)) label = 'väljamaksete pangakonto'
    else if (prefix === 'tos_acceptance') label = 'Stripe’i tingimustega nõustumine'
    else if (/\.(first_name|last_name|name)$/.test(field)) label = 'nimi'
    else if (/\.email$/.test(field)) label = 'e-post'
    else if (/\.phone$/.test(field)) label = 'telefon'
    else if (/\.relationship\.title$/.test(field)) label = 'amet'
    else if (/\.mcc$/.test(field)) label = 'tegevusala'
    else if (/\.(url|website)$/.test(field)) label = 'veebileht'
    else if (/\.product_description$/.test(field)) label = 'tegevuse kirjeldus'
    else if (/\.id_number$/.test(field)) label = 'isikukood'
    else if (field === 'business_type' || field === 'company.structure') label = 'ettevõtlusvorm'
    if (!groups.has(group)) groups.set(group, new Set())
    groups.get(group)!.add(label)
  }
  return [...groups].map(([title, labels]) => ({ title, fields: [...labels] }))
}

export type PaymentExplanation = { title: string; detail: string; tone: 'good' | 'warning' | 'neutral' | 'muted'; icon: 'check' | 'alert' | 'clock' | 'help' | 'minus' | 'flask' }
const explanation = (title: string, detail: string, tone: PaymentExplanation['tone'] = 'warning', icon: PaymentExplanation['icon'] = 'alert'): PaymentExplanation => ({ title, detail, tone, icon })

export function paymentExplanation(diagnostic?: PaymentDiagnostics | null, fallback?: { state?: string; issues?: unknown }): PaymentExplanation {
  const issues = getStripeRequirementIssueCopies(diagnostic?.issues ?? fallback?.issues)
  if (!diagnostic) {
    if (issues.length) return explanation(issues[0].title, issues[0].detail)
    if (fallback?.state === 'active') return explanation('Aktiivne', '', 'good', 'check')
    if (fallback?.state === 'not_connected') return explanation('Stripe ühendamata', 'Kaupmehel tuleb maksete seadetes Stripe ühendada.', 'muted', 'minus')
    if (fallback?.state === 'test') return explanation('Testrežiim', 'Pärismaksete jaoks tuleb ühendada Stripe’i päriskonto.', 'neutral', 'flask')
    if (fallback?.state === 'pending') return explanation('Seadistus pooleli', 'Ava üksikasjad, et kontrollida Stripe’i nõutud andmeid.', 'neutral', 'clock')
    return explanation('Põhjus kontrollimata', 'Ava üksikasjad, et laadida maksete täpne seis.', 'muted', 'help')
  }
  const d = diagnostic
  if (!d.connected) return explanation('Stripe ühendamata', 'Kaupmehel tuleb maksete seadetes Stripe ühendada.', 'muted', 'minus')
  if (d.mode === 'test') return explanation('Testrežiim', 'Pärismaksete jaoks tuleb ühendada Stripe’i päriskonto.', 'neutral', 'flask')
  if (d.disabledReason?.startsWith('rejected.')) return explanation('Stripe’i konto tagasi lükatud', 'Põhjuse ja edasiste võimaluste kontrollimiseks ava konto Stripe’is.')
  if (issues.length) return explanation(issues[0].title, issues[0].detail)
  if (d.dueCount > 0) {
    const groups = requirementGroups(d.dueFields)
    const title = groups.length === 1 && groups[0].title === 'Pangakonto' ? 'Pangakonto puudu'
      : groups.length === 1 && groups[0].title === 'Tingimused' ? 'Tingimused kinnitamata'
      : d.detailsSubmitted === true ? 'Andmed vajavad täiendamist' : 'Stripe’i seadistus pooleli'
    return explanation(title, 'Kaupmehel tuleb Stripe’i vormis allolevad andmed täiendada.')
  }
  if (d.identityError || d.setupError) {
    const message = d.identityError || d.setupError || ''
    const title = message.includes('omaniku nimi peab ühtima') ? 'Müüja nimi ei ühti'
      : message.includes('registrikood peab ühtima') ? 'Registrikood ei ühti'
      : message.includes('omaniku andmeid') ? 'Konto omaniku andmed puudu'
      : message.includes('Eestis registreeritud') ? 'Stripe’i konto riik ei sobi'
      : message.includes('ettevõtluskonto kasutamine') ? 'Ettevõtluskonto kinnitamata'
      : message.includes('EUR-väljamaksekontoks') ? 'Väljamaksekonto ei sobi' : 'Müüja andmed vajavad parandamist'
    return explanation(title, message)
  }
  if (d.pendingVerification || ['requirements.pending_verification', 'under_review'].includes(d.disabledReason || '')) return explanation('Stripe kontrollib andmeid', 'Esitatud andmed on Stripe’is kontrollimisel.', 'neutral', 'clock')
  if (d.disabledReason === 'requirements.past_due') return explanation('Stripe’i nõuded täitmata', 'Stripe ei tagastanud puuduvate väljade loendit. Ava konto Stripe’is.')
  if (d.disabledReason === 'listed') return explanation('Stripe on konto piiranud', 'Konto piirangu täpsustamiseks ava konto Stripe’is.')
  if (d.disabledReason === 'platform_paused') return explanation('Konto on peatatud', 'Kontrolli konto peatamise põhjust Stripe’is.')
  if (d.disabledReason) return explanation('Stripe’i piirang', `Stripe’i põhjus: ${d.disabledReason}. Täpsem info on Stripe’i kontol.`)
  if (d.detailsSubmitted === false) return explanation('Stripe’i seadistus pooleli', 'Kaupmehel tuleb Stripe’i konto andmete esitamine lõpetada.')
  if (d.transfersStatus && d.transfersStatus !== 'active') return d.transfersStatus === 'pending'
    ? explanation('Ülekanded ootel', 'Stripe’i ülekannete aktiveerimine on ootel. Kontrolli konto nõudeid Stripe’is.', 'neutral', 'clock')
    : explanation('Ülekanded aktiveerimata', 'Stripe’i ülekannete võimalus pole aktiveeritud. Kontrolli konto nõudeid Stripe’is.')
  if (d.chargesEnabled === true && d.payoutsEnabled === true && d.mode === 'live') {
    if (d.source === 'saved' && fallback?.state !== 'active') return explanation('Valmisolek kontrollimata', 'Ava üksikasjad, et kontrollida maksete valmisolekut.', 'muted', 'help')
    return explanation('Aktiivne', '', 'good', 'check')
  }
  if (d.chargesEnabled === false || d.payoutsEnabled === false) return explanation('Põhjus täpsustamata', 'Stripe pole maksete piirangu täpset põhjust tagastanud. Ava konto Stripe’is.')
  return explanation('Seis kontrollimata', 'Stripe’i maksete seisu ei ole veel kontrollitud.', 'muted', 'help')
}
