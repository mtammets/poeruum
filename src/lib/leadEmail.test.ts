import { describe, expect, it } from 'vitest'
import {
  isLeadOptOutReply,
  renderLeadEmail,
  renderLeadText,
} from '../../supabase/functions/_shared/lead-email'

const input = {
  body: 'Tere!\n\nMärkasin, et võtate keraamika tellimusi Instagrami kaudu.\n\nKas soovid, et teeksin ühe näidisvaate?',
  senderName: 'Marek',
  appUrl: 'https://poeruum.ee',
}

describe('lead outreach email', () => {
  it('looks like an ordinary personal email instead of a campaign card', () => {
    const html = renderLeadEmail(input)
    expect(html).toContain('Märkasin, et võtate keraamika tellimusi Instagrami kaudu.')
    expect(html).toContain('Parimat<br>Marek')
    expect(html).toContain('Poeruum · poeruum.ee')
    expect(html).toContain('vasta sellele kirjale „ei soovi”')
    expect(html).not.toContain('poeruum-email-logo')
    expect(html).not.toContain('background:#f1efe9')
    expect(html).not.toContain('border-radius')
    expect(html).not.toContain('List-Unsubscribe')
  })

  it('escapes untrusted draft content and does not duplicate an existing signature', () => {
    const html = renderLeadEmail({
      ...input,
      body: 'Tere!\n\n<script>alert("x")</script>\n\nParimat\nMarek\nPoeruum',
    })
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')
    expect(html).not.toContain('<script>alert')
    expect(html.match(/Parimat/g)).toHaveLength(1)
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
