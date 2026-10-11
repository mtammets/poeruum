import { useEffect } from 'react'
import WithdrawalForm from './WithdrawalForm'
import { applySeoMetadata } from './lib/seo'
export default function WithdrawalPage() {
  const slug = new URLSearchParams(window.location.search).get('store') || ''
  useEffect(() => { applySeoMetadata({ title: 'Taganen lepingust — Poeruum', description: 'Esita müüjale taganemisavaldus.', canonicalUrl: `${window.location.origin}/taganemine`, noIndex: true }) }, [])
  return <main className="withdrawal-page"><div>{/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)
    ? <WithdrawalForm store={{ storeSlug: slug }} storeName={`${slug}.poeruum.ee`} />
    : <><h1>Taganen lepingust</h1><p>Ava taganemisvorm poe jalusest või tellimuse kinnituslingilt.</p></>}</div></main>
}
