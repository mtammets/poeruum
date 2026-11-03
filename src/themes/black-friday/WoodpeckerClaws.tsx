import { birdImage } from './krukHatMotion'
import { capWidthInBirdImage, carriedHatPlacement, gameCapImage } from './hatFlightPhysics'

// Isolate the photographed toes, preserving their texture and their ankle joint.
export const clawOutline = 'M800 864 Q815 860 827 877 Q847 881 871 892 Q884 896 901 906 Q910 906 917 897 L920 916 Q928 912 932 899 L935 899 Q938 923 922 932 Q907 943 884 937 Q851 928 825 911 Q805 896 800 880 Z'

export function WoodpeckerClawDefs({ clipId }: { clipId: string }) {
  return <defs>
      <filter id={`${clipId}-feather-edge`} x="-10%" y="-20%" width="120%" height="140%"><feGaussianBlur stdDeviation="3" /></filter>
      <mask id={`${clipId}-feathers`} maskUnits="userSpaceOnUse" x="775" y="830" width="200" height="120">
        <path d="M790 845 Q847 849 896 880 L950 899 L960 928 Q939 916 920 909 Q885 902 859 889 Q830 878 800 886 Z" fill="white" filter={`url(#${clipId}-feather-edge)`} />
      </mask>
      <mask id={`${clipId}-without-foot`} maskUnits="userSpaceOnUse" x="0" y="0" width="1448" height="1086">
        <rect width="1448" height="1086" fill="white" />
        <path d={clawOutline} fill="black" stroke="black" strokeWidth="3" />
      </mask>
      <clipPath id={`${clipId}-ankle`}><path d="M795 857 Q818 855 832 877 L838 891 L823 905 Q805 899 797 882 Z" /></clipPath>
      <clipPath id={`${clipId}-rear-toes`}><path d="M818 878 Q830 877 844 883 L866 891 Q879 894 891 902 Q901 910 910 903 L916 901 Q920 910 917 917 Q902 924 888 916 L873 909 Q857 907 843 901 L824 894 Q815 891 815 884 Z" /></clipPath>
      <clipPath id={`${clipId}-front-toes`}><path d="M815 887 Q827 892 841 901 Q859 913 880 920 Q899 927 910 919 Q926 917 932 902 Q938 918 924 932 Q905 942 887 937 Q855 931 833 916 Q819 907 811 896 Z" /></clipPath>
    </defs>
}

export function WoodpeckerFootFeathers({ clipId }: { clipId: string }) {
  return <g mask={`url(#${clipId}-feathers)`}>
      <image href={birdImage} width="1448" height="1086" transform="translate(0 45)" />
    </g>
}

export default function WoodpeckerClaws({ clipId, caught }: { clipId: string; caught: number }) {
  return <g className="woodpecker-claws" data-grip="resting">
      <g><image href={birdImage} width="1448" height="1086" clipPath={`url(#${clipId}-ankle)`} /></g>
      <g className="woodpecker-claws__rear"><g>
        <image href={birdImage} width="1448" height="1086" clipPath={`url(#${clipId}-rear-toes)`} />
      </g></g>
      <g className="hat-flight__cargo">
        {Array.from({ length: Math.min(caught, 6) }, (_, i) => {
          const cap = carriedHatPlacement(i)
          return <g key={i} className="hat-flight__collected">
            <image href={gameCapImage} x={cap.x} y={cap.y} width={capWidthInBirdImage} height={capWidthInBirdImage * .75}
              transform={`rotate(${cap.rotation} 855 905)`} />
          </g>
        })}
      </g>
      <g className="woodpecker-claws__front"><g>
        <image href={birdImage} width="1448" height="1086" clipPath={`url(#${clipId}-front-toes)`} />
      </g></g>
    </g>
}
