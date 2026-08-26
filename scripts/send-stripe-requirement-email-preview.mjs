import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { config } from 'dotenv'
import {
  STRIPE_REQUIREMENT_ACTION_URL,
  renderStripeRequirementEmail,
} from '../supabase/functions/_shared/stripe-requirement-email.mjs'

export const STRIPE_REQUIREMENT_PREVIEW_RECIPIENT = 'marek@tammets.ee'
export const STRIPE_REQUIREMENT_PREVIEW_IDEMPOTENCY_KEY = 'preview-stripe-requirement-marek-20260826-v1'
export const STRIPE_REQUIREMENT_PREVIEW_TAG = Object.freeze({
  name: 'email_type',
  value: 'preview_stripe_requirement',
})

const normalizeRecipient = (value) => String(value ?? '').trim().toLowerCase()

export const buildStripeRequirementPreviewRequest = ({ recipient, apiKey }) => {
  const normalizedRecipient = normalizeRecipient(recipient)
  if (normalizedRecipient !== STRIPE_REQUIREMENT_PREVIEW_RECIPIENT) {
    throw new Error(`Eelvaate ainus lubatud saaja on ${STRIPE_REQUIREMENT_PREVIEW_RECIPIENT}.`)
  }
  const normalizedApiKey = String(apiKey ?? '').trim()
  if (!normalizedApiKey) throw new Error('Puudub RESEND_API_KEY.')

  const email = renderStripeRequirementEmail({
    kind: 'action_required',
    storeName: 'Poeruumi testpood',
    deadline: '2026-10-09T00:00:00.000Z',
    actionUrl: STRIPE_REQUIREMENT_ACTION_URL,
    preview: true,
    requirements: {
      dueCount: 1,
      pastDue: false,
      pendingVerification: false,
      disabledReason: null,
    },
  })
  if (!email) throw new Error('Stripe’i nõuete eelvaate koostamine ebaõnnestus.')

  return {
    url: 'https://api.resend.com/emails',
    options: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${normalizedApiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'poeruum-stripe-requirement-preview/1.0',
        'Idempotency-Key': STRIPE_REQUIREMENT_PREVIEW_IDEMPOTENCY_KEY,
      },
      body: JSON.stringify({
        from: 'Poeruum <teavitused@send.poeruum.ee>',
        to: [STRIPE_REQUIREMENT_PREVIEW_RECIPIENT],
        subject: email.subject,
        html: email.html,
        text: email.text,
        tags: [STRIPE_REQUIREMENT_PREVIEW_TAG],
      }),
    },
  }
}

export const sendStripeRequirementEmailPreview = async ({ recipient, apiKey, fetchImpl = fetch }) => {
  const request = buildStripeRequirementPreviewRequest({ recipient, apiKey })
  const response = await fetchImpl(request.url, request.options)
  if (!response.ok) {
    throw new Error(`Resend vastas ${response.status}: ${await response.text()}`)
  }
}

const isMainModule = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMainModule) {
  config({ path: '.env', quiet: true })
  if (process.argv.length !== 3) {
    throw new Error(`Kasutus: npm run supabase:stripe-requirement-email:preview -- ${STRIPE_REQUIREMENT_PREVIEW_RECIPIENT}`)
  }
  await sendStripeRequirementEmailPreview({
    recipient: process.argv[2],
    apiKey: process.env.RESEND_API_KEY,
  })
  console.log(`Stripe’i nõuete eelvaade saadeti aadressile ${STRIPE_REQUIREMENT_PREVIEW_RECIPIENT}.`)
}
