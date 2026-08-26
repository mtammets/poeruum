import { describe, expect, it } from 'vitest'
import {
  isLeadOptOutReply,
  renderLeadText,
} from '../../supabase/functions/_shared/lead-email'

const input = {
  body: 'Tere!\n\nMärkasin, et võtate keraamika tellimusi Instagrami kaudu.\n\nKas selline lahendus võiks sinu ettevõttele sobida?',
  senderName: 'Marek',
  emailSourceUrl: 'https://ettevote.ee/kontakt/',
  unsubscribeUrl: 'https://poeruum.ee/loobu/?token=12345678-1234-4234-8234-123456789abc',
}

describe('lead outreach email', () => {
  it('renders a plain personal email without duplicating an existing signature', () => {
    const text = renderLeadText({
      ...input,
      body: 'Tere!\n\n<script>alert("x")</script>\n\nParimat\nMarek\nPoeruum',
    })
    expect(text).toContain('<script>alert("x")</script>')
    expect(text.match(/Parimat/g)).toHaveLength(1)
    expect(text).toContain('Parimat\nMarek\nPoeruum\n\n—\nAvaliku kontakti allikas:')
  })

  it('appends a compact transparency footer after the personal signature', () => {
    const text = renderLeadText(input)
    expect(text).toContain(`${input.body}\n\nParimat\nMarek\nPoeruum · poeruum.ee`)
    expect(text.endsWith([
      '—',
      `Avaliku kontakti allikas: ${input.emailSourceUrl}`,
      `Kirjadest saab tasuta loobuda: vasta „ei soovi” või ava ${input.unsubscribeUrl}`,
    ].join('\n'))).toBe(true)
    expect(text).not.toContain('Poeruum on Animaator OÜ teenus.')
  })

  it('recognizes clear opt-out replies without treating ordinary replies as opt-outs', () => {
    expect(isLeadOptOutReply('Ei soovi, palun rohkem mitte kirjutada.')).toBe(true)
    expect(isLeadOptOutReply('Palun ärge enam saatke.')).toBe(true)
    expect(isLeadOptOutReply('Unsubscribe')).toBe(true)
    expect(isLeadOptOutReply('Aitäh, räägime järgmisel nädalal.')).toBe(false)
    expect(isLeadOptOutReply('Praegu ei ole õige aeg, aga kirjuta sügisel uuesti.')).toBe(false)
  })
})
