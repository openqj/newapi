-- Anonymous Supabase users identify an installation without creating a
-- personal-center login. Enable Anonymous Sign-Ins in Supabase Auth before
-- deploying this migration.

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

drop policy if exists "Users update their notification receipts" on public.notification_receipts;
create policy "Users update their notification receipts"
on public.notification_receipts for update to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and public.relayhub_can_receive_notification(notification_id)
);
