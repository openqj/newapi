alter table public.merchant_rate_shares
  add column if not exists pinned boolean not null default false;

alter table public.merchant_free_accounts
  add column if not exists pinned boolean not null default false;

create index if not exists merchant_rate_shares_marketplace_order
  on public.merchant_rate_shares (pinned desc, published_at desc);

create index if not exists merchant_free_accounts_marketplace_order
  on public.merchant_free_accounts (pinned desc, created_at desc)
  where claimed_by is null;

create or replace function public.relayhub_prepare_merchant_row()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not public.relayhub_is_merchant() then
    raise exception 'Merchant permission is required';
  end if;
  if tg_table_name = 'merchant_profiles' then
    if not public.relayhub_is_admin() then
      new.user_id := auth.uid();
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
returns table (id uuid, merchant_name text, station_name text, station_url text, quota numeric, pinned boolean, published_at bigint)
language sql stable security definer set search_path = '' as $$
  select account.id, profile.merchant_name, account.station_name, account.station_url,
         account.quota, account.pinned, account.created_at
  from public.merchant_free_accounts account
  join public.merchant_profiles profile on profile.user_id = account.merchant_id
  where account.claimed_by is null
  order by account.pinned desc, account.created_at desc;
$$;

revoke all on function public.list_merchant_free_offers() from public;
grant execute on function public.list_merchant_free_offers() to anon, authenticated;

create policy "Administrators manage merchant rates" on public.merchant_rate_shares
for all to authenticated
using (public.relayhub_is_admin())
with check (public.relayhub_is_admin());

create policy "Administrators manage merchant profiles" on public.merchant_profiles
for all to authenticated
using (public.relayhub_is_admin())
with check (public.relayhub_is_admin());

create policy "Administrators manage merchant free accounts" on public.merchant_free_accounts
for all to authenticated
using (public.relayhub_is_admin())
with check (public.relayhub_is_admin());

grant update, delete on public.merchant_free_accounts to authenticated;
