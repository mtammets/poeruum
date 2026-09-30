// Generate a reviewable migration. This command never changes a database.
import { writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { domainToASCII } from 'node:url'

const destination = process.argv[2]
if (!/^supabase\/migrations\/\d{12,14}_disposable_email_domains\.sql$/.test(destination ?? '')) {
  throw new Error('Usage: node scripts/update-disposable-email-domains.mjs supabase/migrations/YYYYMMDDNNNN_disposable_email_domains.sql')
}
const repo = 'disposable-email-domains/disposable-email-domains'
const commitResponse = await fetch(`https://api.github.com/repos/${repo}/commits/main`)
if (!commitResponse.ok) throw new Error(`Source revision: HTTP ${commitResponse.status}`)
const { sha } = await commitResponse.json()
if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid source revision')
const source = `https://raw.githubusercontent.com/${repo}/${sha}/disposable_email_blocklist.conf`
const response = await fetch(source)
if (!response.ok) throw new Error(`Domain list: HTTP ${response.status}`)
const content = await response.text()
const domains = [...new Set(content.split(/\r?\n/).map((line) => domainToASCII(line.trim().toLowerCase())).filter(Boolean))].sort()
if (domains.length < 1000 || domains.length > 100000 || domains.some((domain) => !/^[a-z0-9.-]+\.[a-z0-9-]+$/.test(domain))) {
  throw new Error('Unexpected domain list; review the source before importing')
}
const sql = `-- Community classification snapshot; runtime checks never send user emails to a third party.
-- Source: ${source}
-- License: CC0-1.0 / public domain (https://github.com/${repo}/blob/${sha}/LICENSE.txt)
-- SHA-256: ${createHash('sha256').update(content).digest('hex')}
-- Re-run this generator with a NEW migration filename to refresh. Explicit local exceptions survive.
delete from public.email_domain_rules where source = 'disposable-email-domains';
insert into public.email_domain_rules(domain, disposable, source)
select domain, true, 'disposable-email-domains' from unnest(array[
${domains.map((domain) => `  '${domain}'`).join(',\n')}
]) domain
on conflict (domain) do nothing;
`
await writeFile(destination, sql, { flag: 'wx' })
console.log(`Generated ${destination}: ${domains.length} domains at ${sha}`)
