import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getImageFallbackMimeType, setStorePublication, updateStore, uploadProductImages, type StoreContentInput, type StoreRecord } from './database'
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
})
