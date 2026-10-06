import { useEffect, useRef, useState } from 'react'

export type VisitNotice = { id: number; delta: number; kind: 'visit' | 'account' }

export default function useHomepageVisitFeedback({ count, accountCount, scope, active }: { count: number; accountCount: number; scope: string; active: boolean }) {
  const previous = useRef<{ count: number; accountCount: number; scope: string } | null>(null)
  const sequence = useRef(0)
  const [notice, setNotice] = useState<VisitNotice | null>(null)
  const [accountNotice, setAccountNotice] = useState<VisitNotice | null>(null)

  useEffect(() => {
    if (!active || !Number.isFinite(count) || !Number.isFinite(accountCount)) {
      previous.current = null
      setNotice(null)
      setAccountNotice(null)
      return
    }
    const last = previous.current
    previous.current = { count, accountCount, scope }
    // Initial data and a different reporting period establish a new baseline.
    if (!last || last.scope !== scope) {
      setNotice(null)
      setAccountNotice(null)
      return
    }
    const visitDelta = count - last.count
    const accountDelta = accountCount - last.accountCount
    if (visitDelta < 0) setNotice(null)
    if (accountDelta < 0) setAccountNotice(null)
    if (document.visibilityState !== 'visible') return
    if (visitDelta > 0) setNotice({ id: ++sequence.current, delta: visitDelta, kind: 'visit' })
    if (accountDelta > 0) setAccountNotice({ id: ++sequence.current, delta: accountDelta, kind: 'account' })
  }, [count, accountCount, scope, active])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(null), 3200)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(() => {
    if (!accountNotice) return
    const timeout = window.setTimeout(() => setAccountNotice(null), 3200)
    return () => window.clearTimeout(timeout)
  }, [accountNotice])

  return { notice, accountNotice }
}

export type HomepageVisitFeedback = ReturnType<typeof useHomepageVisitFeedback>
