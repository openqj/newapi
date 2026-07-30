-- Cloud backup storage is part of the project baseline, not a dashboard-only step.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'relayhub-backups',
  'relayhub-backups',
  false,
  26214400,
  array['application/octet-stream']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "RelayHub users list their backups" on storage.objects;
create policy "RelayHub users list their backups"
on storage.objects for select to authenticated
using (
  bucket_id = 'relayhub-backups'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "RelayHub users upload their backups" on storage.objects;
create policy "RelayHub users upload their backups"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'relayhub-backups'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "RelayHub users delete their backups" on storage.objects;
create policy "RelayHub users delete their backups"
on storage.objects for delete to authenticated
using (
  bucket_id = 'relayhub-backups'
  and (storage.foldername(name))[1] = auth.uid()::text
);
