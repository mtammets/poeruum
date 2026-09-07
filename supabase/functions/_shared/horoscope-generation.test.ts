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
  })

  it('does not publish incomplete responses or expose upstream error bodies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'incomplete', output: [] }))))
    await expect(generateDailyHoroscope('test-key', '2026-09-07')).rejects.toThrow('did not complete')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Private upstream details', { status: 429 })))
    await expect(generateDailyHoroscope('test-key', '2026-09-07')).rejects.toThrow('HTTP 429')
  })
})
