import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  verify: vi.fn(),
  recordOrderEmailEvent: vi.fn(),
  captureEdgeError: vi.fn(),
}))

vi.mock('npm:@supabase/supabase-js@2', () => ({ createClient: mocks.createClient }))
vi.mock('npm:resend@^6.18.0', () => ({
  Resend: class {
    webhooks = { verify: mocks.verify }
  },
}))
vi.mock('../_shared/lead-email.ts', () => ({ isLeadOptOutReply: vi.fn() }))
vi.mock('../_shared/security.ts', () => ({ captureEdgeError: mocks.captureEdgeError }))
vi.mock('../_shared/order-email-queue.ts', () => ({ recordOrderEmailEvent: mocks.recordOrderEmailEvent }))

let handleRequest: (request: Request) => Promise<Response>
let environment: Record<string, string>
const from = vi.fn()
const receiptInsert = vi.fn()
const deliveryUpsert = vi.fn()
const supportUpdate = vi.fn()

beforeEach(async () => {
  vi.resetAllMocks()
  vi.resetModules()
  environment = {
    RESEND_API_KEY: 'test-api-key',
    RESEND_WEBHOOK_SECRET: 'test-webhook-secret',
    SUPABASE_URL: 'https://example.supabase.co',
    POERUUM_SUPABASE_SECRET_KEY: 'test-secret',
  }
  vi.stubGlobal('Deno', {
    env: { get: (name: string) => environment[name] },
    serve: (handler: typeof handleRequest) => { handleRequest = handler },
  })
  mocks.verify.mockImplementation(({ payload }) => JSON.parse(payload))
  mocks.createClient.mockReturnValue({ from })
  mocks.recordOrderEmailEvent.mockResolvedValue(false)
  receiptInsert.mockResolvedValue({ error: null })
  deliveryUpsert.mockResolvedValue({ error: null })
  supportUpdate.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
  from.mockImplementation((table: string) => {
    if (table === 'resend_webhook_events') return { insert: receiptInsert }
    if (table === 'email_deliveries') return { upsert: deliveryUpsert }
    if (table === 'support_messages') return { update: supportUpdate }
    throw new Error(`Unexpected database access: ${table}`)
  })
  await import('./index.ts')
})

afterEach(() => vi.unstubAllGlobals())

const invoke = (sender: unknown, type = 'email.delivered', data: Record<string, unknown> = {}) => handleRequest(new Request(
  'https://example.supabase.co/functions/v1/resend-webhook',
  {
    method: 'POST',
    headers: { 'svix-id': 'event-id', 'svix-timestamp': '123', 'svix-signature': 'test-signature' },
    body: JSON.stringify({
      type,
      created_at: '2026-09-23T19:00:00Z',
      data: {
        email_id: 'email-id',
        from: sender,
        to: ['user@example.com'],
        subject: 'Test letter',
        ...data,
      },
    }),
  },
))

describe('Resend webhook application isolation', () => {
  it.each([
    ['Poeruum <invite@forms.siirus.ee>', 'email.delivered'],
    ['teavitused@send.poeruum.ee.evil.example', 'email.bounced'],
    [undefined, 'email.sent'],
    ['invalid', 'email.complained'],
    ['other@example.com', 'email.delivery_delayed'],
    ['other@example.com', 'email.suppressed'],
    ['other@example.com', 'email.opened'],
  ])('ignores foreign or malformed %s / %s before every database handler', async (sender, type) => {
    const response = await invoke(sender, type, {
      tags: { email_type: 'order_customer_confirmation', order_id: 'claimed-order-id' },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, ignored: 'Foreign or invalid sender' })
    expect(mocks.verify).toHaveBeenCalledOnce()
    expect(mocks.createClient).not.toHaveBeenCalled()
    expect(mocks.recordOrderEmailEvent).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
    expect(mocks.captureEdgeError).not.toHaveBeenCalled()
  })

  it('keeps authentication emails without tags and persists verified origin', async () => {
    const response = await invoke('Poeruum <TEAVITUSED@SEND.POERUUM.EE>')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(deliveryUpsert).toHaveBeenCalledWith(expect.objectContaining({
      resend_email_id: 'email-id',
      sender_email: 'teavitused@send.poeruum.ee',
      source_application: 'poeruum',
      email_type: null,
      status: 'delivered',
    }), { onConflict: 'resend_email_id' })
  })

  it.each(['RESEND_FROM_EMAIL', 'OUTREACH_FROM_EMAIL', 'SUPPORT_AGENT_FROM_EMAIL'])(
    'uses the exact configured mailbox from %s',
    async (setting) => {
      environment[setting] = 'Poeruumi tugi <abi@poeruum.ee>'
      expect((await invoke('Store display name <ABI@POERUUM.EE>')).status).toBe(200)
      expect(deliveryUpsert).toHaveBeenCalledWith(expect.objectContaining({
        sender_email: 'abi@poeruum.ee',
        source_application: 'poeruum',
      }), expect.anything())
    },
  )

  it('passes accepted order delivery events to the existing order handler', async () => {
    mocks.recordOrderEmailEvent.mockResolvedValue(true)
    expect((await invoke('teavitused@send.poeruum.ee')).status).toBe(200)
    expect(mocks.recordOrderEmailEvent).toHaveBeenCalledOnce()
    expect(receiptInsert).not.toHaveBeenCalled()
    expect(deliveryUpsert).not.toHaveBeenCalled()
  })

  it('preserves incoming support email handling for outside senders', async () => {
    const response = await invoke('customer@example.com', 'email.received')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, ignored: 'Unknown recipient' })
    expect(mocks.createClient).toHaveBeenCalledOnce()
    expect(receiptInsert).toHaveBeenCalledOnce()
    expect(deliveryUpsert).not.toHaveBeenCalled()
  })
})
