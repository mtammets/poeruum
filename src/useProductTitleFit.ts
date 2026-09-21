import { useLayoutEffect, type RefObject } from 'react'

export default function useProductTitleFit(ref: RefObject<HTMLHeadingElement | null>, name: string | undefined, isEditing: boolean) {
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    let frame = 0
    let disposed = false
    const range = document.createRange()

    const fit = () => {
      if (disposed || !element.clientWidth) return
      // Restore the responsive size before measuring, including after a title
      // change or when the details panel gets wider.
      element.style.removeProperty('font-size')
      element.style.overflowWrap = 'normal'
      const baseSize = parseFloat(getComputedStyle(element).fontSize)
      const minSize = Math.min(baseSize, parseFloat(getComputedStyle(document.documentElement).fontSize) * 1.5)
      range.selectNodeContents(element)
      const fits = () => range.getBoundingClientRect().width <= element.clientWidth
      if (fits()) return

      // Let whole words wrap naturally; shrink only if a word still overflows.
      let min = minSize
      let max = baseSize
      element.style.fontSize = `${min}px`
      if (!fits()) {
        // Preserve readability for exceptional names such as a long unbroken
        // identifier. Emergency wrapping is only allowed at the minimum size.
        element.style.removeProperty('overflow-wrap')
        return
      }
      for (let step = 0; step < 10; step++) {
        const middle = (min + max) / 2
        element.style.fontSize = `${middle}px`
        if (fits()) min = middle
        else max = middle
      }
      element.style.fontSize = `${min}px`
    }

    const scheduleFit = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(fit)
    }
    fit()
    // Font fitting changes height. Observe width only to avoid a resize loop.
    let width = element.clientWidth
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return
      width = element.clientWidth
      scheduleFit()
    })
    observer.observe(element)
    element.addEventListener('input', scheduleFit)
    window.addEventListener('resize', scheduleFit)
    document.fonts.addEventListener('loadingdone', scheduleFit)
    void document.fonts.ready.then(() => { if (!disposed) scheduleFit() })
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      element.removeEventListener('input', scheduleFit)
      window.removeEventListener('resize', scheduleFit)
      document.fonts.removeEventListener('loadingdone', scheduleFit)
    }
  }, [ref, name, isEditing])
}
