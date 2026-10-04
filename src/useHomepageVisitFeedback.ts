import { useEffect, useRef, useState } from 'react'

export type VisitNotice = { id: number; delta: number; kind: 'visit' | 'account' }

function playChime(context: AudioContext, kind: VisitNotice['kind'] = 'visit', delay = 0) {
  if (context.state !== 'running') throw new Error('Audio is not running')
  const start = context.currentTime + .01 + delay
  const notes = kind === 'account' ? [[0, 523.25], [.13, 659.25], [.26, 783.99]] : [[0, 660], [.095, 880]]
  const duration = kind === 'account' ? .32 : .22
  for (const [offset, frequency] of notes) {
    const tone = context.createOscillator()
    const volume = context.createGain()
    tone.type = 'sine'
    tone.frequency.value = frequency
    volume.gain.setValueAtTime(0, start + offset)
    volume.gain.linearRampToValueAtTime(.055, start + offset + .012)
    volume.gain.exponentialRampToValueAtTime(.001, start + offset + duration)
    tone.connect(volume)
    volume.connect(context.destination)
    tone.onended = () => { tone.disconnect(); volume.disconnect() }
    tone.start(start + offset)
    tone.stop(start + offset + duration + .02)
  }
}

export default function useHomepageVisitFeedback({ count, accountCount, scope, active }: { count: number; accountCount: number; scope: string; active: boolean }) {
  const previous = useRef<{ count: number; accountCount: number; scope: string } | null>(null)
  const sequence = useRef(0)
  const audio = useRef<AudioContext | null>(null)
  const [notice, setNotice] = useState<VisitNotice | null>(null)
  const [accountNotice, setAccountNotice] = useState<VisitNotice | null>(null)
  const [soundEnabled, setSoundEnabled] = useState(false)
  const [soundError, setSoundError] = useState('')

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
    if (visitDelta <= 0 && accountDelta <= 0) return
    if (audio.current) {
      try {
        if (visitDelta > 0) playChime(audio.current, 'visit')
        // Keep the two signals distinct if both totals arrive in the same refresh.
        if (accountDelta > 0) playChime(audio.current, 'account', visitDelta > 0 ? .42 : 0)
      } catch {
        setSoundEnabled(false)
        setSoundError('Heli ei saanud esitada. Lülita heli uuesti sisse.')
        const context = audio.current
        audio.current = null
        void context.close().catch(() => undefined)
      }
    }
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

  useEffect(() => () => {
    const context = audio.current
    audio.current = null
    if (context) void context.close().catch(() => undefined)
  }, [])

  const toggleSound = async () => {
    setSoundError('')
    if (audio.current) {
      const context = audio.current
      audio.current = null
      setSoundEnabled(false)
      void context.close().catch(() => undefined)
      return
    }
    let context: AudioContext | null = null
    try {
      // Create/resume within the button gesture so browser autoplay rules allow it.
      context = new AudioContext()
      audio.current = context
      await context.resume()
      if (audio.current !== context) return
      if (context.state !== 'running') throw new Error('Audio is unavailable')
      playChime(context)
      setSoundEnabled(true)
    } catch {
      if (context && audio.current !== context) return
      audio.current = null
      if (context) void context.close().catch(() => undefined)
      setSoundEnabled(false)
      setSoundError('Heli ei saanud sisse lülitada. Proovi uuesti.')
    }
  }

  return { notice, accountNotice, soundEnabled, soundError, toggleSound }
}

export type HomepageVisitFeedback = ReturnType<typeof useHomepageVisitFeedback>
