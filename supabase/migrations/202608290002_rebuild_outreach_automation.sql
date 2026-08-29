-- Replace the manually reviewed AI lead agent with one automatic outreach queue.
-- Contacted history and suppressions are retained; uncontacted legacy candidates
-- are deliberately removed so the old and new systems cannot run in parallel.

drop function if exists public.claim_sales_lead_send(uuid, uuid, integer);
drop function if exists public.apply_sales_lead_retention(timestamptz);

delete from public.sales_leads
where status in ('new', 'ready', 'archived')
   or (status = 'sending' and resend_email_id is null);

update public.sales_leads
set status = 'sent',
    sent_at = coalesce(sent_at, send_claimed_at, updated_at)
where status = 'sending'
  and resend_email_id is not null;

create table public.outreach_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  daily_limit smallint not null default 50 check (daily_limit between 1 and 50),
  subject text not null check (char_length(subject) between 1 and 160),
  body text not null check (char_length(body) between 1 and 5000),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.outreach_settings (id, enabled, daily_limit, subject, body)
values (
  true,
  false,
  50,
  'Poeruum – e-pood telefonist',
  $outreach_body$Tere!

Leidsin teie ettevõtte ja mõtlesin, et Poeruum võib teile huvi pakkuda.

Poeruum on e-poe loomise ja haldamise teenus. Poe saab üles seada umbes 10 minutiga ning tooteid ja tellimusi saab hallata otse telefonist.

Paindlikul paketil kuutasu ei ole – Poeruumi tasu tekib ainult siis, kui poe kaudu müük toimub.

Poeruumiga saate tutvuda siin:
https://poeruum.ee

Kui tekib küsimusi, vastan hea meelega.$outreach_body$
);

create trigger outreach_settings_updated_at
before update on public.outreach_settings
for each row execute function public.set_updated_at();

create table public.outreach_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null check (run_type in ('import', 'send')),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  source_name text,
  source_updated_at timestamptz,
  scanned_count integer not null default 0 check (scanned_count >= 0),
  candidate_count integer not null default 0 check (candidate_count >= 0),
  imported_count integer not null default 0 check (imported_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  excluded_count integer not null default 0 check (excluded_count >= 0),
  sent_count integer not null default 0 check (sent_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  error_message text check (error_message is null or char_length(error_message) <= 1000),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index outreach_runs_created_at_idx
on public.outreach_runs(created_at desc);

alter table public.sales_leads
  drop constraint if exists sales_leads_status_check;

drop index if exists public.sales_leads_website_domain_unique_idx;
drop index if exists public.sales_leads_fit_score_idx;

alter table public.sales_leads
  rename column draft_subject to email_subject;

alter table public.sales_leads
  rename column draft_body to email_body;

alter table public.sales_leads
  alter column website_url drop not null,
  alter column email_subject drop not null,
  alter column email_subject drop default,
  alter column email_body drop not null,
  alter column email_body drop default,
  add column import_run_id uuid references public.outreach_runs(id) on delete set null,
  add column registry_code text check (registry_code is null or registry_code ~ '^\d{8}$'),
  add column source_dataset text not null default 'legacy',
  add column activity_codes text[] not null default '{}'::text[],
  add column activity_labels text[] not null default '{}'::text[],
  add column source_updated_at timestamptz,
  add column queue_priority double precision not null default random(),
  add column send_attempts smallint not null default 0 check (send_attempts between 0 and 5),
  add column last_error text check (last_error is null or char_length(last_error) <= 1000),
  drop column search_run_id,
  drop column website_domain,
  drop column email_source_url,
  drop column contact_kind,
  drop column location,
  drop column segment,
  drop column summary,
  drop column fit_reason,
  drop column evidence,
  drop column fit_score,
  drop column approved_by,
  drop column approved_at;

alter table public.sales_leads
  add constraint sales_leads_status_check
  check (status in ('queued', 'sending', 'sent', 'replied', 'unsubscribed', 'bounced', 'complained', 'failed'));

create unique index sales_leads_registry_code_unique_idx
on public.sales_leads(registry_code)
where registry_code is not null;

drop index if exists public.sales_leads_status_created_idx;
create index sales_leads_queue_idx
on public.sales_leads(status, queue_priority)
where status in ('queued', 'sending');

create index sales_leads_sent_at_idx
on public.sales_leads(sent_at desc)
where sent_at is not null;

alter table public.outreach_settings enable row level security;
alter table public.outreach_runs enable row level security;

revoke all on table public.outreach_settings from public, anon, authenticated;
revoke all on table public.outreach_runs from public, anon, authenticated;
grant select on table public.outreach_settings to authenticated;
grant select on table public.outreach_runs to authenticated;
grant all on table public.outreach_settings to service_role;
grant all on table public.outreach_runs to service_role;

create policy "Admins read outreach settings"
on public.outreach_settings for select to authenticated
using (coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'admin');

create policy "Admins read outreach runs"
on public.outreach_runs for select to authenticated
using (coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'admin');

alter table public.sales_leads
  alter column source_dataset drop default;

drop table public.lead_search_runs;

create or replace function public.import_sales_lead_batch(
  target_run_id uuid,
  candidates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate jsonb;
  registry_value text;
  company_value text;
  email_value text;
  website_value text;
  activity_code_values text[];
  activity_label_values text[];
  batch_count integer;
  batch_imported integer := 0;
  batch_duplicates integer := 0;
  batch_excluded integer := 0;
  inserted_count integer := 0;
begin
  if jsonb_typeof(candidates) <> 'array' then
    raise exception 'Kontaktide pakk peab olema JSON massiiv.';
  end if;

  batch_count := jsonb_array_length(candidates);
  if batch_count < 1 or batch_count > 500 then
    raise exception 'Kontaktide pakis peab olema 1 kuni 500 kirjet.';
  end if;

  if not exists (
    select 1
    from public.outreach_runs run
    where run.id = target_run_id
      and run.run_type = 'import'
      and run.status = 'running'
  ) then
    raise exception 'Aktiivset imporditööd ei leitud.';
  end if;

  for candidate in select value from jsonb_array_elements(candidates)
  loop
    registry_value := btrim(coalesce(candidate ->> 'registry_code', ''));
    company_value := btrim(coalesce(candidate ->> 'company_name', ''));
    email_value := lower(btrim(coalesce(candidate ->> 'contact_email', '')));
    website_value := nullif(btrim(coalesce(candidate ->> 'website_url', '')), '');

    select coalesce(array_agg(left(value, 10)), '{}'::text[])
    into activity_code_values
    from jsonb_array_elements_text(
      case when jsonb_typeof(candidate -> 'activity_codes') = 'array'
        then candidate -> 'activity_codes'
        else '[]'::jsonb
      end
    );

    select coalesce(array_agg(left(value, 200)), '{}'::text[])
    into activity_label_values
    from jsonb_array_elements_text(
      case when jsonb_typeof(candidate -> 'activity_labels') = 'array'
        then candidate -> 'activity_labels'
        else '[]'::jsonb
      end
    );

    if registry_value !~ '^\d{8}$'
      or char_length(company_value) not between 1 and 200
      or char_length(email_value) > 320
      or email_value !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      or (website_value is not null and char_length(website_value) > 1000)
      or not exists (
        select 1
        from unnest(activity_code_values) code
        where substring(code from '^([0-9]{2})') is not null
          and (
            substring(code from '^([0-9]{2})')::integer between 10 and 32
            or substring(code from '^([0-9]{2})')::integer = 47
          )
      )
    then
      batch_excluded := batch_excluded + 1;
      continue;
    end if;

    if exists (
      select 1 from auth.users user_row where lower(user_row.email) = email_value
    ) or exists (
      select 1
      from public.stores store
      where btrim(coalesce(store.settings ->> 'registryCode', '')) = registry_value
         or lower(btrim(coalesce(store.settings ->> 'contactEmail', ''))) = email_value
    ) or exists (
      select 1 from public.lead_suppressions suppression where lower(suppression.email) = email_value
    ) then
      batch_excluded := batch_excluded + 1;
      continue;
    end if;

    insert into public.sales_leads (
      import_run_id,
      registry_code,
      company_name,
      contact_email,
      website_url,
      source_url,
      source_dataset,
      activity_codes,
      activity_labels,
      source_updated_at,
      status
    ) values (
      target_run_id,
      registry_value,
      company_value,
      email_value,
      website_value,
      'https://avaandmed.ariregister.rik.ee/et/avaandmete-allalaadimine',
      'e-business-register-open-data',
      activity_code_values,
      activity_label_values,
      now(),
      'queued'
    )
    on conflict do nothing;

    get diagnostics inserted_count = row_count;
    if inserted_count = 1 then
      batch_imported := batch_imported + 1;
    else
      batch_duplicates := batch_duplicates + 1;
    end if;
  end loop;

  update public.outreach_runs
  set candidate_count = candidate_count + batch_count,
      imported_count = imported_count + batch_imported,
      duplicate_count = duplicate_count + batch_duplicates,
      excluded_count = excluded_count + batch_excluded
  where id = target_run_id;

  return jsonb_build_object(
    'received', batch_count,
    'imported', batch_imported,
    'duplicates', batch_duplicates,
    'excluded', batch_excluded
  );
end;
$$;

revoke all on function public.import_sales_lead_batch(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.import_sales_lead_batch(uuid, jsonb) to service_role;

create or replace function public.claim_next_sales_lead_send()
returns table (
  lead_id uuid,
  company_name text,
  contact_email text,
  subject text,
  body text,
  unsubscribe_token uuid,
  send_claim_id uuid,
  daily_limit smallint,
  used_today integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings_row public.outreach_settings%rowtype;
  candidate public.sales_leads%rowtype;
  local_day_start timestamptz;
  sent_or_claimed_today integer;
begin
  select * into settings_row
  from public.outreach_settings
  where id = true
  for update;

  if not found or not settings_row.enabled then
    return;
  end if;

  update public.sales_leads
  set status = 'failed',
      last_error = 'Saatmise tulemus jäi üle 23 tunni kinnitamata; automaatset kordussaatmist ei tehtud.'
  where status = 'sending'
    and send_claimed_at < now() - interval '23 hours';

  select lead.* into candidate
  from public.sales_leads lead
  where lead.status = 'sending'
    and lead.send_claim_id is not null
    and lead.send_claimed_at between now() - interval '23 hours' and now() - interval '2 minutes'
  order by lead.send_claimed_at
  for update skip locked
  limit 1;

  if found then
    local_day_start := date_trunc('day', now() at time zone 'Europe/Tallinn') at time zone 'Europe/Tallinn';
    select count(*) into sent_or_claimed_today
    from public.sales_leads lead
    where lead.sent_at >= local_day_start
       or (lead.status = 'sending' and lead.send_claimed_at >= local_day_start);

    return query select
      candidate.id,
      candidate.company_name,
      candidate.contact_email,
      settings_row.subject,
      settings_row.body,
      candidate.unsubscribe_token,
      candidate.send_claim_id,
      settings_row.daily_limit,
      sent_or_claimed_today;
    return;
  end if;

  local_day_start := date_trunc('day', now() at time zone 'Europe/Tallinn') at time zone 'Europe/Tallinn';

  select count(*) into sent_or_claimed_today
  from public.sales_leads lead
  where lead.sent_at >= local_day_start
     or (lead.status = 'sending' and lead.send_claimed_at >= local_day_start);

  if sent_or_claimed_today >= settings_row.daily_limit then
    return;
  end if;

  select lead.* into candidate
  from public.sales_leads lead
  where lead.status = 'queued'
    and lead.send_attempts < 5
    and lead.contact_email is not null
    and not exists (
      select 1
      from public.lead_suppressions suppression
      where lower(suppression.email) = lower(lead.contact_email)
    )
    and not exists (
      select 1
      from auth.users user_row
      where lower(user_row.email) = lower(lead.contact_email)
    )
    and not exists (
      select 1
      from public.stores store
      where (lead.registry_code is not null and btrim(coalesce(store.settings ->> 'registryCode', '')) = lead.registry_code)
         or lower(btrim(coalesce(store.settings ->> 'contactEmail', ''))) = lower(lead.contact_email)
    )
  order by lead.queue_priority
  for update skip locked
  limit 1;

  if not found then
    return;
  end if;

  if candidate.status = 'queued' then
    update public.sales_leads
    set status = 'sending',
        send_claim_id = gen_random_uuid(),
        send_claimed_at = now(),
        send_attempts = send_attempts + 1,
        last_error = null
    where id = candidate.id
    returning * into candidate;
  end if;

  return query select
    candidate.id,
    candidate.company_name,
    candidate.contact_email,
    settings_row.subject,
    settings_row.body,
    candidate.unsubscribe_token,
    candidate.send_claim_id,
    settings_row.daily_limit,
    sent_or_claimed_today;
end;
$$;

revoke all on function public.claim_next_sales_lead_send() from public, anon, authenticated;
grant execute on function public.claim_next_sales_lead_send() to service_role;

create or replace function public.complete_sales_lead_send(
  target_lead_id uuid,
  target_claim_id uuid,
  target_resend_email_id text,
  target_subject text,
  target_body text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  sent_time timestamptz := now();
  target_email text;
begin
  update public.sales_leads
  set status = 'sent',
      resend_email_id = target_resend_email_id,
      delivery_status = 'sent',
      email_subject = left(target_subject, 160),
      email_body = left(target_body, 5000),
      sent_at = coalesce(sent_at, sent_time),
      last_error = null
  where id = target_lead_id
    and send_claim_id = target_claim_id
    and status = 'sending'
  returning contact_email into target_email;

  if not found then
    return false;
  end if;

  insert into public.email_deliveries (
    resend_email_id,
    recipient_email,
    subject,
    email_type,
    status,
    sent_at,
    status_updated_at
  ) values (
    target_resend_email_id,
    target_email,
    left(target_subject, 160),
    'lead_outreach',
    'sent',
    sent_time,
    sent_time
  )
  on conflict (resend_email_id) do update
  set recipient_email = excluded.recipient_email,
      subject = excluded.subject,
      email_type = excluded.email_type,
      status = excluded.status,
      status_updated_at = excluded.status_updated_at;

  insert into public.lead_events (lead_id, event_type, details)
  values (target_lead_id, 'sent', jsonb_build_object('resend_email_id', target_resend_email_id));

  return true;
end;
$$;

revoke all on function public.complete_sales_lead_send(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_sales_lead_send(uuid, uuid, text, text, text) to service_role;

create or replace function public.release_sales_lead_send(
  target_lead_id uuid,
  target_claim_id uuid,
  error_message text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.sales_leads
  set status = case when send_attempts >= 5 then 'failed' else 'queued' end,
      send_claim_id = null,
      send_claimed_at = null,
      last_error = left(coalesce(error_message, 'Saatmine ebaõnnestus.'), 1000),
      delivery_status = 'failed'
  where id = target_lead_id
    and send_claim_id = target_claim_id
    and status = 'sending'
    and resend_email_id is null;

  if not found then
    return false;
  end if;

  insert into public.lead_events (lead_id, event_type, details)
  values (
    target_lead_id,
    'send_failed',
    jsonb_build_object('message', left(coalesce(error_message, 'Saatmine ebaõnnestus.'), 300))
  );

  return true;
end;
$$;

revoke all on function public.release_sales_lead_send(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.release_sales_lead_send(uuid, uuid, text) to service_role;

create or replace function public.outreach_overview()
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  with day_boundary as (
    select date_trunc('day', now() at time zone 'Europe/Tallinn') at time zone 'Europe/Tallinn' as starts_at
  ),
  lead_counts as (
    select
      count(*) filter (where status = 'queued') as queued,
      count(*) filter (where status = 'sending') as sending,
      count(*) filter (where status = 'failed') as failed,
      count(*) filter (where status = 'replied') as replied,
      count(*) filter (where status in ('unsubscribed', 'bounced', 'complained')) as blocked,
      count(*) filter (where sent_at >= (select starts_at from day_boundary)) as sent_today,
      count(*) filter (where sent_at is not null) as sent_total
    from public.sales_leads
  )
  select jsonb_build_object(
    'settings', (select to_jsonb(settings_row) - 'id' - 'created_at' from public.outreach_settings settings_row where id = true),
    'counts', (select to_jsonb(lead_counts) from lead_counts),
    'last_import', (
      select to_jsonb(run_row)
      from public.outreach_runs run_row
      where run_type = 'import'
      order by created_at desc
      limit 1
    ),
    'last_send', (
      select to_jsonb(run_row)
      from public.outreach_runs run_row
      where run_type = 'send'
      order by created_at desc
      limit 1
    )
  );
$$;

revoke all on function public.outreach_overview() from public, anon, authenticated;
grant execute on function public.outreach_overview() to service_role;

create or replace function public.apply_sales_lead_retention(reference_time timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_failed_leads integer := 0;
  deleted_contacted_leads integer := 0;
  deleted_runs integer := 0;
begin
  delete from public.sales_leads
  where status = 'failed'
    and updated_at < reference_time - interval '90 days';
  get diagnostics deleted_failed_leads = row_count;

  delete from public.sales_leads
  where status in ('sent', 'replied', 'unsubscribed', 'bounced', 'complained')
    and greatest(
      updated_at,
      coalesce(sent_at, '-infinity'::timestamptz),
      coalesce(replied_at, '-infinity'::timestamptz)
    ) < reference_time - interval '12 months';
  get diagnostics deleted_contacted_leads = row_count;

  delete from public.outreach_runs
  where created_at < reference_time - interval '90 days';
  get diagnostics deleted_runs = row_count;

  return jsonb_build_object(
    'failed_leads', deleted_failed_leads,
    'contacted_leads', deleted_contacted_leads,
    'outreach_runs', deleted_runs
  );
end;
$$;

revoke all on function public.apply_sales_lead_retention(timestamptz) from public, anon, authenticated;
grant execute on function public.apply_sales_lead_retention(timestamptz) to service_role;

comment on table public.sales_leads is
  'One automatic B2B outreach queue. Existing shop technology is intentionally not evaluated.';
comment on table public.outreach_settings is
  'Single administrator-controlled outreach switch, daily cap and shared message.';
comment on table public.outreach_runs is
  'Audit summary for scheduled registry imports and automatic send runs.';
