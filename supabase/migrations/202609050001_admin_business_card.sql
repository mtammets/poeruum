-- One private, editable two-sided business card per administrator.
-- Images stay embedded in the document; no public bucket or live page is created.
create table public.admin_business_card_drafts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  document jsonb not null,
  revision bigint not null default 1 check (revision > 0 and revision <= 9007199254740991),
  updated_at timestamptz not null default now(),
  constraint admin_business_card_document_valid check (
    coalesce(jsonb_typeof(document) = 'object'
    and document -> 'version' = '1'::jsonb
    and jsonb_typeof(document -> 'width') = 'number'
    and (document ->> 'width')::numeric between 40 and 150
    and jsonb_typeof(document -> 'height') = 'number'
    and (document ->> 'height')::numeric between 30 and 150
    and jsonb_typeof(document -> 'bleed') = 'number'
    and (document ->> 'bleed')::numeric between 0 and 5
    and jsonb_typeof(document -> 'cropMarks') = 'boolean'
    and jsonb_typeof(document -> 'sides') = 'object'
    and jsonb_typeof(document #> '{sides,front}') = 'object'
    and jsonb_typeof(document #> '{sides,back}') = 'object'
    and jsonb_typeof(document #> '{sides,front,elements}') = 'array'
    and jsonb_array_length(document #> '{sides,front,elements}') <= 60
    and jsonb_typeof(document #> '{sides,back,elements}') = 'array'
    and jsonb_array_length(document #> '{sides,back,elements}') <= 60
    and octet_length(document::text) <= 12000000, false)
  )
);

alter table public.admin_business_card_drafts enable row level security;

revoke all on public.admin_business_card_drafts from public, anon, authenticated;
grant select on public.admin_business_card_drafts to authenticated;

create policy "Admins read their own business card"
on public.admin_business_card_drafts for select to authenticated
using ((select public.is_admin()) and user_id = (select auth.uid()));

-- Writes go through the RPC so clients cannot skip conflict detection,
-- change the owner, or assign their own revision/timestamp.
create or replace function public.admin_save_business_card(
  next_document jsonb,
  expected_revision bigint
)
returns public.admin_business_card_drafts
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  saved public.admin_business_card_drafts;
begin
  if caller_id is null or not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if expected_revision is null then
    insert into public.admin_business_card_drafts (user_id, document)
    values (caller_id, next_document)
    on conflict (user_id) do nothing
    returning * into saved;
  else
    update public.admin_business_card_drafts as draft
    set document = next_document,
        revision = draft.revision + 1,
        updated_at = clock_timestamp()
    where draft.user_id = caller_id and draft.revision = expected_revision
    returning draft.* into saved;
  end if;

  if saved.user_id is null then
    raise exception 'Business card draft changed; reload before saving' using errcode = '40001';
  end if;

  return saved;
end;
$$;

revoke all on function public.admin_save_business_card(jsonb, bigint) from public, anon;
grant execute on function public.admin_save_business_card(jsonb, bigint) to authenticated;
