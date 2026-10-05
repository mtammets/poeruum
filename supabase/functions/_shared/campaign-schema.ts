export const campaignCopyLimits = { support: 110, cta: 28, captionShort: 400, captionLong: 1400, adTitle: 80 } as const
export type CampaignCopy = Record<keyof typeof campaignCopyLimits, string> & { headlines: string[] }
export type CampaignBrief = { goal: 'signup' | 'showcase'; audience: string; brief: string; textAmount: 'minimal' | 'standard' }

export function parseCampaignBrief(value: unknown): CampaignBrief | null {
  if (!value || typeof value !== 'object') return null
  const b = value as Record<string, unknown>
  if (!['signup', 'showcase'].includes(String(b.goal)) || !['minimal', 'standard'].includes(String(b.textAmount))
    || typeof b.audience !== 'string' || !b.audience.trim() || b.audience.length > 100
    || typeof b.brief !== 'string' || b.brief.length > 700) return null
  return { goal: b.goal as CampaignBrief['goal'], audience: b.audience.trim(), brief: b.brief.trim(), textAmount: b.textAmount as CampaignBrief['textAmount'] }
}

export function parseCampaignCopy(value: unknown): CampaignCopy | null {
  if (!value || typeof value !== 'object') return null
  const c = value as Record<string, unknown>
  if (!Array.isArray(c.headlines) || c.headlines.length !== 3
    || !c.headlines.every((s) => typeof s === 'string' && s.trim() && s.length <= 72)) return null
  for (const [key, limit] of Object.entries(campaignCopyLimits)) {
    if (typeof c[key] !== 'string' || !(c[key] as string).trim() || (c[key] as string).length > limit) return null
  }
  return { headlines: c.headlines.map((s) => s.trim()), ...Object.fromEntries(Object.keys(campaignCopyLimits).map((key) => [key, (c[key] as string).trim()])) } as CampaignCopy
}

export const campaignCopySchema = {
  type: 'object', additionalProperties: false,
  required: ['headlines', ...Object.keys(campaignCopyLimits)],
  properties: {
    headlines: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string', minLength: 1, maxLength: 72 } },
    ...Object.fromEntries(Object.entries(campaignCopyLimits).map(([key, maxLength]) => [key, { type: 'string', minLength: 1, maxLength }])),
  },
}
