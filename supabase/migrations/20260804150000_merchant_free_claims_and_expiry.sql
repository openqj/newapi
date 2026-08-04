alter table public.merchant_free_accounts
  add column if not exists expires_at bigint;

alter table public.merchant_free_accounts
  drop constraint if exists merchant_free_accounts_expires_at_check;

alter table public.merchant_free_accounts
  add constraint merchant_free_accounts_expires_at_check
  check (expires_at is null or expires_at > 0);

create table if not exists public.merchant_free_claims (
  offer_id uuid primary key references public.merchant_free_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  station_key text not null,
  claimed_at bigint not null default extract(epoch from now())::bigint,
  unique (user_id, station_key)
);

insert into public.merchant_free_claims (offer_id, user_id, station_key, claimed_at)
select legacy.offer_id, legacy.user_id, legacy.station_key, legacy.claimed_at
from (
  select distinct on (
    account.claimed_by,
    lower(regexp_replace(btrim(account.station_url), '/+$', ''))
  )
    account.id as offer_id,
    account.claimed_by as user_id,
    lower(regexp_replace(btrim(account.station_url), '/+$', '')) as station_key,
    coalesce(account.claimed_at, extract(epoch from now())::bigint) as claimed_at
  from public.merchant_free_accounts account
  where account.claimed_by is not null
  order by
    account.claimed_by,
    lower(regexp_replace(btrim(account.station_url), '/+$', '')),
    account.claimed_at nulls last,
    account.id
) legacy
on conflict do nothing;

alter table public.merchant_free_claims enable row level security;
revoke all on table public.merchant_free_claims from anon, authenticated;

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
    raise exception 'Merchant code items must be a JSON array';
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
      quota numeric,
      expires_at bigint
    )
    where item.station_name is null
       or char_length(btrim(item.station_name)) not between 1 and 100
       or item.station_url is null
       or btrim(item.station_url) !~ '^https://'
       or char_length(btrim(item.station_url)) > 500
       or item.redemption_code is null
       or char_length(btrim(item.redemption_code)) not between 1 and 128
       or btrim(item.redemption_code) ~ '[[:cntrl:]]'
       or item.quota is null
       or item.quota <= 0
       or item.expires_at is null
       or item.expires_at <= extract(epoch from now())::bigint
  ) then
    raise exception 'Merchant code payload is invalid';
  end if;

  with normalized as (
    select distinct on (btrim(item.station_url), btrim(item.redemption_code))
      btrim(item.station_name) as station_name,
      btrim(item.station_url) as station_url,
      btrim(item.redemption_code) as redemption_code,
      item.quota,
      item.expires_at
    from jsonb_to_recordset(items) as item(
      station_name text,
      station_url text,
      redemption_code text,
      quota numeric,
      expires_at bigint
    )
    order by btrim(item.station_url), btrim(item.redemption_code)
  ), inserted as (
    insert into public.merchant_free_accounts (
      merchant_id,
      station_name,
      station_url,
      redemption_code,
      quota,
      expires_at
    )
    select auth.uid(), station_name, station_url, redemption_code, quota, expires_at
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

drop function if exists public.list_merchant_free_offers();
create function public.list_merchant_free_offers()
returns table (
  id uuid,
  merchant_name text,
  description text,
  station_name text,
  station_url text,
  quota numeric,
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
         account.station_url, account.quota, account.expires_at, account.pinned, profile.tier,
         account.created_at
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

drop function if exists public.claim_merchant_free_code(uuid);
create function public.claim_merchant_free_code(offer_id uuid)
returns table (id uuid, station_name text, station_url text, redemption_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_station_key text;
begin
  if auth.uid() is null then
    raise exception 'Login is required';
  end if;

  select lower(regexp_replace(btrim(account.station_url), '/+$', ''))
    into v_station_key
  from public.merchant_free_accounts account
  where account.id = offer_id
    and account.claimed_by is null
    and account.redemption_code is not null
    and (account.expires_at is null or account.expires_at > extract(epoch from now())::bigint)
  for update;

  if v_station_key is null then
    raise exception 'This free offer is unavailable';
  end if;

  insert into public.merchant_free_claims (offer_id, user_id, station_key)
  values (offer_id, auth.uid(), v_station_key)
  on conflict do nothing;

  if not found then
    raise exception 'You have already claimed a free offer for this station';
  end if;

  return query
  update public.merchant_free_accounts account
     set claimed_by = auth.uid(),
         claimed_at = extract(epoch from now())::bigint
   where account.id = offer_id
     and account.claimed_by is null
  returning account.id, account.station_name, account.station_url, account.redemption_code;

  if not found then
    delete from public.merchant_free_claims
    where merchant_free_claims.offer_id = claim_merchant_free_code.offer_id
      and merchant_free_claims.user_id = auth.uid();
    raise exception 'This free offer is unavailable';
  end if;
end;
$$;

create or replace function public.release_merchant_free_code(offer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.merchant_free_claims
  where merchant_free_claims.offer_id = release_merchant_free_code.offer_id
    and merchant_free_claims.user_id = auth.uid()
    and merchant_free_claims.claimed_at > extract(epoch from now())::bigint - 600;

  update public.merchant_free_accounts
     set claimed_by = null,
         claimed_at = null
   where merchant_free_accounts.id = release_merchant_free_code.offer_id
     and merchant_free_accounts.claimed_by = auth.uid()
     and merchant_free_accounts.claimed_at > extract(epoch from now())::bigint - 600;
end;
$$;

revoke all on function public.import_merchant_free_codes(jsonb) from public;
revoke all on function public.list_merchant_free_offers() from public;
revoke all on function public.claim_merchant_free_code(uuid) from public;
revoke all on function public.release_merchant_free_code(uuid) from public;
grant execute on function public.import_merchant_free_codes(jsonb) to authenticated;
grant execute on function public.list_merchant_free_offers() to anon, authenticated;
grant execute on function public.claim_merchant_free_code(uuid) to authenticated;
grant execute on function public.release_merchant_free_code(uuid) to authenticated;
