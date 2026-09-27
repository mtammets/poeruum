import { useState } from 'react'
import AdminStoreDirectory from './AdminStoreDirectory'
import AdminDirectoryAnalytics from './AdminDirectoryAnalytics'
import AdminHomepageShowcase from './AdminHomepageShowcase'
import './directoryAnalytics.css'

const tabs = [['stats', 'Statistika'], ['order', 'Poodide järjekord'], ['homepage', 'Avalehe eelvaade']] as const

export default function AdminKaubamaja() {
  const requested = new URLSearchParams(window.location.search).get('view')
  const initial = tabs.find(([id]) => id === requested)?.[0] ?? 'stats'
  const [tab, setTab] = useState(initial)
  const [visited, setVisited] = useState(() => new Set([initial]))
  const select = (next: typeof tabs[number][0]) => {
    setTab(next)
    setVisited((current) => new Set([...current, next]))
    const url = new URL(window.location.href)
    if (next !== 'stats') url.searchParams.set('view', next)
    else url.searchParams.delete('view')
    window.history.replaceState(window.history.state, '', url)
  }
  return <div className="admin-kaubamaja">
    <div className="admin-kaubamaja__tabs" role="tablist" aria-label="Kaubamaja haldus">
      {tabs.map(([id, label], index) => <button
        key={id} id={`directory-tab-${id}`} role="tab" type="button" aria-selected={tab === id}
        aria-controls={`directory-panel-${id}`} tabIndex={tab === id ? 0 : -1}
        onClick={() => select(id)} onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length][0]
          select(next)
          document.getElementById(`directory-tab-${next}`)?.focus()
        }}
      >{label}</button>)}
    </div>
    <div id="directory-panel-stats" role="tabpanel" aria-labelledby="directory-tab-stats" hidden={tab !== 'stats'}>
      {visited.has('stats') && <AdminDirectoryAnalytics />}
    </div>
    <div id="directory-panel-order" role="tabpanel" aria-labelledby="directory-tab-order" hidden={tab !== 'order'}>
      {visited.has('order') && <AdminStoreDirectory />}
    </div>
    <div id="directory-panel-homepage" role="tabpanel" aria-labelledby="directory-tab-homepage" hidden={tab !== 'homepage'}>
      {visited.has('homepage') && <AdminHomepageShowcase />}
    </div>
  </div>
}
