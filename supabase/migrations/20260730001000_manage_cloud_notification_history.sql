-- Keep sent notifications available to administrators after they are withdrawn.
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
