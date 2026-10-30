import { describe, expect, it, vi } from 'vitest'
import { companyCopyDefaults, normalizeCompanyCopy } from '../../shared/company-homepage-copy.mjs'
import { getCompanyHomepageOwner, saveCompanyHomepageCopy } from './companyHomepage'
import { requireSupabase } from './supabase'

vi.mock('./supabase', () => ({ requireSupabase: vi.fn() }))

function backend(userId: string | null = 'owner') {
  const query = { select: vi.fn(), eq: vi.fn(), update: vi.fn(), maybeSingle: vi.fn() }
  for (const key of ['select', 'eq', 'update'] as const) query[key].mockReturnValue(query)
  const from = vi.fn(() => query)
  vi.mocked(requireSupabase).mockReturnValue({
    from, auth: { getSession: async () => ({ data: { session: userId ? { user: { id: userId } } : null } }) },
  } as unknown as ReturnType<typeof requireSupabase>)
  return { ...query, from }
}

describe('company homepage publishing', () => {
  it('requires the original authenticated owner before reading or writing settings', async () => {
    const anonymous = backend(null)
    expect(await getCompanyHomepageOwner('shop')).toBeNull()
    await expect(saveCompanyHomepageCopy('shop', 'owner', {}, {})).rejects.toThrow('Logi uuesti sisse')
    expect(anonymous.from).not.toHaveBeenCalled()
    const switched = backend('someone-else')
    await expect(saveCompanyHomepageCopy('shop', 'owner', {}, {})).rejects.toThrow('konto on muutunud')
    expect(switched.from).not.toHaveBeenCalled()
  })

  it('does not allow a signed-in visitor to edit another shop', async () => {
    const query = backend()
    query.maybeSingle.mockResolvedValue({ data: null })
    expect(await getCompanyHomepageOwner('other-shop')).toBeNull()
    await expect(saveCompanyHomepageCopy('other-shop', 'owner', {}, {})).rejects.toThrow('selle poe omanikuna')
    expect(query.eq).toHaveBeenCalledWith('owner_id', 'owner')
    expect(query.update).not.toHaveBeenCalled()
  })

  it('preserves private settings and retries a concurrent unrelated update', async () => {
    const query = backend()
    const copy = { heroTitle: 'Uus pealkiri', email: 'madis@example.invalid' }
    query.maybeSingle.mockResolvedValueOnce({ data: { settings: { orderNotificationEmail: 'private@example.invalid' }, updated_at: 'first' } })
      .mockResolvedValueOnce({ data: null })
      .mockResolvedValueOnce({ data: { settings: { orderNotificationEmail: 'new-private@example.invalid', storeTheme: 'paper' }, updated_at: 'second' } })
      .mockResolvedValueOnce({ data: { id: 'shop' } })
    expect(await saveCompanyHomepageCopy('shop', 'owner', copy, {})).toEqual(copy)
    expect(query.update).toHaveBeenLastCalledWith({ settings: { orderNotificationEmail: 'new-private@example.invalid', storeTheme: 'paper', companyHomepage: copy } })
    expect(query.eq).toHaveBeenCalledWith('updated_at', 'second')
  })

  it('keeps a newer homepage edit instead of silently overwriting it', async () => {
    const query = backend()
    query.maybeSingle.mockResolvedValue({ data: { settings: { companyHomepage: { heroTitle: 'Teise akna tekst' } }, updated_at: 'now' } })
    await expect(saveCompanyHomepageCopy('shop', 'owner', { heroTitle: 'Minu tekst' }, {})).rejects.toThrow('teises aknas')
    expect(query.update).not.toHaveBeenCalled()
  })

  it('reports failed writes and rejects loss of ownership during a save', async () => {
    const query = backend()
    query.maybeSingle.mockResolvedValueOnce({ data: { settings: {}, updated_at: 'now' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } })
    await expect(saveCompanyHomepageCopy('shop', 'owner', { heroTitle: 'Uus' }, {})).rejects.toThrow('Sinu muudatused on alles')
  })
})

it('keeps empty fields, bounds text lengths and ignores arbitrary settings in copy', () => {
  const copy = normalizeCompanyCopy({ email: '', heroTitle: 'x'.repeat(500), nameStory: 'Esimene\r\nTeine', storeTheme: 'red', productTitle: { html: '<b>bad</b>' } })
  expect(copy).toEqual({ email: '', heroTitle: 'x'.repeat(100), nameStory: 'Esimene\nTeine' })
  expect(companyCopyDefaults({ contactEmail: 'hello@example.invalid' }).email).toBe('hello@example.invalid')
})
