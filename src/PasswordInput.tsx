import { useId, useState, type ComponentProps, type ReactNode } from 'react'
import './passwordInput.css'

type PasswordInputProps = Omit<ComponentProps<'input'>, 'type'> & { label: string; hint?: ReactNode }

export default function PasswordInput({ label, hint, id, className, disabled, ...props }: PasswordInputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const [isVisible, setIsVisible] = useState(false)
  const toggleLabel = isVisible ? 'Peida parool' : 'Näita parooli'

  return <div className="password-control">
    <label htmlFor={inputId}>{label}</label>
    <span className="password-field">
    <input {...props} id={inputId} aria-describedby={[props['aria-describedby'], hint ? `${inputId}-hint` : undefined].filter(Boolean).join(' ') || undefined} className={`password-field__input${className ? ` ${className}` : ''}`} type={isVisible ? 'text' : 'password'} disabled={disabled} spellCheck={false} autoCapitalize="none" autoCorrect="off" />
    <button className="password-field__toggle" type="button" disabled={disabled} aria-label={toggleLabel} aria-controls={inputId} title={toggleLabel} onPointerDown={(event) => event.preventDefault()} onClick={() => setIsVisible((visible) => !visible)}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {isVisible ? <>
          <path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.5 5.3A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3 3.8M6.2 6.2A20 20 0 0 0 2 12s4 7 10 7a10 10 0 0 0 5.8-1.8" />
        </> : <>
          <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </>}
      </svg>
    </button>
    </span>
    {hint && <small id={`${inputId}-hint`}>{hint}</small>}
  </div>
}
