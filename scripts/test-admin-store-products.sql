\set ON_ERROR_STOP on
begin;

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('91000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'authenticated','authenticated','product-preview-'||n||'@example.invalid','{}','{}',now(),now()
from generate_series(1,2) n;
insert into public.stores(id,owner_id,name,slug,is_published)
select ('92000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  ('91000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'Private preview '||n,'private-preview-'||n,false
from generate_series(1,2) n;
insert into public.products(id,store_id,name,image_url,gallery,alt,sort_order)
select 'preview-'||n,'92000000-0000-4000-8000-000000000001','Product '||n,
  'https://example.invalid/main.webp','["https://example.invalid/detail.webp"]','Product photo',n
from generate_series(1,49) n;

set local role anon;
do $$ begin
  begin
    perform public.admin_store_products('92000000-0000-4000-8000-000000000001');
    raise exception 'Anonymous access accepted';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
set local request.jwt.claim.sub = '91000000-0000-4000-8000-000000000001';
set local request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000001","app_metadata":{},"user_metadata":{"role":"admin"}}';
set local role authenticated;
do $$ begin
  begin
    perform public.admin_store_products('92000000-0000-4000-8000-000000000001');
    raise exception 'Merchant or user-editable admin claim accepted';
  exception when insufficient_privilege then null;
  end;
end $$;

set local request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000002","app_metadata":{"role":"admin"}}';
set local request.jwt.claim.sub = '91000000-0000-4000-8000-000000000002';
do $$
declare result jsonb;
begin
  result := public.admin_store_products('92000000-0000-4000-8000-000000000001');
  if result->>'version' <> '1' or result->>'total' <> '49' or result->>'offset' <> '0'
    or jsonb_array_length(result->'products') <> 48
    or result#>>'{products,0,id}' <> 'preview-1'
    or result#>>'{products,47,id}' <> 'preview-48'
    or result#>>'{products,0,gallery,0}' <> 'https://example.invalid/detail.webp'
    or result#>>'{products,0,alt}' <> 'Product photo'
    then raise exception 'Draft preview or ordered first page incorrect'; end if;
  result := public.admin_store_products('92000000-0000-4000-8000-000000000001',48);
  if result->>'total' <> '49' or jsonb_array_length(result->'products') <> 1
    or result#>>'{products,0,id}' <> 'preview-49'
    then raise exception 'Second page incorrect'; end if;
  result := public.admin_store_products('92000000-0000-4000-8000-000000000002');
  if result->>'total' <> '0' or result->'products' <> '[]'::jsonb
    then raise exception 'Empty store returned another store products'; end if;
  begin
    perform public.admin_store_products('92000000-0000-4000-8000-000000000001',-1);
    raise exception 'Negative offset accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.admin_store_products('92000000-0000-4000-8000-000000000099');
    raise exception 'Missing store accepted';
  exception when sqlstate 'P0002' then null;
  end;
end $$;

reset role;
do $$ begin
  if (select count(*) from public.products where store_id='92000000-0000-4000-8000-000000000001') <> 49
    or (select is_published from public.stores where id='92000000-0000-4000-8000-000000000001')
    then raise exception 'Preview modified products or publication'; end if;
end $$;
rollback;
