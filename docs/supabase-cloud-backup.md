# Supabase Cloud Backup Setup

The desktop application reads `SUPABASE_URL` and `SUPABASE_ANON_KEY` from its process environment. The anon key is intended for client distribution. Never place a Supabase service-role key in the application.

Enable email/password authentication and email confirmation in Supabase Auth. Migration `20260729165000_cloud_backup_storage.sql` creates the private `relayhub-backups` bucket, limits each encrypted object to 25 MiB, and applies per-user Storage RLS. Do not recreate this bucket or its policies manually in the dashboard.

Backups are encrypted on-device with a recovery password before upload. The service stores only opaque encrypted objects. A restore password cannot be reset or recovered by Supabase or RelayHub.

## Personal center synchronization

Apply the ordered migrations in [`../supabase/migrations`](../supabase/migrations) to the project. The SQL document [`supabase-personal-center.sql`](./supabase-personal-center.sql) remains available for manual recovery, but migrations are the release source of truth.

The same migration also creates cloud notifications, per-user delivery/read receipts, login events, and adds the membership/notification tables to the `supabase_realtime` publication.

Enable **Anonymous Sign-Ins** in Supabase Auth before deploying `20260729164000_anonymous_notification_audiences.sql`. RelayHub uses this anonymous installation identity only to deliver `all` and `guests` notifications and to persist that installation's delivery receipts. It does not log the client into the personal center. Notification audiences are `all`, `members`, `guests`, and `user`; RLS, not the desktop client, decides visibility.

Validate migrations on an empty local Supabase database before release:

```powershell
supabase start
supabase db reset --local
supabase db lint --local
```

The release workflow applies migrations and deploys the trusted login endpoint. Configure `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, and `SUPABASE_PROJECT_ID` as protected secrets in the GitHub `release` environment. For an emergency manual deployment, authenticate the Supabase CLI and run:

```powershell
supabase link --project-ref vvqzkkyfwmuwmntyvbgz --password <database-password>
supabase db push --include-all
supabase functions deploy login-with-audit --no-verify-jwt
```

The hosted function receives `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` from Supabase. Never put the service-role key in the desktop application. Login IP addresses are taken from Supabase's trusted proxy headers inside this function; the desktop client does not submit an IP value. Login attempts are limited per IP and per email/IP pair to 10 per 15 minutes, and the same database RPC deletes stale rate-limit rows and login audit rows older than 90 days.

Password-recovery emails must redirect to `relayhub://auth/reset-password`. This URL is configured by `site_url` and `additional_redirect_urls` in [`../supabase/config.toml`](../supabase/config.toml); after deploying the configuration, confirm the same URL is allowed in the hosted Supabase Auth settings. RelayHub consumes recovery tokens only from this deep link and never persists them in local storage.

Enable Supabase Auth CAPTCHA in the hosted project before public release, and require it for anonymous sign-in and password authentication according to the selected CAPTCHA provider. The database rate limit reduces abuse of the trusted login function, but it does not replace provider-level bot protection for anonymous account creation.

Administrator accounts must have `app_metadata.role` set to `admin` or `super_admin`. Set this only from a trusted server or the Supabase dashboard; client-editable user metadata is not accepted as an administrator role.
