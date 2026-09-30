import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

const databaseUrl = process.argv[2] || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(databaseUrl).hostname)) throw new Error('Store ownership test requires a local database.')
const sql = (input) => new Promise((resolve, reject) => {
  const child = spawn('psql', [databaseUrl, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'] })
  let output = '', error = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { error += chunk })
  child.on('error', reject)
  child.on('close', (code) => code === 0 ? resolve(output.trim()) : reject(new Error(error)))
  child.stdin.end(input)
})
const owners = [randomUUID(), randomUUID()]
const ownerIds = owners.map((id) => `'${id}'`).join(',')
const prefix = `ownership-${randomUUID()}`
const asOwner = (id) => `set local request.jwt.claims = '{"sub":"${id}","role":"authenticated"}'; set local role authenticated;`

try {
  await sql(`begin;
    insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    select id,'authenticated','authenticated',id::text||'@example.invalid','{}','{}',now(),now()
      from unnest(array[${ownerIds}]::uuid[]) id;
    ${asOwner(owners[0])}
    insert into public.stores(owner_id,name,slug,settings)
      values('${owners[0]}','Original','${prefix}-original','{"onboardingStep":"product","storeDescription":"Keep me"}');
    update public.stores set name='Renamed' where owner_id='${owners[0]}';
    do $$ declare violated text; begin
      begin
        insert into public.stores(owner_id,name,slug) values('${owners[0]}','Duplicate','${prefix}-duplicate');
        raise exception 'Duplicate store was accepted';
      exception when unique_violation then
        get stacked diagnostics violated = constraint_name;
        if violated <> 'stores_owner_id_key' then raise; end if;
      end;
      begin
        insert into public.stores(owner_id,name,slug) values('${owners[1]}','Forged owner','${prefix}-forged');
        raise exception 'Another account was allowed as owner';
      exception when insufficient_privilege then null; end;
      if not exists(select 1 from public.stores where owner_id='${owners[0]}'
        and name='Renamed' and settings->>'storeDescription'='Keep me') then
        raise exception 'Existing store content changed';
      end if;
    end $$;
    reset role;
    set local role anon;
    do $$ begin
      begin
        insert into public.stores(owner_id,name,slug) values('${owners[1]}','Anonymous','${prefix}-anon');
        raise exception 'Anonymous store creation accepted';
      exception when insufficient_privilege then null; end;
    end $$;
    reset role;
    -- Retained accounts and the demo store can coexist without an owner.
    insert into public.stores(owner_id,name,slug) values
      (null,'Retained one','${prefix}-retained-1'),(null,'Retained two','${prefix}-retained-2');
    commit;`)

  const outcomes = await Promise.allSettled([1, 2].map((attempt) => sql(`begin;
    set local statement_timeout='5s';
    ${asOwner(owners[1])}
    insert into public.stores(owner_id,name,slug) values('${owners[1]}','Concurrent ${attempt}','${prefix}-race-${attempt}');
    select pg_sleep(0.3);
    commit;`)))
  const winners = outcomes.filter((result) => result.status === 'fulfilled')
  const losers = outcomes.filter((result) => result.status === 'rejected')
  if (winners.length !== 1 || losers.length !== 1 || !losers[0].reason.message.includes('stores_owner_id_key')) {
    throw new Error(`Expected one concurrent store and one owner constraint rejection: ${JSON.stringify(outcomes)}`)
  }
  const count = await sql(`select count(*) from public.stores where owner_id='${owners[1]}';`)
  if (count !== '1') throw new Error(`Concurrent requests created ${count} stores`)
  await sql(`do $$ declare violated text; begin
    begin
      update public.stores set owner_id='${owners[0]}' where owner_id='${owners[1]}';
      raise exception 'Owner transfer bypassed the one-store limit';
    exception when unique_violation then
      get stacked diagnostics violated = constraint_name;
      if violated <> 'stores_owner_id_key' then raise; end if;
    end;
  end $$;`)
  console.log('Store ownership: first creation, retries, concurrent requests, ownership transfers, RLS and ownerless retention passed.')
} finally {
  await sql(`begin;
    delete from public.stores where owner_id in (${ownerIds}) or slug in ('${prefix}-retained-1','${prefix}-retained-2');
    delete from auth.users where id in (${ownerIds});
    commit;`)
}
