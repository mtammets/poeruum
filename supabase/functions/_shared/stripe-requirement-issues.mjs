const MAX_ISSUES = 10
const SAFE_CODE = /^[a-z0-9_]{1,120}$/
const SAFE_REQUIREMENT = /^[a-z0-9_.]{1,200}$/

const copy = (title, detail) => ({ title, detail })

const CODE_COPY = Object.freeze({
  verification_document_address_mismatch: copy(
    'Dokumendil olev aadress ei ühti ettevõtte aadressiga',
    'Kontrolli, et Stripe’i kontol ja üles laaditud kehtival dokumendil oleks täpselt sama ettevõtte aadress.',
  ),
  verification_document_address_missing: copy(
    'Dokumendilt puudub kontrollitav aadress',
    'Laadi üles kehtiv dokument, millel on selgelt näha ettevõtte täielik aadress.',
  ),
  verification_document_name_mismatch: copy(
    'Dokumendil olev nimi ei ühti sisestatud nimega',
    'Kontrolli, et Stripe’i vormis ja üles laaditud dokumendil oleks sama ettevõtte või isiku ametlik nimi.',
  ),
  verification_document_name_missing: copy(
    'Dokumendilt puudub kontrollitav nimi',
    'Laadi üles kehtiv dokument, millel on ettevõtte või isiku ametlik nimi selgelt näha.',
  ),
  verification_document_dob_mismatch: copy(
    'Sünnikuupäev ei ühti dokumendil oleva kuupäevaga',
    'Paranda Stripe’i vormis sünnikuupäev või laadi üles õigete andmetega dokument.',
  ),
  verification_document_id_number_mismatch: copy(
    'Isiku- või registrikood ei ühti dokumendiga',
    'Kontrolli sisestatud numbrit ja laadi vajadusel üles õigete andmetega dokument.',
  ),
  verification_document_id_number_missing: copy(
    'Dokumendilt puudub kontrollitav isiku- või registrikood',
    'Laadi üles kehtiv dokument, millel on vajalik number selgelt näha.',
  ),
  verification_document_expired: copy(
    'Üles laaditud dokument on aegunud',
    'Laadi Stripe’i vormis üles kehtiv dokument.',
  ),
  verification_document_missing_front: copy(
    'Dokumendi esikülg on puudu',
    'Laadi Stripe’i vormis üles dokumendi selgelt loetav esikülg.',
  ),
  verification_document_missing_back: copy(
    'Dokumendi tagakülg on puudu',
    'Laadi Stripe’i vormis üles dokumendi selgelt loetav tagakülg.',
  ),
  verification_document_not_uploaded: copy(
    'Kontrollimiseks vajalik dokument on puudu',
    'Laadi Stripe’i vormis üles küsitud kehtiv dokument.',
  ),
  verification_document_too_large: copy(
    'Üles laaditud dokumendifail on liiga suur',
    'Laadi dokument uuesti üles Stripe’i vormis lubatud suurusega failina.',
  ),
  verification_document_type_not_supported: copy(
    'Stripe ei toeta üles laaditud dokumendiliiki',
    'Vali Stripe’i vormis mõni lubatud dokument ja laadi see uuesti üles.',
  ),
  verification_document_country_not_supported: copy(
    'Dokumendi väljastanud riiki ei toetata',
    'Ava Stripe’i vorm ja vali kontrollimiseks mõni seal lubatud dokument.',
  ),
  verification_document_not_signed: copy(
    'Üles laaditud dokument ei ole allkirjastatud',
    'Laadi üles kehtiv allkirjastatud dokument.',
  ),
  verification_document_photo_mismatch: copy(
    'Dokumendi foto ei vasta kontrollitava isiku andmetele',
    'Kontrolli isiku andmeid ja laadi üles õige isiku kehtiv dokument.',
  ),
  invalid_tax_id: copy(
    'Sisestatud maksu- või registrinumber ei ole kehtiv',
    'Kontrolli numbrit Stripe’i vormis ja sisesta ettevõtte ametlik number.',
  ),
  invalid_tax_id_format: copy(
    'Maksu- või registrinumber on vales vormingus',
    'Kontrolli numbrit Stripe’i vormis ja sisesta see nõutud vormingus.',
  ),
  invalid_street_address: copy(
    'Sisestatud aadressi ei õnnestunud kinnitada',
    'Kontrolli Stripe’i vormis tänavat, maja numbrit, linna ja postiindeksit.',
  ),
  invalid_address_city_state_postal_code: copy(
    'Linn, maakond või postiindeks ei vasta aadressile',
    'Kontrolli Stripe’i vormis ettevõtte täielikku aadressi.',
  ),
  invalid_url_format: copy(
    'Veebilehe aadress on vales vormingus',
    'Sisesta Stripe’i vormis töötav täielik veebiaadress.',
  ),
  invalid_url_website_inaccessible: copy(
    'Stripe ei saanud ettevõtte veebilehte avada',
    'Kontrolli, et veebileht oleks avalikult ligipääsetav, ja esita aadress uuesti.',
  ),
  unsupported_business_type: copy(
    'Valitud ettevõtte liik ei ole toetatud',
    'Ava Stripe’i vorm ja kontrolli ettevõtte liiki ning registreerimisandmeid.',
  ),
  invalid_tos_acceptance: copy(
    'Stripe’i tingimustega nõustumine vajab uuendamist',
    'Ava Stripe’i vorm ja kinnita tingimused konto volitatud esindajana.',
  ),
  verification_missing_directors: copy(
    'Ettevõtte juhtide andmed on puudu',
    'Lisa Stripe’i vormis ettevõtte registrijärgsed juhid ja nende küsitud andmed.',
  ),
  verification_missing_owners: copy(
    'Ettevõtte omanike andmed on puudu',
    'Lisa Stripe’i vormis ettevõtte tegelikud kasusaajad ja nende küsitud andmed.',
  ),
  verification_missing_executives: copy(
    'Ettevõtte juhtkonna andmed on puudu',
    'Lisa Stripe’i vormis küsitud juhtkonna liikmete andmed.',
  ),
  verification_failed_keyed_identity: copy(
    'Esitatud isikuandmeid ei saanud kinnitada',
    'Kontrolli Stripe’i vormis isiku ametlikku nime ja sünnikuupäeva ning esita küsitud dokument uuesti.',
  ),
  verification_failed_tax_id_match: copy(
    'Ettevõtte maksu- või registrinumbrit ei saanud kinnitada',
    'Kontrolli Stripe’i vormis numbrit ja ettevõtte ametlikku nime.',
  ),
})

const unreadableDocumentCodes = new Set([
  'verification_document_corrupt',
  'verification_document_failed_copy',
  'verification_document_failed_greyscale',
  'verification_document_incomplete',
  'verification_document_invalid',
  'verification_document_not_readable',
])

const alteredDocumentCodes = new Set([
  'verification_document_fraudulent',
  'verification_document_manipulated',
])

const requirementLabel = (requirement) => {
  if (/company\.verification\.document/.test(requirement)) return 'Ettevõtte tõendusdokument'
  if (/verification\.document/.test(requirement)) return 'Isikut tõendav dokument'
  if (/external_account|bank_account/.test(requirement)) return 'Pangakonto andmed'
  if (/tax_id|registration_number/.test(requirement)) return 'Ettevõtte registreerimisnumber'
  if (/address/.test(requirement)) return 'Ettevõtte aadress'
  if (/business_profile\.(url|website)/.test(requirement)) return 'Ettevõtte veebileht'
  if (/business_profile/.test(requirement)) return 'Ettevõtte tegevusandmed'
  if (/representative/.test(requirement)) return 'Ettevõtte esindaja andmed'
  if (/owners?/.test(requirement)) return 'Ettevõtte omanike andmed'
  if (/directors?/.test(requirement)) return 'Ettevõtte juhtide andmed'
  if (/executives?/.test(requirement)) return 'Ettevõtte juhtkonna andmed'
  if (/tos_acceptance/.test(requirement)) return 'Stripe’i tingimustega nõustumine'
  return 'Stripe’i nõutud andmed'
}

export const normalizeStripeRequirementIssues = (value) => {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const normalized = []

  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue
    const code = typeof candidate.code === 'string' ? candidate.code.trim().toLowerCase() : ''
    const requirement = typeof candidate.requirement === 'string' ? candidate.requirement.trim().toLowerCase() : ''
    if (!SAFE_CODE.test(code) || (requirement && !SAFE_REQUIREMENT.test(requirement))) continue
    const key = `${code}|${requirement}`
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push({ code, requirement: requirement || null })
    if (normalized.length >= MAX_ISSUES) break
  }

  return normalized
}

export const getStripeRequirementIssueCopy = (issue) => {
  const [normalized] = normalizeStripeRequirementIssues([issue])
  if (!normalized) return null

  const known = CODE_COPY[normalized.code]
  if (known) return known
  if (unreadableDocumentCodes.has(normalized.code)) {
    return copy(
      'Üles laaditud dokumenti ei saanud lugeda',
      'Laadi üles uus terav ja täielik värvifoto või fail, mille kõik servad ja andmed on selgelt näha.',
    )
  }
  if (alteredDocumentCodes.has(normalized.code)) {
    return copy(
      'Stripe ei saanud üles laaditud dokumenti kinnitada',
      'Laadi üles muutmata originaaldokument või selle selge foto.',
    )
  }
  if (normalized.code.startsWith('invalid_url_')) {
    return copy(
      'Ettevõtte veebilehe andmed vajavad parandamist',
      'Ava Stripe’i vorm, kontrolli veebiaadressi ja järgi seal näidatud juhiseid.',
    )
  }
  if (normalized.code.startsWith('verification_document_')) {
    return copy(
      'Üles laaditud dokument vajab parandamist',
      'Ava Stripe’i vorm ja järgi dokumendi juures näidatud juhiseid.',
    )
  }
  if (normalized.code.startsWith('verification_')) {
    return copy(
      'Stripe ei saanud esitatud andmeid kinnitada',
      'Ava Stripe’i vorm, kontrolli esitatud andmeid ja järgi seal näidatud juhiseid.',
    )
  }

  const label = requirementLabel(normalized.requirement ?? '')
  return copy(
    `${label} vajab parandamist`,
    'Ava Stripe’i vorm, kontrolli märgitud välja ja esita parandatud andmed.',
  )
}

export const getStripeRequirementIssueCopies = (issues) => {
  const seen = new Set()
  const copies = []
  for (const issue of normalizeStripeRequirementIssues(issues)) {
    const message = getStripeRequirementIssueCopy(issue)
    if (!message) continue
    const key = `${message.title}|${message.detail}`
    if (seen.has(key)) continue
    seen.add(key)
    copies.push(message)
  }
  return copies
}
