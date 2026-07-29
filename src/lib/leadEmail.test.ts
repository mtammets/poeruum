import { describe, expect, it } from 'vitest'
import {
  isLeadOptOutReply,
  renderLeadText,
} from '../../supabase/functions/_shared/lead-email'

const input = {
  body: 'Tere!\n\nMärkasin, et võtate keraamika tellimusi Instagrami kaudu.\n\nKas soovid, et teeksin ühe näidisvaate?',
  senderName: 'Marek',
  appUrl: 'https://poeruum.ee',
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

  it('provides the same personal signature and reply opt-out in plain text', () => {
    const text = renderLeadText(input)
    expect(text).toContain('Parimat\nMarek\nPoeruum · poeruum.ee')
    expect(text).toContain('vasta sellele kirjale „ei soovi”')
  })

  it('recognizes clear opt-out replies without treating ordinary replies as opt-outs', () => {
    expect(isLeadOptOutReply('Ei soovi, palun rohkem mitte kirjutada.')).toBe(true)
    expect(isLeadOptOutReply('Palun ärge enam saatke.')).toBe(true)
    expect(isLeadOptOutReply('Unsubscribe')).toBe(true)
    expect(isLeadOptOutReply('Aitäh, räägime järgmisel nädalal.')).toBe(false)
    expect(isLeadOptOutReply('Praegu ei ole õige aeg, aga kirjuta sügisel uuesti.')).toBe(false)
  })
})
