\set ON_ERROR_STOP on

begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('85000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'card-admin-one@example.invalid', '{"role":"admin"}', '{}', now(), now()),
  ('85000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'card-admin-two@example.invalid', '{"role":"admin"}', '{}', now(), now()),
  ('85000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'card-merchant@example.invalid', '{}', '{"role":"admin"}', now(), now());

select set_config('request.jwt.claim.sub', '85000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"85000000-0000-4000-8000-000000000001","app_metadata":{"role":"admin"}}', true);
set local role authenticated;

do $$
declare
  card jsonb := '{"version":1,"width":85,"height":55,"bleed":3,"cropMarks":false,"sides":{"front":{"background":"#ffffff","elements":[]},"back":{"background":"#244d3c","elements":[]}}}';
  saved public.admin_business_card_drafts;
  rejected boolean;
begin
  saved := public.admin_save_business_card(card, null);
  if saved.user_id <> auth.uid() or saved.revision <> 1 then
    raise exception 'TEST_ADMIN_DRAFT_INITIAL_VERSION_OR_OWNER_INVALID';
  end if;
  if (select count(*) from public.admin_business_card_drafts) <> 1 then
    raise exception 'TEST_ADMIN_CANNOT_READ_OWN_DRAFT';
  end if;

  rejected := false;
  begin
    perform public.admin_save_business_card(card, null);
  exception when serialization_failure then rejected := true;
  end;
  if not rejected then raise exception 'TEST_CREATE_OVERWRITES_EXISTING_DRAFT'; end if;

  card := jsonb_set(card, '{sides,front,background}', '"#244d3c"');
  saved := public.admin_save_business_card(card, 1);
  if saved.revision <> 2 or saved.document #>> '{sides,front,background}' <> '#244d3c' then
    raise exception 'TEST_FRESH_REVISION_UPDATE_FAILED';
  end if;

  rejected := false;
  begin
    perform public.admin_save_business_card(jsonb_set(card, '{width}', '90'), 1);
  exception when serialization_failure then rejected := true;
  end;
  if not rejected then raise exception 'TEST_STALE_REVISION_OVERWRITES_DRAFT'; end if;
  if (select document ->> 'width' from public.admin_business_card_drafts) <> '85' then
    raise exception 'TEST_STALE_REVISION_CHANGED_DRAFT';
  end if;

  rejected := false;
  begin
    update public.admin_business_card_drafts set revision = 99;
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'TEST_DIRECT_UPDATE_BYPASSES_REVISION'; end if;

  rejected := false;
  begin
    insert into public.admin_business_card_drafts (user_id, document)
    values ('85000000-0000-4000-8000-000000000002', card);
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'TEST_DIRECT_INSERT_IMPERSONATES_ADMIN'; end if;

  rejected := false;
  begin
    delete from public.admin_business_card_drafts;
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'TEST_DIRECT_DELETE_BYPASSES_REVISION'; end if;

  rejected := false;
  begin
    perform public.admin_save_business_card('{"version":1,"sides":{}}', 2);
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'TEST_MALFORMED_DOCUMENT_ACCEPTED'; end if;

  rejected := false;
  begin
    perform public.admin_save_business_card(card || jsonb_build_object('oversized', repeat('x', 12000001)), 2);
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'TEST_OVERSIZED_DOCUMENT_ACCEPTED'; end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '85000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"85000000-0000-4000-8000-000000000002","app_metadata":{"role":"admin"}}', true);
set local role authenticated;

do $$
declare saved public.admin_business_card_drafts;
begin
  if exists (select 1 from public.admin_business_card_drafts) then
    raise exception 'TEST_ADMIN_CAN_READ_ANOTHER_ADMINS_DRAFT';
  end if;
  saved := public.admin_save_business_card('{"version":1,"width":85,"height":55,"bleed":3,"cropMarks":false,"sides":{"front":{"background":"#ffffff","elements":[]},"back":{"background":"#ffffff","elements":[]}}}', null);
  if saved.user_id <> auth.uid() or saved.revision <> 1 then
    raise exception 'TEST_SECOND_ADMIN_DOES_NOT_GET_INDEPENDENT_DRAFT';
  end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '85000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"85000000-0000-4000-8000-000000000003","app_metadata":{},"user_metadata":{"role":"admin"}}', true);
set local role authenticated;

do $$
declare rejected boolean := false;
begin
  if exists (select 1 from public.admin_business_card_drafts) then
    raise exception 'TEST_MERCHANT_CAN_READ_ADMIN_DRAFTS';
  end if;
  begin
    perform public.admin_save_business_card('{}', null);
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'TEST_MERCHANT_CAN_SAVE_ADMIN_DRAFT'; end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
set local role anon;

do $$
declare rejected boolean := false;
begin
  begin
    perform * from public.admin_business_card_drafts;
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'TEST_ANONYMOUS_CAN_READ_DRAFTS'; end if;
  rejected := false;
  begin
    perform public.admin_save_business_card('{}', null);
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'TEST_ANONYMOUS_CAN_SAVE_DRAFT'; end if;
end;
$$;

rollback;
