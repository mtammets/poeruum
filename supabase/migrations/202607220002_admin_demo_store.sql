-- A system-owned storefront whose content is used by the public "Vaata näidispoodi" view.
-- It deliberately has no auth.users owner; only administrators can mutate it.
alter table public.stores alter column owner_id drop not null;

insert into public.stores (
  id, owner_id, name, slug, is_published, payment_provider, payment_status,
  pricing_plan, shipping, settings
)
values (
  '00000000-0000-4000-8000-000000000001', null, 'Poeruumi näidispood', 'naidispood', true,
  'montonio', 'idle', 'flexible', array['omniva', 'dpd', 'smartposti', 'courier', 'pickup']::text[],
  jsonb_build_object(
    'isDemoStore', true,
    'editableStoreName', 'Poeruumi näidispood',
    'storeDescription', 'Hoolikalt valitud esemed, mis muudavad argipäeva natuke põnevamaks.',
    'storeTheme', 'midnight',
    'storeAccent', '#e5f25a',
    'isStoreVisible', true,
    'businessName', 'Poeruum OÜ',
    'registryCode', '12345678',
    'businessAddress', 'Tallinn, Eesti',
    'contactEmail', 'tere@poeruum.ee'
  )
)
on conflict (id) do nothing;

insert into public.products (
  id, store_id, name, description, image_url, gallery, alt, price, sale_price,
  object_position, slug, search_visible, stock, one_of_a_kind, options, sort_order
)
values
  ('demo-product-1', '00000000-0000-4000-8000-000000000001', 'Klaasist mullipiip', 'Minimalistlik läbipaistvast klaasist mullipiip pika varrega.', '/images/demo/bong_1.jpg', '["/images/demo/bong_1.jpg", "/images/demo/bong_2.jpg"]', 'Klaasist mullipiip', 18, null, 'center 52%', 'klaasist-mullipiip', true, 1, true, '[]', 1),
  ('demo-product-2', '00000000-0000-4000-8000-000000000001', 'Kaktusekuju', 'Skulptuurne kaktus tumedas potis. Taim, mida ei pea kunagi kastma.', '/images/demo/kaktus_1.jpg', '["/images/demo/kaktus_1.jpg", "/images/demo/kaktus_2.jpg"]', 'Tume metalliktoonides kaktusekuju', 32, null, 'center 55%', 'kaktusekuju', true, 8, false, '[{"name":"Värv","values":["Grafiit","Roheline","Liiv"]}]', 2),
  ('demo-product-3', '00000000-0000-4000-8000-000000000001', 'Puidust kass', 'Kõrge ja väärikas käsitsi maalitud puidust kassikuju.', '/images/demo/kass_1.jpg', '["/images/demo/kass_1.jpg", "/images/demo/kass_2.jpg"]', 'Kõrge käsitsi maalitud puidust kassikuju', 45, null, 'center 48%', 'puidust-kass', true, 0, false, '[]', 3),
  ('demo-product-4', '00000000-0000-4000-8000-000000000001', 'Valge ornament', 'Ažuurne valge lauakaunistus südame- ja lillemotiividega.', '/images/demo/mingiasi_1.jpg', '["/images/demo/mingiasi_1.jpg", "/images/demo/mingiasi_2.jpg"]', 'Valge ažuurne ornament alusel', 28, null, 'center 50%', 'valge-ornament', true, 6, false, '[{"name":"Suurus","values":["Väike","Keskmine","Suur"]}]', 4),
  ('demo-product-5', '00000000-0000-4000-8000-000000000001', 'Hõbedane pildiraam', 'Detailse mustriga läikiv metallraam erilisele portreele.', '/images/demo/padar_1.jpg', '["/images/demo/padar_1.jpg", "/images/demo/padar_2.jpg"]', 'Läikiv hõbedane pildiraam', 22, null, 'center 48%', 'hobedane-pildiraam', true, 1, false, '[]', 5),
  ('demo-product-6', '00000000-0000-4000-8000-000000000001', 'Inglitega taldrik', 'Kuldne dekoratiivtaldrik kolme ruumilise ingliga.', '/images/demo/taldrik_1.jpg', '["/images/demo/taldrik_1.jpg"]', 'Kuldne dekoratiivtaldrik kolme ingliga', 36, 29, 'center 50%', 'inglitega-taldrik', true, 5, false, '[{"name":"Värv","values":["Kuldne","Hõbedane"]}]', 6),
  ('demo-product-7', '00000000-0000-4000-8000-000000000001', 'Sõnumiga pitsid', 'Neljane keraamiliste pika sangaga pitside komplekt humoorikate sõnumitega.', '/images/demo/viinapitsid_1.jpg', '["/images/demo/viinapitsid_1.jpg"]', 'Neli pika sangaga keraamilist pitsi', 34, null, 'center 50%', 'sonumiga-pitsid', true, 1, true, '[]', 7)
on conflict (id) do nothing;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'admin';
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create policy "Admins update demo store" on public.stores for update to authenticated
using (id = '00000000-0000-4000-8000-000000000001' and (select public.is_admin()))
with check (id = '00000000-0000-4000-8000-000000000001' and (select public.is_admin()));
create policy "Admins read demo store" on public.stores for select to authenticated
using (id = '00000000-0000-4000-8000-000000000001' and (select public.is_admin()));

create policy "Admins create demo products" on public.products for insert to authenticated
with check (store_id = '00000000-0000-4000-8000-000000000001' and (select public.is_admin()));
create policy "Admins update demo products" on public.products for update to authenticated
using (store_id = '00000000-0000-4000-8000-000000000001' and (select public.is_admin()))
with check (store_id = '00000000-0000-4000-8000-000000000001' and (select public.is_admin()));
create policy "Admins delete demo products" on public.products for delete to authenticated
using (store_id = '00000000-0000-4000-8000-000000000001' and (select public.is_admin()));

create policy "Admins read demo orders" on public.orders for select to authenticated
using (store_id = '00000000-0000-4000-8000-000000000001' and (select public.is_admin()));
create policy "Admins update demo orders" on public.orders for update to authenticated
using (store_id = '00000000-0000-4000-8000-000000000001' and (select public.is_admin()))
with check (store_id = '00000000-0000-4000-8000-000000000001' and (select public.is_admin()));

create policy "Admins upload demo product images" on storage.objects for insert to authenticated
with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = '00000000-0000-4000-8000-000000000001'
  and (select public.is_admin())
);
create policy "Admins update demo product images" on storage.objects for update to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = '00000000-0000-4000-8000-000000000001'
  and (select public.is_admin())
);
create policy "Admins delete demo product images" on storage.objects for delete to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = '00000000-0000-4000-8000-000000000001'
  and (select public.is_admin())
);
