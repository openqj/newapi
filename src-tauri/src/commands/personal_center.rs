use std::collections::BTreeSet;

use tauri::State;
use url::Url;
use uuid::Uuid;

use crate::{
    commands::stations::{redeem_station_code_for_station, register_station_account_for_request},
    personal_center_store::{
        AdminMerchantFreeCode, AdminMerchantFreeCodeInput, AdminMerchantProfile,
        AdminMerchantProfileInput, AdminMerchantRateShare, AdminMerchantRateShareInput,
        MembershipAccess, MerchantFreeCodeInput, MerchantFreeOffer, MerchantImportResult,
        MerchantProfile, MerchantRatePublishResult, MerchantRateShare, NotificationPreferences,
        PersonalCenterAuditEntry, PersonalCenterLoginEvent, PersonalCenterNotification,
        PersonalCenterRealtimeSession, PersonalCenterStore, PublishMerchantRateRequest,
        PublishNotificationRequest,
    },
    services::{authorization::require_cloud_admin, cloud_backup},
    station_store::StationStore,
    support::{now, station_base},
    AppState, MerchantFreeRegistrationResult, RegisterMerchantFreeOfferRequest,
    RegisterStationAccountRequest,
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

fn validate_https(value: &str, field: &str) -> Result<String, String> {
    let value = value.trim();
    let url = Url::parse(value).map_err(|_| format!("{field} must be a valid URL"))?;
    if url.scheme() != "https" || url.host_str().is_none() {
        return Err(format!("{field} must use HTTPS"));
    }
    Ok(value.to_string())
}

fn validate_optional(
    value: Option<String>,
    field: &str,
    max: usize,
) -> Result<Option<String>, String> {
    value
        .map(|value| {
            let value = value.trim();
            if value.chars().count() > max || value.chars().any(char::is_control) {
                Err(format!("{field} is invalid"))
            } else {
                Ok(value.to_string())
            }
        })
        .transpose()
        .map(|value| value.filter(|value| !value.is_empty()))
}

fn validate_text(value: &str, field: &str) -> Result<String, String> {
    validate_visible_text(value, field, MAX_TEXT_LENGTH)
}

fn validate_visible_text(value: &str, field: &str, max: usize) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max || value.chars().any(char::is_control) {
        return Err(format!(
            "{field} must contain 1 to {max} visible characters"
        ));
    }
    Ok(value.to_string())
}

fn validate_merchant_tier(tier: Option<String>) -> Result<Option<String>, String> {
    match tier.as_deref() {
        None => Ok(None),
        Some("diamond" | "gold" | "silver") => Ok(tier),
        _ => Err("Merchant tier is invalid".into()),
    }
}

fn validate_uuid(value: &str, field: &str) -> Result<String, String> {
    Uuid::parse_str(value)
        .map(|value| value.to_string())
        .map_err(|_| format!("{field} must be a valid ID"))
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

#[tauri::command]
pub(crate) async fn get_merchant_profile(
    state: State<'_, AppState>,
) -> Result<Option<MerchantProfile>, String> {
    cloud_backup::merchant_profile(&state).await
}

#[tauri::command]
pub(crate) async fn save_merchant_profile(
    state: State<'_, AppState>,
    mut profile: MerchantProfile,
) -> Result<MerchantProfile, String> {
    profile.merchant_name = validate_visible_text(&profile.merchant_name, "Merchant name", 80)?;
    profile.description = validate_optional(profile.description, "Merchant description", 160)?;
    profile.qq = validate_optional(profile.qq, "QQ", 40)?;
    profile.qq_link = validate_optional(profile.qq_link, "QQ link", 500)?
        .map(|value| validate_https(&value, "QQ link"))
        .transpose()?;
    profile.website_url = validate_optional(profile.website_url, "Website URL", 500)?
        .map(|value| validate_https(&value, "Website URL"))
        .transpose()?;
    profile.wechat_qr_url = validate_optional(profile.wechat_qr_url, "WeChat QR URL", 500)?
        .map(|value| validate_https(&value, "WeChat QR URL"))
        .transpose()?;
    cloud_backup::save_merchant_profile(&state, &profile).await
}

#[tauri::command]
pub(crate) async fn list_merchant_rate_shares(
    state: State<'_, AppState>,
) -> Result<Vec<MerchantRateShare>, String> {
    cloud_backup::merchant_rate_shares(&state).await
}

#[tauri::command]
pub(crate) async fn publish_merchant_rate_share(
    state: State<'_, AppState>,
    mut request: PublishMerchantRateRequest,
) -> Result<MerchantRatePublishResult, String> {
    request.station_name = validate_visible_text(&request.station_name, "Station name", 100)?;
    request.station_url = validate_https(&request.station_url, "Station URL")?;
    request.group_name = validate_visible_text(&request.group_name, "Group name", 100)?;
    request.multiplier_summary = request.multiplier_summary.trim().to_string();
    if request.multiplier_summary.is_empty()
        || request.multiplier_summary.chars().count() > 500
        || request.multiplier_summary.chars().any(char::is_control)
    {
        return Err("Multiplier summary must contain 1 to 500 visible characters".into());
    }
    request.recharge_url = validate_https(&request.recharge_url, "Recharge URL")?;
    if !request.one_to_one_recharge || !request.official_pricing {
        return Err("仅支持 1 元兑换 1 美元且使用官方定价的分组倍率".into());
    }
    cloud_backup::publish_merchant_rate(&state, &request).await
}

#[tauri::command]
pub(crate) async fn import_merchant_free_codes(
    state: State<'_, AppState>,
    mut codes: Vec<MerchantFreeCodeInput>,
) -> Result<MerchantImportResult, String> {
    if codes.is_empty() || codes.len() > 200 {
        return Err("每次请导入 1 到 200 个兑换码".into());
    }
    for code in &mut codes {
        code.station_name = validate_visible_text(&code.station_name, "Station name", 100)?;
        code.station_url = validate_https(&code.station_url, "Station URL")?;
        code.redeem_code = validate_optional(Some(code.redeem_code.clone()), "Redeem code", 128)?
            .unwrap_or_default();
        if code.redeem_code.is_empty() {
            return Err("兑换码不能为空".into());
        }
        if !code.quota.is_finite() || code.quota <= 0.0 {
            return Err("免费额度必须是大于 0 的数字".into());
        }
        if code.expires_at <= now() {
            return Err("免费额度有效期必须晚于当前时间".into());
        }
    }
    cloud_backup::import_merchant_codes(&state, &codes).await
}

#[tauri::command]
pub(crate) async fn list_merchant_free_offers(
    state: State<'_, AppState>,
) -> Result<Vec<MerchantFreeOffer>, String> {
    cloud_backup::merchant_free_offers(&state).await
}

#[tauri::command]
pub(crate) async fn claim_and_redeem_merchant_free_offer(
    state: State<'_, AppState>,
    offer_id: String,
    station_id: String,
) -> Result<String, String> {
    let offer_id = validate_uuid(&offer_id, "Offer ID")?;
    let station_id = validate_uuid(&station_id, "Station ID")?;
    let claim = cloud_backup::claim_merchant_code(&state, &offer_id).await?;
    let station = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .get_station(&station_id)?;
    if station_base(&station.base_url) != station_base(&claim.station_url) {
        cloud_backup::release_merchant_code(&state, &claim.id)
            .await
            .ok();
        return Err("站点账号与免费额度所属中转站不一致".into());
    }
    match redeem_station_code_for_station(&state, &station_id, &claim.redeem_code).await {
        Ok(message) => Ok(message),
        Err(reason) => {
            cloud_backup::release_merchant_code(&state, &claim.id)
                .await
                .ok();
            Err(reason)
        }
    }
}

#[tauri::command]
pub(crate) async fn register_and_redeem_merchant_free_offer(
    state: State<'_, AppState>,
    request: RegisterMerchantFreeOfferRequest,
) -> Result<MerchantFreeRegistrationResult, String> {
    let offer_id = validate_uuid(&request.offer_id, "Offer ID")?;
    let station_url = validate_https(&request.base_url, "Station URL")?;
    let claim = cloud_backup::claim_merchant_code(&state, &offer_id).await?;
    if station_base(&station_url) != station_base(&claim.station_url) {
        cloud_backup::release_merchant_code(&state, &claim.id)
            .await
            .ok();
        return Err("站点地址与免费额度所属中转站不一致".into());
    }

    let registration = RegisterStationAccountRequest {
        name: request.name,
        base_url: station_url,
        email: request.email,
        username: request.username,
        password: request.password,
        verification_code: request.verification_code,
        kind: request.kind,
    };
    let registered = match register_station_account_for_request(&state, registration).await {
        Ok(result) => result,
        Err(reason) => {
            cloud_backup::release_merchant_code(&state, &claim.id)
                .await
                .ok();
            return Err(reason);
        }
    };

    match redeem_station_code_for_station(&state, &registered.station.id, &claim.redeem_code).await
    {
        Ok(redemption_message) => Ok(MerchantFreeRegistrationResult {
            station: registered.station,
            connection: registered.connection,
            redemption_success: true,
            redemption_message,
        }),
        Err(reason) => {
            cloud_backup::release_merchant_code(&state, &claim.id)
                .await
                .ok();
            Ok(MerchantFreeRegistrationResult {
                station: registered.station,
                connection: registered.connection,
                redemption_success: false,
                redemption_message: format!(
                    "兑换失败：{reason}。站点账号已添加，可重新领取后兑换。"
                ),
            })
        }
    }
}

#[tauri::command]
pub(crate) async fn list_admin_merchant_profiles(
    state: State<'_, AppState>,
) -> Result<Vec<AdminMerchantProfile>, String> {
    require_cloud_admin(&state).await?;
    cloud_backup::admin_merchant_profiles(&state).await
}

#[tauri::command]
pub(crate) async fn save_admin_merchant_profile(
    state: State<'_, AppState>,
    mut profile: AdminMerchantProfileInput,
) -> Result<(), String> {
    require_cloud_admin(&state).await?;
    profile.user_id = validate_uuid(&profile.user_id, "Merchant ID")?;
    profile.merchant_name = validate_visible_text(&profile.merchant_name, "Merchant name", 80)?;
    profile.description = validate_optional(profile.description, "Merchant description", 160)?;
    profile.qq = validate_optional(profile.qq, "QQ", 40)?;
    profile.qq_link = validate_optional(profile.qq_link, "QQ link", 500)?
        .map(|value| validate_https(&value, "QQ link"))
        .transpose()?;
    profile.wechat_qr_url = validate_optional(profile.wechat_qr_url, "WeChat QR URL", 500)?
        .map(|value| validate_https(&value, "WeChat QR URL"))
        .transpose()?;
    profile.tier = validate_merchant_tier(profile.tier)?;
    cloud_backup::save_admin_merchant_profile(&state, &profile).await
}

#[tauri::command]
pub(crate) async fn list_admin_merchant_rate_shares(
    state: State<'_, AppState>,
) -> Result<Vec<AdminMerchantRateShare>, String> {
    require_cloud_admin(&state).await?;
    cloud_backup::admin_merchant_rate_shares(&state).await
}

#[tauri::command]
pub(crate) async fn save_admin_merchant_rate_share(
    state: State<'_, AppState>,
    mut share: AdminMerchantRateShareInput,
) -> Result<(), String> {
    require_cloud_admin(&state).await?;
    share.id = share
        .id
        .map(|value| validate_uuid(&value, "Rate share ID"))
        .transpose()?;
    share.merchant_id = validate_uuid(&share.merchant_id, "Merchant ID")?;
    share.station_name = validate_visible_text(&share.station_name, "Station name", 100)?;
    share.station_url = validate_https(&share.station_url, "Station URL")?;
    share.group_name = validate_visible_text(&share.group_name, "Group name", 100)?;
    share.multiplier_summary = share.multiplier_summary.trim().to_string();
    if share.multiplier_summary.is_empty()
        || share.multiplier_summary.chars().count() > 500
        || share.multiplier_summary.chars().any(char::is_control)
    {
        return Err("Multiplier summary must contain 1 to 500 visible characters".into());
    }
    cloud_backup::save_admin_merchant_rate_share(&state, &share).await
}

#[tauri::command]
pub(crate) async fn delete_admin_merchant_rate_share(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    require_cloud_admin(&state).await?;
    cloud_backup::delete_admin_merchant_rate_share(&state, &validate_uuid(&id, "Rate share ID")?)
        .await
}

#[tauri::command]
pub(crate) async fn list_admin_merchant_free_codes(
    state: State<'_, AppState>,
) -> Result<Vec<AdminMerchantFreeCode>, String> {
    require_cloud_admin(&state).await?;
    cloud_backup::admin_merchant_free_codes(&state).await
}

#[tauri::command]
pub(crate) async fn save_admin_merchant_free_code(
    state: State<'_, AppState>,
    mut code: AdminMerchantFreeCodeInput,
) -> Result<(), String> {
    require_cloud_admin(&state).await?;
    code.id = code
        .id
        .map(|value| validate_uuid(&value, "Free code ID"))
        .transpose()?;
    code.merchant_id = validate_uuid(&code.merchant_id, "Merchant ID")?;
    code.station_name = validate_visible_text(&code.station_name, "Station name", 100)?;
    code.station_url = validate_https(&code.station_url, "Station URL")?;
    code.redeem_code =
        validate_optional(Some(code.redeem_code), "Redeem code", 128)?.unwrap_or_default();
    if code.redeem_code.is_empty() {
        return Err("兑换码不能为空".into());
    }
    if !code.quota.is_finite() || code.quota <= 0.0 {
        return Err("免费额度必须是大于 0 的数字".into());
    }
    cloud_backup::save_admin_merchant_free_code(&state, &code).await
}

#[tauri::command]
pub(crate) async fn delete_admin_merchant_free_code(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    require_cloud_admin(&state).await?;
    cloud_backup::delete_admin_merchant_free_code(&state, &validate_uuid(&id, "Free code ID")?)
        .await
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
