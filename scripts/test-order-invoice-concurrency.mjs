import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

const databaseUrl = process.argv[2] || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(databaseUrl).hostname)) throw new Error('Invoice concurrency test requires a local database.')
const sql = (input) => new Promise((resolve, reject) => {
  const child = spawn(process.env.PSQL_BINARY || 'psql', [databaseUrl, '-Atq', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'] })
  let output = '', error = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { error += chunk })
  child.on('error', reject)
  child.on('close', (code) => code === 0 ? resolve(output.trim()) : reject(new Error(error)))
  child.stdin.end(input)
})
const fixture = readFileSync(new URL('./test-order-invoices.sql', import.meta.url), 'utf8')
  .split('do $$ declare target')[0].replaceAll('79000000-', '79100000-')
  .replaceAll('invoice-test', 'invoice-concurrency').replaceAll('invoice-product', 'invoice-concurrent-product')
try {
  const ids = (await sql(`${fixture}
select id from pg_temp.checkout('invoice-concurrent-first');
select id from pg_temp.checkout('invoice-concurrent-second');
commit;`)).split('\n').filter(Boolean)
  if (ids.length !== 2 || ids.some((id) => !/^[0-9a-f-]{36}$/.test(id))) throw new Error('Concurrent fixtures were not created.')
  // Separate database connections really contend for the same shop sequence.
  // Disable fixture work before commit so no worker can send these test emails.
  const outcomes = await Promise.allSettled(ids.map((id, index) => sql(`begin;
select public.complete_invoiced_stripe_order('${id}','cs_invoice_concurrent_${index}','pi_invoice_concurrent_${index}',now());
update public.order_email_jobs set status='skipped' where order_id='${id}';
update public.order_documents set status='needs_review' where order_id='${id}';
select number from public.order_documents where order_id='${id}';
select pg_sleep(0.2);
commit;`)))
  for (const result of outcomes) if (result.status === 'rejected') throw result.reason
  const numbers = outcomes.map((result) => result.value.trim()).sort()
  if (new Set(numbers).size !== 2 || !numbers[0].endsWith('-000001') || !numbers[1].endsWith('-000002')) throw new Error(`Invalid concurrent invoice numbers: ${numbers.join(', ')}`)
  console.log('Concurrent payments received distinct consecutive invoice numbers.')
} finally {
  await sql(`begin;
do $$ declare document_ids uuid[]; begin
select array_agg(id) into document_ids from public.order_documents where store_id='79100000-0000-4000-8000-000000000002';
delete from public.orders where store_id='79100000-0000-4000-8000-000000000002';
delete from public.order_document_cleanup where document_id=any(document_ids);
delete from public.products where store_id='79100000-0000-4000-8000-000000000002';
delete from public.stores where id='79100000-0000-4000-8000-000000000002';
delete from auth.users where id='79100000-0000-4000-8000-000000000001';
end; $$;
commit;`)
}
