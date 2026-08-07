import type { MouseEvent, TouchEvent } from 'react'

type ModalCloseButtonProps = {
  onClose: () => void
  disabled?: boolean
  className?: string
}

export default function ModalCloseButton({ onClose, disabled = false, className = 'login-sheet__close' }: ModalCloseButtonProps) {
  const closeFromClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!disabled) onClose()
  }

  const closeFromTouch = (event: TouchEvent<HTMLButtonElement>) => {
    // iOS Safari may dispatch a delayed compatibility click after touchend.
    // Closing during touchend and cancelling that click prevents it from
    // reaching whatever control is revealed underneath the modal.
    event.preventDefault()
    event.stopPropagation()
    if (!disabled) onClose()
  }

  return <button
    className={`modal-close-button ${className}`}
    type="button"
    disabled={disabled}
    onPointerDown={(event) => event.stopPropagation()}
    onTouchEnd={closeFromTouch}
    onClick={closeFromClick}
    aria-label="Sulge"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
  </button>
}
