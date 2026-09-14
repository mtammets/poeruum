import { useLayoutEffect, useRef } from 'react'

export default function StoreName({ name }: { name: string }) {
  const nameRef = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    const element = nameRef.current
    if (!element) return
    let frame = 0
    let disposed = false
    const range = document.createRange()

    const fit = () => {
      if (disposed || !element.clientWidth) return
      // Start from the responsive stylesheet so a wider header can restore
      // the original typography after a resize or a store-name change.
      element.style.removeProperty('font-size')
      element.style.removeProperty('letter-spacing')
      const style = getComputedStyle(element)
      const baseSize = parseFloat(style.fontSize)
      const baseSpacing = parseFloat(style.letterSpacing) || 0
      const minSize = Math.min(baseSize, parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.75)
      range.selectNodeContents(element)
      const fits = () => range.getBoundingClientRect().width <= element.clientWidth
      if (fits()) return

      // Keep the largest spacing or font size that fits the actual text,
      // including the loaded font's glyph widths, rather than character count.
      const fitProperty = (property: 'letterSpacing' | 'fontSize', min: number, max: number) => {
        element.style[property] = `${min}px`
        if (!fits()) return false
        for (let step = 0; step < 10; step++) {
          const middle = (min + max) / 2
          element.style[property] = `${middle}px`
          if (fits()) min = middle
          else max = middle
        }
        element.style[property] = `${min}px`
        return true
      }

      if (fitProperty('letterSpacing', 0, baseSpacing)) return
      fitProperty('fontSize', minSize, baseSize)
      // CSS ellipsis handles names that still exceed the available width at
      // the readable minimum. The DOM and title retain the complete name.
    }

    const scheduleFit = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(fit)
    }
    fit()
    const observer = new ResizeObserver(scheduleFit)
    observer.observe(element)
    window.addEventListener('resize', scheduleFit)
    document.fonts.addEventListener('loadingdone', scheduleFit)
    void document.fonts.ready.then(() => { if (!disposed) scheduleFit() })
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', scheduleFit)
      document.fonts.removeEventListener('loadingdone', scheduleFit)
    }
  }, [name])

  return <strong ref={nameRef} title={name}>{name.toLocaleUpperCase('et')}</strong>
}
