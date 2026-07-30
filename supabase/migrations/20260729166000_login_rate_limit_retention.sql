create table if not exists public.personal_center_auth_rate_limits (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  attempts integer not null default 1 check (attempts > 0),
  updated_at timestamptz not null default now()
);

alter table public.personal_center_auth_rate_limits enable row level security;

create index if not exists personal_center_auth_rate_limits_updated_at_idx
  on public.personal_center_auth_rate_limits (updated_at);

create or replace function public.relayhub_consume_login_rate_limit(
  p_key_hashes text[],
  p_max_attempts integer default 10,
  p_window interval default interval '15 minutes'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed boolean;
begin
  if coalesce(cardinality(p_key_hashes), 0) = 0 or p_max_attempts < 1 or p_window <= interval '0 seconds' then
    raise exception 'Invalid rate limit request';
  end if;

  with touched as (
    insert into public.personal_center_auth_rate_limits (key_hash, window_started_at, attempts, updated_at)
    select distinct key_hash, now(), 1, now()
    from unnest(p_key_hashes) as keys(key_hash)
    on conflict (key_hash) do update
    set window_started_at = case
          when public.personal_center_auth_rate_limits.window_started_at <= now() - p_window then now()
          else public.personal_center_auth_rate_limits.window_started_at
        end,
        attempts = case
          when public.personal_center_auth_rate_limits.window_started_at <= now() - p_window then 1
          else public.personal_center_auth_rate_limits.attempts + 1
        end,
        updated_at = now()
    returning attempts
  )
  select bool_and(attempts <= p_max_attempts) into allowed from touched;

  delete from public.personal_center_auth_rate_limits
  where updated_at < now() - interval '24 hours';
  delete from public.personal_center_login_events
  where created_at < extract(epoch from now() - interval '90 days')::bigint;

  return coalesce(allowed, false);
end;
$$;

revoke all on table public.personal_center_auth_rate_limits from public;
revoke all on function public.relayhub_consume_login_rate_limit(text[], integer, interval) from public;
grant execute on function public.relayhub_consume_login_rate_limit(text[], integer, interval) to service_role;
