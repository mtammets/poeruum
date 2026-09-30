-- Selecting the entrepreneur seller type is sufficient; no separate attestation is required.
create or replace function public.seller_details_complete(settings_value jsonb)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(
    coalesce(settings_value->>'sellerType','company') in ('company','entrepreneur')
    and length(btrim(coalesce(settings_value->>'businessAddress',''))) between 1 and 400
    and length(btrim(coalesce(settings_value->>'contactEmail',''))) between 1 and 254
    and btrim(settings_value->>'contactEmail') ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and case when settings_value->>'sellerType'='entrepreneur' then
      length(btrim(coalesce(settings_value->>'sellerFirstName',''))) between 1 and 100
      and length(btrim(coalesce(settings_value->>'sellerLastName',''))) between 1 and 100
      and coalesce(settings_value->>'vatRegistered','false')='false'
      and btrim(coalesce(settings_value->>'vatNumber',''))=''
    else
      length(btrim(coalesce(settings_value->>'businessName',''))) between 1 and 200
      and btrim(coalesce(settings_value->>'registryCode','')) ~ '^[0-9]{8}$'
      and (coalesce(settings_value->>'vatRegistered','false')='false'
        or upper(btrim(coalesce(settings_value->>'vatNumber',''))) ~ '^EE[0-9]{9}$')
    end, false);
$$;
