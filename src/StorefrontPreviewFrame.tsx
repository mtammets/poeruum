import { useCallback, useEffect, useState } from 'react'
import { Storefront } from './App'
import type { StorefrontPreviewData } from './HomepageStorePhone'
import { getResponsiveImageProps } from './storefrontModel'
import './platform.css'

const data = JSON.parse(document.getElementById('storefront-preview-data')?.textContent || 'null') as StorefrontPreviewData | null

export default function StorefrontPreviewFrame() {
  const [ready, setReady] = useState(false)
  const onReady = useCallback(() => setReady(true), [])

  useEffect(() => {
    document.documentElement.classList.add('app-ready')
    const products = data?.products
    const track = document.querySelector<HTMLElement>('.story-track')
    if (!ready || !products?.length || !track || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let cancelled = false
    let frame = 0
    let finishWaiting: ((completed: boolean) => void) | null = null

    const waitFor = (complete: (elapsed: number) => boolean) => new Promise<boolean>((resolve) => {
      let elapsed = 0
      let previousTime = performance.now()
      finishWaiting = resolve
      const tick = (now: number) => {
        // Do not skip the reading pauses after returning from a background tab.
        if (!document.hidden) elapsed += Math.min(now - previousTime, 64)
        previousTime = now
        if (!document.hidden && complete(elapsed)) {
          finishWaiting = null
          resolve(true)
        } else {
          frame = window.requestAnimationFrame(tick)
        }
      }
      frame = window.requestAnimationFrame(tick)
    })
    const pause = (duration: number) => waitFor((elapsed) => elapsed >= duration)
    const waitUntilStill = (position: () => number) => {
      let previousPosition = position()
      let lastMovement = 0
      return waitFor((elapsed) => {
        const currentPosition = position()
        if (currentPosition !== previousPosition) lastMovement = elapsed
        previousPosition = currentPosition
        // Also allow the storefront to normalize its looping carousel position.
        return elapsed - lastMovement >= 220
      })
    }

    const play = async () => {
      let index = 0
      while (!cancelled) {
        const nextIndex = (index + 1) % products.length
        const product = products[nextIndex]
        const props = getResponsiveImageProps(product, product.image, 'medium')
        const image = new Image()
        image.sizes = '390px'
        if (props.srcSet) image.srcset = props.srcSet
        image.src = props.src
        const imageReady = image.decode().catch(() => {})

        if (!await pause(3800)) return
        const section = document.querySelector('.product-details')
        // scrollIntoView also moves ancestor documents; only scroll this window.
        if (section) window.scrollTo({ top: window.scrollY + section.getBoundingClientRect().top, behavior: 'smooth' })
        if (!await waitUntilStill(() => window.scrollY)) return
        if (!await pause(3000)) return
        window.scrollTo({ top: 0, behavior: 'smooth' })
        if (!await waitUntilStill(() => window.scrollY)) return
        if (!await pause(650)) return
        await imageReady
        if (cancelled) return

        if (products.length > 1) {
          const physicalIndex = Math.round(track.scrollLeft / track.clientWidth)
          // Use the real carousel so the next product slides in from the right,
          // including the seamless last-to-first transition.
          track.scrollTo({ left: (physicalIndex + 1) * track.clientWidth, behavior: 'smooth' })
          if (!await waitUntilStill(() => track.scrollLeft)) return
        }
        index = nextIndex
      }
    }
    void play()
    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
      finishWaiting?.(false)
    }
  }, [ready])

  if (!data || !data.products.length) return null
  return <Storefront storeId={data.store.id} storeName={data.store.name} storeSlug={data.store.slug}
    seedProducts={data.products} initialSettings={data.store.settings}
    initialShipping={data.store.shipping} paymentProvider={data.store.payment_provider}
    paymentsReady={data.store.payment_status === 'connected'}
    initialProductSlug={data.products[0].slug || data.products[0].id}
    embeddedPreview onInitialVisualReady={onReady} />
}
