import { createClient } from 'npm:@supabase/supabase-js@2'
import { captureEdgeError, checkRateLimit, rateLimitResponse } from '../_shared/security.ts'
import { renderLeadText } from '../_shared/lead-email.ts'
import {
  LEAD_COPY_PROMPT_ID,
  assessGeneratedLeadDraft,
  assessLeadQualification,
  buildLeadDraftPrompt,
  buildLeadSearchPrompt,
  hasStrongCommerceSignal,
  leadDraftSchema,
  leadResearchSchema,
  type LeadResearchOutput,
  type LeadSiteCheck,
  type VerifiedLeadDraftOutput,
} from '../_shared/lead-copy.ts'
import {
  classifyContactEmail,
  contactMatchesWebsite,
  domainsRelated,
  finalizeGeneratedLeadDraft,
  multilineValue,
  normalizeEmail,
  normalizePublicUrl,
  sourceKey,
  sourceMatches,
  textValue,
  websiteDomain,
} from '../_shared/lead-utils.ts'

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

type OpenAISource = { url?: string; title?: string }
type OpenAIOutputContent = {
  type?: string
  text?: string
  refusal?: string
  annotations?: Array<{ type?: string; url?: string; title?: string }>
}
type OpenAIOutputItem = {
  type?: string
  action?: { sources?: OpenAISource[] }
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

const extractSources = (response: OpenAIResponse) => {
  const sources = new Map<string, { url: string; title: string }>()
  const add = (source: OpenAISource) => {
    const url = normalizePublicUrl(source.url)
    const key = sourceKey(url)
    if (!url || !key || sources.has(key)) return
    sources.set(key, { url, title: textValue(source.title, 300) })
  }
  for (const item of response.output ?? []) {
    for (const source of item.action?.sources ?? []) add(source)
    for (const content of item.content ?? []) {
      for (const annotation of content.annotations ?? []) {
        if (annotation.type === 'url_citation') add(annotation)
      }
    }
  }
  return sources
}

const siteCheckKinds = new Set<LeadSiteCheck['kind']>([
  'market',
  'business_size',
  'product_type',
  'sales_audience',
  'commerce',
  'purchase_complexity',
  'standard_products',
  'contact',
])

const verifiedSiteChecks = (value: unknown, sourceKeys: Set<string>, websiteValue: unknown) => {
  if (!Array.isArray(value)) return [] as LeadSiteCheck[]
  const domain = websiteDomain(websiteValue)
  if (!domain) return [] as LeadSiteCheck[]
  return value.slice(0, 12).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const kind = textValue(record.kind, 40) as LeadSiteCheck['kind']
    const url = normalizePublicUrl(record.url)
    const finding = textValue(record.finding, 400)
    if (
      !siteCheckKinds.has(kind)
      || !url
      || !finding
      || !sourceMatches(url, sourceKeys)
      || !domainsRelated(domain, websiteDomain(url))
    ) return []
    return [{ kind, url, finding }]
  })
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

const blockingSignalLabels: Record<string, string> = {
  functional_store: 'ettevõttel on juba toimiv e-pood',
  service_or_digital: 'põhitegevus ei ole sobiv füüsiliste toodete veebimüük',
  wholesale_only: 'ettevõte müüb ainult hulgiklientidele',
  larger_or_chain: 'tegu on suurema ettevõtte või ketiga',
  not_estonia: 'Eesti turul tegutsemine ei leidnud kinnitust',
  complex_quote_without_standard_products: 'müük vajab keerukat hinnapäringut ja tavatooteid ei leitud',
  missing_verification: 'värske kontrollitav allikas puudub',
  other_uncertainty: 'sobivus jäi värske kontrolli järel ebaselgeks',
}

const draftExclusionReason = (draft: VerifiedLeadDraftOutput) => {
  const messages = draft.blocking_signals.map((signal) => blockingSignalLabels[signal]).filter(Boolean)
  if (messages.length) return messages.join('; ')
  if (draft.current_qualification === 'review') return 'sobivus jäi värske kontrolli järel ebaselgeks'
  return 'ettevõte ei vasta värske kontrolli põhjal Poeruumi sihtrühmale'
}

const callOpenAI = async (payload: Record<string, unknown>) => {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requiredEnv('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
      'User-Agent': 'poeruum-lead-outreach/1.0',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(115_000),
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

      try {
        const safetyIdentifier = (await sha256(user.id)).slice(0, 64)
        const response = await callOpenAI({
          model,
          store: false,
          safety_identifier: safetyIdentifier,
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
          tool_choice: 'auto',
          max_tool_calls: 12,
          include: ['web_search_call.action.sources'],
          instructions: buildLeadSearchPrompt({ requestedLimit }),
          input: query,
          text: {
            verbosity: 'medium',
            format: {
              type: 'json_schema',
              name: 'poeruum_lead_research',
              description: 'Avalikest allikatest kontrollitud kvalifitseerimisfaktid, ilma kirjamustandita.',
              schema: leadResearchSchema,
              strict: true,
            },
          },
        })

        const parsed = JSON.parse(extractOutputText(response)) as LeadResearchOutput
        const sources = extractSources(response)
        const sourceKeys = new Set(sources.keys())
        let insertedCount = 0
        let eligibleCount = 0
        let reviewCount = 0
        let rejectedCount = 0
        const insertedLeads: Array<{ id: string; decision: 'eligible' | 'review' }> = []

        for (const candidate of (parsed.candidates ?? []).slice(0, requestedLimit)) {
          const companyName = textValue(candidate.company_name, 200)
          const websiteUrl = normalizePublicUrl(candidate.website_url)
          const domain = websiteDomain(websiteUrl)
          const sourceUrl = normalizePublicUrl(candidate.source_url)
          if (!companyName || !websiteUrl || !domain || !sourceUrl || !sourceMatches(sourceUrl, sourceKeys)) continue
          if (!domainsRelated(domain, websiteDomain(sourceUrl))) continue

          const siteChecks = verifiedSiteChecks(candidate.site_checks, sourceKeys, websiteUrl)
          if (siteChecks.length < 2) continue
          const hasCheck = (kind: LeadSiteCheck['kind']) => siteChecks.some((check) => check.kind === kind)
          const commerceCheckUrl = normalizePublicUrl(candidate.commerce_check_url)
          const hasCommerceCheck = Boolean(
            commerceCheckUrl
            && sourceMatches(commerceCheckUrl, sourceKeys)
            && siteChecks.some((check) => check.kind === 'commerce' && sourceKey(check.url) === sourceKey(commerceCheckUrl)),
          )
          const classifications = {
            market: hasCheck('market') ? candidate.market : 'unknown',
            business_size: hasCheck('business_size') ? candidate.business_size : 'unknown',
            product_type: hasCheck('product_type') ? candidate.product_type : 'unknown',
            sales_audience: hasCheck('sales_audience') ? candidate.sales_audience : 'unknown',
            commerce_status: hasCommerceCheck ? candidate.commerce_status : 'unknown',
            purchase_complexity: hasCheck('purchase_complexity') ? candidate.purchase_complexity : 'unknown',
            has_standard_products: hasCheck('standard_products') ? candidate.has_standard_products : null,
          }
          const qualification = assessLeadQualification(classifications)
          if (qualification.decision === 'reject') {
            rejectedCount += 1
            continue
          }

          const rawEmailSourceUrl = normalizePublicUrl(candidate.email_source_url)
          const emailSourceUrl = rawEmailSourceUrl && sourceMatches(rawEmailSourceUrl, sourceKeys)
            ? rawEmailSourceUrl
            : null
          const contactEmail = emailSourceUrl ? normalizeEmail(candidate.contact_email) : null
          const contactKind = classifyContactEmail(contactEmail)
          const qualificationRecord = {
            ...classifications,
            commerce_check_url: hasCommerceCheck ? commerceCheckUrl : null,
            decision: qualification.decision,
            score: qualification.score,
            issues: qualification.reasons.filter((reason) => reason.severity !== 'pass').map((reason) => reason.message),
            reasons: qualification.reasons,
            site_checks: siteChecks,
            prompt_version: LEAD_COPY_PROMPT_ID,
          }
          const fitReason = qualification.reasons.map((reason) => reason.message).join(' ')
          const evidence = textValue(candidate.evidence, 1200)
            || siteChecks.slice(0, 3).map((check) => check.finding).join(' ')

          const { data: lead, error: leadError } = await admin.from('sales_leads').insert({
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
            status: 'new',
            draft_subject: '',
            draft_body: '',
            created_by: user.id,
            updated_by: user.id,
          }).select('id').single()
          if (leadError?.code === '23505') continue
          if (leadError || !lead) throw leadError || new Error('Kontakti ei salvestatud.')
          insertedCount += 1
          if (qualification.decision === 'eligible') eligibleCount += 1
          else reviewCount += 1
          insertedLeads.push({ id: lead.id, decision: qualification.decision })
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
            },
          })))
          if (eventError) throw eventError
        }

        const foundCount = Array.isArray(parsed.candidates) ? parsed.candidates.length : 0
        const sourceList = [...sources.values()].slice(0, 60)
        const { error: completeError } = await admin.from('lead_search_runs').update({
          status: 'completed',
          openai_response_id: response.id ?? null,
          found_count: foundCount,
          inserted_count: insertedCount,
          source_count: sources.size,
          sources: sourceList,
          completed_at: new Date().toISOString(),
        }).eq('id', run.id)
        if (completeError) throw completeError

        return json({
          ok: true,
          search_run_id: run.id,
          found_count: foundCount,
          inserted_count: insertedCount,
          duplicate_or_rejected_count: Math.max(0, foundCount - insertedCount),
          eligible_count: eligibleCount,
          review_count: reviewCount,
          rejected_count: rejectedCount,
          source_count: sources.size,
        })
      } catch (error) {
        await admin.from('lead_search_runs').update({
          status: 'failed',
          error_message: errorMessage(error).slice(0, 1000),
          completed_at: new Date().toISOString(),
        }).eq('id', run.id)
        throw error
      }
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
        && contactMatchesWebsite(contactEmail, lead.website_url, emailSourceUrl)
        && qualification.decision === 'eligible'
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
        tool_choice: 'auto',
        max_tool_calls: 8,
        include: ['web_search_call.action.sources'],
        instructions: buildLeadDraftPrompt({ senderName }),
        input: JSON.stringify({
          company_name: lead.company_name,
          website_url: lead.website_url,
          source_url: lead.source_url,
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
      const sources = extractSources(response)
      const sourceKeys = new Set(sources.keys())
      const siteChecks = verifiedSiteChecks(draft.site_checks, sourceKeys, lead.website_url)
      const hasCheck = (kind: LeadSiteCheck['kind']) => siteChecks.some((check) => check.kind === kind)
      const commerceCheckUrl = normalizePublicUrl(draft.commerce_check_url)
      const hasCommerceCheck = Boolean(
        commerceCheckUrl
        && sourceMatches(commerceCheckUrl, sourceKeys)
        && siteChecks.some((check) => check.kind === 'commerce' && sourceKey(check.url) === sourceKey(commerceCheckUrl)),
      )
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
      const verificationUrl = normalizePublicUrl(draft.verification_url)
      const verificationIsUsable = Boolean(
        verificationUrl
        && sourceMatches(verificationUrl, sourceKeys)
        && domainsRelated(websiteDomain(lead.website_url), websiteDomain(verificationUrl)),
      )
      const verifiedObservation = textValue(draft.verified_observation, 500)
      const eligibleNow = draft.recommendation === 'send'
        && draft.current_qualification === 'eligible'
        && Array.isArray(draft.blocking_signals)
        && draft.blocking_signals.length === 0
        && freshQualification.decision === 'eligible'
        && verificationIsUsable
        && Boolean(verifiedObservation)
      const previousQualification = lead.qualification && typeof lead.qualification === 'object'
        ? lead.qualification as Record<string, unknown>
        : {}

      if (!eligibleNow) {
        const serverReasons = freshQualification.reasons
          .filter((item) => item.severity !== 'pass')
          .map((item) => item.message)
        const reason = !verificationIsUsable
          ? 'värske kontrollitav ettevõtteallikas puudub või ei vasta veebidomeenile'
          : serverReasons.length ? serverReasons.join(' ') : draftExclusionReason(draft)
        const quality = {
          passed: false,
          score: 0,
          issues: [reason],
          issue_codes: ['qualification_failed'],
          prompt_version: LEAD_COPY_PROMPT_ID,
        }
        const recheckDecision = freshQualification.decision === 'eligible'
          ? draft.current_qualification === 'reject' ? 'reject' : 'review'
          : freshQualification.decision
        const qualification = {
          ...previousQualification,
          ...classifications,
          commerce_check_url: hasCommerceCheck ? commerceCheckUrl : null,
          decision: recheckDecision,
          score: freshQualification.score,
          issues: [reason],
          reasons: freshQualification.reasons,
          site_checks: siteChecks,
          last_recheck: {
            decision: recheckDecision,
            blocking_signals: draft.blocking_signals,
            verification_url: verificationUrl,
            checked_at: new Date().toISOString(),
            prompt_version: LEAD_COPY_PROMPT_ID,
          },
        }
        const { data: updatedLead, error: updateError } = await admin.from('sales_leads').update({
          qualification,
          fit_score: recheckDecision === 'reject' ? 0 : Math.min(freshQualification.score, 40),
          fit_reason: reason,
          draft_quality: quality,
          draft_prompt_version: LEAD_COPY_PROMPT_ID,
          draft_openai_response_id: response.id ?? null,
          status: 'new',
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
          event_type: 'draft_excluded',
          details: {
            model,
            prompt_version: LEAD_COPY_PROMPT_ID,
            reason,
            blocking_signals: draft.blocking_signals,
          },
        })
        return json({ ok: true, excluded: true, reason, status: 'new', quality })
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
      const qualification = {
        ...previousQualification,
        ...classifications,
        commerce_check_url: commerceCheckUrl,
        decision: 'eligible',
        score: freshQualification.score,
        issues: [],
        reasons: freshQualification.reasons,
        site_checks: siteChecks,
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
        && contactMatchesWebsite(lead.contact_email, lead.website_url, lead.email_source_url)
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
      if (storedQuality.passed !== true || storedQualification.decision !== 'eligible') {
        return json({ error: 'Kiri peab enne saatmist läbima värske sobivus- ja kvaliteedikontrolli.' }, 409)
      }
      if (!contactMatchesWebsite(lead.contact_email, lead.website_url, lead.email_source_url)) {
        return json({ error: 'Üldkontakti domeen ja avalik kontaktiallikas peavad kuuluma ettevõtte veebidomeenile.' }, 409)
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
