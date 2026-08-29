import { describe, expect, it } from 'vitest'
import {
  classifyOutreachEmail,
  isOutreachActivityCode,
  normalizeOutreachWebsite,
  selectOutreachEmail,
} from './outreach-candidate.mjs'

describe('outreach candidate filtering', () => {
  it('accepts general company mailboxes', () => {
    expect(classifyOutreachEmail('INFO@Näide.ee', 'Näide OÜ').eligible).toBe(true)
    expect(classifyOutreachEmail('kontakt@naide.ee', 'Näide OÜ').reason).toBe('general')
  })

  it('accepts public brand mailboxes, including business Gmail', () => {
    expect(classifyOutreachEmail('4room@4room.ee', '4ROOM OÜ', ['www.4room.ee']).eligible).toBe(true)
    expect(classifyOutreachEmail('12voltipood@gmail.com', '12Volti OÜ', ['www.12volti.ee']).eligible).toBe(true)
    expect(classifyOutreachEmail('etnoehe@gmail.com', 'Etnoehe OÜ').eligible).toBe(true)
  })

  it('rejects named and unclear personal mailboxes', () => {
    expect(classifyOutreachEmail('gilbert.hasballa@gmail.com', '2design OÜ', ['viralcontent.design']).reason).toBe('personal_name')
    expect(classifyOutreachEmail('a.vavilov@gmail.com', '4Steps Group OÜ', ['4steps.ee']).eligible).toBe(false)
    expect(classifyOutreachEmail('tarmo@7element.ee', '7ELEMENT OÜ', ['7element.ee']).eligible).toBe(false)
    expect(classifyOutreachEmail('oskarkadaksoo@gmail.com', '99GADGETS OÜ', ['spinners.ee']).eligible).toBe(false)
  })

  it('selects the strongest company contact', () => {
    const selected = selectOutreachEmail(
      ['mari@naide.ee', 'info@naide.ee', 'naide@gmail.com'],
      'Näide OÜ',
      ['https://naide.ee'],
    )
    expect(selected).toMatchObject({ email: 'info@naide.ee', reason: 'general' })
  })

  it('limits activity codes to product manufacturing and retail', () => {
    expect(isOutreachActivityCode('16231')).toBe(true)
    expect(isOutreachActivityCode('47911')).toBe(true)
    expect(isOutreachActivityCode('62011')).toBe(false)
    expect(isOutreachActivityCode('46901')).toBe(false)
  })

  it('normalizes bare registry websites', () => {
    expect(normalizeOutreachWebsite('www.naide.ee')).toBe('https://www.naide.ee/')
    expect(normalizeOutreachWebsite('not a url')).toBeNull()
  })
})
