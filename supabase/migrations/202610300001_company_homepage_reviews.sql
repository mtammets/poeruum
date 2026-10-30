-- Client review drafts are private and never part of public_storefronts.
create table public.company_homepage_reviews (
  store_id uuid primary key references public.stores(id) on delete cascade,
  access_key_hash text not null unique check (access_key_hash ~ '^[a-f0-9]{64}$'),
  copy jsonb not null default '{}'::jsonb check (jsonb_typeof(copy) = 'object'),
  revision bigint not null default 1,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
create table public.company_homepage_review_versions (
  store_id uuid not null references public.company_homepage_reviews(store_id) on delete cascade,
  revision bigint not null,
  copy jsonb not null,
  saved_at timestamptz not null default now(),
  primary key (store_id, revision)
);
alter table public.company_homepage_reviews enable row level security;
alter table public.company_homepage_review_versions enable row level security;
revoke all on public.company_homepage_reviews, public.company_homepage_review_versions from public, anon, authenticated;
grant all on public.company_homepage_reviews, public.company_homepage_review_versions to service_role;

-- The high-entropy capability is held only by the preview server and is scoped
-- to one review. The server does not need a Supabase service-role credential.
create function public.read_company_homepage_review(access_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare review public.company_homepage_reviews%rowtype;
begin
  if length(access_key) < 40 then raise insufficient_privilege; end if;
  select * into review from public.company_homepage_reviews r
    where r.active and r.access_key_hash = encode(sha256(convert_to(access_key, 'UTF8')), 'hex');
  if not found then raise insufficient_privilege; end if;
  return jsonb_build_object('storeId', review.store_id, 'copy', review.copy, 'revision', review.revision);
end;
$$;

create function public.save_company_homepage_review(access_key text, expected_revision bigint, next_copy jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare review public.company_homepage_reviews%rowtype;
begin
  if length(access_key) < 40 then raise insufficient_privilege; end if;
  select * into review from public.company_homepage_reviews r
    where r.active and r.access_key_hash = encode(sha256(convert_to(access_key, 'UTF8')), 'hex') for update;
  if not found then raise insufficient_privilege; end if;
  if review.revision is distinct from expected_revision then
    raise sqlstate 'PT409' using message = 'Tekste on vahepeal muudetud. Kopeeri oma muudatused ja laadi leht uuesti.';
  end if;
  if next_copy is null or jsonb_typeof(next_copy) <> 'object' or octet_length(next_copy::text) > 100000 then
    raise sqlstate 'PT400' using message = 'Vigased tekstiandmed.';
  end if;
  if exists(select 1 from jsonb_each(next_copy) e where jsonb_typeof(e.value) <> 'string' or length(e.value #>> '{}') > 5000) then
    raise sqlstate 'PT400' using message = 'Vigased tekstiandmed.';
  end if;
  insert into public.company_homepage_review_versions(store_id, revision, copy)
    values(review.store_id, review.revision, review.copy);
  update public.company_homepage_reviews set copy = next_copy, revision = revision + 1, updated_at = now()
    where store_id = review.store_id;
  return jsonb_build_object('revision', review.revision + 1);
end;
$$;
revoke all on function public.read_company_homepage_review(text), public.save_company_homepage_review(text, bigint, jsonb) from public;
grant execute on function public.read_company_homepage_review(text), public.save_company_homepage_review(text, bigint, jsonb) to anon, authenticated, service_role;
