const endpoint = `${String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '')}/functions/v1/report-client-error`
let isReporting = false

export const sanitizeErrorUrl = (value: string) => {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return ''
  }
}

const textValue = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max)

export const reportClientError = (
  error: unknown,
  source = 'browser',
  componentStack = '',
) => {
  if (!endpoint.startsWith('https://') || isReporting) return
  const normalized = error instanceof Error ? error : new Error(textValue(error, 500) || 'Unknown browser error')
  const payload = {
    source: textValue(source, 100),
    message: textValue(normalized.message, 500),
    stack: textValue([normalized.stack, componentStack].filter(Boolean).join('\n'), 4000),
    url: sanitizeErrorUrl(window.location.href),
  }
  isReporting = true
  void fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => undefined).finally(() => {
    isReporting = false
  })
}

export const registerGlobalErrorMonitoring = () => {
  window.addEventListener('error', (event) => {
    reportClientError(event.error || event.message, 'window.error')
  })
  window.addEventListener('unhandledrejection', (event) => {
    reportClientError(event.reason, 'unhandledrejection')
  })
}
