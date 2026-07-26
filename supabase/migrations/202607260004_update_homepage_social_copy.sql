alter table public.platform_settings
alter column social_title set default 'Lihtne e-pood Eesti väikeettevõtjale',
alter column social_description set default 'Lisa tooted, võta vastu makseid ja halda tellimusi ühest kohast.';

update public.platform_settings
set social_title = 'Lihtne e-pood Eesti väikeettevõtjale',
    social_description = 'Lisa tooted, võta vastu makseid ja halda tellimusi ühest kohast.',
    seo_updated_at = now(),
    updated_at = now()
where id = 'homepage';
