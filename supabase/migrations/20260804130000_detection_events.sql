create table if not exists public.detection_events (
  id uuid primary key default gen_random_uuid(),
  event_version integer not null default 1,
  event_type text not null default 'authenticity_detection',
  app_version text not null,
  occurred_at bigint not null,
  endpoint_hash text not null,
  model text not null,
  protocol text not null,
  score smallint not null check (score between 0 and 100),
  base_score smallint check (base_score between 0 and 100),
  confidence double precision,
  correct smallint,
  total smallint,
  elapsed_ms bigint,
  input_tokens bigint,
  output_tokens bigint,
  cache_read_tokens bigint,
  source jsonb,
  behavior jsonb,
  checks jsonb,
  probe_statuses jsonb,
  created_at timestamptz not null default now()
);

alter table public.detection_events enable row level security;

drop policy if exists detection_events_public_insert on public.detection_events;
create policy detection_events_public_insert
  on public.detection_events
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists detection_events_no_public_read on public.detection_events;
create policy detection_events_no_public_read
  on public.detection_events
  for select
  to anon, authenticated
  using (false);

revoke all on public.detection_events from anon, authenticated;
grant insert on public.detection_events to anon, authenticated;
