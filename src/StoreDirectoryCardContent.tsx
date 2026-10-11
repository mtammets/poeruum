import type { ReactNode } from 'react'
import type { StoreDirectoryEntry } from '../shared/store-directory.mjs'
import { ArrowUpRight } from './StoreDirectoryLayout'

export default function StoreDirectoryCardContent({ store, index = 0, isExample = false, mediaActions }: {
  store: Pick<StoreDirectoryEntry, 'name' | 'description' | 'imageUrl' | 'logoUrl'>
  index?: number
  isExample?: boolean
  mediaActions?: ReactNode
}) {
  const isInvitation = isExample && !store.imageUrl
  return <>
    <div className={`store-directory__media${isInvitation ? ' store-directory__media--invitation' : ''}`}>
      {store.imageUrl ? <img
        key={store.imageUrl}
        className="store-directory__cover"
        src={store.imageUrl}
        alt=""
        loading={index < 2 ? 'eager' : 'lazy'}
        fetchPriority={index === 0 ? 'high' : 'auto'}
        decoding="async"
        onError={(event) => { event.currentTarget.style.visibility = 'hidden' }}
      /> : null}
      {isInvitation ? <div className="store-directory__invitation" aria-hidden="true">
        <span className="store-directory__invitation-plus">+</span>
        <span className="store-directory__invitation-message">Siin võiks olla<strong>sinu pood.</strong></span>
      </div> : <span className="store-directory__card-shade" aria-hidden="true" />}
      {mediaActions}
    </div>
    <div className="store-directory__card-copy">
      <div className="store-directory__identity">
        <span className="store-directory__identity-mark" aria-hidden="true">
          <b>{isExample ? '+' : store.name.charAt(0).toLocaleUpperCase('et')}</b>
          {store.logoUrl ? <img key={store.logoUrl} src={store.logoUrl} alt="" loading="lazy" decoding="async" onError={(event) => { event.currentTarget.style.visibility = 'hidden' }} /> : null}
        </span>
        <div>
          <h3>{store.name}</h3>
          <p>{store.description || 'Avasta poe valikut.'}</p>
        </div>
      </div>
      <span className="store-directory__card-cta" aria-hidden="true">
        {isExample ? 'Loo oma pood' : 'Ava pood'}
        <ArrowUpRight />
      </span>
    </div>
  </>
}
