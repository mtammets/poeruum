import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
const mocks = vi.hoisted(() => ({ session: vi.fn(), onAuth: vi.fn(), fetch: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { auth: { getSession: mocks.session, onAuthStateChange: mocks.onAuth } } }))
vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co')
const { startWoodpeckerTracking, trackWoodpecker, woodpeckerCheckoutContext } = await import('./woodpeckerTracking')
let stop: (() => void) | undefined
let documentMock: EventTarget & { cookie: string; hidden: boolean; referrer: string; documentElement: { scrollHeight: number } }
let windowMock: EventTarget & { location: URL; innerWidth: number; innerHeight: number; scrollY: number }
const emitted = () => mocks.fetch.mock.calls.flatMap(([, options]) => JSON.parse(options.body).events)
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-04T06:00:00Z'))
  mocks.session.mockResolvedValue({ data: { session: null }, error: null })
  mocks.onAuth.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
  mocks.fetch.mockResolvedValue({ ok: true, status: 202 })
  documentMock = Object.assign(new EventTarget(), { cookie: '', hidden: false, referrer: 'https://www.google.com/', documentElement: { scrollHeight: 2000 } })
  windowMock = Object.assign(new EventTarget(), { location: new URL('https://kaubamaja.poeruum.ee/'), innerWidth: 1440, innerHeight: 900, scrollY: 0 })
  const storage = new Map<string, string>()
  vi.stubGlobal('document', documentMock); vi.stubGlobal('window', windowMock)
  vi.stubGlobal('crypto', { randomUUID }); vi.stubGlobal('fetch', mocks.fetch)
  vi.stubGlobal('sessionStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) })
})
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks() })
describe('campaign browser collection', () => {
  it('buffers early actions until auth resolves, uses an opaque page identity and sends no personal data', async () => {
    stop = startWoodpeckerTracking('directory')
    trackWoodpecker({ event_name: 'bird_call', placement: 'hero' })
    await vi.advanceTimersByTimeAsync(600)
    expect(emitted().some(e => e.event_name === 'bird_call')).toBe(true)
    expect(emitted().every(e => e.source === 'Google' && !('user_id' in e) && !('email' in e))).toBe(true)
    expect(documentMock.cookie).toBe('')
    expect(sessionStorage.getItem('poeruum:musta-rahni:session')).toBeNull()
    expect(woodpeckerCheckoutContext()?.visitor_id).toBe(emitted()[0].visitor_id)
  })
  it('excludes signed-in admins and merchants, including buffered actions', async () => {
    mocks.session.mockResolvedValue({ data: { session: { user: { app_metadata: { role: 'admin' } } } }, error: null })
    stop = startWoodpeckerTracking('directory')
    trackWoodpecker({ event_name: 'bird_call' })
    await vi.advanceTimersByTimeAsync(31000)
    expect(mocks.fetch).not.toHaveBeenCalled(); expect(woodpeckerCheckoutContext()).toBeUndefined()
  })
  it('clears pending data on login', async () => {
    stop = startWoodpeckerTracking('directory')
    await vi.advanceTimersByTimeAsync(1)
    mocks.onAuth.mock.calls[0][0]('SIGNED_IN', { user: {} })
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.fetch).not.toHaveBeenCalled(); expect(woodpeckerCheckoutContext()).toBeUndefined()
  })
  it('does not count hidden-tab time and flushes the final game immediately', async () => {
    stop = startWoodpeckerTracking('directory')
    await vi.advanceTimersByTimeAsync(5000)
    documentMock.hidden = true; documentMock.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(60000)
    const engaged = emitted().filter(e => e.event_name === 'engagement')
    expect(Math.max(...engaged.map(e => e.duration))).toBeLessThanOrEqual(5)
    trackWoodpecker({ event_name: 'game_end', game_id: randomUUID(), value: 4, duration: 20 })
    await vi.advanceTimersByTimeAsync(1)
    expect(emitted().at(-1).event_name).toBe('game_end')
  })
  it('keeps event IDs stable across retries', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('offline'))
    stop = startWoodpeckerTracking('directory')
    await vi.advanceTimersByTimeAsync(2200)
    const first = JSON.parse(mocks.fetch.mock.calls[0][1].body).events
    const retry = JSON.parse(mocks.fetch.mock.calls[1][1].body).events
    expect(retry).toEqual(first)
  })
  it('never sends pre-campaign events and begins on an already open page', async () => {
    vi.setSystemTime(new Date('2026-11-04T03:59:50Z'))
    stop = startWoodpeckerTracking('directory')
    trackWoodpecker({ event_name: 'bird_call' })
    await vi.advanceTimersByTimeAsync(9000)
    expect(mocks.fetch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(7000)
    expect(emitted().some(e => e.event_name === 'visit')).toBe(true)
    expect(emitted().some(e => e.event_name === 'bird_call')).toBe(false)
  })
})
