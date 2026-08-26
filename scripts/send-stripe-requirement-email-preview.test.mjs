import { describe, expect, it, vi } from 'vitest'
import {
  STRIPE_REQUIREMENT_PREVIEW_IDEMPOTENCY_KEY,
  STRIPE_REQUIREMENT_PREVIEW_RECIPIENT,
  STRIPE_REQUIREMENT_PREVIEW_TAG,
  buildStripeRequirementPreviewRequest,
  sendStripeRequirementEmailPreview,
} from './send-stripe-requirement-email-preview.mjs'

describe('Stripe requirement email preview sender', () => {
  it('is hard-locked to Marek and rejects every other recipient before fetching', async () => {
    const fetchImpl = vi.fn()
    await expect(sendStripeRequirementEmailPreview({
      recipient: 'kaupmees@example.com',
      apiKey: 're_test',
      fetchImpl,
    })).rejects.toThrow(STRIPE_REQUIREMENT_PREVIEW_RECIPIENT)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('builds a single-recipient request without cc or bcc', () => {
    const request = buildStripeRequirementPreviewRequest({
      recipient: STRIPE_REQUIREMENT_PREVIEW_RECIPIENT,
      apiKey: 're_test',
    })
    const body = JSON.parse(request.options.body)

    expect(request.url).toBe('https://api.resend.com/emails')
    expect(request.options.headers['Idempotency-Key']).toBe(STRIPE_REQUIREMENT_PREVIEW_IDEMPOTENCY_KEY)
    expect(body.to).toEqual([STRIPE_REQUIREMENT_PREVIEW_RECIPIENT])
    expect(body).not.toHaveProperty('cc')
    expect(body).not.toHaveProperty('bcc')
    expect(body.subject).toMatch(/^\[Eelvaade\]/)
    expect(body.subject).toContain('Poeruumi testpood')
    expect(body.html).toContain('https://poeruum.ee/?stripe_requirements=1')
    expect(body.tags).toEqual([STRIPE_REQUIREMENT_PREVIEW_TAG])
  })

  it('makes exactly one Resend request and never retries', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    await sendStripeRequirementEmailPreview({
      recipient: STRIPE_REQUIREMENT_PREVIEW_RECIPIENT,
      apiKey: 're_test',
      fetchImpl,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
