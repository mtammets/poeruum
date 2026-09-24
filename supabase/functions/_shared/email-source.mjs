const defaultSender = 'teavitused@send.poeruum.ee'

// Accept one mailbox, optionally wrapped in a display name. A full address is
// required: a matching display name or domain suffix never establishes origin.
export const normalizeSenderEmail = (value) => {
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) return null
  const header = value.trim()
  const address = (header.includes('<') || header.includes('>'))
    ? header.match(/^(?:"(?:[^"\\]|\\.)*"|[^"<>@,;:]*)\s*<([^<>]+)>$/)?.[1]?.trim()
    : header
  if (!address || address.length > 254) return null

  const [local, domain, extra] = address.toLowerCase().split('@')
  if (extra !== undefined || !local || local.length > 64 || !domain) return null
  if (!/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(local)) return null
  const labels = domain.split('.')
  if (labels.length < 2 || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null
  return `${local}@${domain}`
}

export const isPoeruumSender = (value, configuredSenders = []) => {
  const sender = normalizeSenderEmail(value)
  return sender !== null && [defaultSender, ...configuredSenders]
    .some((candidate) => normalizeSenderEmail(candidate) === sender)
}
