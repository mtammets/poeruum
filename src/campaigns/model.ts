import { actionLabels, actionTimeline, campaignDuration, contentDuration, parsePhoneContent, type PhoneContent } from './phoneContent'
import { createRandomId } from '../lib/randomId'
import { campaignCopyLimits, parseCampaignBrief, type CampaignBrief, type CampaignCopy } from '../../supabase/functions/_shared/campaign-schema'
import { parseLayouts, type CampaignLayouts } from './layout'
import { phoneMotions, type PhoneMotion } from './motion'
export { campaignCopyLimits } from '../../supabase/functions/_shared/campaign-schema'
export type { CampaignCopy }

export const templates = [
  { id: 'phone', name: 'Telefon' },
  { id: 'products', name: 'Tooted' },
  { id: 'message', name: 'Tekst' },
] as const
export type Template = typeof templates[number]['id']
export type CampaignMedia = { src: string; alt: string; kind: 'screen' | 'photo' }
export type CampaignDocument = CampaignBrief & {
  version: 1; id: string; name: string; template: Template; copy: CampaignCopy; media: CampaignMedia[]; variation: number
  phoneContent?: PhoneContent
  phoneMotion?: PhoneMotion
  layouts?: CampaignLayouts
  endCopy?: { headline: string; slogan: string }
}
export const defaultMedia: CampaignMedia[] = [0, 1, 2].map((n) => ({
  src: `/campaigns/screen-${n}.jpg`, kind: 'screen',
  alt: ['Moreamoreceramicsi e-pood telefonis, sinine keraamiline alus', 'Moreamoreceramicsi e-pood telefonis, espressotass', 'Moreamoreceramicsi e-pood telefonis, keraamiline taldrik'][n],
}))

export function usesPhoneDemo(doc: CampaignDocument) {
  return !doc.phoneContent && doc.template === 'phone' && doc.media.every((media, i) => media.src === defaultMedia[i].src && media.kind === 'screen')
}

export function templateCopy(brief: CampaignBrief): CampaignCopy {
  const craft = /käsitöö|looj|disain/i.test(brief.audience)
  const signup = brief.goal === 'signup'
  const cta = signup ? 'Alusta tasuta' : 'Tutvu Poeruumiga'
  return {
    headlines: craft ? ['Sinu looming. Sinu pood.', 'Loo oma e-pood.', 'Anna loomingule oma kodu.'] : ['Loo oma e-pood.', 'Sinu pood. Sinu moodi.', 'Telefonist oma e-poeni.'],
    support: 'Loo, avalda ja halda oma e-poodi otse telefonist.', cta,
    captionShort: `Sinu e-pood. 10 minutiga. ${cta}.`,
    captionLong: `${craft ? 'Sinu looming väärib oma poodi.' : 'Oma e-poega alustamine võib olla lihtne.'} Poeruumis saad luua, avaldada ja hallata oma e-poodi otse telefonist. Lisa tooted ja kujunda pood enda nägu. ${cta}.`,
    adTitle: signup ? 'Sinu e-pood. 10 minutiga.' : 'Avasta Poeruumi võimalused',
  }
}
export function createCampaign(): CampaignDocument {
  const brief: CampaignBrief = { goal: 'signup', audience: 'Käsitöötegijad ja väiketootjad', brief: '', textAmount: 'minimal' }
  return { ...brief, version: 1, id: createRandomId(), name: 'Sinu looming. Sinu pood.', template: 'phone', copy: templateCopy(brief), media: structuredClone(defaultMedia), variation: 0 }
}
export function campaignSlug(name: string) {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'poeruum'
}
export function campaignLink(doc: CampaignDocument, medium = 'organic_social') {
  const url = new URL('https://poeruum.ee/')
  url.search = new URLSearchParams({ utm_source: 'instagram', utm_medium: medium, utm_campaign: `${campaignSlug(doc.name)}-${doc.id.slice(0, 8)}` }).toString()
  return url.href
}
export function validateCampaign(value: unknown, allowIncomplete = false): CampaignDocument | null {
  if (!value || typeof value !== 'object') return null
  const d = value as CampaignDocument
  if (d.phoneMotion !== undefined && !phoneMotions.some((motion) => motion.id === d.phoneMotion)) return null
  const phoneContent = d.phoneContent === undefined ? undefined : parsePhoneContent(d.phoneContent, allowIncomplete)
  if (phoneContent === null || new TextEncoder().encode(JSON.stringify(value)).length > 3_950_000) return null
  const brief = parseCampaignBrief(d), copy = parseDocumentCopy(d.copy), layouts = parseLayouts(d.layouts)
  if (!layouts || (d.endCopy !== undefined && (!d.endCopy || typeof d.endCopy.headline !== 'string' || typeof d.endCopy.slogan !== 'string' || d.endCopy.headline.length > 72 || d.endCopy.slogan.length > 72))) return null
  if (d.version !== 1 || !brief || !copy || typeof d.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(d.id)
    || typeof d.name !== 'string' || !d.name.trim() || d.name.length > 100
    || !templates.some((t) => t.id === d.template) || !Number.isInteger(d.variation) || d.variation < 0 || d.variation > 10000
    || !Array.isArray(d.media) || d.media.length !== 3
    || !d.media.every((m) => m && ['photo', 'screen'].includes(m.kind) && typeof m.alt === 'string' && m.alt.length <= 200
      && typeof m.src === 'string' && m.src.length < 1_200_000 && (Boolean(phoneContent?.snapshot.products.some((p) => m.src === `campaign-product:${p.id}`)) || /^\/campaigns\/screen-[012]\.jpg$/.test(m.src) || /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(m.src)))) return null
  return { version: 1, id: d.id, name: d.name.trim(), template: d.template, variation: d.variation, media: d.media, ...brief, copy,
    ...(phoneContent ? { phoneContent } : {}), ...(d.phoneMotion === undefined ? {} : { phoneMotion: d.phoneMotion }), ...(d.layouts === undefined ? {} : { layouts }), ...(d.endCopy === undefined ? {} : { endCopy: { headline: d.endCopy.headline, slogan: d.endCopy.slogan } }) }
}

// Authored drafts may intentionally omit copy. AI responses remain strict and
// use parseCampaignCopy on the generation boundary, not this document parser.
function parseDocumentCopy(value: unknown): CampaignCopy | null {
  if (!value || typeof value !== 'object') return null
  const copy = value as CampaignCopy
  if (!Array.isArray(copy.headlines) || copy.headlines.length !== 3 || !copy.headlines.every((text) => typeof text === 'string' && text.length <= 72)) return null
  for (const [key, max] of Object.entries(campaignCopyLimits)) if (typeof copy[key as keyof typeof campaignCopyLimits] !== 'string' || copy[key as keyof typeof campaignCopyLimits].length > max) return null
  return { headlines: copy.headlines.map((text) => text.trim()), ...Object.fromEntries(Object.keys(campaignCopyLimits).map((key) => [key, copy[key as keyof typeof campaignCopyLimits].trim()])) } as CampaignCopy
}
export function campaignText(doc: CampaignDocument) {
  const c = doc.copy
  const scenes = doc.template === 'phone' && doc.phoneContent ? actionTimeline(doc.phoneContent.actions).map((a) => `${a.start}–${a.end} s: ${actionLabels[a.type]} · ${doc.phoneContent!.snapshot.products.find((p) => p.id === a.productId)?.name}${a.query ? ` · ${a.query}` : ''}`).join('\n') : usesPhoneDemo(doc)
    ? '0–4,5 s: tootevaade, kerimine tooteinfo juurde ja tagasi\n4,5–7 s: toodete vahel libistamine\n7–9 s: toote pildigalerii'
    : `0–3 s: ${c.headlines[0]}\n3–6 s: teine toode / poevaade\n6–9 s: kolmas toode / poevaade`
  return `${doc.name}\n\nLÜHIKE POSTITUS\n${c.captionShort}\n${campaignLink(doc)}\n\nPIKEM POSTITUS\n${c.captionLong}\n${campaignLink(doc)}\n\nREKLAAM\n${c.adTitle}\n${c.captionShort}\n${c.cta}\n${campaignLink(doc, 'paid_social')}\n\nPILTIDE PEALKIRJAD\n${c.headlines.join('\n')}\n\nALTERNATIIVTEKSTID\n${doc.media.map((m, i) => `${i + 1}. ${c.headlines[i]} — ${m.alt}`).join('\n')}\n\nVIDEO ÜLESEHITUS\n${scenes}\n${contentDuration(doc)}–${campaignDuration(doc)} s: Poeruum. ${doc.endCopy?.headline ?? 'Sinu e-pood.'} ${doc.endCopy?.slogan ?? '10 minutiga.'} ${c.cta}.\n`
}
