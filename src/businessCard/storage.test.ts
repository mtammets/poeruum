import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requireSupabase } from '../lib/supabase'
import { createDefaultCard } from './model'
import { CardDraftConflictError, loadCloudCardDraft, saveCloudCardDraft } from './storage'

vi.mock('../lib/supabase', () => ({ requireSupabase: vi.fn() }))

describe('private business card cloud drafts', () => {
  const maybeSingle = vi.fn()
  const retry = vi.fn(() => ({ maybeSingle }))
  const abortSignal = vi.fn(() => ({ retry }))
  const eq = vi.fn(() => ({ abortSignal }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  const rpc = vi.fn()
  const userId = '85000000-0000-4000-8000-000000000001'
  const updatedAt = '2026-09-05T12:00:00Z'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireSupabase).mockReturnValue({ from, rpc } as unknown as ReturnType<typeof requireSupabase>)
  })

  it('loads the current administrators draft and validates its revision', async () => {
    const document = createDefaultCard()
    maybeSingle.mockResolvedValue({ data: { document, revision: 3, updated_at: updatedAt }, error: null })
    await expect(loadCloudCardDraft(userId)).resolves.toEqual({ document, revision: 3, updatedAt })
    expect(from).toHaveBeenCalledWith('admin_business_card_drafts')
    expect(eq).toHaveBeenCalledWith('user_id', userId)
    expect(retry).toHaveBeenCalledWith(false)
    expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal))
    expect(rpc).not.toHaveBeenCalled()
  })

  it('distinguishes a confirmed missing draft from an unavailable or unauthorized read', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    await expect(loadCloudCardDraft(userId)).resolves.toBeNull()

    maybeSingle.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'denied' } })
    await expect(loadCloudCardDraft(userId)).rejects.toThrow('ei õnnestunud laadida')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses to turn an unreadable cloud draft into a new empty document', async () => {
    maybeSingle.mockResolvedValue({ data: { document: {}, revision: 1, updated_at: updatedAt }, error: null })
    await expect(loadCloudCardDraft(userId)).rejects.toThrow('Visiitkaardi fail on vigane')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('forwards the last loaded revision to the protected atomic save function', async () => {
    const document = createDefaultCard()
    rpc.mockResolvedValue({ data: { document, revision: 5, updated_at: updatedAt }, error: null })
    await expect(saveCloudCardDraft(document, 4)).resolves.toEqual({ document, revision: 5, updatedAt })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('admin_save_business_card', {
      next_document: document,
      expected_revision: 4,
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('creates a draft only when the server confirms that no previous draft exists', async () => {
    const document = createDefaultCard()
    rpc.mockResolvedValue({ data: { document, revision: 1, updated_at: updatedAt }, error: null })
    await expect(saveCloudCardDraft(document, null)).resolves.toMatchObject({ revision: 1 })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('admin_save_business_card', {
      next_document: document,
      expected_revision: null,
    })
  })

  it('accepts the single-row representation of a composite RPC result', async () => {
    const document = createDefaultCard()
    rpc.mockResolvedValue({ data: [{ document, revision: 1, updated_at: updatedAt }], error: null })
    await expect(saveCloudCardDraft(document, null)).resolves.toEqual({ document, revision: 1, updatedAt })
  })

  it('reports a stale save distinctly and never retries it with a newer revision', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '40001', message: 'conflict' } })
    await expect(saveCloudCardDraft(createDefaultCard(), 2)).rejects.toBeInstanceOf(CardDraftConflictError)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(from).not.toHaveBeenCalled()
  })

  it('does not confirm a failed save or an unexpected returned revision', async () => {
    const document = createDefaultCard()
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'missing migration' } })
    await expect(saveCloudCardDraft(document, null)).rejects.toThrow('salvestamine ebaõnnestus')
    rpc.mockResolvedValueOnce({ data: { document, revision: 9, updated_at: updatedAt }, error: null })
    await expect(saveCloudCardDraft(document, 3)).rejects.toThrow('ei õnnestunud kinnitada')
  })

  it('rejects invalid revisions and documents before transmitting data', async () => {
    const document = createDefaultCard()
    await expect(saveCloudCardDraft(document, Number.NaN)).rejects.toThrow('versioon puudub')
    await expect(saveCloudCardDraft({ ...document, width: -5 }, 1)).rejects.toThrow('Visiitkaardi fail on vigane')
    expect(rpc).not.toHaveBeenCalled()
  })
})
