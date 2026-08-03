alter table public.merchant_profiles
  add column if not exists description text not null default '';

alter table public.merchant_profiles
  drop constraint if exists merchant_profiles_description_check;

alter table public.merchant_profiles
  add constraint merchant_profiles_description_check
  check (char_length(description) <= 160);

drop function if exists public.list_merchant_free_offers();
create function public.list_merchant_free_offers()
returns table (id uuid, merchant_name text, description text, station_name text, station_url text, quota numeric, pinned boolean, tier text, published_at bigint)
language sql stable security definer set search_path = '' as $$
  select account.id, profile.merchant_name, profile.description, account.station_name,
         account.station_url, account.quota, account.pinned, profile.tier, account.created_at
  from public.merchant_free_accounts account
  join public.merchant_profiles profile on profile.user_id = account.merchant_id
  where account.claimed_by is null
    and account.redemption_code is not null
  order by account.pinned desc, account.created_at desc;
$$;

revoke all on function public.list_merchant_free_offers() from public;
grant execute on function public.list_merchant_free_offers() to anon, authenticated;
