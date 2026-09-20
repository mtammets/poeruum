import { useEffect, useRef } from 'react'
import { trackDirectoryEvent } from './lib/directoryAnalytics'

export function useDirectoryImpression(storeId: string | null, placement: 'directory' | 'search', position: number) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!storeId || !element || !('IntersectionObserver' in window)) return
    let visible = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const update = () => {
      clearTimeout(timer)
      if (visible && document.visibilityState === 'visible') timer = setTimeout(() => {
        trackDirectoryEvent({ event_name: 'store_impression', store_id: storeId, placement, position })
      }, 1000)
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && entry.intersectionRatio >= 0.5
      update()
    }, { threshold: 0.5 })
    observer.observe(element)
    document.addEventListener('visibilitychange', update)
    return () => {
      clearTimeout(timer)
      observer.disconnect()
      document.removeEventListener('visibilitychange', update)
    }
  }, [storeId, placement, position])
  return ref
}
