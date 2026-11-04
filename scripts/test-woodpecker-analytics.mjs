// Isolated PostgreSQL fixture; no production connection or credentials are used.
import { pathToFileURL } from 'node:url'
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite')
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const db = new PGlite()
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create schema cron;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function public.is_admin() returns boolean language sql as $$ select coalesce(current_setting('request.jwt.claim.admin',true),'false')='true' $$;
create function cron.schedule(text,text,text) returns bigint language sql as $$ select 1::bigint $$;
create table public.stores(id uuid primary key,slug text);
create table public.products(id text primary key,name text,image_url text);
create table public.orders(id uuid primary key,store_id uuid,created_at timestamptz default now(),invoice_paid_at timestamptz,
 customer_name text, total numeric, stripe_refunded_amount_cents integer, payment_status text,stripe_mode text,stripe_payment_intent_id text);
create table public.directory_campaign_settings(id text primary key,ends_at timestamptz);
insert into public.directory_campaign_settings values('black-friday',null);
`)
await db.exec(await readFile(new URL('../supabase/migrations/202611040001_woodpecker_analytics.sql', import.meta.url),'utf8'))
const sql = async (query, params=[]) => (await db.query(query, params)).rows
const expectDenied = async query => { await assert.rejects(() => sql(query), e => e.code==='42501') }
await db.exec('set role anon')
await expectDenied('select public.admin_woodpecker_analytics()')
await expectDenied('select * from public.woodpecker_analytics_events')
await expectDenied("select public.record_woodpecker_analytics('kaubamaja.poeruum.ee','[]')")
await db.exec("reset role; set role authenticated; set request.jwt.claim.sub='20000000-0000-4000-8000-000000000001'")
await expectDenied('select public.admin_woodpecker_analytics()')
await expectDenied('select * from public.woodpecker_order_attribution')
await db.exec("reset role; set request.jwt.claim.admin='true'; update public.woodpecker_analytics_settings set starts_at=now()-interval '2 hours',tracking_started_at=now()-interval '2 hours'")
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const ev=(n,name,extra={})=>({id:id(n),visitor_id:id(900),session_id:id(901),surface:'directory',event_name:name,source:'Google',device:'desktop',utm_campaign:'',product_id:'',placement:'',game_id:null,value:0,duration:0,...extra})
await assert.rejects(()=>sql("select public.record_woodpecker_analytics('evil.example',$1::jsonb)",[JSON.stringify([ev(1,'visit')])]),e=>e.code==='42501')
await assert.rejects(()=>sql("select public.record_woodpecker_analytics('kruk-kruk.ee',$1::jsonb)",[JSON.stringify([ev(1,'visit')])]),e=>e.code==='42501')
const record = async events => sql("select public.record_woodpecker_analytics('kaubamaja.poeruum.ee',$1::jsonb)",[JSON.stringify(events)])
await record([ev(1,'visit'),ev(2,'visit'),ev(3,'game_view',{game_id:id(800)}),ev(4,'game_view',{game_id:id(801)}),
 ev(5,'game_start',{game_id:id(800)}),ev(6,'game_progress',{game_id:id(800),value:3,duration:20}),
 ev(7,'game_end',{game_id:id(800),value:7,duration:45}),ev(8,'game_end',{game_id:id(800),value:7,duration:45}),
 ev(9,'engagement',{duration:15}),ev(10,'engagement',{duration:45}),ev(11,'product_view',{product_id:'cap'}),ev(12,'product_click',{product_id:'cap'})])
await record([ev(1,'visit')])
await db.exec("update public.woodpecker_analytics_events set occurred_at=now()-interval '1 minute'")
await sql('insert into stores values($1,$2)',[id(700),'kruk-kruk'])
await sql('insert into stores values($1,$2)',[id(701),'other'])
for(const [n,store,mode,status,total,refund] of [[100,700,'live','paid',50,1000],[101,700,'live','refunded',20,2000],[102,700,'test','paid',999,0],[103,701,'live','paid',999,0],[104,700,'live','pending',999,0]]) {
 await sql("insert into orders(id,store_id,created_at,invoice_paid_at,customer_name,total,stripe_refunded_amount_cents,payment_status,stripe_mode,stripe_payment_intent_id) values($1,$2,now()-interval '1 minute',now()-interval '1 minute','Mari Maasikas',$3,$4,$5,$6,'pi_test')",[id(n),id(store),total,refund,status,mode])
}
await sql('select public.attribute_woodpecker_order($1,$2,$3)',[id(100),id(900),id(901)])
await sql('select public.attribute_woodpecker_order($1,$2,$3)',[id(100),id(999),id(998)])
await db.exec('set role authenticated')
const report=async(range='all',page=0,search='')=>(await sql('select public.admin_woodpecker_analytics($1,$2,$3) as report',[range,page,search]))[0].report
const r=await report()
assert.equal(r.totals.visits,1);assert.equal(r.totals.games,1);assert.equal(r.totals.players,1);assert.equal(r.totals.hats,7)
assert.equal(r.totals.game_seconds,45);assert.equal(r.totals.sales,40);assert.equal(r.totals.refunds,30);assert.equal(r.totals.orders,1)
assert.equal(r.totals.game_buyers,1);assert.equal(r.players[0].customer_name,'Mari Maasikas')
assert.equal(r.surfaces.find(s=>s.surface==='directory').seconds,45)
assert.equal(r.actions.find(a=>a.label==='product_interest').sessions,1)
assert.equal((await report('all',0,'Maasikas')).player_count,1)
assert.equal((await report('all',0,'unmatched')).player_count,0)
assert.equal((await report('all',1)).players.length,0)
for(const range of ['today','24h','7d']) assert.equal((await report(range)).totals.sales,40)
await assert.rejects(()=>report('invalid'),e=>e.code==='22023')
await db.exec("reset role; update public.woodpecker_analytics_settings set starts_at=now()+interval '1 hour'")
assert.equal((await record([ev(40,'visit',{session_id:id(904)})]))[0].record_woodpecker_analytics,0)
assert.equal((await report()).timeline.length,0)
await db.exec("update public.woodpecker_analytics_settings set starts_at=now()-interval '2 hours'; update public.directory_campaign_settings set ends_at=now()-interval '30 seconds'")
assert.equal((await record([ev(41,'visit',{session_id:id(905)})]))[0].record_woodpecker_analytics,0)
await db.exec("update public.woodpecker_analytics_settings set starts_at=now()-interval '3 days'; update public.directory_campaign_settings set ends_at=now()-interval '2 days'")
assert.equal((await report('today')).totals.visits,0)
assert.equal((await report('today')).timeline.length,0)
console.log('PASS: migration, admin permissions, origins, deduplication, game starts, cumulative scores/duration, paid/refunded/test orders, attribution, search, pagination, ranges, campaign boundaries')
await db.close()
