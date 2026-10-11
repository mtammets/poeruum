import type { SupabaseClient } from '@supabase/supabase-js'

export const SESSION_ENDED_MESSAGE = 'Sinu seanss on lõppenud. Logi uuesti sisse ja proovi uuesti.'

export async function requireActiveSession(client: SupabaseClient, expectedUserId?: string) {
  const { data, error } = await client.auth.getSession()
  if (error || !data.session) throw new Error(SESSION_ENDED_MESSAGE)
  if (expectedUserId && data.session.user.id !== expectedUserId) {
    throw new Error('Sisselogitud konto on muutunud. Laadi leht uuesti ja proovi uuesti.')
  }
  return data.session
}

/** Cookies cross shop origins; Supabase's BroadcastChannel does not. Rebuild
 * the view when another origin changes accounts or clears the shared session.
 * Never sign out here: that could revoke a newer login in the other tab.
 */
export function watchSharedAuthSession(
  auth: SupabaseClient['auth'],
  browser: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  document: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>,
  onChange: () => void,
) {
  let userId: string | null | undefined
  let revision = 0
  let checking = false
  let stopped = false
  let changed = false
  const notify = () => {
    if (stopped || changed) return
    changed = true
    onChange()
  }
  const { data } = auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION' && userId !== undefined) return
    const nextUserId = session?.user.id ?? null
    // An account switch can also arrive through the SDK on focus. Ordinary
    // login/logout flows keep their existing navigation and callbacks.
    if (userId && nextUserId && userId !== nextUserId) notify()
    userId = nextUserId
    revision += 1
  })
  const check = async () => {
    if (stopped || changed || checking || userId === undefined || document.visibilityState === 'hidden') return
    checking = true
    const startedRevision = revision
    try {
      const { data, error } = await auth.getSession()
      if (!error && !stopped && startedRevision === revision && (data.session?.user.id ?? null) !== userId) notify()
    } catch { /* A transient read/refresh failure is not a logout. */ }
    finally { checking = false }
  }
  const onVisible = () => { void check() }
  browser.addEventListener('focus', onVisible)
  document.addEventListener('visibilitychange', onVisible)
  // Cookie changes do not emit a storage event. Poll visible tabs as a fallback
  // for side-by-side windows and browsers without CookieStore events.
  const timer = setInterval(onVisible, 1000)
  return () => {
    stopped = true
    clearInterval(timer)
    data.subscription.unsubscribe()
    browser.removeEventListener('focus', onVisible)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
