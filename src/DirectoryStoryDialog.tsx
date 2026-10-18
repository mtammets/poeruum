import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { DirectoryStory } from '../shared/directory-stories.mjs'
import DirectoryStoryArticle from './DirectoryStoryArticle'
import ModalCloseButton from './ModalCloseButton'

export default function DirectoryStoryDialog({ story, opener, onClose, onDiscover }: {
  story: DirectoryStory
  opener: HTMLElement | null
  onClose: () => void
  onDiscover: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current!
    const { overflow, paddingRight } = document.body.style
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${parseFloat(getComputedStyle(document.body).paddingRight) + scrollbarWidth}px`
    document.body.style.overflow = 'hidden'
    dialog.showModal()
    return () => {
      dialog.close()
      document.body.style.overflow = overflow
      document.body.style.paddingRight = paddingRight
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [opener])

  return createPortal(<dialog ref={dialogRef} className="directory-story-dialog" aria-label={story.title}
    onCancel={(event) => { event.preventDefault(); onClose() }}
    onKeyDown={(event) => event.stopPropagation()}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
    }}>
    <div className="directory-story-dialog__toolbar">
      <ModalCloseButton className="directory-story-dialog__close" onClose={onClose} />
    </div>
    <div className="directory-story-dialog__content" tabIndex={0}>
      <DirectoryStoryArticle story={story} onDiscover={onDiscover} />
    </div>
  </dialog>, document.body)
}
