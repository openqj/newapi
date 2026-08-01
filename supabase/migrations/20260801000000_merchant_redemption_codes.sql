-- Free offers are voucher codes. Login credentials are supplied by the user
-- at import time and must never be stored or exposed in the marketplace.
alter table public.merchant_free_accounts
  add column if not exists redemption_code text;

alter table public.merchant_free_accounts
  alter column username drop not null,
  alter column password drop not null;

create unique index if not exists merchant_free_accounts_code_unique
  on public.merchant_free_accounts (station_url, redemption_code)
  where redemption_code is not null;

drop function if exists public.list_merchant_free_offers();
create function public.list_merchant_free_offers()
returns table (id uuid, merchant_name text, station_name text, station_url text, quota numeric, pinned boolean, tier text, published_at bigint)
language sql stable security definer set search_path = '' as $$
  select account.id, profile.merchant_name, account.station_name, account.station_url,
         account.quota, account.pinned, profile.tier, account.created_at
  from public.merchant_free_accounts account
  join public.merchant_profiles profile on profile.user_id = account.merchant_id
  where account.claimed_by is null and account.redemption_code is not null
  order by account.pinned desc, account.created_at desc;
$$;

drop function if exists public.claim_merchant_free_account(uuid);
drop function if exists public.release_merchant_free_account(uuid);
create or replace function public.claim_merchant_free_code(offer_id uuid)
returns table (id uuid, station_name text, station_url text, redeem_code text)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Login is required'; end if;
  return query
    update public.merchant_free_accounts
       set claimed_by = auth.uid(), claimed_at = extract(epoch from now())::bigint
     where merchant_free_accounts.id = offer_id
       and merchant_free_accounts.redemption_code is not null
       and claimed_by is null
     returning merchant_free_accounts.id, merchant_free_accounts.station_name,
               merchant_free_accounts.station_url, merchant_free_accounts.redemption_code;
end;
$$;

create or replace function public.release_merchant_free_code(offer_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.merchant_free_accounts
     set claimed_by = null, claimed_at = null
   where id = offer_id and claimed_by = auth.uid()
     and claimed_at > extract(epoch from now())::bigint - 600;
end;
$$;

revoke all on function public.claim_merchant_free_code(uuid) from public;
revoke all on function public.release_merchant_free_code(uuid) from public;
grant execute on function public.claim_merchant_free_code(uuid) to authenticated;
grant execute on function public.release_merchant_free_code(uuid) to authenticated;

grant update, delete on public.merchant_free_accounts to authenticated;
