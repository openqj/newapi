use std::collections::BTreeSet;

use tauri::State;

use crate::{
    personal_center_store::{
        MembershipAccess, NotificationPreferences, PersonalCenterAuditEntry,
        PersonalCenterLoginEvent, PersonalCenterNotification, PersonalCenterRealtimeSession,
        PersonalCenterStore, PublishNotificationRequest,
    },
    services::{authorization::require_cloud_admin, cloud_backup},
    support::now,
    AppState,
};

const MAX_TEXT_LENGTH: usize = 64;
const MAX_PRIVILEGES: usize = 12;
const ACCESS_LEVELS: &[&str] = &["viewer", "member", "manager", "admin"];
const PRIVILEGES: &[&str] = &[
    "usage",
    "apiKeys",
    "billing",
    "notifications",
    "members",
    "admin",
];

fn validate_text(value: &str, field: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > MAX_TEXT_LENGTH || value.chars().any(char::is_control) {
        return Err(format!(
            "{field} must contain 1 to {MAX_TEXT_LENGTH} visible characters"
        ));
    }
    Ok(value.to_string())
}

fn validate_email(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 254
        || value.chars().any(char::is_control)
        || !value.contains('@')
    {
        return Err("User email must be a valid Supabase account email".into());
    }
    Ok(value.to_lowercase())
}

fn validate_membership(mut membership: MembershipAccess) -> Result<MembershipAccess, String> {
    membership.station_id = validate_text(&membership.station_id, "Station ID")?;
    membership.account_id = validate_text(&membership.account_id, "Account ID")?;
    membership.user_email = validate_email(&membership.user_email)?;
    membership.plan = validate_text(&membership.plan, "Membership plan")?;
    membership.access_level = validate_text(&membership.access_level, "Access level")?;
    if !ACCESS_LEVELS.contains(&membership.access_level.as_str()) {
        return Err("Access level must be viewer, member, manager, or admin".into());
    }
    if membership.expires_at.is_some_and(|time| time <= 0) {
        return Err("Membership expiry must be a valid Unix timestamp".into());
    }
    if membership.privileges.len() > MAX_PRIVILEGES {
        return Err("Too many membership privileges".into());
    }
    let privileges = membership
        .privileges
        .into_iter()
        .map(|value| validate_text(&value, "Membership privilege"))
        .collect::<Result<BTreeSet<_>, _>>()?;
    if privileges
        .iter()
        .any(|value| !PRIVILEGES.contains(&value.as_str()))
    {
        return Err("Membership contains an unsupported privilege".into());
    }
    membership.privileges = privileges.into_iter().collect();
    membership.updated_at = now();
    Ok(membership)
}

fn validate_notification(
    mut request: PublishNotificationRequest,
) -> Result<PublishNotificationRequest, String> {
    request.title = validate_text(&request.title, "Notification title")?;
    request.body = request.body.trim().to_string();
    if request.body.is_empty()
        || request.body.len() > 2000
        || request.body.chars().any(char::is_control)
    {
        return Err("Notification body must contain 1 to 2000 visible characters".into());
    }
    if !["all", "members", "guests", "user"].contains(&request.audience.as_str()) {
        return Err("Notification audience must be all, members, guests, or user".into());
    }
    if !["info", "warning", "offer"].contains(&request.kind.as_str()) {
        return Err("Notification kind must be info, warning, or offer".into());
    }
    if !["overview", "offers", "personalCenter"].contains(&request.destination.as_str()) {
        return Err("Notification destination is unsupported".into());
    }
    request.target_email = match request.audience.as_str() {
        "user" => Some(validate_email(
            request.target_email.as_deref().unwrap_or_default(),
        )?),
        _ => None,
    };
    if request.expires_at.is_some_and(|value| value <= now()) {
        return Err("Notification expiry must be in the future".into());
    }
    Ok(request)
}

#[tauri::command]
pub(crate) async fn get_personal_center_notification_preferences(
    state: State<'_, AppState>,
) -> Result<NotificationPreferences, String> {
    state
        .store
        .lock()
        .map_err(|_| "Local database is unavailable".to_string())?
        .notification_preferences()
}

#[tauri::command]
pub(crate) async fn refresh_personal_center_notification_preferences(
    state: State<'_, AppState>,
) -> Result<NotificationPreferences, String> {
    match cloud_backup::cloud_notification_preferences(&state).await {
        Ok(preferences) => {
            state
                .store
                .lock()
                .map_err(|_| "Local database is unavailable".to_string())?
                .save_notification_preferences(&preferences)?;
            Ok(preferences)
        }
        Err(error) => state
            .store
            .lock()
            .map_err(|_| "Local database is unavailable".to_string())?
            .notification_preferences()
            .map_err(|_| error),
    }
}

#[tauri::command]
pub(crate) async fn save_personal_center_notification_preferences(
    state: State<'_, AppState>,
    preferences: NotificationPreferences,
) -> Result<NotificationPreferences, String> {
    let store = state
        .store
        .lock()
        .map_err(|_| "Local database is unavailable".to_string())?;
    store.save_notification_preferences(&preferences)?;
    Ok(preferences)
}

#[tauri::command]
pub(crate) async fn list_personal_center_memberships(
    state: State<'_, AppState>,
) -> Result<Vec<MembershipAccess>, String> {
    let memberships = cloud_backup::cloud_memberships(&state).await?;
    let store = state
        .store
        .lock()
        .map_err(|_| "Local database is unavailable".to_string())?;
    for membership in &memberships {
        store.save_membership(membership)?;
    }
    Ok(memberships)
}

#[tauri::command]
pub(crate) async fn save_personal_center_membership(
    state: State<'_, AppState>,
    membership: MembershipAccess,
) -> Result<MembershipAccess, String> {
    require_cloud_admin(&state).await?;
    let membership = validate_membership(membership)?;
    let membership = cloud_backup::save_cloud_membership(&state, &membership).await?;
    let store = state
        .store
        .lock()
        .map_err(|_| "Local database is unavailable".to_string())?;
    store.save_membership(&membership)?;
    Ok(membership)
}

#[tauri::command]
pub(crate) async fn delete_personal_center_membership(
    state: State<'_, AppState>,
    station_id: String,
    account_id: String,
) -> Result<(), String> {
    require_cloud_admin(&state).await?;
    let station_id = validate_text(&station_id, "Station ID")?;
    let account_id = validate_text(&account_id, "Account ID")?;
    cloud_backup::delete_cloud_membership(&state, &station_id, &account_id).await?;
    let store = state
        .store
        .lock()
        .map_err(|_| "Local database is unavailable".to_string())?;
    let _ = store.delete_membership(&station_id, &account_id)?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn list_personal_center_audit_history(
    state: State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<PersonalCenterAuditEntry>, String> {
    require_cloud_admin(&state).await?;
    cloud_backup::cloud_personal_center_audit(&state, limit.unwrap_or(100)).await
}

#[tauri::command]
pub(crate) async fn list_personal_center_notifications(
    state: State<'_, AppState>,
) -> Result<Vec<PersonalCenterNotification>, String> {
    cloud_backup::cloud_notifications(&state).await
}

#[tauri::command]
pub(crate) async fn publish_personal_center_notification(
    state: State<'_, AppState>,
    request: PublishNotificationRequest,
) -> Result<PersonalCenterNotification, String> {
    require_cloud_admin(&state).await?;
    let request = validate_notification(request)?;
    cloud_backup::publish_cloud_notification(&state, &request).await
}

#[tauri::command]
pub(crate) async fn list_sent_personal_center_notifications(
    state: State<'_, AppState>,
) -> Result<Vec<PersonalCenterNotification>, String> {
    require_cloud_admin(&state).await?;
    cloud_backup::cloud_sent_notifications(&state).await
}

#[tauri::command]
pub(crate) async fn update_personal_center_notification(
    state: State<'_, AppState>,
    notification_id: String,
    request: PublishNotificationRequest,
) -> Result<PersonalCenterNotification, String> {
    require_cloud_admin(&state).await?;
    let notification_id = validate_text(&notification_id, "Notification ID")?;
    let request = validate_notification(request)?;
    cloud_backup::update_cloud_notification(&state, &notification_id, &request).await
}

#[tauri::command]
pub(crate) async fn revoke_personal_center_notification(
    state: State<'_, AppState>,
    notification_id: String,
) -> Result<PersonalCenterNotification, String> {
    require_cloud_admin(&state).await?;
    let notification_id = validate_text(&notification_id, "Notification ID")?;
    cloud_backup::revoke_cloud_notification(&state, &notification_id).await
}

#[tauri::command]
pub(crate) async fn delete_personal_center_notification(
    state: State<'_, AppState>,
    notification_id: String,
) -> Result<(), String> {
    require_cloud_admin(&state).await?;
    let notification_id = validate_text(&notification_id, "Notification ID")?;
    cloud_backup::delete_cloud_notification(&state, &notification_id).await
}

#[tauri::command]
pub(crate) async fn mark_personal_center_notification(
    state: State<'_, AppState>,
    notification_id: String,
    read: bool,
) -> Result<(), String> {
    let notification_id = validate_text(&notification_id, "Notification ID")?;
    cloud_backup::mark_cloud_notification(&state, &notification_id, read).await
}

#[tauri::command]
pub(crate) async fn get_personal_center_realtime_session(
    state: State<'_, AppState>,
) -> Result<PersonalCenterRealtimeSession, String> {
    cloud_backup::realtime_session(&state).await
}

#[tauri::command]
pub(crate) async fn list_personal_center_login_events(
    state: State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<PersonalCenterLoginEvent>, String> {
    require_cloud_admin(&state).await?;
    cloud_backup::cloud_login_events(&state, limit.unwrap_or(100)).await
}

#[cfg(test)]
mod tests {
    use super::{
        validate_membership, validate_notification, MembershipAccess, PublishNotificationRequest,
    };

    fn membership() -> MembershipAccess {
        MembershipAccess {
            station_id: "station-1".into(),
            account_id: "account-1".into(),
            user_email: "user@example.com".into(),
            plan: "pro".into(),
            access_level: "member".into(),
            enabled: true,
            expires_at: None,
            privileges: vec!["usage".into()],
            updated_at: 0,
        }
    }

    #[test]
    fn membership_validation_rejects_unsafe_access() {
        let mut invalid = membership();
        invalid.access_level = "owner".into();
        assert!(validate_membership(invalid).is_err());
        let mut invalid = membership();
        invalid.privileges = vec!["shell".into()];
        assert!(validate_membership(invalid).is_err());
    }

    #[test]
    fn membership_validation_deduplicates_privileges() {
        let mut valid = membership();
        valid.privileges = vec!["usage".into(), "usage".into(), "members".into()];
        assert_eq!(
            validate_membership(valid)
                .expect("membership should validate")
                .privileges,
            vec!["members", "usage"]
        );
    }

    #[test]
    fn notification_validation_accepts_member_and_guest_audiences() {
        for audience in ["members", "guests"] {
            let request = PublishNotificationRequest {
                audience: audience.into(),
                target_email: None,
                kind: "info".into(),
                title: "Notice".into(),
                body: "Body".into(),
                destination: "personalCenter".into(),
                expires_at: None,
            };
            assert_eq!(validate_notification(request).unwrap().audience, audience);
        }
    }
}
