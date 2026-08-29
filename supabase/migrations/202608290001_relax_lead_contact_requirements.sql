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

  if candidate.contact_email is null or candidate.email_source_url is null then
    raise exception 'Saatmiseks on vaja avalikku ettevõtte kontaktaadressi ja selle allikat.';
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
      raise exception 'Tänane saatmislimiit on täis.';
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
