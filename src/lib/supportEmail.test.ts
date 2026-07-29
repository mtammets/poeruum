import { describe, expect, it } from 'vitest'
import { buildSupportReplyEmail } from '../../supabase/functions/_shared/support-email'

const input = {
  from: 'Marek Tammets | Poeruum <teavitused@send.poeruum.ee>',
  recipientEmail: 'klient@example.com',
  replyTo: 'vastus+123@example.com',
  subject: '[NÄIDIS 5] Tellimused ühte e-poodi',
  body: '  Tere!\n\nAitäh vastuse eest.  ',
  conversationId: '00000000-0000-4000-8000-000000000000',
}

describe('manual support reply email', () => {
  it('sends exactly the written reply as plain text without a campaign frame', () => {
    const email = buildSupportReplyEmail(input)
    expect(email.text).toBe('Tere!\n\nAitäh vastuse eest.')
    expect(email.subject).toBe('Re: [NÄIDIS 5] Tellimused ühte e-poodi')
    expect(email.from).toBe(input.from)
    expect(email).not.toHaveProperty('html')
  })

  it('does not add a second reply prefix', () => {
    const email = buildSupportReplyEmail({ ...input, subject: 'Re: Olemasolev vestlus' })
    expect(email.subject).toBe('Re: Olemasolev vestlus')
  })
})
