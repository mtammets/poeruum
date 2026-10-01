import type { ReactNode } from 'react'

export type IconName = 'users' | 'store' | 'sales' | 'alert' | 'message' | 'check' | 'clock' | 'minus' | 'flask' | 'help' | 'search' | 'arrow' | 'close' | 'filter' | 'chevron' | 'card' | 'truck' | 'box' | 'mail' | 'shield' | 'pulse' | 'info'
export default function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M21 20v-2a6 6 0 0 0-3-5" /></>,
    store: <><path d="M3 10h18l-2-6H5l-2 6Zm2 0v10h14V10M9 20v-6h6v6" /></>,
    sales: <><path d="m3 17 6-6 4 4 8-10M15 5h6v6" /></>,
    alert: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 17h.01" /></>,
    message: <><path d="M4 4h16v13H9l-5 4V4Z" /><path d="M8 9h8M8 13h5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    minus: <path d="M6 12h12" />,
    flask: <><path d="M9 3h6M10 3v7l-6 9q-1 2 2 2h12q3 0 2-2l-6-9V3M7 16h10" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9 9a3 3 0 1 1 5 2l-2 2M12 17h.01" /></>,
    search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></>,
    arrow: <path d="M6 18 18 6M7 6h11v11" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    filter: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="2" /><circle cx="15" cy="17" r="2" /></>,
    card: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3 10h18M7 15h3" /></>,
    truck: <><path d="M3 5h11v12H3zM14 9h4l3 4v4h-7" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></>,
    box: <><path d="m12 3 9 5v9l-9 5-9-5V8l9-5Zm0 10v9M3 8l9 5 9-5M7 5l10 6" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m3 6 9 7 9-7" /></>,
    shield: <><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z" /><path d="m8 12 3 3 5-6" /></>,
    pulse: <path d="M2 12h5l3-8 4 16 3-8h5" />,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
    chevron: <path d="m9 5 7 7-7 7" />,
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}
