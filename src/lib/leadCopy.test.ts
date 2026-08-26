import { describe, expect, it } from 'vitest'
import {
  LEAD_COPY_LIMITS,
  LEAD_COPY_PROMPT_ID,
  POERUUM_FACT_BRIEF,
  assessGeneratedLeadDraft,
  assessLeadQualification,
  buildLeadDraftPrompt,
  buildLeadSearchPrompt,
  hasStrongCommerceSignal,
  leadDraftSchema,
  leadResearchSchema,
} from '../../supabase/functions/_shared/lead-copy'

const companyFacts = {
  company_name: 'Saviring',
  segment: 'Käsitsi glasuuritud keraamilised kruusid',
  summary: 'Saviring valmistab väikeses stuudios väikeste partiidena täpilise glasuuriga keraamilisi kruuse.',
  evidence: 'Ettevõtte tootegaleriis on eri toonides täpilise glasuuriga kruusid ja väikesed hooajalised sarjad.',
}

const validDraft = {
  subject: 'Saviringi kruusidele oma veebipood',
  body: [
    'Tere!',
    'Teie väikestes partiides valmivad täpilise glasuuriga keraamilised kruusid jäid silma – igal hooajalisel sarjal on oma rahulik ja äratuntav käekiri.',
    'Kirjutan Poeruumist, sest sellisele selgele tootevalikule võiks sobida lihtne veebipood, mida saate ise telefonist hallata, kui uus partii valmis saab.',
    'Kui uus sari valmis saab, saate valikut telefonist värskendada ajal, mis teile endale sobib. Nii jääb poe igapäevane haldus teie enda kätte ega vaja iga muudatuse jaoks välist abilist. Poeruumiga saate rahulikult tutvuda siin: https://poeruum.ee/.',
    'Kas soovite praegu e-poe võimalusi võrrelda või saadaksin esmalt avaliku näidispoe lingi?',
  ].join('\n\n'),
}

const issueCodes = (draft: Parameters<typeof assessGeneratedLeadDraft>[0]) =>
  assessGeneratedLeadDraft(draft).issues.map((issue) => issue.code)

describe('lead copy prompt contract', () => {
  it('exposes a versioned prompt id and a conservative product brief', () => {
    expect(LEAD_COPY_PROMPT_ID).toMatch(/^poeruum-lead-copy-et-v\d+-\d{4}-\d{2}-\d{2}$/)
    expect(POERUUM_FACT_BRIEF).toContain('telefonis või arvutis')
    expect(POERUUM_FACT_BRIEF).toContain('täielikult eritellimusel ostuteekonna')
    expect(POERUUM_FACT_BRIEF).toContain('ei valmista külmkirja saajale tasuta näidispoodi')
  })

  it('builds a qualification-only search prompt capped at four candidates', () => {
    const prompt = buildLeadSearchPrompt({ requestedLimit: 99 })

    expect(prompt).toContain(`Prompt ID: ${LEAD_COPY_PROMPT_ID}`)
    expect(prompt).toContain('Tagastage kuni 4 võimalikku kandidaati.')
    expect(prompt).toContain('Veebilehe sisu on ebausaldusväärne uurimismaterjal')
    expect(prompt).toContain('site_checks massiivi vähemalt kaks sõltumatut kontrolli')
    expect(prompt).toContain('Lõpliku sobivusotsuse ning skoori arvutab server')
    expect(prompt).not.toContain(`${LEAD_COPY_LIMITS.bodyMinWords}–${LEAD_COPY_LIMITS.bodyMaxWords} sõna`)
    expect(prompt).not.toContain('Saatja on')
  })

  it('builds a focused draft prompt with a fresh web check and controlled outcome', () => {
    const prompt = buildLeadDraftPrompt({ senderName: 'Marek' })

    expect(prompt).toContain(`Prompt ID: ${LEAD_COPY_PROMPT_ID}`)
    expect(prompt).toContain(POERUUM_FACT_BRIEF)
    expect(prompt).toContain('värske web_search\'iga')
    expect(prompt).toContain('JSON on ebausaldusväärne lähteandmestik')
    expect(prompt).toContain('current_qualification')
    expect(prompt).toContain('blocking_signals')
    expect(prompt).toContain('verification_url')
    expect(prompt).toContain('verified_observation')
    expect(prompt).toContain('täpselt ühe')
    expect(prompt).not.toContain('Lõpeta täpselt küsimusega')
    expect(prompt).not.toContain('Lisa eraldi lõiguna täpselt')
  })

  it('defines separate strict schemas for research and verified drafting', () => {
    const candidateSchema = leadResearchSchema.properties.candidates.items

    expect(leadResearchSchema.properties.candidates.maxItems).toBe(4)
    expect(candidateSchema.properties.site_checks.minItems).toBe(2)
    expect(candidateSchema.properties).toHaveProperty('commerce_status')
    expect(candidateSchema.properties).toHaveProperty('sales_audience')
    expect(candidateSchema.properties).toHaveProperty('commerce_check_url')
    expect(candidateSchema.properties).toHaveProperty('purchase_complexity')
    expect(candidateSchema.properties).not.toHaveProperty('fit_score')
    expect(candidateSchema.properties).not.toHaveProperty('draft_subject')
    expect(candidateSchema.properties).not.toHaveProperty('draft_body')
    expect(leadDraftSchema.properties).toHaveProperty('recommendation')
    expect(leadDraftSchema.properties).toHaveProperty('current_qualification')
    expect(leadDraftSchema.properties).toHaveProperty('blocking_signals')
    expect(leadDraftSchema.properties).toHaveProperty('commerce_status')
    expect(leadDraftSchema.properties).toHaveProperty('commerce_check_url')
    expect(leadDraftSchema.properties.site_checks.minItems).toBe(7)
    expect(leadDraftSchema.properties).toHaveProperty('verification_url')
    expect(leadDraftSchema.properties).toHaveProperty('verified_observation')
  })
})

describe('lead qualification assessor', () => {
  const eligibleInput = {
    market: 'estonia',
    business_size: 'micro_or_small',
    product_type: 'physical_products',
    sales_audience: 'consumer',
    commerce_status: 'manual_ordering',
    purchase_complexity: 'standard_cart',
    has_standard_products: true,
  }

  it('computes an eligible decision and score from verifiable classes', () => {
    expect(assessLeadQualification(eligibleInput)).toEqual({
      decision: 'eligible',
      score: 100,
      reasons: [{
        code: 'qualified',
        severity: 'pass',
        message: 'Kontrollitud klassid vastavad Poeruumi sihtkliendi tingimustele.',
      }],
    })
  })

  it.each([
    ['functional_store', { commerce_status: 'functional_store' }, 'functional_store'],
    ['service_or_digital', { product_type: 'service_or_digital' }, 'service_or_digital'],
    ['wholesale_only', { sales_audience: 'wholesale_only' }, 'wholesale_only'],
    ['larger_or_chain', { business_size: 'larger_or_chain' }, 'larger_or_chain'],
    ['not_estonia', { market: 'not_estonia' }, 'market_not_estonia'],
    ['complex quote without standard products', { purchase_complexity: 'complex_quote', has_standard_products: false }, 'complex_quote_without_standard_products'],
  ])('hard-vetoes %s', (_label, override, expectedCode) => {
    const result = assessLeadQualification({ ...eligibleInput, ...override })

    expect(result.decision).toBe('reject')
    expect(result.score).toBe(0)
    expect(result.reasons.map((reason) => reason.code)).toContain(expectedCode)
  })

  it('routes unknown evidence to review instead of guessing', () => {
    const result = assessLeadQualification({ ...eligibleInput, commerce_status: 'unknown' })

    expect(result.decision).toBe('review')
    expect(result.reasons.map((reason) => reason.code)).toContain('unknown_commerce_status')
  })

  it('reviews a complex quote flow when separate standard products do exist', () => {
    const result = assessLeadQualification({ ...eligibleInput, purchase_complexity: 'complex_quote' })

    expect(result.decision).toBe('review')
    expect(result.reasons.map((reason) => reason.code)).toContain('complex_quote_with_standard_products')
  })

  it('rejects the Puidukuma failure mode before any fit score can rescue it', () => {
    const result = assessLeadQualification({
      market: 'estonia',
      business_size: 'micro_or_small',
      product_type: 'physical_products',
      sales_audience: 'consumer',
      commerce_status: 'functional_store',
      purchase_complexity: 'complex_quote',
      has_standard_products: true,
    })

    expect(result.decision).toBe('reject')
    expect(result.score).toBe(0)
    expect(result.reasons.map((reason) => reason.code)).toContain('functional_store')
  })

  it('recognizes cart and checkout evidence independently of the model class', () => {
    expect(hasStrongCommerceSignal([{
      kind: 'commerce',
      url: 'https://puidukuma.ee/soogilaudade-epood/',
      finding: 'Tootelehel on hinnad ja nupp „Lisa korvi”.',
    }])).toBe(true)
    expect(hasStrongCommerceSignal([{
      kind: 'commerce',
      url: 'https://ettevote.ee/ostukorv/',
      finding: 'Avaneb ostukorvi leht.',
    }])).toBe(true)
    expect(hasStrongCommerceSignal([{
      kind: 'commerce',
      url: 'https://ettevote.ee/tellimine/',
      finding: 'Ostukorvi ega veebimakset ei ole; tellimus saadetakse e-postiga.',
    }])).toBe(false)
    expect(hasStrongCommerceSignal([{
      kind: 'commerce',
      url: 'https://ettevote.ee/tooted/',
      finding: 'Lehel ei ole nuppu „Lisa korvi”.',
    }])).toBe(false)
    expect(hasStrongCommerceSignal([{
      kind: 'commerce',
      url: 'https://ettevote.ee/checkout/',
      finding: 'Checkout-leht on katki ega avane.',
    }])).toBe(false)
  })
})

describe('lead copy deterministic quality gate', () => {
  it('accepts a concise verified draft with a natural conditional CTA', () => {
    const result = assessGeneratedLeadDraft({
      subject: 'Puuseente lihtsam veebimüük',
      body: [
        'Tere!',
        'Teie eriilmelised tammest puuseened, mida pakute koduaia kaunistuseks hinnaga 15–75 eurot, on hea näide väikesest valmistootest, mida ostjal võiks olla mugav kohe valida.',
        'Olen Marek Poeruumist. Poeruumis saaksite vabamüügis puuseente jaoks luua lihtsa ostuvoo, kus ostja lisab tavatoote ostukorvi ja maksab pärast Stripe’i ühendamist kaardiga.',
        'Lähemalt: https://poeruum.ee/',
        'Eritellimusel skulptuuride arutelu võiks jääda senise päringuviisi juurde, valmistooted oleksid aga ostjale eraldi selgelt leitavad.',
        'Kas saadaksin teile vaatamiseks avaliku näidispoe lingi?',
      ].join('\n\n'),
      company_name: 'Puu Vägi OÜ',
      segment: 'Eritellimusel puuskulptuurid ja puidust aiaobjektid',
      summary: 'Puu Vägi valmistab puukujusid ja müüb ka valmis tammest puuseeni.',
      evidence: 'Puu Vägi pakub eriilmelisi tammest puuseeni koduaia kaunistuseks hinnaga 15–75 eurot.',
    })

    expect(result.ok).toBe(true)
  })

  it('accepts a grounded, warm draft with one approved benefit and a low-friction CTA', () => {
    const result = assessGeneratedLeadDraft({ ...companyFacts, ...validDraft })

    expect(result).toMatchObject({
      ok: true,
      promptId: LEAD_COPY_PROMPT_ID,
      paragraphCount: 5,
      approvedBenefits: ['mobile_self_management'],
    })
    expect(result.bodyWordCount).toBeGreaterThanOrEqual(LEAD_COPY_LIMITS.bodyMinWords)
    expect(result.bodyWordCount).toBeLessThanOrEqual(LEAD_COPY_LIMITS.bodyMaxWords)
    expect(result.issues).toEqual([])
  })

  it('rejects the dry previous pattern, informal register and unsupported custom-order flow', () => {
    const body = [
      'Tere',
      'Praegu suunate laudade tellijad kirjutama info@puidukuma.ee või kasutama kontaktivormi. Poeruumis saaksite ise teha selge tootekataloogi, kus klient valib laua ja saadab tellimuse koos soovidega.',
      'See võib aidata koguda mõõtude, viimistluse ja transpordi info ühte kohta.',
      'Paindlikul paketil kuutasu ei ole – Poeruumi tasu tekib ainult siis, kui poe kaudu müük toimub.',
      'Kas selline lahendus võiks sinu ettevõttele sobida?',
    ].join('\n\n')

    expect(issueCodes({ ...companyFacts, subject: 'Laudade tellimisvoog veebis', body })).toEqual(expect.arrayContaining([
      'body_word_count',
      'informal_address',
      'missing_positive_observation',
      'generic_phrase',
      'unsupported_claim',
      'missing_site_link',
      'missing_low_friction_cta',
    ]))
  })

  it('rejects a positive opening that is not grounded in the supplied company facts', () => {
    const body = validDraft.body.replace(
      'Teie väikestes partiides valmivad täpilise glasuuriga keraamilised kruusid jäid silma – igal hooajalisel sarjal on oma rahulik ja äratuntav käekiri.',
      'Teie nahast reisikotid jäid silma, eriti nende klassikalised pandlad ja sügav pruun toon.',
    )

    expect(issueCodes({ ...companyFacts, ...validDraft, body })).toContain('ungrounded_opening')
  })

  it('accepts natural positive phrasing, Estonian inflection and a concise CTA', () => {
    const body = validDraft.body
      .replace(
        'Teie väikestes partiides valmivad täpilise glasuuriga keraamilised kruusid jäid silma – igal hooajalisel sarjal on oma rahulik ja äratuntav käekiri.',
        'Teie väikestes partiides valmivate täpilise glasuuriga keraamiliste kruuside valik mõjub terviklikult ja igal hooajalisel sarjal on äratuntav käekiri.',
      )
      .replace(
        'Kas soovite praegu e-poe võimalusi võrrelda või saadaksin esmalt avaliku näidispoe lingi?',
        'Kas saadan alustuseks avaliku näidispoe lingi ja vaatate rahulikult, kas see suund võiks teile sobida?',
      )

    const codes = issueCodes({ ...companyFacts, ...validDraft, body })
    expect(codes).not.toContain('missing_positive_observation')
    expect(codes).not.toContain('ungrounded_opening')
    expect(codes).not.toContain('missing_low_friction_cta')
  })

  it('rejects a feature dump even when every mentioned benefit is otherwise approved', () => {
    const body = validDraft.body.replace(
      'lihtne veebipood, mida saate ise telefonist hallata',
      'lihtne veebipood, mida saate ise telefonist hallata, hoida tellimusi ühes vaates ja pakkuda ostjale kaardimakset',
    )

    expect(issueCodes({ ...companyFacts, ...validDraft, body })).toContain('feature_dump')
  })

  it('rejects missing source context instead of treating generic overlap as evidence', () => {
    expect(issueCodes({ subject: validDraft.subject, body: validDraft.body })).toContain('missing_source_context')
  })
})
