-- Publication is reversible; completing the first setup is not. Preserve the
-- existing marker even when an older browser saves a stale settings snapshot.
create or replace function public.preserve_store_onboarding_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.is_published or new.is_published or old.settings ->> 'onboardingStep' = 'complete' then
    new.settings := jsonb_set(coalesce(new.settings, '{}'::jsonb), '{onboardingStep}', '"complete"'::jsonb, true);
  end if;
  return new;
end;
$$;

revoke all on function public.preserve_store_onboarding_completion() from public, anon, authenticated;

create trigger preserve_store_onboarding_completion
before update of settings, is_published on public.stores
for each row execute function public.preserve_store_onboarding_completion();

-- Restore markers previously lost through settings autosave. Match the actual
-- store and owner; a different store's completed journey must not finish a draft.
update public.stores s
set settings = jsonb_set(coalesce(s.settings, '{}'::jsonb), '{onboardingStep}', '"complete"'::jsonb, true)
where s.settings ->> 'onboardingStep' is distinct from 'complete'
  and (s.is_published or exists (
    select 1 from public.onboarding_journeys j
    where j.store_id = s.id and j.user_id = s.owner_id and j.completed_at is not null
  ));
