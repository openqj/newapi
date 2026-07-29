alter table public.personal_center_notification_preferences replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'personal_center_notification_preferences'
  ) then
    alter publication supabase_realtime
      add table public.personal_center_notification_preferences;
  end if;
end
$$;
