import { describe, expect, it } from 'vitest'
import { isPoeruumSender, normalizeSenderEmail } from './email-source.mjs'

describe('email sender origin', () => {
  it.each([
    'teavitused@send.poeruum.ee',
    ' Poeruum <TEAVITUSED@SEND.POERUUM.EE> ',
    '"Kinnita oma Poeruumi konto" <teavitused@send.poeruum.ee>',
    '"Poeruum, klienditugi" <teavitused@send.poeruum.ee>',
    'Some other display name <teavitused@send.poeruum.ee>',
  ])('recognizes the authentication sender without depending on tags or display name: %s', (value) => {
    expect(normalizeSenderEmail(value)).toBe('teavitused@send.poeruum.ee')
    expect(isPoeruumSender(value)).toBe(true)
  })

  it.each([
    'Siirus <kutse@forms.siirus.ee>',
    'Poeruum <hello@lorienvelmore.com>',
    'teavitused@send.poeruum.ee <foreign@example.com>',
    'teavitused@send.poeruum.ee.evil.example',
    'teavitused@evil-send.poeruum.ee',
    'other@send.poeruum.ee',
    'teavitused+other-app@send.poeruum.ee',
  ])('rejects another application or mailbox: %s', (value) => {
    expect(isPoeruumSender(value)).toBe(false)
  })

  it.each([
    undefined, null, '', ' ', 123, {}, ['teavitused@send.poeruum.ee'],
    'Poeruum', 'teavitused@', '@send.poeruum.ee', 'teavitused@@send.poeruum.ee',
    'teavitused@send..poeruum.ee', 'teavitused@-send.poeruum.ee',
    'teavi tused@send.poeruum.ee', 'teavitused@send.poeruum.ee.',
    'Poeruum <teavitused@send.poeruum.ee> trailing text',
    'Poeruum <teavitused@send.poeruum.ee>, Other <other@example.com>',
    'foreign@example.com, <teavitused@send.poeruum.ee>',
    'Poeruum; <teavitused@send.poeruum.ee>',
    '<teavitused@send.poeruum.ee', 'teavitused@send.poeruum.ee>',
    'teavitused@send.poeruum.ee\r\nBcc: other@example.com',
  ])('fails closed for absent or malformed senders: %j', (value) => {
    expect(normalizeSenderEmail(value)).toBeNull()
    expect(isPoeruumSender(value)).toBe(false)
  })

  it('accepts only the exact configured mailbox after normalization', () => {
    const configured = ['Poeruumi klienditugi <ABI@POERUUM.EE>', '', 'invalid']
    expect(isPoeruumSender('Store name <abi@poeruum.ee>', configured)).toBe(true)
    expect(isPoeruumSender('other@poeruum.ee', configured)).toBe(false)
    expect(isPoeruumSender('abi@poeruum.ee.evil.example', configured)).toBe(false)
    expect(isPoeruumSender('teavitused@send.poeruum.ee', configured)).toBe(true)
  })
})
