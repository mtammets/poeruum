-- Keep the public showcase unmistakably fictional and avoid displaying a
-- plausible registry code or contact details as if they belonged to a seller.
update public.stores
set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
  'businessName', 'Poeruumi Näidispood',
  'registryCode', 'Näidisandmed',
  'businessAddress', 'Näidise 1, Tallinn',
  'contactEmail', 'naidis@poeruum.ee',
  'contactPhone', ''
)
where id = '00000000-0000-4000-8000-000000000001';
