alter table public.merchant_profiles
  add column if not exists website_url text;

alter table public.merchant_profiles
  drop constraint if exists merchant_profiles_website_url_check;

alter table public.merchant_profiles
  add constraint merchant_profiles_website_url_check
  check (
    website_url is null
    or (char_length(website_url) <= 500 and website_url ~ '^https://')
  );
