import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import CompanyHomepage from '../../src/CompanyHomepage'
import type { PublicStoreRecord } from '../../src/lib/database'
import type { Product } from '../../src/products'
import type { CompanyCopy } from '../../shared/company-homepage-copy.mjs'
import './preview.css'

type PageData = { store: PublicStoreRecord; products: Product[]; revision: number; shopUrl: string }

function Preview() {
  const [data, setData] = useState<PageData | null>(null)
  const [error, setError] = useState('')
  const version = useRef(0)
  useEffect(() => {
    fetch('/api/homepage').then(async response => {
      if (response.status === 401) { window.location.replace('/'); return }
      if (!response.ok) throw new Error('Lehe laadimine ebaõnnestus. Proovi uuesti.')
      const value = await response.json() as PageData
      version.current = value.revision
      setData(value)
    }).catch(error => setError(error.message))
  }, [])
  const review = useMemo(() => ({
    shopUrl: data?.shopUrl || 'https://kruk-kruk.poeruum.ee/',
    save: async (copy: CompanyCopy) => {
      const response = await fetch('/api/homepage', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ copy, revision: version.current }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Salvestamine ebaõnnestus. Proovi uuesti.')
      version.current = result.revision
    },
    logout: () => {
      const form = document.createElement('form')
      form.method = 'POST'; form.action = '/logout'; document.body.append(form); form.submit()
    },
  }), [data?.shopUrl])
  if (error) return <main className="review-loading"><p role="alert">{error}</p><button onClick={() => window.location.reload()}>Proovi uuesti</button></main>
  if (!data) return <main className="review-loading" aria-busy="true">Laadin kodulehte…</main>
  return <CompanyHomepage store={data.store} products={data.products} review={review} />
}
createRoot(document.getElementById('root')!).render(<Preview />)
