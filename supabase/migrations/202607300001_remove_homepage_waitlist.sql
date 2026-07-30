update public.platform_settings
set coming_soon_enabled = false,
    updated_at = now()
where id = 'homepage'
  and coming_soon_enabled;

alter table public.platform_settings
alter column coming_soon_enabled set default false;

drop function if exists public.admin_set_coming_soon(boolean);

comment on column public.platform_settings.coming_soon_enabled is
'Deprecated compatibility field. The Poeruum homepage is always public.';
