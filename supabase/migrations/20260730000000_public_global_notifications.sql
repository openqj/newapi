-- Global announcements are available to the desktop notification poller
-- without creating an anonymous Supabase account.
grant select on public.personal_center_notifications to anon;

drop policy if exists "Anonymous users read global notifications" on public.personal_center_notifications;
create policy "Anonymous users read global notifications"
on public.personal_center_notifications for select to anon
using (
  audience = 'all'
  and (expires_at is null or expires_at > extract(epoch from now())::bigint)
);
