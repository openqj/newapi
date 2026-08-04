alter table public.merchant_free_accounts
  drop constraint if exists merchant_free_accounts_positive_quota;

alter table public.merchant_free_accounts
  add constraint merchant_free_accounts_positive_quota
  check (quota > 0) not valid;

create or replace function public.import_merchant_free_codes(items jsonb)
returns table (imported integer, skipped integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_count integer;
  imported_count integer;
begin
  if auth.uid() is null or not public.relayhub_is_merchant() then
    raise exception 'Merchant permission is required';
  end if;

  if jsonb_typeof(items) is distinct from 'array' then
    raise exception 'Merchant codes must be a JSON array';
  end if;

  item_count := jsonb_array_length(items);
  if item_count < 1 or item_count > 200 then
    raise exception 'Import between 1 and 200 merchant codes at a time';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(items) as item(
      station_name text,
      station_url text,
      redemption_code text,
      quota numeric
    )
    where item.station_name is null
       or char_length(btrim(item.station_name)) not between 1 and 100
       or item.station_url is null
       or btrim(item.station_url) !~ '^https://'
       or char_length(btrim(item.station_url)) > 500
       or item.redemption_code is null
       or char_length(btrim(item.redemption_code)) not between 1 and 128
       or item.quota is null
       or item.quota <= 0
  ) then
    raise exception 'Merchant code payload is invalid';
  end if;

  with normalized as (
    select distinct on (btrim(item.station_url), btrim(item.redemption_code))
      btrim(item.station_name) as station_name,
      btrim(item.station_url) as station_url,
      btrim(item.redemption_code) as redemption_code,
      item.quota
    from jsonb_to_recordset(items) as item(
      station_name text,
      station_url text,
      redemption_code text,
      quota numeric
    )
    order by btrim(item.station_url), btrim(item.redemption_code)
  ), inserted as (
    insert into public.merchant_free_accounts (
      merchant_id,
      station_name,
      station_url,
      redemption_code,
      quota
    )
    select auth.uid(), station_name, station_url, redemption_code, quota
    from normalized
    on conflict (station_url, redemption_code)
      where redemption_code is not null
      do nothing
    returning 1
  )
  select count(*)::integer into imported_count from inserted;

  return query select imported_count, item_count - imported_count;
end;
$$;

revoke all on function public.import_merchant_free_codes(jsonb) from public;
grant execute on function public.import_merchant_free_codes(jsonb) to authenticated;

drop function if exists public.list_merchant_free_offers();
create function public.list_merchant_free_offers()
returns table (
  id uuid,
  merchant_name text,
  description text,
  station_name text,
  station_url text,
  quota numeric,
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
         account.station_url, account.quota, account.pinned, profile.tier, account.created_at
  from public.merchant_free_accounts account
  join public.merchant_profiles profile on profile.user_id = account.merchant_id
  where account.claimed_by is null
    and account.redemption_code is not null
    and account.quota > 0
  order by account.pinned desc, account.created_at desc
  limit 500;
$$;

revoke all on function public.list_merchant_free_offers() from public;
grant execute on function public.list_merchant_free_offers() to anon, authenticated;
