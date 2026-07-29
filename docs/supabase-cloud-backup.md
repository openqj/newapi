# Supabase Cloud Backup Setup

The desktop application reads `SUPABASE_URL` and `SUPABASE_ANON_KEY` from its process environment. The anon key is intended for client distribution. Never place a Supabase service-role key in the application.

Enable email/password authentication and email confirmation in Supabase Auth. Create a private Storage bucket named `relayhub-backups`, then apply these policies in the SQL editor:

```sql
create policy "RelayHub users list their backups"
on storage.objects for select to authenticated
using (
  bucket_id = 'relayhub-backups'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "RelayHub users upload their backups"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'relayhub-backups'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "RelayHub users delete their backups"
on storage.objects for delete to authenticated
using (
  bucket_id = 'relayhub-backups'
  and (storage.foldername(name))[1] = auth.uid()::text
);
```

Backups are encrypted on-device with a recovery password before upload. The service stores only opaque encrypted objects. A restore password cannot be reset or recovered by Supabase or RelayHub.

## Personal center synchronization

Run [`supabase-personal-center.sql`](./supabase-personal-center.sql) once in the same project's SQL Editor. It creates the personal-center tables, audit triggers, and row-level security policies used to synchronize administrator settings and each user's memberships.

The same migration also creates cloud notifications, per-user delivery/read receipts, login events, and adds the membership/notification tables to the `supabase_realtime` publication.

Deploy the trusted login endpoint from the repository root after authenticating the Supabase CLI:

```powershell
supabase link --project-ref vvqzkkyfwmuwmntyvbgz
supabase functions deploy login-with-audit --no-verify-jwt
```

The hosted function receives `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` from Supabase. Never put the service-role key in the desktop application. Login IP addresses are taken from Supabase's trusted proxy headers inside this function; the desktop client does not submit an IP value.

Administrator accounts must have `app_metadata.role` set to `admin` or `super_admin`. Set this only from a trusted server or the Supabase dashboard; client-editable user metadata is not accepted as an administrator role.
