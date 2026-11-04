import { clamp, projectFlightPoint, type FlightGeometry } from './screensaverFlight'
import { entranceSeconds, deliveredSeconds, type HatDelivery } from './hatDelivery'

const smooth = (t: number) => { const v = clamp(t, 0, 1); return v * v * (3 - 2 * v) }
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
type Viewport = { width: number; height: number }

// A world object moving with the forest, never a replacement background.
export function destinationFrame(viewport: Viewport, approach: number) {
  const mobile = viewport.width <= 760
  const width = mobile ? viewport.width * 1.25 : Math.min(viewport.width * .83, viewport.height * 1.7)
  const height = width / 2
  const left = lerp(-width, mobile ? -viewport.width * .42 : -width * .08, smooth(approach))
  return { width, height, left, top: viewport.height * .86 - height * .89 }
}

export function createDepartmentStoreArrival(dialog: HTMLDialogElement) {
  const shop = dialog.querySelector<HTMLElement>('.hat-delivery__destination')!
  const facade = dialog.querySelector<SVGSVGElement>('.hat-delivery__facade')!
  const branding = dialog.querySelector<HTMLElement>('.hat-delivery__branding')!
  const ground = dialog.querySelector<HTMLElement>('.hat-delivery__ground')!
  const shadow = dialog.querySelector<HTMLElement>('.hat-delivery__shadow')!
  const bird = dialog.querySelector<HTMLElement>('.black-friday-screensaver__bird')!
  let origin: { x: number; y: number; scale: number; bank: number } | null = null

  return (journey: HatDelivery, geometry: FlightGeometry, viewport: Viewport, reduced: boolean): FlightGeometry => {
    if (!origin) {
      const point = projectFlightPoint(geometry, { x: .58, y: .45 })
      origin = { x: point.x / viewport.width, y: point.y / viewport.height,
        scale: geometry.pose.scale, bank: geometry.pose.bank }
    }
    const t = journey.elapsed
    const frame = destinationFrame(viewport, t / 4.8)
    for (const element of [shop, facade, branding]) {
      element.style.width = `${frame.width}px`; element.style.height = `${frame.height}px`
      element.style.left = `${frame.left}px`; element.style.top = `${frame.top}px`
    }
    shop.style.visibility = 'visible'
    facade.style.visibility = 'visible'
    branding.style.visibility = 'visible'
    const approach = smooth(t / entranceSeconds)
    const entry = smooth((t - entranceSeconds) / (deliveredSeconds - entranceSeconds))
    const finalFrame = destinationFrame(viewport, 1)
    const groundWidth = finalFrame.width * 2.5
    ground.style.visibility = 'visible'
    ground.style.width = `${groundWidth}px`
    ground.style.height = `${Math.max(finalFrame.height * 1.3, viewport.height * .55)}px`
    ground.style.left = `${lerp(-groundWidth, finalFrame.left - finalFrame.width * .4, smooth(t / 4.8))}px`
    ground.style.top = `${finalFrame.top + finalFrame.height * .22}px`
    const targetScale = finalFrame.width * .205 / geometry.bounds.width
    const from = { x: origin.x * viewport.width, y: origin.y * viewport.height }
    const landing = { x: finalFrame.left + finalFrame.width * .923, y: finalFrame.top + finalFrame.height * .735 }
    const x = lerp(from.x, landing.x, approach) - finalFrame.width * .24 * entry
    const y = lerp(from.y, landing.y, approach) + (reduced ? 0 : Math.sin(approach * Math.PI) * viewport.height * .035)
      - finalFrame.height * .018 * entry
    // Keep the bird's scale at the door; the wall physically hides it.
    const scale = lerp(origin.scale, targetScale, approach) * lerp(1, .91, entry)
    const bank = reduced ? 0 : lerp(origin.bank, -2, approach) + Math.sin(entry * Math.PI) * 2
    bird.style.filter = entry ? `brightness(${lerp(1, .62, entry)})` : ''
    shadow.style.opacity = String(.3 * smooth((t - 3) / 2) * (1 - entry))
    shadow.style.width = `${geometry.bounds.width * scale * .65}px`
    shadow.style.left = `${x}px`
    shadow.style.top = `${finalFrame.top + finalFrame.height * .86}px`
    return { ...geometry, pose: { ...geometry.pose, bank, scale }, position: {
      x: x - geometry.bounds.left - geometry.bounds.width * .58,
      y: y - geometry.bounds.top - geometry.bounds.height * .45,
    } }
  }
}
