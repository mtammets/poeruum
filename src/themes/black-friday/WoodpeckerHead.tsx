import { birdImage } from './krukHatMotion'
import type useWoodpeckerCall from './useWoodpeckerCall'
import WoodpeckerBeak, { lowerBeak } from './WoodpeckerBeak'
import WoodpeckerEye from './WoodpeckerEye'

// The photographed head and upper neck, with overlap under the body's feathers.
// Keep the rider's hand and legs on the stationary body layer.
const crownAndBeak = 'M10 438 L183 430 Q218 401 287 389 Q341 384 389 396 Q428 403 449 425 L460 442 Q449 452 461 467 Q481 487 504 510'
export const headCutout = `${crownAndBeak} L522 544 Q493 590 456 631 L394 633 Q310 592 269 550 L220 527 L174 516 L10 500 Z`
const headOutline = `${crownAndBeak} L574 570 Q553 647 493 685 L399 673 Q310 592 269 550 L220 527 L174 516 L10 500 Z`

export default function WoodpeckerHead({ clipId, call }: { clipId: string; call: ReturnType<typeof useWoodpeckerCall> }) {
  return <span className="woodpecker-head">
    <svg className="woodpecker-head__image" viewBox="10 370 580 330" width="580" height="330">
      <defs>
        <mask id={`${clipId}-head`} maskUnits="userSpaceOnUse" x="0" y="360" width="610" height="350">
          <path d={headOutline} fill="white" stroke="white" strokeWidth="16" strokeLinejoin="round" />
          <path d={lowerBeak} fill="black" />
        </mask>
        <clipPath id={`${clipId}-beak`}><path d={lowerBeak} /></clipPath>
      </defs>
      <image href={birdImage} width="1448" height="1086" mask={`url(#${clipId}-head)`} />
    </svg>
    <WoodpeckerEye clipId={clipId} />
    <svg className="black-friday-screensaver__beak-layer" viewBox="30 450 255 110" width="255" height="110">
      <WoodpeckerBeak clipId={clipId} {...call} calling />
    </svg>
  </span>
}
