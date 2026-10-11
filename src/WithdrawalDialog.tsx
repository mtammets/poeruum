import { useEffect, useRef } from 'react'
import ModalCloseButton from './ModalCloseButton'
import WithdrawalForm from './WithdrawalForm'
import type { WithdrawalStore } from './lib/withdrawals'
export default function WithdrawalDialog({ store, storeName, orderReference, onClose }: {
  store: WithdrawalStore; storeName: string; orderReference?: string; onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element?.showModal()
    return () => { element?.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }) }
  }, [])
  return <dialog className="withdrawal-dialog" ref={dialog} aria-label="Taganen lepingust" onCancel={onClose} onKeyDown={(event) => event.stopPropagation()} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div><ModalCloseButton onClose={onClose} /><WithdrawalForm store={store} storeName={storeName} orderReference={orderReference} /></div>
  </dialog>
}
