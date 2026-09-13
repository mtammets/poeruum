import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateDailyHoroscope } from './horoscope-generation'
import { zodiacSigns } from './horoscope'

afterEach(() => vi.unstubAllGlobals())

describe('horoscope generation', () => {
  it('extracts a complete edition from message output after reasoning items', async () => {
    const entries = Object.fromEntries(zodiacSigns.map((sign) => [sign.id,
      'Üks pooleli jäänud mõte võib täna lõpuks paika loksuda. Räägi sellest sõbraga ja vaata, kuhu jutt teid viib.',
    ]))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(entries) }] }],
    }))))
    await expect(generateDailyHoroscope('test-key', '2026-09-07')).resolves.toEqual({ date: '2026-09-07', entries })
    const request = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    const sky = JSON.parse(request.input)
    expect(sky.date).toBe('2026-09-07')
    expect(sky.positionsAt).toBe('2026-09-07T09:00:00.000Z')
    expect(sky.bodies).toHaveLength(10)
    expect(sky.signs.map((sign: { id: string }) => sign.id)).toEqual(zodiacSigns.map((sign) => sign.id))
  })

  it('rejects invalid dates before making a paid request', async () => {
    vi.stubGlobal('fetch', vi.fn())
    await expect(generateDailyHoroscope('test-key', '2026-02-30')).rejects.toThrow('Invalid horoscope date')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not publish incomplete responses or expose upstream error bodies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'incomplete', output: [] }))))
    await expect(generateDailyHoroscope('test-key', '2026-09-07')).rejects.toThrow('did not complete')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Private upstream details', { status: 429 })))
    await expect(generateDailyHoroscope('test-key', '2026-09-07')).rejects.toThrow('HTTP 429')
  })
})
