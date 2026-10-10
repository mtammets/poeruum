import { useEffect, useLayoutEffect, useRef, type ReactNode, type CompositionEventHandler } from 'react'
import ModalCloseButton from './ModalCloseButton'
import './storeSettings.css'

export default function StoreSettingsDrawer({ storeName, storeLogo, title, section, onBack, onClose, onCompositionStart, onCompositionEnd, saveAction, children }: {
  storeName: string
  storeLogo?: string | null
  title: string
  section: string
  onBack?: () => void
  onClose: () => void
  onCompositionStart: CompositionEventHandler<HTMLElement>
  onCompositionEnd: CompositionEventHandler<HTMLElement>
  saveAction?: ReactNode
  children: ReactNode
}) {
  const dialog = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const previousSection = useRef(section)

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.focus({ preventScroll: true })
    return () => { if (opener?.isConnected) opener.focus({ preventScroll: true }) }
  }, [])

  useLayoutEffect(() => {
    if (previousSection.current === section) return
    body.current?.scrollTo(0, 0)
    const previous = previousSection.current
    previousSection.current = section
    if (section === 'home') {
      dialog.current?.querySelector<HTMLElement>(`button[data-section="${previous}"]`)?.focus({ preventScroll: true })
    } else heading.current?.focus({ preventScroll: true })
  }, [section])

  return <div className="overlay settings-drawer-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className={`settings-drawer${section === 'home' ? ' is-home' : ''}`} data-section={section} role="dialog" aria-modal="true" aria-label="Seaded" tabIndex={-1} ref={dialog}
      onCompositionStart={onCompositionStart} onCompositionEnd={onCompositionEnd}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
        if (event.key !== 'Tab') return
        const elements = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], summary, [tabindex="0"]')]
          .filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden')
        const first = elements[0], last = elements.at(-1)
        const active = document.activeElement
        if (event.shiftKey && (active === first || active === dialog.current || active === heading.current)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && (active === last || active === dialog.current || active === heading.current)) { event.preventDefault(); first?.focus() }
      }}>
      <header className="settings-drawer__header">
        {onBack ? <button className="settings-drawer__icon-button" type="button" onClick={onBack} aria-label="Kõik seaded"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg></button>
          : <span className="settings-drawer__mark" aria-hidden="true">{storeLogo ? <img src={storeLogo} alt="" /> : storeName.trim().charAt(0).toLocaleUpperCase('et') || 'P'}</span>}
        <div><span className="settings-drawer__eyebrow">{onBack ? 'Seaded' : storeName}</span><h2 ref={heading} tabIndex={-1}>{title}</h2></div>
        <ModalCloseButton className="settings-drawer__icon-button" onClose={onClose} />
      </header>
      <div className="settings-drawer__body" ref={body}>{children}</div>
      {saveAction && <footer className="settings-drawer__footer" aria-live="polite">{saveAction}</footer>}
    </section>
  </div>
}
