import { useCallback, useEffect, useState } from 'react'
import { Storefront } from './App'
import type { StorefrontPreviewData } from './HomepageStorePhone'
import { getResponsiveImageProps } from './storefrontModel'
import type { Product } from './products'
import './platform.css'

const data = JSON.parse(document.getElementById('storefront-preview-data')?.textContent || 'null') as StorefrontPreviewData | null

export default function StorefrontPreviewFrame() {
  const [ready, setReady] = useState(false)
  const [imageSelection, setImageSelection] = useState<{ productId: string; index: number } | null>(null)
  const onReady = useCallback(() => setReady(true), [])

  useEffect(() => {
    document.documentElement.classList.add('app-ready')
    const products = data?.products
    const track = document.querySelector<HTMLElement>('.story-track')
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (!ready || !products?.length || !track) return
    let cancelled = false
    let frame = 0
    let finishWaiting: ((completed: boolean) => void) | null = null
    const canPlay = () => !document.hidden && !motion.matches
      && window.frameElement?.getAttribute('data-preview-visible') !== 'false'
    const preloads = new Set<() => void>()
    const preload = (product: Product, source: string) => new Promise<boolean>((resolve) => {
      const image = new Image()
      const props = getResponsiveImageProps(product, source, 'medium')
      const finish = (loaded = false) => {
        window.clearTimeout(timeout)
        preloads.delete(finish)
        resolve(loaded)
      }
      const timeout = window.setTimeout(finish, 5000)
      preloads.add(finish)
      image.sizes = '390px'
      if (props.srcSet) image.srcset = props.srcSet
      image.src = props.src
      void image.decode().then(() => finish(true), () => finish(false))
    })

    const waitFor = (complete: (elapsed: number) => boolean) => new Promise<boolean>((resolve) => {
      let elapsed = 0
      let previousTime = performance.now()
      finishWaiting = resolve
      const tick = (now: number) => {
        // Do not skip the reading pauses after returning from a background tab.
        if (canPlay()) elapsed += Math.min(now - previousTime, 64)
        previousTime = now
        if (canPlay() && complete(elapsed)) {
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
      let singleProductRound = 0
      while (!cancelled) {
        const nextIndex = (index + 1) % products.length
        const product = products[index]
        const nextProduct = products[nextIndex]
        const imageReady = preload(nextProduct, nextProduct.gallery?.[0] || nextProduct.image)
        const extraIndex = product.gallery?.findIndex((image, imageIndex, gallery) => imageIndex > 0 && image !== gallery[0]) ?? -1
        const showGallery = extraIndex > 0 && (products.length === 1 ? singleProductRound % 2 === 0 : Math.random() < .5)
        const galleryReady = showGallery ? preload(product, product.gallery![extraIndex]) : Promise.resolve(false)

        if (!await pause(3800)) return
        const extraLoaded = await galleryReady
        if (cancelled || !await pause(0)) return
        if (showGallery && extraLoaded) {
          setImageSelection({ productId: product.id, index: extraIndex })
          if (!await pause(2600)) return
        } else {
          const section = document.querySelector('.product-details')
          // scrollIntoView also moves ancestor documents; only scroll this window.
          if (section) window.scrollTo({ top: window.scrollY + section.getBoundingClientRect().top, behavior: 'smooth' })
          if (!await waitUntilStill(() => window.scrollY)) return
          if (!await pause(3000)) return
          window.scrollTo({ top: 0, behavior: 'smooth' })
          if (!await waitUntilStill(() => window.scrollY)) return
          if (!await pause(650)) return
        }
        await imageReady
        if (cancelled || !await pause(0)) return

        if (products.length > 1) {
          const physicalIndex = Math.round(track.scrollLeft / track.clientWidth)
          // Use the real carousel so the next product slides in from the right,
          // including the seamless last-to-first transition.
          track.scrollTo({ left: (physicalIndex + 1) * track.clientWidth, behavior: 'smooth' })
          if (!await waitUntilStill(() => track.scrollLeft)) return
        }
        setImageSelection(null)
        index = nextIndex
        singleProductRound += 1
      }
    }
    void play()
    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
      finishWaiting?.(false)
      preloads.forEach((finish) => finish())
    }
  }, [ready])

  if (!data || !data.products.length) return null
  return <Storefront storeId={data.store.id} storeName={data.store.name} storeSlug={data.store.slug}
    seedProducts={data.products} initialSettings={data.store.settings}
    initialShipping={data.store.shipping} paymentProvider={data.store.payment_provider}
    paymentsReady={data.store.payment_status === 'connected'}
    initialProductSlug={data.products[0].slug || data.products[0].id}
    embeddedPreview previewImageSelection={imageSelection} onInitialVisualReady={onReady} />
}
