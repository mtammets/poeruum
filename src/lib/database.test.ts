import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProductCategorySlug, createStore, getImageFallbackMimeType, listOrders, refundStripeOrder, setStorePublication, updateStore, uploadProductImages, type StoreContentInput, type StoreRecord } from './database'
import { requireSupabase } from './supabase'

vi.mock('./supabase', () => ({
  requireSupabase: vi.fn(),
}))

const store = {
  id: '10000000-0000-4000-8000-000000000001',
  is_published: true,
} as StoreRecord

it('loads every order page for accurate monthly fees and keeps live/test orders separate', async () => {
  const page = Array.from({ length: 500 }, (_, index) => ({ id: `order-${index}` }))
  const range = vi.fn().mockResolvedValueOnce({ data: page }).mockResolvedValueOnce({ data: page })
    .mockResolvedValueOnce({ data: [{ id: 'last-order' }] }).mockResolvedValueOnce({ data: [] })
  const query = { select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(), range }
  for (const key of ['select', 'eq', 'in', 'order'] as const) query[key].mockReturnValue(query)
  vi.mocked(requireSupabase).mockReturnValue({ from: () => query } as unknown as ReturnType<typeof requireSupabase>)
  expect(await listOrders(store.id)).toHaveLength(1001)
  expect(query.eq).toHaveBeenCalledWith('stripe_mode', 'live')
  expect(range.mock.calls.slice(0, 3)).toEqual([[0, 499], [500, 999], [1000, 1499]])
  await listOrders(store.id, 'test')
  expect(query.eq).toHaveBeenCalledWith('stripe_mode', 'test')
})

describe('createStore', () => {
  const ownerId = '10000000-0000-4000-8000-000000000002'
  const input: StoreContentInput = {
    name: 'New draft', slug: 'new-draft', payment_provider: 'stripe', shipping: ['pickup'], settings: {},
  }
  const existing = { ...store, owner_id: ownerId, name: 'Original store', settings: { onboardingStep: 'product' } }
  const maybeSingle = vi.fn()
  const single = vi.fn()
  const insert = vi.fn(() => ({ select: () => ({ single }) }))
  const eq = vi.fn(() => ({ order: () => ({ limit: () => ({ maybeSingle }) }) }))
  const getUser = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    maybeSingle.mockReset()
    single.mockReset()
    getUser.mockResolvedValue({ data: { user: { id: ownerId } }, error: null })
    vi.mocked(requireSupabase).mockReturnValue({
      auth: { getUser },
      from: () => ({ select: () => ({ eq }), insert }),
    } as unknown as ReturnType<typeof requireSupabase>)
  })

  it('resumes the existing store without replacing its content with a stale draft', async () => {
    maybeSingle.mockResolvedValue({ data: existing, error: null })
    await expect(createStore(input)).resolves.toBe(existing)
    expect(eq).toHaveBeenCalledWith('owner_id', ownerId)
    expect(insert).not.toHaveBeenCalled()
  })

  it('creates the first store with the authenticated owner and only editable fields', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    single.mockResolvedValue({ data: existing, error: null })
    await expect(createStore({ ...input, owner_id: 'forged', is_published: true } as StoreContentInput)).resolves.toBe(existing)
    expect(insert).toHaveBeenCalledWith({ ...input, owner_id: ownerId })
  })

  it('recovers the store created by another request after the initial empty read', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: existing, error: null })
    single.mockResolvedValue({ data: null, error: { code: '23505', message: 'Duplicate owner' } })
    await expect(createStore(input)).resolves.toBe(existing)
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it('does not swallow a slug conflict with a different account', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    single.mockResolvedValue({ data: null, error: { code: '23505', message: 'Slug already taken' } })
    await expect(createStore(input)).rejects.toThrow('Slug already taken')
  })

  it('does not create a store when the ownership lookup fails', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'Connection failed' } })
    await expect(createStore(input)).rejects.toThrow('Connection failed')
    expect(insert).not.toHaveBeenCalled()
  })

  it('requires authentication before looking up or creating a store', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null })
    await expect(createStore(input)).rejects.toThrow('Poe loomiseks logi sisse.')
    expect(maybeSingle).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })
})

describe('refund confirmation', () => {
  it.each([
    [{ refunded: false, pending: true }, { refunded: false, pending: true }],
    [{ refunded: true }, { refunded: true, pending: false }],
  ])('preserves the server-confirmed refund state %j', async (data, expected) => {
    const invoke = vi.fn().mockResolvedValue({ data, error: null })
    vi.mocked(requireSupabase).mockReturnValue({ functions: { invoke } } as unknown as ReturnType<typeof requireSupabase>)
    await expect(refundStripeOrder(store.id, 'PR-TEST')).resolves.toEqual(expected)
  })

  it('does not claim a refund started when the server returns no confirmation', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: {}, error: null })
    vi.mocked(requireSupabase).mockReturnValue({ functions: { invoke } } as unknown as ReturnType<typeof requireSupabase>)
    await expect(refundStripeOrder(store.id, 'PR-TEST')).rejects.toThrow('Tagastuse olekut ei õnnestunud kinnitada')
  })
})

describe('product category slugs', () => {
  it('normalizes Estonian names into store-scoped URL-safe identifiers', () => {
    expect(createProductCategorySlug('  Köögi tarvikud  ')).toBe('koogi-tarvikud')
    expect(createProductCategorySlug('Ehted & kingitused')).toBe('ehted-kingitused')
  })
})

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

describe('image encoding fallback', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses compact JPEG for opaque camera photos', () => {
    expect(getImageFallbackMimeType('image/jpeg', 'photo.jpg')).toBe('image/jpeg')
    expect(getImageFallbackMimeType('image/heic', 'IMG_1234.HEIC')).toBe('image/jpeg')
  })

  it('preserves transparency-capable image formats', () => {
    expect(getImageFallbackMimeType('image/png', 'product.png')).toBe('image/png')
    expect(getImageFallbackMimeType('', 'product.webp')).toBe('image/png')
  })

  it('flattens an opaque PNG photo but preserves a PNG with actual alpha', () => {
    expect(getImageFallbackMimeType('image/png', 'photo.png', false)).toBe('image/jpeg')
    expect(getImageFallbackMimeType('image/png', 'logo.png', true)).toBe('image/png')
  })

  it('falls back to JPEG in Safari and uploads responsive variants concurrently', async () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
        fillStyle: '',
        fillRect: vi.fn(),
        drawImage: vi.fn(),
      })),
      toBlob: vi.fn((callback: BlobCallback, type?: string) => {
        const outputType = type === 'image/webp' ? 'image/png' : type ?? 'image/png'
        callback(new Blob(['optimized-image'], { type: outputType }))
      }),
    }
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) })
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1600, height: 1200, close: vi.fn() })))

    let activeUploads = 0
    let maximumConcurrentUploads = 0
    const upload = vi.fn(async (_path: string, _blob: Blob) => {
      void _path
      void _blob
      activeUploads += 1
      maximumConcurrentUploads = Math.max(maximumConcurrentUploads, activeUploads)
      await new Promise((resolve) => setTimeout(resolve, 5))
      activeUploads -= 1
      return { error: null }
    })
    const bucket = {
      upload,
      remove: vi.fn(async () => ({ error: null })),
      getPublicUrl: vi.fn((path: string) => ({ data: { publicUrl: `https://images.example/${path}` } })),
    }
    vi.mocked(requireSupabase).mockReturnValue({ storage: { from: vi.fn(() => bucket) } } as unknown as ReturnType<typeof requireSupabase>)

    const steps: number[] = []
    const [result] = await uploadProductImages(store.id, [{
      name: 'iphone-photo.heic',
      type: 'image/heic',
      size: 4_000_000,
    } as File], (_index, phase, step) => {
      if (phase === 'uploading' && step) steps.push(step.completed)
    })

    expect(result.asset.mimeType).toBe('image/jpeg')
    expect(upload).toHaveBeenCalledTimes(3)
    expect(upload.mock.calls.every(([path]) => String(path).endsWith('.jpg'))).toBe(true)
    expect(maximumConcurrentUploads).toBe(3)
    expect(steps).toEqual([0, 1, 2, 3])
  })

  it('inspects an opaque PNG and uses compact JPEG when WebP encoding is unavailable', async () => {
    const context = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(64 * 48 * 4).fill(255) })),
    }
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toBlob: vi.fn((callback: BlobCallback, type?: string) => {
        const outputType = type === 'image/webp' ? 'image/png' : type ?? 'image/png'
        callback(new Blob(['optimized-image'], { type: outputType }))
      }),
    }
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) })
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 800, height: 600, close: vi.fn() })))

    const upload = vi.fn(async (_path: string, _blob: Blob) => {
      void _path
      void _blob
      return { error: null }
    })
    const bucket = {
      upload,
      remove: vi.fn(async () => ({ error: null })),
      getPublicUrl: vi.fn((path: string) => ({ data: { publicUrl: `https://images.example/${path}` } })),
    }
    vi.mocked(requireSupabase).mockReturnValue({ storage: { from: vi.fn(() => bucket) } } as unknown as ReturnType<typeof requireSupabase>)

    const [result] = await uploadProductImages(store.id, [{
      name: 'opaque-photo.png',
      type: 'image/png',
      size: 2_800_000,
    } as File])

    expect(result.asset.mimeType).toBe('image/jpeg')
    expect(upload).toHaveBeenCalledTimes(2)
    expect(upload.mock.calls.every(([path]) => String(path).endsWith('.jpg'))).toBe(true)
    expect(context.getImageData).toHaveBeenCalledTimes(1)
  })
})
