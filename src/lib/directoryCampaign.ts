import { requireSupabase } from './supabase'

export type CampaignMode = 'off' | 'on' | 'scheduled'
export type DirectoryCampaign = {
  mode: CampaignMode
  startsAt: string | null
  endsAt: string | null
  revision: number
  serverNow: string
}

export function parseDirectoryCampaign(value: unknown): DirectoryCampaign {
  const data = value as Partial<DirectoryCampaign> | null
  const validDate = (date: unknown) => typeof date === 'string' && Number.isFinite(Date.parse(date))
  if (!data || !['off', 'on', 'scheduled'].includes(data.mode ?? '')
    || !Number.isSafeInteger(data.revision) || data.revision! < 0 || !validDate(data.serverNow)
    || (data.startsAt !== null && !validDate(data.startsAt))
    || (data.endsAt !== null && !validDate(data.endsAt))
    || (data.mode === 'scheduled' && (!data.startsAt || !data.endsAt || Date.parse(data.endsAt) <= Date.parse(data.startsAt)))) {
    throw new Error('Kampaania seadistust ei õnnestunud laadida.')
  }
  return data as DirectoryCampaign
}

export function campaignStatus(campaign: DirectoryCampaign | null, now: number): 'off' | 'active' | 'waiting' | 'ended' {
  if (!campaign || campaign.mode === 'off') return 'off'
  if (campaign.mode === 'on') return 'active'
  if (now < Date.parse(campaign.startsAt!)) return 'waiting'
  return now < Date.parse(campaign.endsAt!) ? 'active' : 'ended'
}

export function nextCampaignBoundary(campaign: DirectoryCampaign | null, now: number): number | null {
  if (campaign?.mode !== 'scheduled') return null
  return [Date.parse(campaign.startsAt!), Date.parse(campaign.endsAt!)].find(time => time > now) ?? null
}

const tallinnFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Tallinn', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
export function toTallinnInput(iso: string | null): string {
  if (!iso) return ''
  const parts = Object.fromEntries(tallinnFormat.formatToParts(new Date(iso)).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

// Resolve wall time in Estonia, independently of the administrator's device timezone.
// Reject the missing/repeated hour at DST changes instead of silently choosing a time.
export function fromTallinnInput(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Sisesta kuupäev ja kellaaeg.')
  const wall = Date.parse(`${value}:00Z`)
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 16) !== value) throw new Error('Kuupäev või kellaaeg ei sobi.')
  const offsets = new Set([-86400000, 0, 86400000].map(delta => {
    const instant = wall + delta
    return Date.parse(`${toTallinnInput(new Date(instant).toISOString())}:00Z`) - instant
  }))
  const candidates = [...offsets].map(offset => new Date(wall - offset).toISOString())
    .filter(iso => toTallinnInput(iso) === value)
  if (candidates.length !== 1) throw new Error(candidates.length
    ? 'See kellaaeg kordub talveajale üleminekul. Vali üheselt mõistetav kellaaeg.'
    : 'Seda kellaaega suveajale üleminekul ei ole. Vali teine kellaaeg.')
  return candidates[0]
}

export async function loadDirectoryCampaign(signal?: AbortSignal): Promise<DirectoryCampaign> {
  const query = requireSupabase().rpc('get_directory_campaign')
  const { data, error } = await (signal ? query.abortSignal(signal) : query)
  if (error) throw new Error('Kampaania seadistust ei õnnestunud laadida.')
  return parseDirectoryCampaign(data)
}

export class DirectoryCampaignConflict extends Error {
  constructor() { super('Kampaania seadistus on vahepeal muutunud. Laadi salvestatud seadistus ja proovi uuesti.') }
}

export async function saveDirectoryCampaign(campaign: Pick<DirectoryCampaign, 'mode' | 'startsAt' | 'endsAt' | 'revision'>) {
  const { data, error } = await requireSupabase().rpc('admin_set_directory_campaign', {
    next_mode: campaign.mode, next_starts_at: campaign.startsAt, next_ends_at: campaign.endsAt, expected_revision: campaign.revision,
  })
  if (error?.code === '40001') throw new DirectoryCampaignConflict()
  if (error) throw new Error(error.code === '42501' ? 'Kampaania muutmiseks on vaja administraatori õigusi.'
    : error.code === '22023' ? 'Kontrolli kampaania algus- ja lõpuaega.' : 'Kampaaniat ei õnnestunud salvestada. Proovi uuesti.')
  return parseDirectoryCampaign(data)
}
