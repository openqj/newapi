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
