import { useEffect, useRef } from 'react'
import './bannerForest.css'

const forestImage = '/images/campaigns/musta-rahni-forest-v1.webp'

export default function BannerForest() {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = root.current
    if (!element) return
    let inView = true
    const sync = () => { element.dataset.running = String(inView && !document.hidden) }
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting
      sync()
    }, { rootMargin: '100px' })
    observer.observe(element)
    document.addEventListener('visibilitychange', sync)
    sync()
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])

  return <div className="banner-forest" ref={root} aria-hidden="true">
    {['far', 'middle', 'near'].map(depth => <div className={`banner-forest__layer banner-forest__layer--${depth}`} key={depth}>
      <div className="banner-forest__track">
        {/* Mirrored pairs meet on identical edges; two pairs make a seamless loop. */}
        {[0, 1, 2, 3].map(tile => <img key={tile} src={forestImage} alt="" width="2172" height="724" decoding="async" draggable={false} />)}
      </div>
    </div>)}
  </div>
}
