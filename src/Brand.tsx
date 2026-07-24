export function BrandMark({ className = '' }: { className?: string }) {
  return <span className={`platform-brand__mark${className ? ` ${className}` : ''}`} aria-hidden="true">
    <svg viewBox="0 0 40 40">
      <rect x="1" y="1" width="38" height="38" rx="11" />
      <path d="M10 16.5h20l-1.7 15H11.7L10 16.5Z" />
      <path d="M14.8 18v-3.2C14.8 11.3 16.9 9 20 9s5.2 2.3 5.2 5.8V18" />
      <path d="M15.5 22.2h9" />
    </svg>
  </span>
}

export function Brand() {
  return <div className="platform-brand" aria-label="Poeruum">
    <BrandMark />
    <strong>Poe<span>ruum</span></strong>
  </div>
}
