-- RelayHub personal-center synchronization. Run once in the Supabase SQL Editor.

create or replace function public.relayhub_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users
    where id = auth.uid()
      and raw_app_meta_data ->> 'role' in ('admin', 'super_admin')
  );
$$;

revoke all on function public.relayhub_is_admin() from public;
grant execute on function public.relayhub_is_admin() to authenticated;

create table if not exists public.personal_center_notification_preferences (
  id text primary key check (id = 'global'),
  desktop_enabled boolean not null default true,
  sync_enabled boolean not null default true,
  alert_enabled boolean not null default true,
  offer_enabled boolean not null default true,
  updated_at bigint not null default extract(epoch from now())::bigint,
  updated_by uuid references auth.users(id)
);

insert into public.personal_center_notification_preferences (id)
values ('global')
on conflict (id) do nothing;

create table if not exists public.personal_center_memberships (
  station_id text not null,
  account_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text not null,
  plan text not null,
  access_level text not null check (access_level in ('viewer', 'member', 'manager', 'admin')),
  enabled boolean not null default true,
  expires_at bigint,
  privileges jsonb not null default '[]'::jsonb,
  updated_at bigint not null default extract(epoch from now())::bigint,
  updated_by uuid references auth.users(id),
  primary key (station_id, account_id)
);

create table if not exists public.personal_center_audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  target_user_id uuid references auth.users(id),
  action text not null,
  subject text not null,
  detail text not null,
  created_at bigint not null default extract(epoch from now())::bigint
);

create table if not exists public.personal_center_notifications (
  id uuid primary key default gen_random_uuid(),
  audience text not null check (audience in ('all', 'user')),
  target_user_id uuid references auth.users(id) on delete cascade,
  target_email text,
  kind text not null check (kind in ('info', 'warning', 'offer')),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 2000),
  destination text not null default 'personalCenter'
    check (destination in ('overview', 'offers', 'personalCenter')),
  published_at bigint not null default extract(epoch from now())::bigint,
  expires_at bigint,
  created_by uuid not null references auth.users(id)
);

create table if not exists public.notification_receipts (
  notification_id uuid not null references public.personal_center_notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  delivered_at bigint,
  read_at bigint,
  primary key (notification_id, user_id)
);

create table if not exists public.personal_center_login_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  ip_address inet,
  user_agent text,
  outcome text not null check (outcome in ('success', 'failure')),
  failure_reason text,
  created_at bigint not null default extract(epoch from now())::bigint
);

create index if not exists personal_center_memberships_user_id_idx
  on public.personal_center_memberships (user_id);
create index if not exists personal_center_audit_events_created_at_idx
  on public.personal_center_audit_events (created_at desc);
create index if not exists personal_center_notifications_target_idx
  on public.personal_center_notifications (target_user_id, published_at desc);
create index if not exists notification_receipts_user_idx
  on public.notification_receipts (user_id, read_at);
create index if not exists personal_center_login_events_created_at_idx
  on public.personal_center_login_events (created_at desc);

create or replace function public.relayhub_resolve_membership_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select id into new.user_id
  from auth.users
  where lower(email) = lower(trim(new.user_email))
  limit 1;

  if new.user_id is null then
    raise exception 'No Supabase user exists for email %', new.user_email;
  end if;

  new.user_email := lower(trim(new.user_email));
  new.updated_by := auth.uid();
  new.updated_at := extract(epoch from now())::bigint;
  return new;
end;
$$;

create or replace function public.relayhub_touch_notification_preferences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := extract(epoch from now())::bigint;
  return new;
end;
$$;

create or replace function public.relayhub_record_personal_center_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'personal_center_memberships' then
    if tg_op = 'DELETE' then
      insert into public.personal_center_audit_events
        (actor_id, target_user_id, action, subject, detail)
      values
        (auth.uid(), old.user_id, 'membership_delete',
         old.station_id || ':' || old.account_id,
         old.plan || ' / ' || old.access_level);
    else
      insert into public.personal_center_audit_events
        (actor_id, target_user_id, action, subject, detail)
      values
        (auth.uid(), new.user_id, 'membership_' || lower(tg_op),
         new.station_id || ':' || new.account_id,
         new.plan || ' / ' || new.access_level);
    end if;
  else
    insert into public.personal_center_audit_events
      (actor_id, action, subject, detail)
    values
      (auth.uid(), 'notification_preferences_' || lower(tg_op),
       'notifications', 'Updated global notification preferences');
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.relayhub_prepare_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.relayhub_is_admin() then
    raise exception 'Administrator permission is required';
  end if;
  new.created_by := auth.uid();
  new.published_at := extract(epoch from now())::bigint;
  if new.audience = 'all' then
    new.target_user_id := null;
    new.target_email := null;
  else
    select id, lower(email) into new.target_user_id, new.target_email
    from auth.users
    where lower(email) = lower(trim(new.target_email))
    limit 1;
    if new.target_user_id is null then
      raise exception 'No Supabase user exists for email %', new.target_email;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.relayhub_prepare_notification_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.user_id := auth.uid();
  return new;
end;
$$;

revoke all on function public.relayhub_resolve_membership_user() from public;
revoke all on function public.relayhub_touch_notification_preferences() from public;
revoke all on function public.relayhub_record_personal_center_audit() from public;
revoke all on function public.relayhub_prepare_notification() from public;
revoke all on function public.relayhub_prepare_notification_receipt() from public;

drop trigger if exists relayhub_resolve_membership_user on public.personal_center_memberships;
create trigger relayhub_resolve_membership_user
before insert or update on public.personal_center_memberships
for each row execute function public.relayhub_resolve_membership_user();

drop trigger if exists relayhub_touch_notification_preferences on public.personal_center_notification_preferences;
create trigger relayhub_touch_notification_preferences
before update on public.personal_center_notification_preferences
for each row execute function public.relayhub_touch_notification_preferences();

drop trigger if exists relayhub_audit_membership on public.personal_center_memberships;
create trigger relayhub_audit_membership
after insert or update or delete on public.personal_center_memberships
for each row execute function public.relayhub_record_personal_center_audit();

drop trigger if exists relayhub_audit_notification_preferences on public.personal_center_notification_preferences;
create trigger relayhub_audit_notification_preferences
after update on public.personal_center_notification_preferences
for each row execute function public.relayhub_record_personal_center_audit();

drop trigger if exists relayhub_prepare_notification on public.personal_center_notifications;
create trigger relayhub_prepare_notification
before insert on public.personal_center_notifications
for each row execute function public.relayhub_prepare_notification();

drop trigger if exists relayhub_prepare_notification_receipt on public.notification_receipts;
create trigger relayhub_prepare_notification_receipt
before insert or update on public.notification_receipts
for each row execute function public.relayhub_prepare_notification_receipt();

alter table public.personal_center_notification_preferences enable row level security;
alter table public.personal_center_memberships enable row level security;
alter table public.personal_center_audit_events enable row level security;
alter table public.personal_center_notifications enable row level security;
alter table public.notification_receipts enable row level security;
alter table public.personal_center_login_events enable row level security;

drop policy if exists "Authenticated users read global notification preferences" on public.personal_center_notification_preferences;
create policy "Authenticated users read global notification preferences"
on public.personal_center_notification_preferences for select to authenticated
using (true);

drop policy if exists "Administrators manage global notification preferences" on public.personal_center_notification_preferences;
create policy "Administrators manage global notification preferences"
on public.personal_center_notification_preferences for all to authenticated
using (public.relayhub_is_admin())
with check (public.relayhub_is_admin());

drop policy if exists "Users read their memberships" on public.personal_center_memberships;
create policy "Users read their memberships"
on public.personal_center_memberships for select to authenticated
using (user_id = auth.uid() or public.relayhub_is_admin());

drop policy if exists "Administrators manage memberships" on public.personal_center_memberships;
create policy "Administrators manage memberships"
on public.personal_center_memberships for all to authenticated
using (public.relayhub_is_admin())
with check (public.relayhub_is_admin());

drop policy if exists "Users read relevant audit events" on public.personal_center_audit_events;
create policy "Users read relevant audit events"
on public.personal_center_audit_events for select to authenticated
using (target_user_id = auth.uid() or public.relayhub_is_admin());

drop policy if exists "Users read addressed notifications" on public.personal_center_notifications;
create policy "Users read addressed notifications"
on public.personal_center_notifications for select to authenticated
using (
  (audience = 'all' or target_user_id = auth.uid())
  and (expires_at is null or expires_at > extract(epoch from now())::bigint)
  or public.relayhub_is_admin()
);

drop policy if exists "Administrators publish notifications" on public.personal_center_notifications;
create policy "Administrators publish notifications"
on public.personal_center_notifications for insert to authenticated
with check (public.relayhub_is_admin());

drop policy if exists "Administrators delete notifications" on public.personal_center_notifications;
create policy "Administrators delete notifications"
on public.personal_center_notifications for delete to authenticated
using (public.relayhub_is_admin());

drop policy if exists "Users read their notification receipts" on public.notification_receipts;
create policy "Users read their notification receipts"
on public.notification_receipts for select to authenticated
using (user_id = auth.uid() or public.relayhub_is_admin());

drop policy if exists "Users create their notification receipts" on public.notification_receipts;
create policy "Users create their notification receipts"
on public.notification_receipts for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.personal_center_notifications notification
    where notification.id = notification_id
      and (notification.audience = 'all' or notification.target_user_id = auth.uid())
      and (notification.expires_at is null or notification.expires_at > extract(epoch from now())::bigint)
  )
);

drop policy if exists "Users update their notification receipts" on public.notification_receipts;
create policy "Users update their notification receipts"
on public.notification_receipts for update to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.personal_center_notifications notification
    where notification.id = notification_id
      and (notification.audience = 'all' or notification.target_user_id = auth.uid())
      and (notification.expires_at is null or notification.expires_at > extract(epoch from now())::bigint)
  )
);

drop policy if exists "Administrators read login events" on public.personal_center_login_events;
create policy "Administrators read login events"
on public.personal_center_login_events for select to authenticated
using (public.relayhub_is_admin());

grant select on public.personal_center_notification_preferences to authenticated;
grant update on public.personal_center_notification_preferences to authenticated;
grant select, insert, update, delete on public.personal_center_memberships to authenticated;
grant select on public.personal_center_audit_events to authenticated;
grant select, insert, delete on public.personal_center_notifications to authenticated;
grant select, insert, update on public.notification_receipts to authenticated;
grant select on public.personal_center_login_events to authenticated;

alter table public.personal_center_notification_preferences replica identity full;
alter table public.personal_center_memberships replica identity full;
alter table public.personal_center_notifications replica identity full;
alter table public.notification_receipts replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'personal_center_notification_preferences') then
    alter publication supabase_realtime add table public.personal_center_notification_preferences;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'personal_center_memberships') then
    alter publication supabase_realtime add table public.personal_center_memberships;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'personal_center_notifications') then
    alter publication supabase_realtime add table public.personal_center_notifications;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notification_receipts') then
    alter publication supabase_realtime add table public.notification_receipts;
  end if;
end
$$;

-- Keep this document aligned with the ordered migrations in supabase/migrations.
-- These follow-up changes scope receipt writes and add anonymous-client audiences.

drop policy if exists "Users create their notification receipts" on public.notification_receipts;
create policy "Users create their notification receipts"
on public.notification_receipts for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.personal_center_notifications notification
    where notification.id = notification_id
      and (notification.audience = 'all' or notification.target_user_id = auth.uid())
      and (notification.expires_at is null or notification.expires_at > extract(epoch from now())::bigint)
  )
);

drop policy if exists "Users update their notification receipts" on public.notification_receipts;
create policy "Users update their notification receipts"
on public.notification_receipts for update to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.personal_center_notifications notification
    where notification.id = notification_id
      and (notification.audience = 'all' or notification.target_user_id = auth.uid())
      and (notification.expires_at is null or notification.expires_at > extract(epoch from now())::bigint)
  )
);

alter table public.personal_center_notifications
  drop constraint if exists personal_center_notifications_audience_check;
alter table public.personal_center_notifications
  add constraint personal_center_notifications_audience_check
  check (audience in ('all', 'members', 'guests', 'user'));

create or replace function public.relayhub_is_anonymous()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;

create or replace function public.relayhub_has_active_membership()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.personal_center_memberships
    where user_id = auth.uid()
      and enabled
      and (expires_at is null or expires_at > extract(epoch from now())::bigint)
  );
$$;

create or replace function public.relayhub_can_receive_notification(notification uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.personal_center_notifications
    where id = notification
      and (expires_at is null or expires_at > extract(epoch from now())::bigint)
      and (
        audience = 'all'
        or (audience = 'members' and not public.relayhub_is_anonymous() and public.relayhub_has_active_membership())
        or (audience = 'guests' and public.relayhub_is_anonymous())
        or (audience = 'user' and target_user_id = auth.uid())
        or public.relayhub_is_admin()
      )
  );
$$;

create or replace function public.relayhub_prepare_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.relayhub_is_admin() then
    raise exception 'Administrator permission is required';
  end if;
  new.created_by := auth.uid();
  new.published_at := extract(epoch from now())::bigint;
  if new.audience in ('all', 'members', 'guests') then
    new.target_user_id := null;
    new.target_email := null;
  else
    select id, lower(email) into new.target_user_id, new.target_email
    from auth.users
    where lower(email) = lower(trim(new.target_email))
    limit 1;
    if new.target_user_id is null then
      raise exception 'No Supabase user exists for email %', new.target_email;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.relayhub_is_anonymous() from public;
revoke all on function public.relayhub_has_active_membership() from public;
revoke all on function public.relayhub_can_receive_notification(uuid) from public;
grant execute on function public.relayhub_is_anonymous() to authenticated;
grant execute on function public.relayhub_has_active_membership() to authenticated;
grant execute on function public.relayhub_can_receive_notification(uuid) to authenticated;

drop policy if exists "Users read addressed notifications" on public.personal_center_notifications;
create policy "Users read addressed notifications"
on public.personal_center_notifications for select to authenticated
using (public.relayhub_can_receive_notification(id));

drop policy if exists "Users create their notification receipts" on public.notification_receipts;
create policy "Users create their notification receipts"
on public.notification_receipts for insert to authenticated
with check (
  user_id = auth.uid()
  and public.relayhub_can_receive_notification(notification_id)
);

-- Sent-notification history: administrators can edit active notices, withdraw them
-- without losing the record, or permanently delete them.
alter table public.personal_center_notifications
  add column if not exists revoked_at bigint;

drop policy if exists "Anonymous users read global notifications" on public.personal_center_notifications;
create policy "Anonymous users read global notifications"
on public.personal_center_notifications for select to anon
using (
  audience = 'all'
  and revoked_at is null
  and (expires_at is null or expires_at > extract(epoch from now())::bigint)
);

create or replace function public.relayhub_can_receive_notification(notification uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.personal_center_notifications
    where id = notification
      and revoked_at is null
      and (expires_at is null or expires_at > extract(epoch from now())::bigint)
      and (
        audience = 'all'
        or (audience = 'members' and not public.relayhub_is_anonymous() and public.relayhub_has_active_membership())
        or (audience = 'guests' and public.relayhub_is_anonymous())
        or (audience = 'user' and target_user_id = auth.uid())
        or public.relayhub_is_admin()
      )
  );
$$;

create or replace function public.relayhub_prepare_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.relayhub_is_admin() then
    raise exception 'Administrator permission is required';
  end if;
  if tg_op = 'UPDATE' then
    if old.revoked_at is not null then
      raise exception 'A revoked notification cannot be changed';
    end if;
    new.created_by := old.created_by;
    new.published_at := old.published_at;
  else
    new.created_by := auth.uid();
    new.published_at := extract(epoch from now())::bigint;
  end if;
  if new.audience in ('all', 'members', 'guests') then
    new.target_user_id := null;
    new.target_email := null;
  else
    select id, lower(email) into new.target_user_id, new.target_email
    from auth.users
    where lower(email) = lower(trim(new.target_email))
    limit 1;
    if new.target_user_id is null then
      raise exception 'No Supabase user exists for email %', new.target_email;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists relayhub_prepare_notification on public.personal_center_notifications;
create trigger relayhub_prepare_notification
before insert or update on public.personal_center_notifications
for each row execute function public.relayhub_prepare_notification();

drop policy if exists "Administrators update notifications" on public.personal_center_notifications;
create policy "Administrators update notifications"
on public.personal_center_notifications for update to authenticated
using (public.relayhub_is_admin())
with check (public.relayhub_is_admin());

drop policy if exists "Users update their notification receipts" on public.notification_receipts;
create policy "Users update their notification receipts"
on public.notification_receipts for update to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and public.relayhub_can_receive_notification(notification_id)
);
