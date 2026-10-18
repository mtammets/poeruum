import { directoryStories, getDirectoryStory, type DirectoryStory } from '../../shared/directory-stories.mjs'
import { isSupabaseConfigured, requireSupabase } from './supabase'

export const STORY_PAGE_SIZE = 12

export function initialDirectoryStories() {
  const data = document.getElementById('poeruum-stories-data')?.textContent
  if (!data) return [] as DirectoryStory[]
  try { const rows = JSON.parse(data); return Array.isArray(rows) ? rows as DirectoryStory[] : [] } catch { return [] as DirectoryStory[] }
}

export async function listDirectoryStories(offset = 0) {
  if (!isSupabaseConfigured) return [] as DirectoryStory[]
  const { data, error } = await requireSupabase().from('directory_stories').select('story')
    .eq('is_published', true).order('published_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + STORY_PAGE_SIZE - 1)
  if (error) throw new Error('Lugusid ei õnnestunud laadida.')
  return data.map((row) => row.story as DirectoryStory)
}

export async function loadDirectoryStory(path: string): Promise<DirectoryStory | undefined> {
  const fixed = getDirectoryStory(path)
  if (fixed) return fixed
  const match = /^\/lood\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/.exec(path)
  if (!match || !isSupabaseConfigured) return undefined
  const { data, error } = await requireSupabase().from('directory_stories').select('story').eq('slug', match[1]).eq('is_published', true).maybeSingle()
  if (error) throw new Error('Lugu ei õnnestunud laadida. Proovi uuesti.')
  return data?.story as DirectoryStory | undefined
}

export const mergeDirectoryStories = (stories: DirectoryStory[]) => [...stories, ...directoryStories.filter((fixed) => !stories.some((story) => story.slug === fixed.slug))]
