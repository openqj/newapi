create or replace function public.relayhub_is_merchant()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid()
      and raw_app_meta_data ->> 'role' in ('merchant', 'admin', 'super_admin')
  );
$$;

revoke all on function public.relayhub_is_merchant() from public;
grant execute on function public.relayhub_is_merchant() to authenticated;

create table if not exists public.merchant_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  merchant_name text not null check (char_length(merchant_name) between 1 and 80),
  qq text,
  qq_link text,
  wechat_qr_url text,
  updated_at bigint not null default extract(epoch from now())::bigint
);

create table if not exists public.merchant_rate_shares (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchant_profiles(user_id) on delete cascade,
  station_name text not null check (char_length(station_name) between 1 and 100),
  station_url text not null check (station_url ~ '^https://'),
  group_name text not null check (char_length(group_name) between 1 and 100),
  multiplier_summary text not null check (char_length(multiplier_summary) between 1 and 500),
  published_at bigint not null default extract(epoch from now())::bigint,
  active boolean not null default true,
  unique (merchant_id, station_url, group_name)
);

create table if not exists public.merchant_free_accounts (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchant_profiles(user_id) on delete cascade,
  station_name text not null check (char_length(station_name) between 1 and 100),
  station_url text not null check (station_url ~ '^https://'),
  username text not null check (char_length(username) between 1 and 254),
  password text not null check (char_length(password) between 1 and 500),
  station_kind text not null default 'auto' check (station_kind in ('auto', 'newapi', 'sub2api')),
  quota numeric not null check (quota >= 0),
  created_at bigint not null default extract(epoch from now())::bigint,
  claimed_by uuid references auth.users(id) on delete set null,
  claimed_at bigint
);

create or replace function public.relayhub_prepare_merchant_row()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not public.relayhub_is_merchant() then
    raise exception 'Merchant permission is required';
  end if;
  if tg_table_name = 'merchant_profiles' then
    new.user_id := auth.uid();
    new.updated_at := extract(epoch from now())::bigint;
  else
    new.merchant_id := auth.uid();
    if tg_table_name = 'merchant_rate_shares' then
      new.published_at := extract(epoch from now())::bigint;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.relayhub_prepare_merchant_row() from public;

drop trigger if exists relayhub_prepare_merchant_profile on public.merchant_profiles;
create trigger relayhub_prepare_merchant_profile before insert or update on public.merchant_profiles
for each row execute function public.relayhub_prepare_merchant_row();
drop trigger if exists relayhub_prepare_merchant_rate on public.merchant_rate_shares;
create trigger relayhub_prepare_merchant_rate before insert or update on public.merchant_rate_shares
for each row execute function public.relayhub_prepare_merchant_row();
drop trigger if exists relayhub_prepare_merchant_account on public.merchant_free_accounts;
create trigger relayhub_prepare_merchant_account before insert on public.merchant_free_accounts
for each row execute function public.relayhub_prepare_merchant_row();

create or replace function public.list_merchant_free_offers()
returns table (id uuid, merchant_name text, station_name text, station_url text, quota numeric, published_at bigint)
language sql stable security definer set search_path = '' as $$
  select account.id, profile.merchant_name, account.station_name, account.station_url,
         account.quota, account.created_at
  from public.merchant_free_accounts account
  join public.merchant_profiles profile on profile.user_id = account.merchant_id
  where account.claimed_by is null
  order by account.created_at desc;
$$;

create or replace function public.claim_merchant_free_account(offer_id uuid)
returns table (id uuid, station_name text, station_url text, username text, password text, station_kind text)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Login is required'; end if;
  return query
    update public.merchant_free_accounts
       set claimed_by = auth.uid(), claimed_at = extract(epoch from now())::bigint
     where merchant_free_accounts.id = offer_id and claimed_by is null
     returning merchant_free_accounts.id, merchant_free_accounts.station_name,
               merchant_free_accounts.station_url, merchant_free_accounts.username,
               merchant_free_accounts.password, merchant_free_accounts.station_kind;
end;
$$;

create or replace function public.release_merchant_free_account(offer_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.merchant_free_accounts
     set claimed_by = null, claimed_at = null
   where id = offer_id and claimed_by = auth.uid()
     and claimed_at > extract(epoch from now())::bigint - 600;
end;
$$;

revoke all on function public.list_merchant_free_offers() from public;
revoke all on function public.claim_merchant_free_account(uuid) from public;
revoke all on function public.release_merchant_free_account(uuid) from public;
grant execute on function public.list_merchant_free_offers() to anon, authenticated;
grant execute on function public.claim_merchant_free_account(uuid) to authenticated;
grant execute on function public.release_merchant_free_account(uuid) to authenticated;

alter table public.merchant_profiles enable row level security;
alter table public.merchant_rate_shares enable row level security;
alter table public.merchant_free_accounts enable row level security;

create policy "Anyone reads merchant profiles" on public.merchant_profiles for select to anon, authenticated using (true);
create policy "Merchants manage own profile" on public.merchant_profiles for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.relayhub_is_merchant());
create policy "Anyone reads active merchant rates" on public.merchant_rate_shares for select to anon, authenticated using (active);
create policy "Merchants manage own rates" on public.merchant_rate_shares for all to authenticated using (merchant_id = auth.uid()) with check (merchant_id = auth.uid() and public.relayhub_is_merchant());
create policy "Merchants read own free accounts" on public.merchant_free_accounts for select to authenticated using (merchant_id = auth.uid() and public.relayhub_is_merchant());
create policy "Merchants add own free accounts" on public.merchant_free_accounts for insert to authenticated with check (merchant_id = auth.uid() and public.relayhub_is_merchant());

grant select on public.merchant_profiles to anon, authenticated;
grant select on public.merchant_rate_shares to anon, authenticated;
grant insert, update, delete on public.merchant_profiles to authenticated;
grant insert, update, delete on public.merchant_rate_shares to authenticated;
grant select, insert on public.merchant_free_accounts to authenticated;
