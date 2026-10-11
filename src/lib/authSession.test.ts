import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js'
import { requireActiveSession, SESSION_ENDED_MESSAGE, watchSharedAuthSession } from './authSession'

const session = (id: string, token = 'token') => ({ user: { id }, access_token: token }) as Session

function setup() {
  let listener: (event: AuthChangeEvent, session: Session | null) => void = () => {}
  const getSession = vi.fn().mockResolvedValue({ data: { session: session('owner') }, error: null })
  const unsubscribe = vi.fn()
  const auth = {
    getSession,
    onAuthStateChange: vi.fn((callback) => {
      listener = callback
      callback('INITIAL_SESSION', session('owner'))
      return { data: { subscription: { unsubscribe } } }
    }),
  } as unknown as SupabaseClient['auth']
  const browser = new EventTarget()
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState })
  const onChange = vi.fn()
  const stop = watchSharedAuthSession(auth, browser, document, onChange)
  return { getSession, unsubscribe, browser, document, onChange, stop, emit: (event: AuthChangeEvent, value: Session | null) => listener(event, value) }
}

afterEach(() => vi.useRealTimers())

describe('shared cookie session changes', () => {
  it('detects a logout in another origin without an SDK event and notifies once', async () => {
    vi.useFakeTimers()
    const api = setup()
    api.getSession.mockResolvedValue({ data: { session: null }, error: null })
    await vi.advanceTimersByTimeAsync(1000)
    expect(api.onChange).toHaveBeenCalledTimes(1)
    api.browser.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(3000)
    expect(api.onChange).toHaveBeenCalledTimes(1)
    api.stop()
  })

  it('checks when a hidden tab becomes visible and detects a different account', async () => {
    vi.useFakeTimers()
    const api = setup()
    api.document.visibilityState = 'hidden'
    api.getSession.mockResolvedValue({ data: { session: session('other') }, error: null })
    await vi.advanceTimersByTimeAsync(2000)
    expect(api.getSession).not.toHaveBeenCalled()
    api.document.visibilityState = 'visible'
    api.document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(api.onChange).toHaveBeenCalledTimes(1)
    api.stop()
  })

  it('does not reload for token rotation, local logout, failed reads or after cleanup', async () => {
    vi.useFakeTimers()
    const api = setup()
    api.getSession.mockResolvedValue({ data: { session: session('owner', 'new-token') }, error: null })
    await vi.advanceTimersByTimeAsync(1000)
    api.getSession.mockRejectedValueOnce(new Error('Network unavailable'))
    await vi.advanceTimersByTimeAsync(1000)
    api.emit('SIGNED_OUT', null)
    api.getSession.mockResolvedValue({ data: { session: null }, error: null })
    await vi.advanceTimersByTimeAsync(1000)
    expect(api.onChange).not.toHaveBeenCalled()
    api.stop()
    api.getSession.mockClear()
    api.browser.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(api.getSession).not.toHaveBeenCalled()
    expect(api.unsubscribe).toHaveBeenCalledOnce()
  })

  it('ignores a stale read that completed after a new local login', async () => {
    vi.useFakeTimers()
    const api = setup()
    let resolve!: (value: unknown) => void
    api.getSession.mockReturnValue(new Promise((done) => { resolve = done }))
    api.browser.dispatchEvent(new Event('focus'))
    api.emit('SIGNED_OUT', null)
    api.emit('SIGNED_IN', session('other'))
    resolve({ data: { session: null }, error: null })
    await vi.advanceTimersByTimeAsync(0)
    expect(api.onChange).not.toHaveBeenCalled()
    api.stop()
  })
})

describe('authenticated writes', () => {
  it('rejects a missing session and a stale account before submitting', async () => {
    const getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null })
    const client = { auth: { getSession } } as unknown as SupabaseClient
    await expect(requireActiveSession(client)).rejects.toThrow(SESSION_ENDED_MESSAGE)
    getSession.mockResolvedValue({ data: { session: session('other') }, error: null })
    await expect(requireActiveSession(client, 'owner')).rejects.toThrow('konto on muutunud')
    await expect(requireActiveSession(client, 'other')).resolves.toEqual(session('other'))
  })
})
