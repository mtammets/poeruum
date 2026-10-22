export const birdImage = '/images/campaigns/musta-rahni-cutout-v2.webp'
export const bareheadedImage = '/images/campaigns/musta-rahni-bareheaded-v1.webp'
export const capImage = '/images/campaigns/kruk-cap-cutout-v1.webp'

// Original photo coordinates; the foreground starts with these exact pixels.
export const capOutline = 'M 667 223 C 676 216 690 216 699 214 C 709 196 722 185 738 187 C 766 188 783 214 784 246 L 771 246 C 751 236 735 232 716 231 C 701 239 681 241 667 232 Z'
export const headPatch = 'M 654 176 H 798 V 267 H 654 Z'
export type HatOrigin = { x: number; y: number; width: number; rotation: number }

export function getHatOrigin(image: SVGSVGElement): HatOrigin | null {
  const matrix = image.getScreenCTM()
  if (!matrix) return null
  const center = new DOMPoint(727, 224).matrixTransform(matrix)
  return {
    x: center.x,
    y: center.y,
    width: 144 * Math.hypot(matrix.a, matrix.b),
    rotation: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI,
  }
}
