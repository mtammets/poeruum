import { describe, expect, it, vi } from 'vitest'
import { campaignStatus, fromTallinnInput, nextCampaignBoundary, parseDirectoryCampaign, toTallinnInput, type DirectoryCampaign } from './directoryCampaign'
import { directoryPreviewTheme } from './directoryTheme'

vi.mock('./supabase', () => ({ requireSupabase: () => { throw new Error('No network in unit tests') } }))
const campaign: DirectoryCampaign = { mode: 'scheduled', startsAt: '2026-11-27T06:00:00Z', endsAt: '2026-11-30T22:00:00Z', revision: 1, serverNow: '2026-10-22T00:00:00Z' }

describe('campaign availability', () => {
  it('includes the exact start and excludes the exact end', () => {
    const start = Date.parse(campaign.startsAt!)
    const end = Date.parse(campaign.endsAt!)
    expect(campaignStatus(campaign, start - 1)).toBe('waiting')
    expect(campaignStatus(campaign, start)).toBe('active')
    expect(campaignStatus(campaign, end - 1)).toBe('active')
    expect(campaignStatus(campaign, end)).toBe('ended')
    expect(nextCampaignBoundary(campaign, start - 1)).toBe(start)
    expect(nextCampaignBoundary(campaign, start)).toBe(end)
    expect(nextCampaignBoundary(campaign, end)).toBeNull()
  })
  it('manual off overrides a running schedule; manual on overrides an expired one', () => {
    expect(campaignStatus({ ...campaign, mode: 'off' }, Date.parse(campaign.startsAt!))).toBe('off')
    expect(campaignStatus({ ...campaign, mode: 'on' }, Date.parse(campaign.endsAt!) + 1)).toBe('active')
    expect(campaignStatus(null, 0)).toBe('off')
  })
  it('rejects malformed or incomplete settings rather than enabling a campaign', () => {
    for (const value of [null, {}, { ...campaign, serverNow: 'wrong' }, { ...campaign, mode: 'unknown' },
      { ...campaign, startsAt: null }, { ...campaign, endsAt: campaign.startsAt }, { ...campaign, revision: -1 }]) {
      expect(() => parseDirectoryCampaign(value)).toThrow()
    }
    expect(parseDirectoryCampaign({ ...campaign, mode: 'off', startsAt: null, endsAt: null }).mode).toBe('off')
  })
  it('ignores production theme parameters unless an administrator was verified', () => {
    expect(directoryPreviewTheme('?theme=black-friday', false, false)).toBeNull()
    expect(directoryPreviewTheme('?theme=default', false, false)).toBeNull()
    expect(directoryPreviewTheme('?theme=black-friday', false, true)).toBe('black-friday')
    expect(directoryPreviewTheme('?theme=default', true, false)).toBe('default')
    expect(directoryPreviewTheme('', true, true)).toBeNull()
  })
})

describe('Estonian schedule times', () => {
  it('converts winter and summer independently of the machine timezone', () => {
    expect(fromTallinnInput('2026-11-27T08:00')).toBe('2026-11-27T06:00:00.000Z')
    expect(fromTallinnInput('2026-07-27T08:00')).toBe('2026-07-27T05:00:00.000Z')
    expect(toTallinnInput('2026-11-30T22:00:00Z')).toBe('2026-12-01T00:00')
  })
  it('rejects skipped and ambiguous hours at DST transitions', () => {
    expect(() => fromTallinnInput('2026-03-29T03:30')).toThrow('suveajale')
    expect(() => fromTallinnInput('2026-10-25T03:30')).toThrow('talveajale')
    expect(fromTallinnInput('2026-10-25T04:00')).toBe('2026-10-25T02:00:00.000Z')
  })
  it('rejects invalid dates without normalizing them into a different day', () => {
    for (const value of ['', '2026-02-30T08:00', '2026-11-27T24:30', '2026-11-27']) {
      expect(() => fromTallinnInput(value)).toThrow()
    }
  })
})
