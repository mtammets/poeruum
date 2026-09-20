import { useState } from 'react'
import AdminStoreDirectory from './AdminStoreDirectory'
import AdminDirectoryAnalytics from './AdminDirectoryAnalytics'
import './directoryAnalytics.css'

export default function AdminKaubamaja() {
  const initial = new URLSearchParams(window.location.search).get('view') === 'order' ? 'order' : 'stats'
  const [tab, setTab] = useState(initial)
  const [visited, setVisited] = useState(() => new Set([initial]))
  const select = (next: string) => {
    setTab(next)
    setVisited((current) => new Set([...current, next]))
    const url = new URL(window.location.href)
    if (next === 'order') url.searchParams.set('view', 'order')
    else url.searchParams.delete('view')
    window.history.replaceState(window.history.state, '', url)
  }
  return <div className="admin-kaubamaja">
    <div className="admin-kaubamaja__tabs" role="tablist" aria-label="Kaubamaja haldus">
      {([['stats', 'Statistika'], ['order', 'Poodide järjekord']] as const).map(([id, label]) => <button
        key={id} id={`directory-tab-${id}`} role="tab" type="button" aria-selected={tab === id}
        aria-controls={`directory-panel-${id}`} tabIndex={tab === id ? 0 : -1}
        onClick={() => select(id)} onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const next = event.key === 'Home' ? 'stats' : event.key === 'End' ? 'order' : tab === 'stats' ? 'order' : 'stats'
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
  </div>
}
