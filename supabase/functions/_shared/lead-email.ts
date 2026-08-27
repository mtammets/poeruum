export type LeadEmailInput = {
  body: string
  senderName: string
}

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

const signatureText = (input: LeadEmailInput) => {
  if (hasPersonalSignature(input.body, input.senderName)) return ''
  return `Parimat\n${input.senderName}\nPoeruum · https://poeruum.ee`
}

export const renderLeadText = (input: LeadEmailInput) => [
  input.body.trim(),
  signatureText(input),
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
