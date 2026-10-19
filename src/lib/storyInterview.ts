import { requireSupabase } from './supabase'
import type { StoryDraft, StoryMessage } from '../../supabase/functions/_shared/story-interview'
export type { StoryDraft, StoryMessage }

export type StoryInterview = {
  id: string; storeName: string; storeSlug: string
  status: 'interview' | 'photo' | 'preview' | 'pending_review' | 'published'
  version: number; messages: StoryMessage[]; draft: StoryDraft | null
  needsName?: boolean
  imageUrl: string | null; imageAlt: string; publishedUrl: string | null; lastRequestId: string | null
  bodyImageUrl?: string | null; bodyImageAlt?: string; bodyImageCaption?: string
}
export type StoryAdminData = {
  aiAvailable: boolean
  stores: { id: string; name: string; slug: string; is_published: boolean }[]
  interviews: { id: string; store_id: string; store_name?: string; status: StoryInterview['status'] | 'revoked'; expires_at: string; created_at: string
    article: { id: string; slug: string; is_published: boolean } | null }[]
}

export class StoryRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export function readInterviewToken(hash = window.location.hash) {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token')
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null
}

export const interviewLink = (token: string) => `https://poeruum.ee/lugu/#token=${token}`

export function storyInterviewPreview(interview: StoryInterview | null) {
  return interview?.draft && interview.imageUrl ? { ...interview.draft,
    slug: '', category: 'Meie kaupmehed', author: interview.storeName, publishedAt: '',
    image: interview.imageUrl, imageAlt: interview.imageAlt, storeName: interview.storeName, storeSlug: interview.storeSlug,
    ...(interview.bodyImageUrl ? { bodyImage: { src: interview.bodyImageUrl, alt: interview.bodyImageAlt || '', caption: interview.bodyImageCaption || '' } } : {}),
  } : null
}

export async function callStoryInterview<T>(body: Record<string, unknown>, admin = false): Promise<T> {
  const url = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '')
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) throw new StoryRequestError('Intervjuu pole praegu saadaval.', 503)
  const token = admin ? (await requireSupabase().auth.getSession()).data.session?.access_token : null
  const response = await fetch(`${url}/functions/v1/story-interview`, {
    method: 'POST', signal: AbortSignal.timeout(100_000),
    headers: { 'Content-Type': 'application/json', apikey: key, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body), referrerPolicy: 'no-referrer',
  }).catch(() => { throw new StoryRequestError('Ühendus katkes. Proovi uuesti.', 0) })
  let result
  try { result = await response.json() } catch { throw new StoryRequestError('Ühendus katkes. Proovi uuesti.', response.status) }
  if (!response.ok) throw new StoryRequestError(result.error || 'Toiming ei õnnestunud. Proovi uuesti.', response.status)
  return result as T
}

export async function prepareStoryImage(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Vali JPG-, PNG- või WebP-pilt.')
  if (file.size > 25 * 1024 * 1024) throw new Error('Vali pilt kuni 25 MB.')
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('Pilti ei õnnestunud avada. Vali teine foto.') })
  try {
    const ratio = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Pilti ei õnnestunud töödelda.')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/webp', .86)
  } finally { bitmap.close() }
}
