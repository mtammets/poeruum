import type { ReactNode } from 'react'

export type CardIconName = 'text' | 'image' | 'shape' | 'qr' | 'undo' | 'redo' | 'download' | 'settings' | 'trash' | 'copy' | 'lock' | 'unlock' | 'up' | 'down' | 'check' | 'close' | 'minus' | 'plus' | 'layers' | 'alignLeft' | 'alignCenter' | 'alignRight' | 'eye' | 'rotate' | 'file' | 'upload'
const paths: Record<CardIconName, ReactNode> = {
  text: <><path d="M4 6V4h16v2M12 4v16M8 20h8" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 6-6 4 4 3-3 5 5" /></>,
  shape: <><rect x="3" y="3" width="11" height="11" rx="1" /><circle cx="15.5" cy="15.5" r="5.5" /></>,
  qr: <><path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h2v2h-2zM19 15h2v6h-6v-2M6 6h.01M18 6h.01M6 18h.01" /></>,
  undo: <><path d="M8 5 3 10l5 5M3 10h11a6 6 0 0 1 0 12" transform="translate(0 -2)" /></>,
  redo: <><path d="m16 5 5 5-5 5M21 10H10a6 6 0 0 0 0 12" transform="translate(0 -2)" /></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" /></>,
  settings: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="8" cy="6" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="10" cy="18" r="2" /></>,
  trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></>,
  copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
  unlock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 7-2M12 14v3" /></>,
  up: <path d="m6 14 6-6 6 6" />,
  down: <path d="m6 10 6 6 6-6" />,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  minus: <path d="M5 12h14" />,
  plus: <path d="M5 12h14M12 5v14" />,
  layers: <><path d="m3 8 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M3 18l9 5 9-5" transform="translate(0 -1)" /></>,
  alignLeft: <path d="M4 5h16M4 10h10M4 15h16M4 20h10" />,
  alignCenter: <path d="M4 5h16M7 10h10M4 15h16M7 20h10" />,
  alignRight: <path d="M4 5h16M10 10h10M4 15h16M10 20h10" />,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>,
  rotate: <><path d="M4 10a8 8 0 1 1 1 7M4 4v6h6" /></>,
  file: <><path d="M14 3H5v18h14V8l-5-5ZM14 3v6h5M8 13h8M8 17h5" /></>,
  upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 16v4h16v-4" /></>,
}
export function CardIcon({ name }: { name: CardIconName }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
