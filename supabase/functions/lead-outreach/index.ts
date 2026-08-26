import { createClient } from 'npm:@supabase/supabase-js@2'
import { captureEdgeError, checkRateLimit, rateLimitResponse } from '../_shared/security.ts'
import { renderLeadText } from '../_shared/lead-email.ts'
import {
  LEAD_COPY_PROMPT_ID,
  assessGeneratedLeadDraft,
  assessLeadQualification,
  assessLeadSearchCandidate,
  buildLeadBatchDraftPrompt,
  buildDeterministicLeadDraft,
  buildLeadDraftPrompt,
  buildLeadSearchPrompt,
  hasStrongCommerceSignal,
  leadBatchDraftSchema,
  leadDraftSchema,
  leadSearchResearchSchema,
  type LeadBatchDraftOutput,
  type LeadSearchResearchCandidate,
  type LeadSearchResearchOutput,
  type LeadSiteCheck,
  type VerifiedLeadDraftOutput,
} from '../_shared/lead-copy.ts'
import {
  classifyContactEmail,
  domainsRelated,
  extractOpenAIResponseSources,
  finalizeGeneratedLeadDraft,
  multilineValue,
  normalizeEmail,
  normalizePublicUrl,
  sourceKey,
  sourceMatches,
  textValue,
  websiteDomain,
} from '../_shared/lead-utils.ts'
import {
  hasCompleteLeadQualificationEvidence,
  storedLeadContactVerificationMatches,
  verifyLeadContactEvidence,
  verifyLeadWebEvidence,
  verifiedObservationMatchesSiteChecks,
} from '../_shared/lead-verification.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const defaultSearchQuery = [
  'Leia Eesti mikro- ja väikeettevõtteid, kes müüvad enda valmistatud või väikese valikuga füüsilisi tooteid.',
  'Eelista ettevõtteid, kes võtavad tellimusi sotsiaalmeedia, kontaktivormi või e-posti kaudu ja kellel puudub selgelt toimiv ostukorviga e-pood.',
  'Sobivad näiteks käsitöö, disaini, kodutoodete, aksessuaaride, kosmeetika, kunsti ja kohalike tarbekaupade müüjad.',
].join(' ')

type OpenAIOutputContent = {
  type?: string
  text?: string
  refusal?: string
}
type OpenAIOutputItem = {
  type?: string
  status?: string
  action?: Record<string, unknown>
  content?: OpenAIOutputContent[]
}
type OpenAIResponse = {
  id?: string
  status?: string
  error?: { message?: string } | null
  incomplete_details?: { reason?: string } | null
  output?: OpenAIOutputItem[]
}

const errorMessage = (error: unknown) => {
  const message = error instanceof Error
    ? error.message
    : error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : ''
  if (/signal timed out|timed out/i.test(message)) {
    return 'OpenAI veebiuuring võttis liiga kaua. Proovi väiksema tulemuste arvuga uuesti.'
  }
  if (message) return message
  return 'Kliendiotsingu toiming ebaõnnestus.'
}

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const extractOutputText = (response: OpenAIResponse) => {
  if (response.status !== 'completed') {
    const reason = response.error?.message || response.incomplete_details?.reason || response.status || 'unknown'
    throw new Error(`OpenAI vastus ei valminud (${reason}).`)
  }
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'refusal') throw new Error(content.refusal || 'OpenAI keeldus päringust.')
      if (content.type === 'output_text' && content.text) return content.text
    }
  }
  throw new Error('OpenAI ei tagastanud oodatud väljundit.')
}

const draftQualityRecord = (assessment: ReturnType<typeof assessGeneratedLeadDraft>) => ({
  passed: assessment.ok,
  score: Math.max(0, 100 - assessment.issues.length * 15),
  issues: assessment.issues.map((issue) => issue.message),
  issue_codes: assessment.issues.map((issue) => issue.code),
  metrics: {
    subject_words: assessment.subjectWordCount,
    body_words: assessment.bodyWordCount,
    paragraphs: assessment.paragraphCount,
    approved_benefits: assessment.approvedBenefits,
  },
  prompt_version: assessment.promptId,
})

const callOpenAI = async (payload: Record<string, unknown>, timeoutMs = 112_000) => {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requiredEnv('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
      'User-Agent': 'poeruum-lead-outreach/1.0',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const result = await response.json().catch(() => ({})) as OpenAIResponse
  if (!response.ok) {
    throw new Error(result.error?.message || `OpenAI vastas ${response.status}.`)
  }
  return result
}

const sendEmail = async (payload: Record<string, unknown>, idempotencyKey: string) => {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requiredEnv('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      'User-Agent': 'poeruum-lead-outreach/1.0',
    },
    body: JSON.stringify(payload),
  })
  const result = await response.json().catch(() => ({})) as { id?: string; message?: string }
  if (!response.ok || !result.id) throw new Error(result.message || `Resend vastas ${response.status}.`)
  return result.id
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authorization = request.headers.get('Authorization') ?? ''
    const token = authorization.replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'Palun logi sisse.' }, 401)

    const supabaseUrl = requiredEnv('SUPABASE_URL')
    const userClient = createClient(supabaseUrl, requiredEnv('POERUUM_SUPABASE_PUBLISHABLE_KEY'), {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: { user }, error: userError } = await userClient.auth.getUser(token)
    if (userError || !user) return json({ error: 'Sinu seanss on aegunud. Palun logi uuesti sisse.' }, 401)
    if (user.app_metadata?.role !== 'admin') return json({ error: 'Administraatori ligipääs puudub.' }, 403)

    const input = await request.json().catch(() => ({})) as Record<string, unknown>
    const action = textValue(input.action, 40)
    const admin = createClient(supabaseUrl, requiredEnv('POERUUM_SUPABASE_SECRET_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    if (action === 'search') {
      const rateLimit = await checkRateLimit(request, 'lead-outreach-search', 6, 3600, user.id)
      if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retry_after_seconds, corsHeaders)

      const query = textValue(input.query, 1000) || defaultSearchQuery
      const requestedLimit = Math.min(4, Math.max(1, Math.floor(Number(input.limit) || 4)))
      const model = Deno.env.get('OPENAI_LEAD_MODEL')?.trim() || 'gpt-5.6-sol'
      const { data: run, error: runError } = await admin.from('lead_search_runs').insert({
        created_by: user.id,
        query,
        requested_limit: requestedLimit,
        model,
        prompt_version: LEAD_COPY_PROMPT_ID,
      }).select('id').single()
      if (runError || !run) throw runError || new Error('Otsingukorda ei loodud.')

      const executeSearch = async () => {
        try {
          const [existingResult, suppressionsResult] = await Promise.all([
          admin.from('sales_leads').select('website_domain,contact_email').limit(1000),
          admin.from('lead_suppressions').select('email').limit(1000),
        ])
        if (existingResult.error) throw existingResult.error
        if (suppressionsResult.error) throw suppressionsResult.error
        const existingDomains = new Set((existingResult.data ?? [])
          .map((item) => String(item.website_domain ?? '').trim().toLowerCase().replace(/^www\./, ''))
          .filter(Boolean))
        const existingEmails = new Set((existingResult.data ?? [])
          .map((item) => normalizeEmail(item.contact_email))
          .filter((value): value is string => Boolean(value)))
        const preloadedSuppressedEmails = new Set((suppressionsResult.data ?? [])
          .map((item) => normalizeEmail(item.email))
          .filter((value): value is string => Boolean(value)))
        const excludedEmails = new Set([...existingEmails, ...preloadedSuppressedEmails])
        const safetyIdentifier = (await sha256(user.id)).slice(0, 64)
        const senderName = textValue(Deno.env.get('OUTREACH_SENDER_NAME'), 80) || 'Marek'
        const researchResponse = await callOpenAI({
          model,
          store: false,
          safety_identifier: safetyIdentifier,
          reasoning: { effort: 'low' },
          tools: [{
            type: 'web_search',
            search_context_size: 'medium',
            user_location: {
              type: 'approximate',
              country: 'EE',
              timezone: 'Europe/Tallinn',
            },
          }],
          tool_choice: 'required',
          max_tool_calls: 14,
          max_output_tokens: 9_000,
          include: ['web_search_call.action.sources'],
          instructions: buildLeadSearchPrompt({ requestedLimit }),
          input: JSON.stringify({
            search_request: query,
            requested_contacts: requestedLimit,
            excluded_website_domains: [...existingDomains].slice(0, 250),
            excluded_contact_emails: [...excludedEmails].slice(0, 250),
          }),
          text: {
            verbosity: 'low',
            format: {
              type: 'json_schema',
              name: 'poeruum_lead_research',
              description: 'Avalikest allikatest kontrollitud kontaktid ja sobivusfaktid.',
              schema: leadSearchResearchSchema,
              strict: true,
            },
          },
        }, 115_000)

        const parsed = JSON.parse(extractOutputText(researchResponse)) as LeadSearchResearchOutput
        const sources = extractOpenAIResponseSources(researchResponse)
        const hasCompletedWebSearch = (researchResponse.output ?? []).some((item) => (
          item.type === 'web_search_call' && item.status === 'completed'
        ))
        if (!hasCompletedWebSearch || !sources.size) {
          throw new Error('OpenAI veebiuuring ei tagastanud kontrollitavaid allikaid. Proovi uuesti.')
        }
        let duplicateCount = 0
        let rejectedCount = 0
        let invalidEvidenceCount = 0
        let suppressedCount = 0
        const preparedCandidates: Array<{
          candidateKey: string
          candidate: LeadSearchResearchCandidate
          rowBase: Record<string, unknown>
          decision: 'eligible' | 'review'
          hasReadyEvidence: boolean
          priority: number
        }> = []
        const preparedDomains = new Set<string>()
        const preparedEmails = new Set<string>()
        const domainAlreadyKnown = (candidateDomain: string) => (
          [...existingDomains, ...preparedDomains].some((knownDomain) => domainsRelated(candidateDomain, knownDomain))
        )

        for (const candidate of (parsed.candidates ?? []).slice(0, 6)) {
          const companyName = textValue(candidate.company_name, 200)
          const websiteUrl = normalizePublicUrl(candidate.website_url)
          const domain = websiteDomain(websiteUrl)
          const sourceUrl = normalizePublicUrl(candidate.source_url)
          if (!companyName || !websiteUrl || !domain || !sourceUrl) {
            invalidEvidenceCount += 1
            continue
          }
          if (domainAlreadyKnown(domain)) {
            duplicateCount += 1
            continue
          }
          const webEvidence = verifyLeadWebEvidence({
            response: researchResponse,
            websiteUrl,
            siteChecks: candidate.site_checks,
            verificationUrl: candidate.verification_url,
            commerceCheckUrl: candidate.commerce_check_url,
            requireOpenedCompanyPages: false,
          })
          const verificationUrl = webEvidence.verificationUrl
          const verifiedObservation = textValue(candidate.verified_observation, 500)
          if (
            !verificationUrl
            || !verifiedObservation
            || !webEvidence.verificationIsUsable
            || !sourceMatches(sourceUrl, webEvidence.sourceKeys)
            || !domainsRelated(domain, websiteDomain(sourceUrl))
          ) {
            invalidEvidenceCount += 1
            continue
          }
          const siteChecks = webEvidence.siteChecks
          const hasCheck = (kind: LeadSiteCheck['kind']) => siteChecks.some((check) => check.kind === kind)
          const commerceCheckUrl = webEvidence.commerceCheckUrl
          const hasCommerceCheck = webEvidence.commerceCheckIsUsable
          if (
            siteChecks.length < 3
            || !hasCheck('product_type')
            || !hasCheck('commerce')
            || !hasCheck('contact')
            || !hasCommerceCheck
            || !verifiedObservationMatchesSiteChecks({
              verifiedObservation,
              verificationUrl,
              siteChecks,
            })
          ) {
            invalidEvidenceCount += 1
            continue
          }
          const classifications = {
            market: hasCheck('market') ? candidate.market : 'unknown',
            business_size: hasCheck('business_size') ? candidate.business_size : 'unknown',
            product_type: hasCheck('product_type') ? candidate.product_type : 'unknown',
            sales_audience: hasCheck('sales_audience') ? candidate.sales_audience : 'unknown',
            commerce_status: hasStrongCommerceSignal(siteChecks)
              ? 'functional_store'
              : hasCommerceCheck ? candidate.commerce_status : 'unknown',
            purchase_complexity: hasCheck('purchase_complexity') ? candidate.purchase_complexity : 'unknown',
            has_standard_products: hasCheck('standard_products') ? candidate.has_standard_products : null,
          }
          const emailSourceUrl = normalizePublicUrl(candidate.email_source_url)
          const contactEmail = normalizeEmail(candidate.contact_email)
          const contactKind = classifyContactEmail(contactEmail)
          if (
            !emailSourceUrl
            || !contactEmail
            || contactKind !== 'general_business'
            || existingEmails.has(contactEmail)
            || preloadedSuppressedEmails.has(contactEmail)
            || preparedEmails.has(contactEmail)
          ) {
            if (contactEmail && preloadedSuppressedEmails.has(contactEmail)) {
              suppressedCount += 1
            } else if (contactEmail && (existingEmails.has(contactEmail) || preparedEmails.has(contactEmail))) {
              duplicateCount += 1
            } else {
              invalidEvidenceCount += 1
            }
            continue
          }
          const contactVerification = verifyLeadContactEvidence({
            contactEmail,
            emailSourceUrl,
            websiteUrl,
            companyName,
            siteChecks,
            openedSourceKeys: webEvidence.openedSourceKeys,
            sourceKeys: webEvidence.sourceKeys,
            requireOpenedSource: false,
          })
          if (!contactVerification) {
            invalidEvidenceCount += 1
            continue
          }
          const normalizedCandidate: LeadSearchResearchCandidate = {
            ...candidate,
            ...classifications,
            company_name: companyName,
            website_url: websiteUrl,
            source_url: sourceUrl,
            email_source_url: emailSourceUrl,
            contact_email: contactEmail,
            commerce_check_url: commerceCheckUrl,
            site_checks: siteChecks,
            verification_url: verificationUrl,
            verified_observation: verifiedObservation,
          }
          const qualification = assessLeadQualification(classifications)
          const decision = qualification.decision
          if (decision === 'reject') {
            rejectedCount += 1
            continue
          }
          const hasOpenedCheck = (kind: LeadSiteCheck['kind']) => siteChecks.some((check) => (
            check.kind === kind && sourceMatches(check.url, webEvidence.openedSourceKeys)
          ))
          const requiredOpenedKinds: LeadSiteCheck['kind'][] = [
            'market',
            'business_size',
            'product_type',
            'sales_audience',
            'commerce',
            'purchase_complexity',
            'standard_products',
          ]
          const hasReadyEvidence = requiredOpenedKinds.every(hasOpenedCheck)
            && sourceMatches(verificationUrl, webEvidence.openedSourceKeys)
            && sourceMatches(commerceCheckUrl, webEvidence.openedSourceKeys)
            && contactVerification.source_was_opened
          const qualificationRecord = {
            ...classifications,
            commerce_check_url: hasCommerceCheck ? commerceCheckUrl : null,
            decision,
            score: qualification.score,
            issues: qualification.reasons.filter((reason) => reason.severity !== 'pass').map((reason) => reason.message),
            reasons: qualification.reasons,
            site_checks: siteChecks,
            ready_evidence_verified: hasReadyEvidence,
            contact_verification: {
              ...contactVerification,
              checked_at: new Date().toISOString(),
              prompt_version: LEAD_COPY_PROMPT_ID,
            },
            last_recheck: {
              decision,
              verification_url: verificationUrl,
              verified_observation: verifiedObservation,
              response_id: researchResponse.id ?? null,
              checked_at: new Date().toISOString(),
              prompt_version: LEAD_COPY_PROMPT_ID,
            },
            prompt_version: LEAD_COPY_PROMPT_ID,
          }
          const fitReason = qualification.reasons.map((reason) => reason.message).join(' ')
          const evidence = textValue(candidate.evidence, 1200)
            || siteChecks.slice(0, 3).map((check) => check.finding).join(' ')
          const candidateKey = `candidate-${preparedCandidates.length + 1}`
          preparedCandidates.push({
            candidateKey,
            candidate: normalizedCandidate,
            rowBase: {
              search_run_id: run.id,
              company_name: companyName,
              website_url: websiteUrl,
              website_domain: domain,
              source_url: sourceUrl,
              email_source_url: emailSourceUrl,
              contact_email: contactEmail,
              contact_kind: contactKind,
              location: textValue(candidate.location, 160),
              segment: textValue(candidate.segment, 160),
              summary: textValue(candidate.summary, 1000),
              fit_reason: textValue(fitReason, 1200),
              evidence,
              fit_score: qualification.score,
              qualification: qualificationRecord,
              created_by: user.id,
              updated_by: user.id,
            },
            decision,
            hasReadyEvidence,
            priority: (hasReadyEvidence ? 1_000 : 0) + (decision === 'eligible' ? 200 : 0) + qualification.score,
          })
          preparedDomains.add(domain)
          preparedEmails.add(contactEmail)
        }

        preparedCandidates.sort((left, right) => right.priority - left.priority)
        const candidateEmails = preparedCandidates
          .map((candidate) => normalizeEmail(candidate.rowBase.contact_email))
          .filter((value): value is string => Boolean(value))
        const { data: currentSuppressions, error: currentSuppressionsError } = candidateEmails.length
          ? await admin.from('lead_suppressions').select('email').in('email', candidateEmails)
          : { data: [], error: null }
        if (currentSuppressionsError) throw currentSuppressionsError
        const suppressedEmails = new Set((currentSuppressions ?? [])
          .map((item) => normalizeEmail(item.email))
          .filter((value): value is string => Boolean(value)))
        const selectedCandidates: typeof preparedCandidates = []
        for (const candidate of preparedCandidates) {
          const candidateEmail = normalizeEmail(candidate.rowBase.contact_email)
          if (candidateEmail && suppressedEmails.has(candidateEmail)) {
            suppressedCount += 1
            continue
          }
          selectedCandidates.push(candidate)
          if (selectedCandidates.length >= requestedLimit) break
        }

        let draftResponseId: string | null = null
        let draftStageDegraded = false
        const draftsByKey = new Map<string, { subject: string; body: string }>()
        if (selectedCandidates.length) {
          try {
            const draftResponse = await callOpenAI({
              model,
              store: false,
              safety_identifier: safetyIdentifier,
              reasoning: { effort: 'low' },
              max_output_tokens: 6_000,
              instructions: buildLeadBatchDraftPrompt({
                senderName,
                candidateCount: selectedCandidates.length,
              }),
              input: JSON.stringify({
                candidates: selectedCandidates.map((candidate) => ({
                  candidate_key: candidate.candidateKey,
                  company_name: candidate.candidate.company_name,
                  segment: candidate.candidate.segment,
                  summary: candidate.candidate.summary,
                  evidence: candidate.candidate.evidence,
                  verified_observation: candidate.candidate.verified_observation,
                })),
              }),
              text: {
                verbosity: 'medium',
                format: {
                  type: 'json_schema',
                  name: 'poeruum_lead_draft_batch',
                  description: 'Kontrollitud kandidaatide isikupärased eestikeelsed kirjamustandid.',
                  schema: leadBatchDraftSchema,
                  strict: true,
                },
              },
            }, 18_000)
            draftResponseId = draftResponse.id ?? null
            const parsedDrafts = JSON.parse(extractOutputText(draftResponse)) as LeadBatchDraftOutput
            const expectedKeys = new Set(selectedCandidates.map((candidate) => candidate.candidateKey))
            for (const draft of parsedDrafts.drafts ?? []) {
              const candidateKey = textValue(draft.candidate_key, 80)
              if (!expectedKeys.has(candidateKey) || draftsByKey.has(candidateKey)) continue
              draftsByKey.set(candidateKey, {
                subject: textValue(draft.draft_subject, 160),
                body: finalizeGeneratedLeadDraft(draft.draft_body),
              })
            }
          } catch (draftError) {
            draftStageDegraded = true
            await captureEdgeError('lead-outreach-search-drafts', draftError, {
              search_run_id: run.id,
              candidate_count: selectedCandidates.length,
            }, 'warning')
          }
        }

        let insertedCount = 0
        let eligibleCount = 0
        let reviewCount = 0
        let newCount = 0
        let readyCount = 0
        let aiDraftCount = 0
        let fallbackDraftCount = 0
        const insertedLeads: Array<{
          id: string
          decision: 'eligible' | 'review'
          status: 'new' | 'ready'
          draftSource: 'openai' | 'deterministic_repair'
        }> = []
        for (const candidate of selectedCandidates) {
          let draft = draftsByKey.get(candidate.candidateKey)
          let assessment = draft
            ? assessLeadSearchCandidate({
              ...candidate.candidate,
              draft_subject: draft.subject,
              draft_body: draft.body,
            })
            : null
          let draftSource: 'openai' | 'deterministic_repair' = 'openai'
          if (!draft || !assessment?.draftQuality.ok) {
            draft = buildDeterministicLeadDraft({
              company_name: candidate.candidate.company_name,
              verified_observation: candidate.candidate.verified_observation,
            })
            assessment = assessLeadSearchCandidate({
              ...candidate.candidate,
              draft_subject: draft.subject,
              draft_body: draft.body,
            })
            draftSource = 'deterministic_repair'
          }
          if (!assessment.actionable) {
            invalidEvidenceCount += 1
            continue
          }
          const quality = draftQualityRecord(assessment.draftQuality)
          const status = candidate.decision === 'eligible' && quality.passed && candidate.hasReadyEvidence
            ? 'ready'
            : 'new'
          const { data: lead, error: leadError } = await admin.from('sales_leads').insert({
            ...candidate.rowBase,
            status,
            draft_subject: draft.subject,
            draft_body: draft.body,
            draft_quality: quality,
            draft_prompt_version: LEAD_COPY_PROMPT_ID,
            draft_openai_response_id: draftResponseId,
          }).select('id').single()
          if (leadError?.code === '23505') {
            duplicateCount += 1
            continue
          }
          if (leadError || !lead) throw leadError || new Error('Kontakti ei salvestatud.')
          insertedCount += 1
          if (candidate.decision === 'eligible') eligibleCount += 1
          if (candidate.decision === 'review') reviewCount += 1
          if (status === 'ready') readyCount += 1
          if (status === 'new') newCount += 1
          if (draftSource === 'openai') aiDraftCount += 1
          if (draftSource === 'deterministic_repair') fallbackDraftCount += 1
          insertedLeads.push({ id: lead.id, decision: candidate.decision, status, draftSource })
        }

        if (insertedLeads.length) {
          const { error: eventError } = await admin.from('lead_events').insert(insertedLeads.map((lead) => ({
            lead_id: lead.id,
            actor_id: user.id,
            event_type: 'discovered',
            details: {
              search_run_id: run.id,
              prompt_version: LEAD_COPY_PROMPT_ID,
              qualification: lead.decision,
              status: lead.status,
              draft_created: true,
              draft_source: lead.draftSource,
              draft_response_id: draftResponseId,
            },
          })))
          if (eventError) {
            await captureEdgeError('lead-outreach-search-events', eventError, {
              search_run_id: run.id,
              inserted_count: insertedLeads.length,
            }, 'warning')
          }
        }

        const foundCount = Array.isArray(parsed.candidates) ? parsed.candidates.length : 0
        const usedSourceKeys = new Set(selectedCandidates.flatMap((candidate) => [
          candidate.candidate.source_url,
          candidate.candidate.email_source_url,
          candidate.candidate.verification_url,
          candidate.candidate.commerce_check_url,
          ...candidate.candidate.site_checks.map((check) => check.url),
        ].map(sourceKey).filter((value): value is string => Boolean(value))))
        const prioritizedSources = [...sources.entries()]
          .sort(([leftKey], [rightKey]) => Number(usedSourceKeys.has(rightKey)) - Number(usedSourceKeys.has(leftKey)))
          .map(([, source]) => source)
        const sourceList = prioritizedSources.slice(0, 120)
        const resultDetails = {
          research_response_id: researchResponse.id ?? null,
          draft_response_id: draftResponseId,
          inserted_ids: insertedLeads.map((lead) => lead.id),
          drafted_count: insertedCount,
          ready_count: readyCount,
          not_added_count: Math.max(0, foundCount - insertedCount),
          duplicate_count: duplicateCount,
          eligible_count: eligibleCount,
          review_count: reviewCount,
          needs_review_count: newCount,
          rejected_count: rejectedCount,
          suppressed_count: suppressedCount,
          invalid_evidence_count: invalidEvidenceCount,
          ai_draft_count: aiDraftCount,
          fallback_draft_count: fallbackDraftCount,
          draft_stage_degraded: draftStageDegraded,
        }
        const { error: completeError } = await admin.from('lead_search_runs').update({
          status: 'completed',
          openai_response_id: researchResponse.id ?? null,
          draft_openai_response_id: draftResponseId,
          found_count: foundCount,
          inserted_count: insertedCount,
          source_count: sources.size,
          sources: sourceList,
          result_details: resultDetails,
          completed_at: new Date().toISOString(),
        }).eq('id', run.id)
        if (completeError) throw completeError

        } catch (error) {
          const message = errorMessage(error).slice(0, 1000)
          await admin.from('lead_search_runs').update({
            status: 'failed',
            error_message: message,
            result_details: { failure_stage: 'research_or_drafting' },
            completed_at: new Date().toISOString(),
          }).eq('id', run.id)
          await captureEdgeError('lead-outreach-search', error, { search_run_id: run.id })
          console.error(error)
        }
      }

      const searchTask = executeSearch()
      const edgeRuntime = (globalThis as unknown as {
        EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void }
      }).EdgeRuntime
      if (edgeRuntime) {
        edgeRuntime.waitUntil(searchTask)
      } else {
        await searchTask
      }
      return json({ ok: true, accepted: true, search_run_id: run.id }, 202)
    }

    const leadId = textValue(input.lead_id, 60)
    if (!uuidPattern.test(leadId)) return json({ error: 'Kontakti ei leitud.' }, 400)

    const { data: lead, error: leadError } = await admin.from('sales_leads').select('*').eq('id', leadId).maybeSingle()
    if (leadError) throw leadError
    if (!lead) return json({ error: 'Kontakti ei leitud.' }, 404)

    if (action === 'save') {
      if (!['new', 'ready', 'archived'].includes(lead.status)) {
        return json({ error: 'Saadetud või saatmisel olevat kirja ei saa enam muuta.' }, 409)
      }
      const companyName = textValue(input.company_name, 200)
      const contactEmail = normalizeEmail(input.contact_email)
      const contactKind = classifyContactEmail(contactEmail)
      const emailSourceUrl = normalizePublicUrl(input.email_source_url)
      const subject = textValue(input.draft_subject, 160)
      const body = multilineValue(input.draft_body, 5000)
      if (!companyName) return json({ error: 'Lisa ettevõtte nimi.' }, 400)
      if (contactEmail && !emailSourceUrl) return json({ error: 'Lisa avalik allikas, kus ettevõtte kontakt on nähtav.' }, 400)
      const qualification = lead.qualification && typeof lead.qualification === 'object'
        ? lead.qualification as Record<string, unknown>
        : {}
      const lastRecheck = qualification.last_recheck && typeof qualification.last_recheck === 'object'
        ? qualification.last_recheck as Record<string, unknown>
        : {}
      const qualityEvidence = `${lead.evidence ?? ''} ${textValue(lastRecheck.verified_observation, 500)}`
      const assessment = assessGeneratedLeadDraft({
        subject,
        body,
        company_name: companyName,
        segment: lead.segment,
        summary: lead.summary,
        evidence: qualityEvidence,
      })
      const quality = draftQualityRecord(assessment)
      const status = contactKind === 'general_business'
        && storedLeadContactVerificationMatches({
          qualification,
          contactEmail,
          emailSourceUrl,
          websiteUrl: lead.website_url,
        })
        && qualification.decision === 'eligible'
        && qualification.ready_evidence_verified === true
        && quality.passed
        ? 'ready'
        : 'new'
      const { data: updatedLead, error: updateError } = await admin.from('sales_leads').update({
        company_name: companyName,
        contact_email: contactEmail,
        contact_kind: contactKind,
        email_source_url: emailSourceUrl,
        draft_subject: subject,
        draft_body: body,
        draft_quality: quality,
        status,
        updated_by: user.id,
      })
        .eq('id', leadId)
        .eq('status', lead.status)
        .eq('updated_at', lead.updated_at)
        .is('resend_email_id', null)
        .select('id')
        .maybeSingle()
      if (updateError?.code === '23505') return json({ error: 'See e-posti aadress on juba teise kontakti juures.' }, 409)
      if (updateError) throw updateError
      if (!updatedLead) return json({ error: 'Kontakt muutus vahepeal. Laadi värske seis ja proovi uuesti.' }, 409)
      await admin.from('lead_events').insert({
        lead_id: leadId,
        actor_id: user.id,
        event_type: 'edited',
        details: {
          ready: status === 'ready',
          quality_passed: quality.passed,
          quality_issue_codes: quality.issue_codes,
        },
      })
      return json({ ok: true, status, contact_kind: contactKind, quality })
    }

    if (action === 'draft') {
      if (!['new', 'ready'].includes(lead.status)) return json({ error: 'Selle kontakti kirja ei saa enam uuesti koostada.' }, 409)
      const rateLimit = await checkRateLimit(request, 'lead-outreach-draft', 30, 3600, user.id)
      if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retry_after_seconds, corsHeaders)
      const model = Deno.env.get('OPENAI_LEAD_MODEL')?.trim() || 'gpt-5.6-sol'
      const senderName = textValue(Deno.env.get('OUTREACH_SENDER_NAME'), 80) || 'Marek'
      const feedback = multilineValue(input.feedback, 500)
      const response = await callOpenAI({
        model,
        store: false,
        safety_identifier: (await sha256(user.id)).slice(0, 64),
        reasoning: { effort: 'medium' },
        tools: [{
          type: 'web_search',
          search_context_size: 'high',
          user_location: {
            type: 'approximate',
            country: 'EE',
            timezone: 'Europe/Tallinn',
          },
        }],
        tool_choice: 'required',
        max_tool_calls: 8,
        include: ['web_search_call.action.sources'],
        instructions: buildLeadDraftPrompt({ senderName }),
        input: JSON.stringify({
          company_name: lead.company_name,
          website_url: lead.website_url,
          source_url: lead.source_url,
          contact_email: lead.contact_email,
          email_source_url: lead.email_source_url,
          segment: lead.segment,
          summary: lead.summary,
          fit_reason: lead.fit_reason,
          evidence: lead.evidence,
          previous_qualification: lead.qualification,
          editor_feedback: feedback || null,
        }),
        text: {
          verbosity: 'medium',
          format: {
            type: 'json_schema',
            name: 'poeruum_verified_outreach_draft',
            description: 'Värskelt kontrollitud sobivusotsus ja parim eestikeelne kirjamustand.',
            schema: leadDraftSchema,
            strict: true,
          },
        },
      })
      const draft = JSON.parse(extractOutputText(response)) as VerifiedLeadDraftOutput
      const webEvidence = verifyLeadWebEvidence({
        response,
        websiteUrl: lead.website_url,
        siteChecks: draft.site_checks,
        verificationUrl: draft.verification_url,
        commerceCheckUrl: draft.commerce_check_url,
      })
      const siteChecks = webEvidence.siteChecks
      const hasCheck = (kind: LeadSiteCheck['kind']) => siteChecks.some((check) => check.kind === kind)
      const commerceCheckUrl = webEvidence.commerceCheckUrl
      const hasCommerceCheck = webEvidence.commerceCheckIsUsable
      const classifications = {
        market: hasCheck('market') ? draft.market : 'unknown',
        business_size: hasCheck('business_size') ? draft.business_size : 'unknown',
        product_type: hasCheck('product_type') ? draft.product_type : 'unknown',
        sales_audience: hasCheck('sales_audience') ? draft.sales_audience : 'unknown',
        commerce_status: hasStrongCommerceSignal(siteChecks)
          ? 'functional_store'
          : hasCommerceCheck ? draft.commerce_status : 'unknown',
        purchase_complexity: hasCheck('purchase_complexity') ? draft.purchase_complexity : 'unknown',
        has_standard_products: hasCheck('standard_products') ? draft.has_standard_products : null,
      }
      const freshQualification = assessLeadQualification(classifications)
      const verificationUrl = webEvidence.verificationUrl
      const verificationIsUsable = webEvidence.verificationIsUsable
      const verifiedObservation = textValue(draft.verified_observation, 500)
      const observationIsVerified = verifiedObservationMatchesSiteChecks({
        verifiedObservation,
        verificationUrl,
        siteChecks,
      })
      const requiresDraftEvidence = draft.recommendation === 'send'
      const hasCompleteQualificationEvidence = hasCompleteLeadQualificationEvidence(siteChecks)
      const verificationIncomplete = !webEvidence.hasCompletedWebSearch
        || !webEvidence.sources.size
        || !siteChecks.length
        || (freshQualification.decision !== 'reject' && !hasCompleteQualificationEvidence)
        || (requiresDraftEvidence && (!verificationIsUsable || !observationIsVerified))

      if (verificationIncomplete) {
        const reason = 'Veebikontroll ei saanud ettevõtte lehti usaldusväärselt kinnitada. Proovi uuesti.'
        await admin.from('lead_events').insert({
          lead_id: leadId,
          actor_id: user.id,
          event_type: 'draft_verification_failed',
          details: {
            model,
            prompt_version: LEAD_COPY_PROMPT_ID,
            response_id: response.id ?? null,
            had_web_search_call: webEvidence.hasCompletedWebSearch,
            source_count: webEvidence.sources.size,
            raw_site_check_count: Array.isArray(draft.site_checks) ? draft.site_checks.length : 0,
            verified_site_check_count: siteChecks.length,
            has_complete_qualification_evidence: hasCompleteQualificationEvidence,
            verification_url: verificationUrl,
          },
        })
        return json({
          ok: true,
          verification_incomplete: true,
          retryable: true,
          reason,
          status: lead.status,
        })
      }

      const eligibleNow = draft.recommendation === 'send'
        && draft.current_qualification === 'eligible'
        && Array.isArray(draft.blocking_signals)
        && draft.blocking_signals.length === 0
        && freshQualification.decision === 'eligible'
        && verificationIsUsable
        && observationIsVerified
      const previousQualification = lead.qualification && typeof lead.qualification === 'object'
        ? lead.qualification as Record<string, unknown>
        : {}

      if (!eligibleNow) {
        const serverReasons = freshQualification.reasons
          .filter((item) => item.severity !== 'pass')
          .map((item) => item.message)
        const rejected = freshQualification.decision === 'reject'
        const recheckDecision = rejected ? 'reject' : 'review'
        const rawReason = serverReasons.length
          ? serverReasons.join(' ')
          : 'Värske veebikontrolli soovitus ja kontrollitud sobivusandmed ei olnud omavahel kooskõlas'
        const normalizedReason = rawReason.trim().replace(/\s+/g, ' ')
        const capitalizedReason = normalizedReason
          ? `${normalizedReason.charAt(0).toLocaleUpperCase('et-EE')}${normalizedReason.slice(1)}`
          : rejected
            ? 'Ettevõte ei vasta praegu Poeruumi sihtkliendi tingimustele'
            : 'Ettevõtte sobivus vajab enne kirja koostamist käsitsi kontrolli'
        const reason = /[.!?]$/.test(capitalizedReason) ? capitalizedReason : `${capitalizedReason}.`
        const qualification = {
          ...previousQualification,
          ...classifications,
          commerce_check_url: hasCommerceCheck ? commerceCheckUrl : null,
          decision: recheckDecision,
          score: freshQualification.score,
          issues: [reason],
          reasons: freshQualification.reasons,
          site_checks: siteChecks,
          ready_evidence_verified: false,
          last_recheck: {
            decision: recheckDecision,
            blocking_signals: draft.blocking_signals,
            verification_url: verificationUrl,
            outcome: rejected ? 'not_recommended' : 'needs_review',
            response_id: response.id ?? null,
            checked_at: new Date().toISOString(),
            prompt_version: LEAD_COPY_PROMPT_ID,
          },
        }
        const updateValues: Record<string, unknown> = {
          qualification,
          status: rejected ? 'archived' : 'new',
          updated_by: user.id,
        }
        if (rejected) {
          updateValues.fit_score = 0
          updateValues.draft_subject = ''
          updateValues.draft_body = ''
          updateValues.draft_quality = {}
          updateValues.draft_prompt_version = null
          updateValues.draft_openai_response_id = null
        }
        const { data: updatedLead, error: updateError } = await admin.from('sales_leads').update(updateValues)
          .eq('id', leadId)
          .eq('status', lead.status)
          .eq('updated_at', lead.updated_at)
          .is('resend_email_id', null)
          .select('id')
          .maybeSingle()
        if (updateError) throw updateError
        if (!updatedLead) return json({ error: 'Kontakt muutus veebikontrolli ajal. Laadi värske seis ja proovi uuesti.' }, 409)
        await admin.from('lead_events').insert({
          lead_id: leadId,
          actor_id: user.id,
          event_type: rejected ? 'draft_excluded' : 'draft_review_required',
          details: {
            model,
            prompt_version: LEAD_COPY_PROMPT_ID,
            reason,
            decision: recheckDecision,
            blocking_signals: draft.blocking_signals,
          },
        })
        return json({
          ok: true,
          excluded: rejected,
          needs_review: !rejected,
          reason,
          status: rejected ? 'archived' : 'new',
        })
      }

      const subject = textValue(draft.subject, 160)
      const body = finalizeGeneratedLeadDraft(draft.body)
      if (!subject || !body) throw new Error('OpenAI ei koostanud kasutatavat kirja.')
      const assessment = assessGeneratedLeadDraft({
        subject,
        body,
        company_name: lead.company_name,
        segment: lead.segment,
        summary: lead.summary,
        evidence: `${lead.evidence ?? ''} ${verifiedObservation}`,
      })
      const quality = draftQualityRecord(assessment)
      const verifiedContactEvidence = verifyLeadContactEvidence({
        contactEmail: lead.contact_email,
        emailSourceUrl: lead.email_source_url,
        websiteUrl: lead.website_url,
        companyName: lead.company_name,
        siteChecks,
        openedSourceKeys: webEvidence.openedSourceKeys,
      })
      const qualification = {
        ...previousQualification,
        ...classifications,
        commerce_check_url: commerceCheckUrl,
        decision: 'eligible',
        score: freshQualification.score,
        issues: [],
        reasons: freshQualification.reasons,
        site_checks: siteChecks,
        ready_evidence_verified: Boolean(verifiedContactEvidence),
        contact_verification: verifiedContactEvidence
          ? {
            ...verifiedContactEvidence,
            checked_at: new Date().toISOString(),
            prompt_version: LEAD_COPY_PROMPT_ID,
          }
          : null,
        last_recheck: {
          decision: 'eligible',
          blocking_signals: [],
          verification_url: verificationUrl,
          verified_observation: verifiedObservation,
          checked_at: new Date().toISOString(),
          prompt_version: LEAD_COPY_PROMPT_ID,
        },
      }
      const status = lead.contact_kind === 'general_business'
        && storedLeadContactVerificationMatches({
          qualification,
          contactEmail: lead.contact_email,
          emailSourceUrl: lead.email_source_url,
          websiteUrl: lead.website_url,
        })
        && quality.passed
        ? 'ready'
        : 'new'
      const { data: updatedLead, error: updateError } = await admin.from('sales_leads').update({
        fit_score: freshQualification.score,
        fit_reason: freshQualification.reasons.map((reason) => reason.message).join(' '),
        qualification,
        draft_subject: subject,
        draft_body: body,
        draft_quality: quality,
        draft_prompt_version: LEAD_COPY_PROMPT_ID,
        draft_openai_response_id: response.id ?? null,
        status,
        updated_by: user.id,
      })
        .eq('id', leadId)
        .eq('status', lead.status)
        .eq('updated_at', lead.updated_at)
        .is('resend_email_id', null)
        .select('id')
        .maybeSingle()
      if (updateError) throw updateError
      if (!updatedLead) return json({ error: 'Kontakt muutus veebikontrolli ajal. Laadi värske seis ja proovi uuesti.' }, 409)
      await admin.from('lead_events').insert({
        lead_id: leadId,
        actor_id: user.id,
        event_type: 'draft_regenerated',
        details: {
          model,
          prompt_version: LEAD_COPY_PROMPT_ID,
          quality_passed: quality.passed,
          quality_issue_codes: quality.issue_codes,
          verification_url: verificationUrl,
        },
      })
      return json({ ok: true, subject, body, status, quality })
    }

    if (action === 'archive') {
      if (!['new', 'ready'].includes(lead.status)) return json({ error: 'Seda kontakti ei saa arhiveerida.' }, 409)
      const { error: updateError } = await admin.from('sales_leads').update({
        status: 'archived',
        updated_by: user.id,
      }).eq('id', leadId)
      if (updateError) throw updateError
      await admin.from('lead_events').insert({
        lead_id: leadId,
        actor_id: user.id,
        event_type: 'archived',
      })
      return json({ ok: true })
    }

    if (action === 'suppress') {
      const contactEmail = normalizeEmail(lead.contact_email)
      if (!contactEmail) return json({ error: 'Kontaktil puudub blokeeritav e-posti aadress.' }, 400)
      const { error: suppressionError } = await admin.from('lead_suppressions').upsert({
        email: contactEmail,
        reason: 'manual',
        lead_id: leadId,
        source: 'admin',
      }, { onConflict: 'email' })
      if (suppressionError) throw suppressionError
      const { error: updateError } = await admin.from('sales_leads').update({
        status: 'unsubscribed',
        suppressed_at: new Date().toISOString(),
        suppression_reason: 'manual',
        updated_by: user.id,
      }).eq('id', leadId)
      if (updateError) throw updateError
      await admin.from('lead_events').insert({
        lead_id: leadId,
        actor_id: user.id,
        event_type: 'suppressed',
        details: { reason: 'manual' },
      })
      return json({ ok: true })
    }

    if (action === 'send') {
      const storedQuality = lead.draft_quality && typeof lead.draft_quality === 'object'
        ? lead.draft_quality as Record<string, unknown>
        : {}
      const storedQualification = lead.qualification && typeof lead.qualification === 'object'
        ? lead.qualification as Record<string, unknown>
        : {}
      if (
        storedQuality.passed !== true
        || storedQualification.decision !== 'eligible'
        || storedQualification.ready_evidence_verified !== true
      ) {
        return json({ error: 'Kiri peab enne saatmist läbima värske sobivus- ja kvaliteedikontrolli.' }, 409)
      }
      if (!storedLeadContactVerificationMatches({
          qualification: storedQualification,
          contactEmail: lead.contact_email,
          emailSourceUrl: lead.email_source_url,
          websiteUrl: lead.website_url,
        })) {
        return json({ error: 'Üldkontakt peab olema värskelt kinnitatud ettevõtte avatud ametlikul kontaktilehel.' }, 409)
      }
      const rateLimit = await checkRateLimit(request, 'lead-outreach-send', 40, 3600, user.id)
      if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retry_after_seconds, corsHeaders)
      const configuredLimit = Number(Deno.env.get('OUTREACH_DAILY_SEND_LIMIT') || 20)
      const dailyLimit = Number.isFinite(configuredLimit) ? Math.min(200, Math.max(1, Math.floor(configuredLimit))) : 20
      const { data: claims, error: claimError } = await admin.rpc('claim_sales_lead_send', {
        target_lead_id: leadId,
        target_admin_id: user.id,
        target_daily_limit: dailyLimit,
      })
      if (claimError) return json({ error: claimError.message }, 409)
      const claim = Array.isArray(claims) ? claims[0] : claims
      if (!claim) throw new Error('Saatmislukk ei tagastanud kontakti.')

      const senderName = textValue(Deno.env.get('OUTREACH_SENDER_NAME'), 80) || 'Marek'
      const configuredSender = Deno.env.get('RESEND_FROM_EMAIL')?.trim() || ''
      const senderAddress = configuredSender.match(/<([^<>\s@]+@[^<>\s@]+)>/)?.[1]
        || configuredSender.match(/^[^\s@]+@[^\s@]+$/)?.[0]
        || 'teavitused@send.poeruum.ee'
      const from = Deno.env.get('OUTREACH_FROM_EMAIL')?.trim()
        || `Marek Tammets | Poeruum <${senderAddress}>`
      const replyTo = Deno.env.get('OUTREACH_REPLY_TO')?.trim()
        || Deno.env.get('SUPPORT_PUBLIC_EMAIL')?.trim()
        || 'info@poeruum.ee'
      const emailSourceUrl = normalizePublicUrl(claim.email_source_url)
      if (!emailSourceUrl) {
        await admin.from('sales_leads').update({
          status: 'new',
          send_claim_id: null,
          send_claimed_at: null,
          approved_by: null,
          approved_at: null,
        }).eq('id', leadId)
        return json({ error: 'Kontakti avalik allikas puudub või pole korrektne.' }, 400)
      }

      const publicAppUrl = normalizePublicUrl(Deno.env.get('APP_URL') || 'https://poeruum.ee/')
      if (!publicAppUrl) throw new Error('APP_URL peab olema avalik HTTP(S) aadress.')
      const unsubscribeUrl = new URL('/loobu/', publicAppUrl)
      unsubscribeUrl.searchParams.set('token', String(claim.unsubscribe_token))
      const text = renderLeadText({
        body: claim.draft_body,
        senderName,
        emailSourceUrl,
        unsubscribeUrl: unsubscribeUrl.toString(),
      })
      const idempotencyKey = `poeruum-lead-${leadId}-${claim.send_claim_id}`

      let resendEmailId = ''
      try {
        resendEmailId = await sendEmail({
          from,
          to: [claim.contact_email],
          reply_to: replyTo,
          subject: claim.draft_subject,
          text,
          tags: [
            { name: 'email_type', value: 'lead_outreach' },
            { name: 'lead_id', value: leadId },
          ],
        }, idempotencyKey)
      } catch (sendError) {
        await admin.from('sales_leads').update({
          status: 'ready',
          send_claim_id: null,
          send_claimed_at: null,
          approved_by: null,
          approved_at: null,
          updated_by: user.id,
        }).eq('id', leadId).is('resend_email_id', null)
        await admin.from('lead_events').insert({
          lead_id: leadId,
          actor_id: user.id,
          event_type: 'send_failed',
          details: { message: errorMessage(sendError).slice(0, 300) },
        })
        throw sendError
      }

      // Once Resend accepted the message, keep the claim even if a bookkeeping
      // write fails. A retry then reuses the same claim and idempotency key.
      const sentAt = new Date().toISOString()
      const { error: updateError } = await admin.from('sales_leads').update({
        status: 'sent',
        resend_email_id: resendEmailId,
        delivery_status: 'sent',
        sent_at: sentAt,
        updated_by: user.id,
      }).eq('id', leadId).eq('send_claim_id', claim.send_claim_id)
      if (updateError) throw updateError
      const { error: deliveryError } = await admin.from('email_deliveries').upsert({
        resend_email_id: resendEmailId,
        recipient_email: claim.contact_email,
        subject: claim.draft_subject,
        email_type: 'lead_outreach',
        status: 'sent',
        sent_at: sentAt,
        status_updated_at: sentAt,
      }, { onConflict: 'resend_email_id' })
      if (deliveryError) throw deliveryError
      const { error: eventError } = await admin.from('lead_events').insert({
        lead_id: leadId,
        actor_id: user.id,
        event_type: 'sent',
        details: { resend_email_id: resendEmailId },
      })
      if (eventError) throw eventError
      return json({ ok: true, resend_email_id: resendEmailId, sent_at: sentAt })
    }

    return json({ error: 'Tundmatu tegevus.' }, 400)
  } catch (error) {
    await captureEdgeError('lead-outreach', error)
    console.error(error)
    return json({ error: errorMessage(error) }, 500)
  }
})
