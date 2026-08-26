import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  STRIPE_REQUIREMENT_ACTION_URL,
  renderStripeRequirementEmail,
} from '../_shared/stripe-requirement-email.mjs'
import { captureEdgeError } from '../_shared/security.ts'

type StripeRequirementEmailClaim = {
  notification_id: string
  store_id: string
  email: string
  store_name: string
  kind: 'action_required' | 'deadline_7d' | 'deadline_1d'
  deadline: string | null
  due_count: number
  past_due: boolean
  disabled: boolean
}

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Puudub ${name}.`)
  return value
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

const isEnabled = () => Deno.env.get('STRIPE_REQUIREMENT_EMAILS_ENABLED')?.trim().toLowerCase() === 'true'

const getActionUrl = () => {
  const appUrl = new URL(requiredEnv('APP_URL'))
  if (appUrl.protocol !== 'https:' || !['poeruum.ee', 'www.poeruum.ee'].includes(appUrl.hostname)) {
    throw new Error('APP_URL peab viitama HTTPS Poeruumi tootmisaadressile.')
  }
  return STRIPE_REQUIREMENT_ACTION_URL
}

const sendEmail = async (claim: StripeRequirementEmailClaim) => {
  const renderedKind = claim.disabled
    ? 'disabled'
    : claim.past_due ? 'past_due' : claim.kind
  const email = renderStripeRequirementEmail({
    kind: renderedKind,
    storeName: claim.store_name,
    deadline: claim.deadline,
    actionUrl: getActionUrl(),
    requirements: {
      dueCount: claim.due_count,
      pastDue: claim.past_due,
      disabledReason: claim.disabled ? 'restricted' : null,
    },
  })
  if (!email) throw new Error('Teavituse claim ei sisalda tegevust nõudvat Stripe’i olekut.')

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requiredEnv('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
      'User-Agent': 'poeruum-stripe-requirement-notifications/1.0',
      'Idempotency-Key': `stripe-requirement-${claim.notification_id}-${claim.kind}`,
    },
    body: JSON.stringify({
      from: Deno.env.get('RESEND_FROM_EMAIL')?.trim() || 'Poeruum <teavitused@send.poeruum.ee>',
      to: [claim.email],
      subject: email.subject,
      html: email.html,
      text: email.text,
      tags: [
        { name: 'email_type', value: `stripe_requirement_${claim.kind}` },
        { name: 'store_id', value: claim.store_id },
        { name: 'notification_id', value: claim.notification_id },
      ],
    }),
  })
  if (!response.ok) throw new Error(`Resend vastas ${response.status}: ${await response.text()}`)
  const result = await response.json() as { id?: unknown }
  if (typeof result.id !== 'string' || !result.id) throw new Error('Resendi vastusest puudub e-kirja ID.')
  return result.id
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (request.headers.get('Authorization') !== `Bearer ${requiredEnv('ONBOARDING_CRON_SECRET')}`) {
    return json({ error: 'Unauthorized' }, 401)
  }
  if (!isEnabled()) return json({ enabled: false, sent: 0, failed: 0 })

  const admin = createClient(
    requiredEnv('SUPABASE_URL'),
    requiredEnv('POERUUM_SUPABASE_SECRET_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  let sent = 0
  let failed = 0

  for (let index = 0; index < 50; index += 1) {
    const { data, error } = await admin.rpc('claim_stripe_requirement_notification')
    if (error) {
      await captureEdgeError('stripe-requirement-notifications', error, {}, 'critical')
      return json({ error: 'Stripe’i teavituse claim ebaõnnestus.', sent, failed }, 500)
    }
    const claim = (data?.[0] ?? null) as StripeRequirementEmailClaim | null
    if (!claim) break

    try {
      await sendEmail(claim)
      const { data: completed, error: completeError } = await admin.rpc('complete_stripe_requirement_notification', {
        target_notification_id: claim.notification_id,
      })
      if (completeError) throw completeError
      if (completed !== true) throw new Error('Stripe’i teavituse claimi lõpetamine ei muutnud ühtegi rida.')
      sent += 1
    } catch (error) {
      failed += 1
      await captureEdgeError('stripe-requirement-notifications', error, {
        store_id: claim.store_id,
        notification_kind: claim.kind,
      }, 'critical')
      console.error(`Stripe’i nõuete teavitus poe ${claim.store_id} jaoks ebaõnnestus.`, error)
      await admin.rpc('release_stripe_requirement_notification', {
        target_notification_id: claim.notification_id,
      })
    }
  }

  return json({ enabled: true, sent, failed }, failed ? 500 : 200)
})
