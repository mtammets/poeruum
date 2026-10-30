import type { RefObject } from 'react'
import { birdImage } from './krukHatMotion'

// Lower mandible and hinge in the source image's 1448 × 1086 coordinate space.
export const lowerBeak = 'M 39 468 L 265 488 L 272 506 L 247 520 L 209 519 L 147 506 L 83 487 Z'

export default function WoodpeckerBeak({ clipId, calling, beakRef, mouthRef }: {
  clipId: string
  calling: boolean
  beakRef: RefObject<SVGGElement | null>
  mouthRef: RefObject<SVGPathElement | null>
}) {
  return <g visibility={calling ? 'visible' : 'hidden'} aria-hidden="true">
    <path ref={mouthRef} className="woodpecker-mouth" d="" fill="#201818" />
    <g ref={beakRef} className="woodpecker-beak" transform="rotate(0 265 490)">
      <image href={birdImage} width="1448" height="1086" clipPath={`url(#${clipId}-beak)`} />
    </g>
  </g>
}
