import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setStorePublication, updateStore, type StoreContentInput, type StoreRecord } from './database'
import { requireSupabase } from './supabase'

vi.mock('./supabase', () => ({
  requireSupabase: vi.fn(),
}))

const store = {
  id: '10000000-0000-4000-8000-000000000001',
  is_published: true,
} as StoreRecord

describe('setStorePublication', () => {
  const rpc = vi.fn()

  beforeEach(() => {
    rpc.mockReset()
    vi.mocked(requireSupabase).mockReturnValue({ rpc } as unknown as ReturnType<typeof requireSupabase>)
  })

  it('publishes through the protected database function', async () => {
    rpc.mockResolvedValue({ data: store, error: null })

    await expect(setStorePublication(store.id, true)).resolves.toBe(store)
    expect(rpc).toHaveBeenCalledWith('publish_store', { target_store_id: store.id })
  })

  it('unpublishes through the protected database function', async () => {
    const hiddenStore = { ...store, is_published: false }
    rpc.mockResolvedValue({ data: hiddenStore, error: null })

    await expect(setStorePublication(store.id, false)).resolves.toBe(hiddenStore)
    expect(rpc).toHaveBeenCalledWith('unpublish_store', { target_store_id: store.id })
  })

  it('surfaces a rejected publication without changing it in the browser', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Enne avaldamist ühenda Stripe’i maksed.' } })

    await expect(setStorePublication(store.id, true))
      .rejects.toThrow('Enne avaldamist ühenda Stripe’i maksed.')
  })
})

describe('updateStore', () => {
  it('never forwards publication state through the generic content update', async () => {
    const single = vi.fn().mockResolvedValue({ data: store, error: null })
    const select = vi.fn(() => ({ single }))
    const eq = vi.fn(() => ({ select }))
    const update = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ update }))
    vi.mocked(requireSupabase).mockReturnValue({ from } as unknown as ReturnType<typeof requireSupabase>)

    const staleAutosavePayload = {
      settings: { storeTheme: 'sand' },
      is_published: false,
    } as unknown as Partial<StoreContentInput>

    await expect(updateStore(store.id, staleAutosavePayload)).resolves.toBe(store)

    expect(from).toHaveBeenCalledWith('stores')
    expect(update).toHaveBeenCalledWith({ settings: { storeTheme: 'sand' } })
    expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ is_published: expect.anything() }))
  })
})
