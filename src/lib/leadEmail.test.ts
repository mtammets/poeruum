import { describe, expect, it } from 'vitest'
import {
  isLeadOptOutReply,
  renderLeadText,
} from '../../supabase/functions/_shared/lead-email'

const input = {
  body: 'Tere!\n\nMärkasin, et võtate keraamika tellimusi Instagrami kaudu.\n\nKas soovid, et teeksin ühe näidisvaate?',
  senderName: 'Marek',
}

describe('lead outreach email', () => {
  it('renders a plain personal email without duplicating an existing signature', () => {
    const text = renderLeadText({
      ...input,
      body: 'Tere!\n\n<script>alert("x")</script>\n\nParimat\nMarek\nPoeruum',
    })
    expect(text).toContain('<script>alert("x")</script>')
    expect(text.match(/Parimat/g)).toHaveLength(1)
  })

  it('ends after the personal signature without a campaign footer', () => {
    const text = renderLeadText(input)
    expect(text).toMatch(/Parimat\nMarek\nPoeruum · poeruum\.ee$/)
    expect(text).not.toContain('Poeruum on Animaator OÜ teenus.')
    expect(text).not.toContain('vasta sellele kirjale „ei soovi”')
  })

  it('recognizes clear opt-out replies without treating ordinary replies as opt-outs', () => {
    expect(isLeadOptOutReply('Ei soovi, palun rohkem mitte kirjutada.')).toBe(true)
    expect(isLeadOptOutReply('Palun ärge enam saatke.')).toBe(true)
    expect(isLeadOptOutReply('Unsubscribe')).toBe(true)
    expect(isLeadOptOutReply('Aitäh, räägime järgmisel nädalal.')).toBe(false)
    expect(isLeadOptOutReply('Praegu ei ole õige aeg, aga kirjuta sügisel uuesti.')).toBe(false)
  })
})
