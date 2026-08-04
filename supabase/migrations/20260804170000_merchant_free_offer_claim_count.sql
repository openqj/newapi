drop function if exists public.list_merchant_free_offers();

create function public.list_merchant_free_offers()
returns table (
  id uuid,
  merchant_name text,
  description text,
  station_name text,
  station_url text,
  quota numeric,
  claimed_count bigint,
  expires_at bigint,
  pinned boolean,
  tier text,
  published_at bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select account.id, profile.merchant_name, profile.description, account.station_name,
         account.station_url, account.quota,
         (
           select count(*)
           from public.merchant_free_claims claim
           where claim.station_key = lower(regexp_replace(btrim(account.station_url), '/+$', ''))
         ) as claimed_count,
         account.expires_at, account.pinned, profile.tier, account.created_at
  from public.merchant_free_accounts account
  join public.merchant_profiles profile on profile.user_id = account.merchant_id
  where account.claimed_by is null
    and account.redemption_code is not null
    and account.quota > 0
    and (account.expires_at is null or account.expires_at > extract(epoch from now())::bigint)
    and not exists (
      select 1
      from public.merchant_free_claims claim
      where claim.user_id = auth.uid()
        and claim.station_key = lower(regexp_replace(btrim(account.station_url), '/+$', ''))
    )
  order by account.pinned desc, account.created_at desc
  limit 500;
$$;

create index if not exists merchant_free_claims_station_key
  on public.merchant_free_claims (station_key);

revoke all on function public.list_merchant_free_offers() from public;
grant execute on function public.list_merchant_free_offers() to anon, authenticated;
