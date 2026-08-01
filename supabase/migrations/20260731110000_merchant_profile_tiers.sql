alter table public.merchant_profiles
  add column if not exists tier text;

alter table public.merchant_profiles
  drop constraint if exists merchant_profiles_tier_check;

alter table public.merchant_profiles
  add constraint merchant_profiles_tier_check
  check (tier is null or tier in ('diamond', 'gold', 'silver'));

create or replace function public.relayhub_prepare_merchant_row()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not public.relayhub_is_merchant() then
    raise exception 'Merchant permission is required';
  end if;
  if tg_table_name = 'merchant_profiles' then
    if not public.relayhub_is_admin() then
      new.user_id := auth.uid();
      if tg_op = 'INSERT' then
        new.tier := null;
      else
        new.tier := old.tier;
      end if;
    end if;
    new.updated_at := extract(epoch from now())::bigint;
  else
    if not public.relayhub_is_admin() then
      new.merchant_id := auth.uid();
    end if;
    if tg_table_name = 'merchant_rate_shares' then
      new.published_at := extract(epoch from now())::bigint;
    end if;
  end if;
  return new;
end;
$$;

drop function if exists public.list_merchant_free_offers();
create function public.list_merchant_free_offers()
returns table (id uuid, merchant_name text, station_name text, station_url text, quota numeric, pinned boolean, tier text, published_at bigint)
language sql stable security definer set search_path = '' as $$
  select account.id, profile.merchant_name, account.station_name, account.station_url,
         account.quota, account.pinned, profile.tier, account.created_at
  from public.merchant_free_accounts account
  join public.merchant_profiles profile on profile.user_id = account.merchant_id
  where account.claimed_by is null
  order by account.pinned desc, account.created_at desc;
$$;

revoke all on function public.list_merchant_free_offers() from public;
grant execute on function public.list_merchant_free_offers() to anon, authenticated;
