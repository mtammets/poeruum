import { birdImage } from './krukHatMotion'

// Original-photo wings. The body retains overlapping shoulder feathers above
// these moving layers, so the rider and the wing roots never move with the tips.
const farWing = 'M175 -5 H665 V304 Q624 310 597 340 L555 380 L513 405 L481 422 L458 423 L427 399 L360 387 L175 300 Z'
const nearWing = 'M808 535 Q815 470 866 409 L1000 280 L1290 50 H1455 V835 H1080 Q990 800 925 725 Q850 660 808 535 Z'
export const wingCutouts = 'M175 -5 H665 V304 Q624 310 597 340 L555 380 L507 395 L460 390 L370 365 L175 300 Z '
  + 'M780 560 Q795 490 866 409 L1000 280 L1290 50 H1455 V835 H1080 Q995 770 960 700 L870 545 Z'

export default function WoodpeckerWings({ clipId }: { clipId: string }) {
  return <>
    <svg className="woodpecker-wing woodpecker-wing--far" viewBox="175 0 490 470" width="490" height="470">
      <defs><clipPath id={`${clipId}-far-wing`}><path d={farWing} /></clipPath></defs>
      <image href={birdImage} width="1448" height="1086" clipPath={`url(#${clipId}-far-wing)`} />
    </svg>
    <svg className="woodpecker-wing woodpecker-wing--near" viewBox="780 50 668 800" width="668" height="800">
      <defs><clipPath id={`${clipId}-near-wing`}><path d={nearWing} /></clipPath></defs>
      <image href={birdImage} width="1448" height="1086" clipPath={`url(#${clipId}-near-wing)`} />
    </svg>
    <svg className="woodpecker-wing-roots" viewBox="0 0 1448 1086" width="1448" height="1086">
      <defs>
        <filter id={`${clipId}-shoulder-soften`}><feGaussianBlur stdDeviation="3" /></filter>
        <mask id={`${clipId}-far-shoulder`} maskUnits="userSpaceOnUse" x="470" y="310" width="180" height="150">
          <path d="M481 415 L604 322 L636 346 L530 445 Z" fill="white" filter={`url(#${clipId}-shoulder-soften)`} />
        </mask>
        <mask id={`${clipId}-near-shoulder`} maskUnits="userSpaceOnUse" x="800" y="495" width="135" height="210">
          <path d="M820 550 Q853 540 880 580 L924 670 L861 691 L810 580 Z" fill="white" filter={`url(#${clipId}-shoulder-soften)`} />
        </mask>
      </defs>
      <g mask={`url(#${clipId}-far-shoulder)`}><image href={birdImage} width="1448" height="1086" transform="translate(100 60)" /></g>
      <g mask={`url(#${clipId}-near-shoulder)`}><image href={birdImage} width="1448" height="1086" transform="translate(-40 -30)" /></g>
    </svg>
  </>
}
