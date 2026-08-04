alter table public.merchant_rate_shares
  add column if not exists one_to_one_recharge boolean not null default false,
  add column if not exists official_pricing boolean not null default false,
  add column if not exists recharge_url text;

alter table public.merchant_rate_shares
  drop constraint if exists merchant_rate_shares_recharge_url_check;

alter table public.merchant_rate_shares
  add constraint merchant_rate_shares_recharge_url_check
  check (recharge_url is null or recharge_url ~ '^https://');

create or replace function public.publish_merchant_rate_share(payload jsonb)
returns table (rate_share_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_station_name text;
  v_station_url text;
  v_group_name text;
  v_multiplier_summary text;
  v_recharge_url text;
  v_one_to_one_recharge boolean;
  v_official_pricing boolean;
  v_rate_share_id uuid;
begin
  if auth.uid() is null or not public.relayhub_is_merchant() then
    raise exception 'Merchant permission is required';
  end if;

  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'Merchant rate payload must be a JSON object';
  end if;

  select item.station_name, item.station_url, item.group_name, item.multiplier_summary,
         item.recharge_url, item.one_to_one_recharge, item.official_pricing
    into v_station_name, v_station_url, v_group_name, v_multiplier_summary,
         v_recharge_url, v_one_to_one_recharge, v_official_pricing
  from jsonb_to_record(payload) as item(
    station_name text,
    station_url text,
    group_name text,
    multiplier_summary text,
    recharge_url text,
    one_to_one_recharge boolean,
    official_pricing boolean
  );

  v_station_name := btrim(v_station_name);
  v_station_url := btrim(v_station_url);
  v_group_name := btrim(v_group_name);
  v_multiplier_summary := btrim(v_multiplier_summary);
  v_recharge_url := btrim(v_recharge_url);

  if v_station_name is null
     or char_length(v_station_name) not between 1 and 100
     or v_station_url is null
     or v_station_url !~ '^https://'
     or char_length(v_station_url) > 500
     or v_group_name is null
     or char_length(v_group_name) not between 1 and 100
     or v_multiplier_summary is null
     or char_length(v_multiplier_summary) not between 1 and 500
     or v_recharge_url is null
     or v_recharge_url !~ '^https://'
     or char_length(v_recharge_url) > 500
     or v_one_to_one_recharge is not true
     or v_official_pricing is not true
  then
    raise exception 'Merchant rate payload is invalid';
  end if;

  insert into public.merchant_rate_shares (
    merchant_id,
    station_name,
    station_url,
    group_name,
    multiplier_summary,
    recharge_url,
    one_to_one_recharge,
    official_pricing,
    active
  )
  values (
    auth.uid(),
    v_station_name,
    v_station_url,
    v_group_name,
    v_multiplier_summary,
    v_recharge_url,
    v_one_to_one_recharge,
    v_official_pricing,
    true
  )
  on conflict (merchant_id, station_url, group_name)
  do update set
    station_name = excluded.station_name,
    multiplier_summary = excluded.multiplier_summary,
    recharge_url = excluded.recharge_url,
    one_to_one_recharge = excluded.one_to_one_recharge,
    official_pricing = excluded.official_pricing,
    active = true
  returning id into v_rate_share_id;

  return query select v_rate_share_id;
end;
$$;

revoke all on function public.publish_merchant_rate_share(jsonb) from public;
grant execute on function public.publish_merchant_rate_share(jsonb) to authenticated;
