import { describe, expect, it } from 'vitest'
import { campaignLink, campaignText, createCampaign, validateCampaign } from './model'
import { parseCampaignBrief, parseCampaignCopy } from '../../supabase/functions/_shared/campaign-schema'

describe('campaign documents', () => {
  it('creates a valid complete package and distinct, stable campaign attribution', () => {
    const doc = createCampaign(), next = createCampaign()
    expect(validateCampaign(doc)).toEqual(doc)
    const link = new URL(campaignLink(doc))
    expect(link.origin).toBe('https://poeruum.ee')
    expect(link.searchParams.get('utm_campaign')).not.toBe(new URL(campaignLink(next)).searchParams.get('utm_campaign'))
    expect(new URL(campaignLink(doc, 'paid_social')).searchParams.get('utm_medium')).toBe('paid_social')
    expect(campaignText(doc)).toContain(campaignLink(doc))
    expect(campaignText(doc)).toContain(doc.media[2].alt)
  })
  it('rejects remote image URLs, unsafe data, corrupt snapshots and overflowing text', () => {
    const doc = createCampaign()
    expect(validateCampaign({ ...doc, media: [{ ...doc.media[0], src: 'https://example.com/track' }, ...doc.media.slice(1)] })).toBeNull()
    expect(validateCampaign({ ...doc, media: [{ ...doc.media[0], src: 'data:image/svg+xml,<svg/>' }, ...doc.media.slice(1)] })).toBeNull()
    expect(validateCampaign({ ...doc, version: 2 })).toBeNull()
    expect(validateCampaign({ ...doc, copy: { ...doc.copy, cta: 'A'.repeat(29) } })).toBeNull()
    expect(validateCampaign({ ...doc, media: [] })).toBeNull()
  })
  it('validates the same AI copy contract on client and server', () => {
    const doc = createCampaign()
    expect(parseCampaignCopy(doc.copy)).toEqual(doc.copy)
    expect(parseCampaignCopy({ ...doc.copy, headlines: ['Üks'] })).toBeNull()
    expect(parseCampaignCopy({ ...doc.copy, support: '' })).toBeNull()
    expect(parseCampaignBrief({ ...doc, brief: 'a'.repeat(701) })).toBeNull()
    expect(parseCampaignBrief({ ...doc, audience: '' })).toBeNull()
    expect(parseCampaignBrief({ ...doc, goal: 'spam' })).toBeNull()
  })
})
