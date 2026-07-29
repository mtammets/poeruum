export type SupportReplyEmailInput = {
  from: string
  recipientEmail: string
  replyTo: string
  subject: string
  body: string
  conversationId: string
}

const replySubject = (value: string) => {
  const subject = value.trim()
  return /^re\s*:/iu.test(subject) ? subject : `Re: ${subject}`
}

export const buildSupportReplyEmail = (input: SupportReplyEmailInput) => ({
  from: input.from,
  to: [input.recipientEmail],
  reply_to: input.replyTo,
  subject: replySubject(input.subject),
  text: input.body.trim(),
  tags: [
    { name: 'email_type', value: 'support_reply' },
    { name: 'conversation_id', value: input.conversationId },
  ],
})
