-- Local showcase files are not a product-image source. Remove demo rows that
-- still depend on those files; products uploaded to Supabase Storage remain.
delete from public.products
where store_id = '00000000-0000-4000-8000-000000000001'
  and (
    image_url like '/images/demo/%'
    or image_url like '/images/showcase/%'
    or gallery::text like '%/images/demo/%'
    or gallery::text like '%/images/showcase/%'
    or image_variants::text like '%/images/demo/%'
    or image_variants::text like '%/images/showcase/%'
  );
