import { useLayoutEffect, useRef } from 'react'
import { companyCopyFields } from '../shared/company-homepage-copy.mjs'

// innerText includes CSS text-transform. Read the actual spelling while keeping
// the browser's handling of Enter, pasted lines and empty lines.
function plainText(element: HTMLElement) {
  const transform = element.style.textTransform
  element.style.textTransform = 'none'
  const value = element.innerText.replace(/\r\n?/g, '\n')
  element.style.textTransform = transform
  return value
}

export default function CompanyEditableText({ field, value, editing, disabled, onChange }: {
  field: string; value: string; editing: boolean; disabled: boolean; onChange: (field: string, value: string) => void
}) {
  const element = useRef<HTMLSpanElement>(null)
  const [label, limit] = companyCopyFields[field]
  useLayoutEffect(() => {
    // Do not replace the DOM while typing: keep the selection and native undo.
    if (element.current && plainText(element.current) !== value) element.current.innerText = value
  }, [value, editing])
  return <span ref={element} className="company-copy" data-copy-field={field}
    contentEditable={editing && !disabled ? 'plaintext-only' : undefined} suppressContentEditableWarning
    role={editing ? 'textbox' : undefined} tabIndex={editing ? 0 : undefined}
    aria-label={editing ? label : undefined} aria-multiline={editing ? true : undefined}
    aria-disabled={editing && disabled ? true : undefined} data-placeholder={label}
    spellCheck={editing} onInput={event => {
      const value = plainText(event.currentTarget)
      onChange(field, value.slice(0, limit))
      if (value.length > limit) event.currentTarget.innerText = value.slice(0, limit)
    }} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); event.currentTarget.blur() }
    }} />
}
