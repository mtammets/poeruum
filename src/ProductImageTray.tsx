import { useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type PointerEvent, type ReactNode } from 'react'

type ImageInteractionProps = Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'aria-keyshortcuts' | 'onPointerDown' | 'onKeyDown' | 'onDragStart'>

type Props = {
  images: string[]
  selectedImage: string | undefined
  disabled: boolean
  onReorder: (images: string[], selectedImage?: string) => void
  renderImage: (image: string, index: number, interactionProps: ImageInteractionProps) => ReactNode
  itemClassName: (image: string, index: number) => string
  children: ReactNode
}

export default function ProductImageTray({ images, selectedImage, disabled, onReorder, renderImage, itemClassName, children }: Props) {
  const trayRef = useRef<HTMLDivElement>(null)
  const itemsRef = useRef(new Map<string, HTMLDivElement>())
  const suppressClickRef = useRef(false)
  const positionsRef = useRef(new Map<string, number>())
  const gestureRef = useRef<{
    pointerId: number
    image: string
    originalImages: string[]
    originalSelection: string | undefined
    startX: number
    left: number
    scrollLeft: number
    centers: number[]
    moved: boolean
  } | null>(null)
  const [drag, setDrag] = useState<{ image: string; x: number } | null>(null)
  const [announcement, setAnnouncement] = useState('')

  // Animate the other photos into their new slots while the grabbed photo
  // stays under the pointer. Stable URL keys also preserve keyboard focus.
  useLayoutEffect(() => {
    const nextPositions = new Map<string, number>()
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    itemsRef.current.forEach((node, image) => {
      const left = node.offsetLeft
      nextPositions.set(image, left)
      const previousLeft = positionsRef.current.get(image)
      if (drag?.image === image && gestureRef.current) {
        node.getAnimations().forEach((animation) => animation.cancel())
        node.style.transform = `translateX(${gestureRef.current.left + drag.x - left}px) scale(1.04)`
      } else {
        node.style.transform = ''
        if (!reducedMotion && previousLeft !== undefined && previousLeft !== left) {
          node.getAnimations().forEach((animation) => animation.cancel())
          node.animate([{ transform: `translateX(${previousLeft - left}px)` }, { transform: 'translateX(0)' }], { duration: 180, easing: 'ease-out' })
        }
      }
    })
    positionsRef.current = nextPositions
  })

  const announce = (index: number) => setAnnouncement(`Pilt liigutatud kohale ${index + 1}/${images.length}.${index === 0 ? ' Esipilt.' : ''}`)

  const startDrag = (event: PointerEvent<HTMLButtonElement>, image: string) => {
    if (disabled || images.length < 2 || gestureRef.current || !event.isPrimary || event.button !== 0) return
    const tray = trayRef.current
    const node = itemsRef.current.get(image)
    if (!tray || !node) return
    event.stopPropagation()
    event.currentTarget.focus({ preventScroll: true })
    gestureRef.current = {
      pointerId: event.pointerId, image, originalImages: [...images], originalSelection: selectedImage,
      moved: false, startX: event.clientX, left: node.offsetLeft, scrollLeft: tray.scrollLeft,
      centers: images.map((url) => {
        const item = itemsRef.current.get(url)!
        return item.offsetLeft + item.offsetWidth / 2
      }),
    }
  }

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    const tray = trayRef.current
    if (!gesture || !tray || gesture.pointerId !== event.pointerId) return
    // A small movement threshold keeps taps available for preview selection.
    if (!gesture.moved) {
      if (Math.abs(event.clientX - gesture.startX) < 8) return
      gesture.moved = true
      // The tray stays mounted when its children move.
      tray.setPointerCapture(event.pointerId)
    }
    event.preventDefault()
    event.stopPropagation()
    const bounds = tray.getBoundingClientRect()
    if (event.clientX < bounds.left + 24) tray.scrollLeft -= 12
    if (event.clientX > bounds.right - 24) tray.scrollLeft += 12
    const x = event.clientX - gesture.startX + tray.scrollLeft - gesture.scrollLeft
    setDrag({ image: gesture.image, x })
    const center = gesture.centers[gesture.originalImages.indexOf(gesture.image)] + x
    const target = gesture.centers.reduce((closest, slot, index, slots) => Math.abs(slot - center) < Math.abs(slots[closest] - center) ? index : closest, 0)
    const current = images.indexOf(gesture.image)
    if (target === current) return
    const next = images.filter((image) => image !== gesture.image)
    next.splice(target, 0, gesture.image)
    onReorder(next)
    announce(target)
  }

  const finishDrag = (cancel: boolean) => {
    const gesture = gestureRef.current
    if (!gesture) return
    gestureRef.current = null
    suppressClickRef.current = gesture.moved
    if (cancel && gesture.moved) {
      onReorder(gesture.originalImages, gesture.originalSelection)
      setAnnouncement('Piltide järjekorra muutmine tühistatud.')
    }
    setDrag(null)
    const tray = trayRef.current
    if (tray?.hasPointerCapture(gesture.pointerId)) tray.releasePointerCapture(gesture.pointerId)
  }

  return <div ref={trayRef} className={`product-image-editor__tray${drag ? ' is-sorting' : ''}`} aria-label="Toote piltide järjestus"
    onPointerDownCapture={() => { suppressClickRef.current = false }}
    onClickCapture={(event) => {
      if (suppressClickRef.current && event.detail > 0) {
        event.preventDefault()
        event.stopPropagation()
        suppressClickRef.current = false
      }
    }}
    onPointerMove={moveDrag}
    onPointerUp={(event) => { if (event.pointerId === gestureRef.current?.pointerId) finishDrag(false) }}
    onPointerCancel={(event) => { if (event.pointerId === gestureRef.current?.pointerId) finishDrag(true) }}
    onLostPointerCapture={(event) => {
      // Touch starts with implicit capture on the thumbnail. Its release
      // bubbles here when capture transfers to the tray during a drag.
      if (event.target === event.currentTarget) finishDrag(true)
    }}
    onKeyDown={(event) => { if (event.key === 'Escape' && gestureRef.current) { event.preventDefault(); event.stopPropagation(); finishDrag(true) } }}>
    {images.map((image, index) => <div key={image} ref={(node) => { if (node) itemsRef.current.set(image, node); else itemsRef.current.delete(image) }}
      className={`product-image-editor__item ${itemClassName(image, index)}${index === 0 ? ' is-cover' : ''}${drag?.image === image ? ' is-dragging' : ''}`}>
      <div className="product-image-editor__visual">{renderImage(image, index, {
        className: `product-image-editor__preview${!disabled && images.length > 1 ? ' is-sortable' : ''}`,
        'aria-keyshortcuts': !disabled && images.length > 1 ? 'ArrowLeft ArrowRight Home End' : undefined,
        onPointerDown: (event) => startDrag(event, image),
        onDragStart: (event) => event.preventDefault(),
        onKeyDown: (event) => {
          if (gestureRef.current || disabled) return
          const target = event.key === 'ArrowLeft' ? Math.max(0, index - 1)
            : event.key === 'ArrowRight' ? Math.min(images.length - 1, index + 1)
              : event.key === 'Home' ? 0 : event.key === 'End' ? images.length - 1 : null
          if (target === null) return
          event.preventDefault()
          event.stopPropagation()
          if (target === index) return
          const next = images.filter((url) => url !== image)
          next.splice(target, 0, image)
          onReorder(next)
          announce(target)
        },
      })}</div>
    </div>)}
    {children}
    <span className="product-image-editor__announcement" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
  </div>
}
