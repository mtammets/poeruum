-- Keep the public showcase store aligned with the production asset namespace.
update public.products
set
  image_url = replace(image_url, '/images/demo/', '/images/showcase/'),
  gallery = replace(gallery::text, '/images/demo/', '/images/showcase/')::jsonb,
  image_variants = replace(image_variants::text, '/images/demo/', '/images/showcase/')::jsonb
where store_id = '00000000-0000-4000-8000-000000000001'
  and (
    image_url like '/images/demo/%'
    or gallery::text like '%/images/demo/%'
    or image_variants::text like '%/images/demo/%'
  );
