create table public.lead_search_runs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  query text not null check (char_length(query) between 3 and 1000),
  requested_limit smallint not null check (requested_limit between 1 and 10),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  model text not null,
  openai_response_id text,
  found_count smallint not null default 0 check (found_count >= 0),
  inserted_count smallint not null default 0 check (inserted_count >= 0),
  source_count smallint not null default 0 check (source_count >= 0),
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  error_message text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index lead_search_runs_created_at_idx
on public.lead_search_runs(created_at desc);

create table public.sales_leads (
  id uuid primary key default gen_random_uuid(),
  search_run_id uuid references public.lead_search_runs(id) on delete set null,
  company_name text not null check (char_length(company_name) between 1 and 200),
  website_url text not null check (char_length(website_url) between 8 and 1000),
  website_domain text not null check (char_length(website_domain) between 3 and 253),
  source_url text not null check (char_length(source_url) between 8 and 1000),
  email_source_url text check (email_source_url is null or char_length(email_source_url) between 8 and 1000),
  contact_email text check (contact_email is null or char_length(contact_email) <= 320),
  contact_kind text not null default 'missing'
    check (contact_kind in ('general_business', 'personal_or_unclear', 'missing')),
  location text not null default '',
  segment text not null default '',
  summary text not null default '',
  fit_reason text not null default '',
  evidence text not null default '',
  fit_score smallint not null default 0 check (fit_score between 0 and 100),
  status text not null default 'new'
    check (status in ('new', 'ready', 'sending', 'sent', 'replied', 'unsubscribed', 'bounced', 'complained', 'archived')),
  draft_subject text not null default '' check (char_length(draft_subject) <= 160),
  draft_body text not null default '' check (char_length(draft_body) <= 5000),
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  send_claim_id uuid,
  send_claimed_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  resend_email_id text unique,
  delivery_status text check (
    delivery_status is null
    or delivery_status in ('sent', 'delivered', 'failed', 'bounced', 'complained')
  ),
  sent_at timestamptz,
  replied_at timestamptz,
  suppressed_at timestamptz,
  suppression_reason text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index sales_leads_website_domain_unique_idx
on public.sales_leads(lower(website_domain));

create unique index sales_leads_contact_email_unique_idx
on public.sales_leads(lower(contact_email))
where contact_email is not null;

create index sales_leads_status_created_idx
on public.sales_leads(status, created_at desc);

create index sales_leads_fit_score_idx
on public.sales_leads(fit_score desc, created_at desc);

create table public.lead_suppressions (
  email text primary key,
  reason text not null check (reason in ('unsubscribed', 'bounced', 'complained', 'manual')),
  lead_id uuid references public.sales_leads(id) on delete set null,
  source text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.lead_events (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.sales_leads(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null check (char_length(event_type) between 2 and 60),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index lead_events_lead_created_idx
on public.lead_events(lead_id, created_at desc);

create trigger sales_leads_updated_at
before update on public.sales_leads
for each row execute function public.set_updated_at();

create trigger lead_suppressions_updated_at
before update on public.lead_suppressions
for each row execute function public.set_updated_at();

alter table public.lead_search_runs enable row level security;
alter table public.sales_leads enable row level security;
alter table public.lead_suppressions enable row level security;
alter table public.lead_events enable row level security;

revoke all on table public.lead_search_runs from public, anon, authenticated;
revoke all on table public.sales_leads from public, anon, authenticated;
revoke all on table public.lead_suppressions from public, anon, authenticated;
revoke all on table public.lead_events from public, anon, authenticated;

grant select on table public.lead_search_runs to authenticated;
grant select on table public.sales_leads to authenticated;
grant select on table public.lead_suppressions to authenticated;
grant select on table public.lead_events to authenticated;
grant all on table public.lead_search_runs to service_role;
grant all on table public.sales_leads to service_role;
grant all on table public.lead_suppressions to service_role;
grant all on table public.lead_events to service_role;
grant usage, select on sequence public.lead_events_id_seq to service_role;

create policy "Admins read lead search runs"
on public.lead_search_runs for select to authenticated
using (coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'admin');

create policy "Admins read sales leads"
on public.sales_leads for select to authenticated
using (coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'admin');

create policy "Admins read lead suppressions"
on public.lead_suppressions for select to authenticated
using (coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'admin');

create policy "Admins read lead events"
on public.lead_events for select to authenticated
using (coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'admin');

create or replace function public.claim_sales_lead_send(
  target_lead_id uuid,
  target_admin_id uuid,
  target_daily_limit integer
)
returns table (
  lead_id uuid,
  company_name text,
  contact_email text,
  email_source_url text,
  draft_subject text,
  draft_body text,
  unsubscribe_token uuid,
  send_claim_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate public.sales_leads%rowtype;
  local_day_start timestamptz;
  used_today integer;
begin
  if target_daily_limit < 1 or target_daily_limit > 200 then
    raise exception 'Vigane päevane saatmislimiit.';
  end if;

  select *
  into candidate
  from public.sales_leads
  where id = target_lead_id
  for update;

  if not found then
    raise exception 'Kontakti ei leitud.';
  end if;

  if candidate.status = 'sending' then
    if candidate.send_claimed_at is null or candidate.send_claimed_at > now() - interval '2 minutes' then
      raise exception 'Selle kontakti kiri on juba saatmisel.';
    end if;
    if candidate.send_claimed_at < now() - interval '23 hours' then
      raise exception 'Saatmise olek vajab käsitsi kontrolli; automaatne korduskatse pole enam turvaline.';
    end if;
  elsif candidate.status <> 'ready' then
    raise exception 'Kiri peab enne saatmist olema üle vaadatud ja salvestatud.';
  end if;

  if candidate.contact_kind <> 'general_business' or candidate.contact_email is null then
    raise exception 'Saata saab ainult kontrollitud ettevõtte üldkontaktile.';
  end if;

  if exists (
    select 1
    from public.lead_suppressions suppression
    where lower(suppression.email) = lower(candidate.contact_email)
  ) then
    raise exception 'See aadress on loobumis- või blokeerimisnimekirjas.';
  end if;

  if candidate.resend_email_id is not null or candidate.sent_at is not null then
    raise exception 'Sellele kontaktile on kiri juba saadetud.';
  end if;

  if candidate.status <> 'sending' then
    local_day_start := date_trunc('day', now() at time zone 'Europe/Tallinn') at time zone 'Europe/Tallinn';
    select count(*)
    into used_today
    from public.sales_leads lead
    where lead.status in ('sending', 'sent', 'replied', 'bounced', 'complained')
      and coalesce(lead.sent_at, lead.send_claimed_at) >= local_day_start;

    if used_today >= target_daily_limit then
      raise exception 'Tänane turvaline saatmislimiit on täis.';
    end if;

    update public.sales_leads
    set status = 'sending',
        send_claim_id = gen_random_uuid(),
        send_claimed_at = now(),
        approved_by = target_admin_id,
        approved_at = now(),
        updated_by = target_admin_id
    where id = candidate.id
    returning * into candidate;
  end if;

  return query
  select
    candidate.id,
    candidate.company_name,
    candidate.contact_email,
    candidate.email_source_url,
    candidate.draft_subject,
    candidate.draft_body,
    candidate.unsubscribe_token,
    candidate.send_claim_id;
end;
$$;

revoke all on function public.claim_sales_lead_send(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_sales_lead_send(uuid, uuid, integer) to service_role;

create or replace function public.unsubscribe_sales_outreach(target_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_lead_id uuid;
  target_email text;
begin
  select lead.id, lead.contact_email
  into target_lead_id, target_email
  from public.sales_leads lead
  where lead.unsubscribe_token = target_token
  for update;

  if not found then
    return false;
  end if;

  if target_email is not null then
    insert into public.lead_suppressions (email, reason, lead_id, source)
    values (lower(target_email), 'unsubscribed', target_lead_id, 'unsubscribe_link')
    on conflict (email) do update
    set reason = 'unsubscribed',
        lead_id = excluded.lead_id,
        source = excluded.source,
        updated_at = now();
  end if;

  update public.sales_leads
  set status = 'unsubscribed',
      suppressed_at = coalesce(suppressed_at, now()),
      suppression_reason = 'unsubscribed'
  where id = target_lead_id;

  if not exists (
    select 1
    from public.lead_events event
    where event.lead_id = target_lead_id
      and event.event_type = 'unsubscribed'
  ) then
    insert into public.lead_events (lead_id, event_type, details)
    values (target_lead_id, 'unsubscribed', jsonb_build_object('source', 'unsubscribe_link'));
  end if;

  return true;
end;
$$;

revoke all on function public.unsubscribe_sales_outreach(uuid) from public;
grant execute on function public.unsubscribe_sales_outreach(uuid) to anon, authenticated, service_role;

create or replace function public.apply_sales_lead_retention(reference_time timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_unsent_leads integer := 0;
  deleted_contacted_leads integer := 0;
  deleted_search_runs integer := 0;
begin
  delete from public.sales_leads
  where status in ('new', 'ready', 'archived')
    and updated_at < reference_time - interval '90 days';
  get diagnostics deleted_unsent_leads = row_count;

  delete from public.sales_leads
  where status in ('sent', 'replied', 'unsubscribed', 'bounced', 'complained')
    and greatest(
      updated_at,
      coalesce(sent_at, '-infinity'::timestamptz),
      coalesce(replied_at, '-infinity'::timestamptz)
    ) < reference_time - interval '12 months';
  get diagnostics deleted_contacted_leads = row_count;

  delete from public.lead_search_runs
  where created_at < reference_time - interval '90 days';
  get diagnostics deleted_search_runs = row_count;

  return jsonb_build_object(
    'unsent_leads', deleted_unsent_leads,
    'contacted_leads', deleted_contacted_leads,
    'lead_search_runs', deleted_search_runs
  );
end;
$$;

revoke all on function public.apply_sales_lead_retention(timestamptz) from public, anon, authenticated;
grant execute on function public.apply_sales_lead_retention(timestamptz) to service_role;

comment on table public.sales_leads is
  'Admin-reviewed B2B sales prospects found from public web sources. No message is sent without an explicit admin action.';
comment on table public.lead_suppressions is
  'Minimal do-not-contact records retained to honor opt-outs, complaints, bounces and manual blocks.';
