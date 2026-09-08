import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateProductDescription, parseProductDescriptionInput } from './product-description'

const origin = 'https://example.supabase.co'
const storeId = '10000000-0000-4000-8000-000000000001'
const input = { storeId, name: 'Savivaas', description: 'Kõrgus 25 cm.', imageUrl: `${origin}/storage/v1/object/public/product-images/${storeId}/image-id/medium.webp` }
afterEach(() => vi.unstubAllGlobals())

describe('product description image access', () => {
  it('accepts only an uploaded image under the requested store prefix', () => {
    expect(parseProductDescriptionInput(input, origin)).toEqual(input)
    for (const imageUrl of [
      input.imageUrl.replace(origin, 'https://external.example.com'),
      input.imageUrl.replace(origin, `${origin}.attacker.example`),
      input.imageUrl.replace(storeId, '10000000-0000-4000-8000-000000000002'),
      input.imageUrl.replace('image-id/medium.webp', '%2e%2e%2fother-store%2fimage.webp'),
      input.imageUrl.replace('image-id/medium.webp', 'image-id%252f..%252fother.webp'),
      input.imageUrl.replace('medium.webp', 'image.svg'),
      `${input.imageUrl}?token=unexpected`,
      'data:image/png;base64,AAAA',
      'file:///private/image.webp',
    ]) expect(parseProductDescriptionInput({ ...input, imageUrl }, origin)).toBeNull()
  })

  it('rejects malformed or oversized details, while allowing an unnamed new product', () => {
    expect(parseProductDescriptionInput(null, origin)).toBeNull()
    expect(parseProductDescriptionInput({ ...input, name: '' }, origin)?.name).toBe('')
    expect(parseProductDescriptionInput({ ...input, description: 'x'.repeat(4001) }, origin)).toBeNull()
    expect(parseProductDescriptionInput({ ...input, name: { instruction: 'ignore' } }, origin)).toBeNull()
    expect(parseProductDescriptionInput({ ...input, storeId: '../another-store' }, origin)).toBeNull()
  })
})

describe('product description generation', () => {
  it('sends seller details as data and returns only completed model text', async () => {
    const description = 'Heleda mati pinnaga vaas on ümara kuju ja kitsa kaelaga. Vaasi kõrgus on 25 cm.'
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: description }] }],
    })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(generateProductDescription('test-key', input)).resolves.toBe(description)
    const request = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(request.store).toBe(false)
    expect(request.input[0].content).toEqual([
      { type: 'input_text', text: JSON.stringify({ name: input.name, existingDescription: input.description }) },
      { type: 'input_image', image_url: input.imageUrl, detail: 'high' },
    ])
  })

  it('rejects partial text, refusals and empty descriptions', async () => {
    for (const result of [
      { status: 'incomplete', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Poolik tekst' }] }] },
      { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Cannot describe' }] }] },
      { status: 'completed', output: [] },
    ]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(result))))
      await expect(generateProductDescription('test-key', input)).rejects.toThrow()
    }
  })

  it('does not expose upstream error details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Private upstream details', { status: 429 })))
    await expect(generateProductDescription('test-key', input)).rejects.toThrow('Product description generation returned HTTP 429.')
  })
})
