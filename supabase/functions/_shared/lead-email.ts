export type LeadEmailInput = {
  body: string
  senderName: string
  appUrl: string
}

const escapeHtml = (value: unknown) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const hasPersonalSignature = (body: string, senderName: string) => {
  const tail = body.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-5)
    .join(' ')
    .toLocaleLowerCase('et')
  const firstName = senderName.trim().split(/\s+/)[0]?.toLocaleLowerCase('et') || ''
  return /(parimat|tervitades|lugupidamisega)/u.test(tail)
    && (tail.includes('poeruum') || Boolean(firstName && tail.includes(firstName)))
}

const signatureHtml = (input: LeadEmailInput) => {
  if (hasPersonalSignature(input.body, input.senderName)) return ''
  const appUrl = input.appUrl.replace(/\/$/, '')
  return `<p style="margin:24px 0 0">Parimat<br>${escapeHtml(input.senderName)}<br><a href="${escapeHtml(appUrl)}" style="color:inherit;text-decoration:none">Poeruum · poeruum.ee</a></p>`
}

const signatureText = (input: LeadEmailInput) => {
  if (hasPersonalSignature(input.body, input.senderName)) return ''
  return `Parimat\n${input.senderName}\nPoeruum · poeruum.ee`
}

export const renderLeadEmail = (input: LeadEmailInput) => {
  const paragraphs = input.body.split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p style="margin:0 0 16px">${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`)
    .join('')
  return `<!doctype html>
<html lang="et"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;color:#222;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:16px;line-height:1.55">
<div style="max-width:640px">
${paragraphs}
${signatureHtml(input)}
<p style="margin:28px 0 0;padding-top:12px;border-top:1px solid #ddd;color:#777;font-size:11px;line-height:1.45">
Poeruum on Animaator OÜ teenus.<br>
Kui sa ei soovi minult rohkem selliseid kirju, vasta sellele kirjale „ei soovi”.
</p>
</div>
</body></html>`
}

export const renderLeadText = (input: LeadEmailInput) => [
  input.body.trim(),
  signatureText(input),
  [
    'Poeruum on Animaator OÜ teenus.',
    'Kui sa ei soovi minult rohkem selliseid kirju, vasta sellele kirjale „ei soovi”.',
  ].join('\n'),
].filter(Boolean).join('\n\n').trim()

export const isLeadOptOutReply = (value: unknown) => {
  const normalized = String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('et')
    .replace(/[„“”"'’]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return false
  return [
    /(^|\s)ei soovi($|\s)/u,
    /(^|\s)loobun($|\s)/u,
    /(^|\s)ärge (?:palun )?(?:rohkem )?(?:kirjutage|saatke)($|\s)/u,
    /(^|\s)palun (?:ärge|ärge enam) (?:kirjutage|saatke)($|\s)/u,
    /(^|\s)unsubscribe($|\s)/u,
    /^(?:stop|remove me)$/u,
  ].some((pattern) => pattern.test(normalized))
}
