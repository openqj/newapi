-- Add operator identity and redacted before/after snapshots to personal-center audit records.

alter table public.personal_center_audit_events
  add column if not exists actor_email text,
  add column if not exists before_value jsonb,
  add column if not exists after_value jsonb;

create index if not exists personal_center_audit_events_actor_action_idx
  on public.personal_center_audit_events (actor_id, action, created_at desc);

create or replace function public.relayhub_record_personal_center_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_email text;
  event_action text;
  event_subject text;
  event_detail text;
  event_target_user_id uuid;
  event_before jsonb;
  event_after jsonb;
begin
  select email into current_actor_email
  from auth.users
  where id = auth.uid();

  if tg_table_name = 'personal_center_memberships' then
    if tg_op = 'DELETE' then
      event_action := 'membership.deleted';
      event_subject := old.station_id || ':' || old.account_id;
      event_detail := old.plan || ' / ' || old.access_level;
      event_target_user_id := old.user_id;
      event_before := jsonb_build_object(
        'stationId', old.station_id,
        'accountId', old.account_id,
        'userEmail', old.user_email,
        'plan', old.plan,
        'accessLevel', old.access_level,
        'enabled', old.enabled,
        'expiresAt', old.expires_at,
        'privileges', old.privileges
      );
    else
      event_action := case when tg_op = 'INSERT' then 'membership.created' else 'membership.updated' end;
      event_subject := new.station_id || ':' || new.account_id;
      event_detail := new.plan || ' / ' || new.access_level;
      event_target_user_id := new.user_id;
      event_after := jsonb_build_object(
        'stationId', new.station_id,
        'accountId', new.account_id,
        'userEmail', new.user_email,
        'plan', new.plan,
        'accessLevel', new.access_level,
        'enabled', new.enabled,
        'expiresAt', new.expires_at,
        'privileges', new.privileges
      );
      if tg_op = 'UPDATE' then
        event_before := jsonb_build_object(
          'stationId', old.station_id,
          'accountId', old.account_id,
          'userEmail', old.user_email,
          'plan', old.plan,
          'accessLevel', old.access_level,
          'enabled', old.enabled,
          'expiresAt', old.expires_at,
          'privileges', old.privileges
        );
      end if;
    end if;
  elsif tg_table_name = 'personal_center_notification_preferences' then
    event_action := 'notification_preferences.updated';
    event_subject := 'notifications';
    event_detail := 'Updated global notification preferences';
    event_before := jsonb_build_object(
      'desktopEnabled', old.desktop_enabled,
      'syncEnabled', old.sync_enabled,
      'alertEnabled', old.alert_enabled,
      'offerEnabled', old.offer_enabled
    );
    event_after := jsonb_build_object(
      'desktopEnabled', new.desktop_enabled,
      'syncEnabled', new.sync_enabled,
      'alertEnabled', new.alert_enabled,
      'offerEnabled', new.offer_enabled
    );
  elsif tg_table_name = 'personal_center_notifications' then
    event_action := case
      when tg_op = 'INSERT' then 'notification.created'
      when tg_op = 'DELETE' then 'notification.deleted'
      when new.revoked_at is distinct from old.revoked_at and new.revoked_at is not null then 'notification.revoked'
      else 'notification.updated'
    end;
    event_subject := coalesce(new.id, old.id)::text;
    event_detail := coalesce(new.title, old.title, '云端通知');
    event_target_user_id := coalesce(new.target_user_id, old.target_user_id);
    if tg_op <> 'INSERT' then
      event_before := jsonb_build_object(
        'audience', old.audience,
        'targetEmail', old.target_email,
        'kind', old.kind,
        'title', old.title,
        'body', old.body,
        'destination', old.destination,
        'expiresAt', old.expires_at,
        'revokedAt', old.revoked_at
      );
    end if;
    if tg_op <> 'DELETE' then
      event_after := jsonb_build_object(
        'audience', new.audience,
        'targetEmail', new.target_email,
        'kind', new.kind,
        'title', new.title,
        'body', new.body,
        'destination', new.destination,
        'expiresAt', new.expires_at,
        'revokedAt', new.revoked_at
      );
    end if;
  else
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  insert into public.personal_center_audit_events
    (actor_id, actor_email, target_user_id, action, subject, detail, before_value, after_value)
  values
    (auth.uid(), current_actor_email, event_target_user_id, event_action, event_subject,
     event_detail, event_before, event_after);

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists relayhub_audit_notifications on public.personal_center_notifications;
create trigger relayhub_audit_notifications
after insert or update or delete on public.personal_center_notifications
for each row execute function public.relayhub_record_personal_center_audit();

create or replace function public.list_admin_merchant_free_codes()
returns table (
  id uuid,
  merchant_id uuid,
  merchant_name text,
  station_name text,
  station_url text,
  redemption_code_masked text,
  quota numeric,
  pinned boolean,
  claimed boolean,
  created_at bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select account.id,
         account.merchant_id,
         profile.merchant_name,
         account.station_name,
         account.station_url,
         case
           when char_length(account.redemption_code) <= 6 then repeat('*', 6)
           else left(account.redemption_code, 3) || '******' || right(account.redemption_code, 3)
         end,
         account.quota,
         account.pinned,
         account.claimed_by is not null,
         account.created_at
  from public.merchant_free_accounts account
  join public.merchant_profiles profile on profile.user_id = account.merchant_id
  where public.relayhub_is_admin()
    and account.redemption_code is not null
  order by account.pinned desc, account.created_at desc;
$$;

revoke all on function public.list_admin_merchant_free_codes() from public;
grant execute on function public.list_admin_merchant_free_codes() to authenticated;

create or replace function public.reveal_admin_merchant_code(code_id uuid, access_mode text)
returns table (redemption_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  code text;
begin
  if not public.relayhub_is_admin() then
    raise exception 'Administrator permission is required';
  end if;
  if access_mode not in ('view', 'copy') then
    raise exception 'Invalid code access mode';
  end if;

  select account.redemption_code into code
  from public.merchant_free_accounts account
  where account.id = code_id;
  if code is null then
    raise exception 'Redeem code was not found';
  end if;

  insert into public.personal_center_audit_events
    (actor_id, actor_email, action, subject, detail, before_value, after_value)
  select auth.uid(), users.email,
         case when access_mode = 'copy' then 'merchant_code_copied' else 'merchant_code_revealed' end,
         code_id::text,
         case when access_mode = 'copy' then 'Admin copied a merchant redeem code' else 'Admin viewed a merchant redeem code' end,
         jsonb_build_object('accessMode', access_mode),
         jsonb_build_object('result', 'authorized')
  from auth.users users
  where users.id = auth.uid();

  return query select code;
end;
$$;

revoke all on function public.reveal_admin_merchant_code(uuid, text) from public;
grant execute on function public.reveal_admin_merchant_code(uuid, text) to authenticated;
