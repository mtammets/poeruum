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

  it('starts a conversation with the written subject and preserves reply routing', () => {
    const email = buildSupportReplyEmail({ ...input, subject: '  Abi poe seadistamisel  ', isNewConversation: true })
    expect(email.subject).toBe('Abi poe seadistamisel')
    expect(email.reply_to).toBe(input.replyTo)
    expect(email.tags).toContainEqual({ name: 'conversation_id', value: input.conversationId })
    expect(email.text).toBe(input.body.trim())
  })
})
