use std::{collections::HashMap, fs, path::Path};

use aes_gcm::{
    aead::{rand_core::RngCore, Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::Utc;
use reqwest::{header, StatusCode};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tempfile::NamedTempFile;
use uuid::Uuid;

use crate::{
    keyring_store::{
        clear_cloud_session, clear_login_profile_secret, clear_secret, load_cloud_session,
        load_login_profile_secret, load_secret, remote_key_passphrase_entry,
        remote_relay_key_entry, remote_server_entry, save_cloud_session, save_login_profile_secret,
        save_secret, CloudSession, Secret,
    },
    login_profiles::LoginProfileStore,
    personal_center_store::{
        AdminMerchantFreeAccount, AdminMerchantFreeAccountInput, AdminMerchantProfile,
        AdminMerchantProfileInput, AdminMerchantRateShare, AdminMerchantRateShareInput,
        ClaimedMerchantAccount,
        MembershipAccess, MerchantFreeAccountInput, MerchantFreeOffer, MerchantProfile,
        MerchantRateShare, NotificationPreferences, PersonalCenterAuditEntry,
        PersonalCenterLoginEvent, PersonalCenterNotification, PersonalCenterRealtimeSession,
        PublishMerchantRateRequest, PublishNotificationRequest,
    },
    remote_store::RemoteServerStore,
    station_store::StationStore,
    AppState, CloudAuthStatus, CloudBackupPreview, CloudBackupSummary, Store,
};

const BACKUP_BUCKET: &str = "relayhub-backups";
const BACKUP_VERSION: u8 = 1;
const BACKUP_LIST_PAGE_SIZE: usize = 100;
const MAX_BACKUP_BYTES: usize = 25 * 1024 * 1024;
const BACKUP_TABLES: &[&str] = &[
    "stations",
    "snapshots",
    "changes",
    "audit_events",
    "usage_log_cache",
    "model_discovery_cache",
    "app_settings",
    "alert_events",
    "alert_states",
    "login_profiles",
    "remote_servers",
    "remote_sync_logs",
];

struct CloudConfig {
    url: String,
    anon_key: String,
}

#[derive(Deserialize)]
struct AuthUser {
    id: String,
    email: Option<String>,
    #[serde(default)]
    app_metadata: AuthAppMetadata,
}

#[derive(Default, Deserialize)]
struct AuthAppMetadata {
    role: Option<String>,
}

#[derive(Deserialize)]
struct AuthResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    user: AuthUser,
}

#[derive(Deserialize)]
struct StorageMetadata {
    size: Option<u64>,
}

#[derive(Deserialize)]
struct StorageObject {
    name: String,
    created_at: Option<String>,
    metadata: Option<StorageMetadata>,
}

#[derive(Clone, Serialize, Deserialize)]
struct StationSecretBackup {
    username: String,
    password: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct CloudBackupPayload {
    version: u8,
    database: String,
    station_secrets: HashMap<String, StationSecretBackup>,
    login_profile_secrets: HashMap<String, StationSecretBackup>,
    remote_passwords: HashMap<String, String>,
    remote_relay_keys: HashMap<String, String>,
}

#[derive(Serialize, Deserialize)]
struct EncryptedBackup {
    version: u8,
    salt: String,
    nonce: String,
    ciphertext: String,
}

fn parse_environment_value(content: &str, key: &str) -> Option<String> {
    content
        .lines()
        .find_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                return None;
            }
            let (name, value) = line.split_once('=')?;
            (name.trim() == key).then(|| value.trim().trim_matches('"').to_string())
        })
        .filter(|value| !value.is_empty())
}

fn local_environment_value(key: &str) -> Option<String> {
    let content = std::fs::read_to_string(".env.local")
        .ok()
        .or_else(|| std::fs::read_to_string("../.env.local").ok())?;
    parse_environment_value(&content, key)
}

fn bundled_environment_value(key: &str) -> Option<String> {
    parse_environment_value(include_str!("../../supabase.env"), key)
}

fn config() -> Result<CloudConfig, String> {
    let url = std::env::var("SUPABASE_URL")
        .ok()
        .or_else(|| local_environment_value("SUPABASE_URL"))
        .or_else(|| bundled_environment_value("SUPABASE_URL"))
        .unwrap_or_default();
    let anon_key = std::env::var("SUPABASE_ANON_KEY")
        .ok()
        .or_else(|| local_environment_value("SUPABASE_ANON_KEY"))
        .or_else(|| bundled_environment_value("SUPABASE_ANON_KEY"))
        .unwrap_or_default();
    if url.trim().is_empty() || anon_key.trim().is_empty() {
        return Err("未配置 Supabase。请设置 SUPABASE_URL 和 SUPABASE_ANON_KEY。".into());
    }
    Ok(CloudConfig {
        url: url.trim_end_matches('/').to_string(),
        anon_key,
    })
}

fn status_from_session(configured: bool) -> CloudAuthStatus {
    let session = load_cloud_session().ok();
    let role = session
        .as_ref()
        .map(|value| value.role.clone())
        .unwrap_or_else(|| "member".into());
    CloudAuthStatus {
        configured,
        email: session.as_ref().map(|value| value.email.clone()),
        is_admin: session.is_some_and(|value| value.is_admin),
        role,
    }
}

fn cloud_role(role: Option<&str>) -> String {
    match role {
        Some("admin" | "super_admin") => "admin",
        Some("merchant") => "merchant",
        Some("pro") => "pro",
        _ => "member",
    }
    .into()
}

pub(crate) async fn auth_status(_state: &AppState) -> CloudAuthStatus {
    // Opening the personal center must not create or refresh a cloud session.
    status_from_session(config().is_ok())
}

fn auth_headers(config: &CloudConfig) -> Result<header::HeaderMap, String> {
    let mut headers = header::HeaderMap::new();
    headers.insert(
        "apikey",
        config
            .anon_key
            .parse::<header::HeaderValue>()
            .map_err(|error| error.to_string())?,
    );
    Ok(headers)
}

async fn response_json<T: DeserializeOwned>(response: reqwest::Response) -> Result<T, String> {
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format!("云端请求失败 ({status}): {body}"));
    }
    serde_json::from_str(&body).map_err(|error| error.to_string())
}

async fn ensure_success(response: reqwest::Response) -> Result<(), String> {
    if response.status().is_success() {
        return Ok(());
    }
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    Err(format!("云端请求失败 ({status}): {body}"))
}

fn save_auth_response(response: AuthResponse) -> Result<CloudAuthStatus, String> {
    let (Some(access_token), Some(refresh_token)) = (response.access_token, response.refresh_token)
    else {
        return Ok(CloudAuthStatus {
            configured: true,
            email: None,
            is_admin: false,
            role: "member".into(),
        });
    };
    let email = response.user.email.unwrap_or_default();
    let role = cloud_role(response.user.app_metadata.role.as_deref());
    let is_admin = matches!(
        response.user.app_metadata.role.as_deref(),
        Some("admin" | "super_admin")
    );
    save_cloud_session(&CloudSession {
        access_token,
        refresh_token,
        user_id: response.user.id,
        email: email.clone(),
        expires_at: Utc::now().timestamp() + response.expires_in.unwrap_or(3600),
        is_admin,
        role: role.clone(),
    })?;
    Ok(CloudAuthStatus {
        configured: true,
        email: Some(email),
        is_admin,
        role,
    })
}

pub(crate) async fn sign_up(
    state: &AppState,
    email: String,
    password: String,
) -> Result<CloudAuthStatus, String> {
    validate_auth_input(&email, &password)?;
    let config = config()?;
    let response = state
        .client
        .post(format!("{}/auth/v1/signup", config.url))
        .headers(auth_headers(&config)?)
        .json(&serde_json::json!({ "email": email.trim(), "password": password }))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    save_auth_response(response_json(response).await?)
}

pub(crate) async fn sign_in(
    state: &AppState,
    email: String,
    password: String,
) -> Result<CloudAuthStatus, String> {
    validate_auth_input(&email, &password)?;
    let config = config()?;
    let response = state
        .client
        .post(format!("{}/functions/v1/login-with-audit", config.url))
        .headers(auth_headers(&config)?)
        .bearer_auth(&config.anon_key)
        .json(&serde_json::json!({ "email": email.trim(), "password": password }))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    save_auth_response(response_json(response).await?)
}

pub(crate) async fn request_password_reset(state: &AppState, email: String) -> Result<(), String> {
    if !email.contains('@') {
        return Err("请输入有效邮箱。".into());
    }
    let config = config()?;
    let response = state
        .client
        .post(format!("{}/auth/v1/recover", config.url))
        .headers(auth_headers(&config)?)
        .json(&serde_json::json!({
            "email": email.trim(),
            "redirect_to": "relayhub://auth/reset-password"
        }))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    ensure_success(response).await
}

pub(crate) async fn complete_password_reset(
    state: &AppState,
    access_token: String,
    refresh_token: String,
    expires_in: i64,
    password: String,
) -> Result<CloudAuthStatus, String> {
    if access_token.trim().is_empty() || refresh_token.trim().is_empty() {
        return Err("密码重置链接无效或已过期。".into());
    }
    if password.len() < 8 {
        return Err("新密码至少需要 8 个字符。".into());
    }
    let config = config()?;
    let response = state
        .client
        .put(format!("{}/auth/v1/user", config.url))
        .headers(auth_headers(&config)?)
        .bearer_auth(&access_token)
        .json(&serde_json::json!({ "password": password }))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let user: AuthUser = response_json(response).await?;
    let email = user.email.unwrap_or_default();
    let role = cloud_role(user.app_metadata.role.as_deref());
    let is_admin = matches!(
        user.app_metadata.role.as_deref(),
        Some("admin" | "super_admin")
    );
    save_cloud_session(&CloudSession {
        access_token,
        refresh_token,
        user_id: user.id,
        email: email.clone(),
        expires_at: Utc::now().timestamp() + expires_in.clamp(60, 86_400),
        is_admin,
        role: role.clone(),
    })?;
    Ok(CloudAuthStatus {
        configured: true,
        email: Some(email),
        is_admin,
        role,
    })
}

pub(crate) fn sign_out() {
    clear_cloud_session();
}

fn validate_auth_input(email: &str, password: &str) -> Result<(), String> {
    if !email.contains('@') || password.len() < 8 {
        return Err("请输入有效邮箱和至少 8 位的密码。".into());
    }
    Ok(())
}

async fn session(state: &AppState, config: &CloudConfig) -> Result<CloudSession, String> {
    let current = load_cloud_session()?;
    if current.expires_at > Utc::now().timestamp() + 60 {
        return Ok(current);
    }
    let response = state
        .client
        .post(format!(
            "{}/auth/v1/token?grant_type=refresh_token",
            config.url
        ))
        .headers(auth_headers(config)?)
        .json(&serde_json::json!({ "refresh_token": current.refresh_token }))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let refreshed: AuthResponse = response_json(response).await?;
    let (Some(access_token), Some(refresh_token)) =
        (refreshed.access_token, refreshed.refresh_token)
    else {
        clear_cloud_session();
        return Err("云端登录已过期，请重新登录。".into());
    };
    let next = CloudSession {
        access_token,
        refresh_token,
        user_id: refreshed.user.id,
        email: refreshed.user.email.unwrap_or(current.email),
        expires_at: Utc::now().timestamp() + refreshed.expires_in.unwrap_or(3600),
        is_admin: matches!(
            refreshed.user.app_metadata.role.as_deref(),
            Some("admin" | "super_admin")
        ),
        role: cloud_role(refreshed.user.app_metadata.role.as_deref()),
    };
    save_cloud_session(&next)?;
    Ok(next)
}

async fn verified_session(state: &AppState, config: &CloudConfig) -> Result<CloudSession, String> {
    let mut current = session(state, config).await?;
    let response = state
        .client
        .get(format!("{}/auth/v1/user", config.url))
        .headers(storage_headers(config, &current)?)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let user: AuthUser = response_json(response).await?;
    current.user_id = user.id;
    current.email = user.email.unwrap_or(current.email);
    current.is_admin = matches!(
        user.app_metadata.role.as_deref(),
        Some("admin" | "super_admin")
    );
    current.role = cloud_role(user.app_metadata.role.as_deref());
    save_cloud_session(&current)?;
    Ok(current)
}

pub(crate) async fn require_verified_admin(state: &AppState) -> Result<CloudSession, String> {
    let config = config()?;
    let current = verified_session(state, &config).await?;
    if current.is_admin {
        Ok(current)
    } else {
        Err("Administrator permission is required".into())
    }
}

pub(crate) async fn is_verified_cloud_admin(state: &AppState) -> Result<bool, String> {
    let config = config()?;
    Ok(verified_session(state, &config).await?.is_admin)
}

async fn require_verified_merchant(state: &AppState) -> Result<(CloudConfig, CloudSession), String> {
    let config = config()?;
    let current = verified_session(state, &config).await?;
    if current.role == "merchant" || current.is_admin {
        Ok((config, current))
    } else {
        Err("Merchant permission is required".into())
    }
}

pub(crate) async fn merchant_profile(state: &AppState) -> Result<Option<MerchantProfile>, String> {
    let (config, current) = require_verified_merchant(state).await?;
    let response = state.client
        .get(format!("{}/rest/v1/merchant_profiles", config.url))
        .headers(postgrest_headers(&config, &current)?)
        .query(&[("user_id", format!("eq.{}", current.user_id)), ("select", "merchant_name,qq,qq_link,wechat_qr_url".into())])
        .send().await.map_err(|error| error.to_string())?;
    Ok(response_json::<Vec<CloudMerchantProfile>>(response).await?.into_iter().next().map(Into::into))
}

pub(crate) async fn save_merchant_profile(state: &AppState, profile: &MerchantProfile) -> Result<MerchantProfile, String> {
    let (config, current) = require_verified_merchant(state).await?;
    let response = state.client
        .post(format!("{}/rest/v1/merchant_profiles", config.url))
        .headers(postgrest_headers(&config, &current)?)
        .header("Prefer", "resolution=merge-duplicates,return=representation")
        .json(&serde_json::json!({
            "user_id": current.user_id,
            "merchant_name": profile.merchant_name,
            "qq": profile.qq,
            "qq_link": profile.qq_link,
            "wechat_qr_url": profile.wechat_qr_url,
        }))
        .send().await.map_err(|error| error.to_string())?;
    response_json::<Vec<CloudMerchantProfile>>(response).await?.into_iter().next().map(Into::into)
        .ok_or_else(|| "Merchant profile was not saved".into())
}

pub(crate) async fn merchant_rate_shares(state: &AppState) -> Result<Vec<MerchantRateShare>, String> {
    let config = config()?;
    let response = state.client
        .get(format!("{}/rest/v1/merchant_rate_shares", config.url))
        .headers(public_postgrest_headers(&config)?)
        .query(&[("select", "id,station_name,station_url,group_name,multiplier_summary,pinned,published_at,merchant_profiles!inner(merchant_name,qq,qq_link,wechat_qr_url)"), ("active", "eq.true"), ("order", "pinned.desc,published_at.desc")])
        .send().await.map_err(|error| error.to_string())?;
    Ok(response_json::<Vec<CloudMerchantRateShare>>(response).await?.into_iter().map(Into::into).collect())
}

pub(crate) async fn publish_merchant_rate(state: &AppState, request: &PublishMerchantRateRequest) -> Result<(), String> {
    let (config, current) = require_verified_merchant(state).await?;
    let response = state.client
        .post(format!("{}/rest/v1/merchant_rate_shares", config.url))
        .headers(postgrest_headers(&config, &current)?)
        .header("Prefer", "resolution=merge-duplicates")
        .query(&[("on_conflict", "merchant_id,station_url,group_name")])
        .json(&serde_json::json!({
            "merchant_id": current.user_id,
            "station_name": request.station_name,
            "station_url": request.station_url,
            "group_name": request.group_name,
            "multiplier_summary": request.multiplier_summary,
            "active": true,
        }))
        .send().await.map_err(|error| error.to_string())?;
    ensure_success(response).await
}

pub(crate) async fn import_merchant_accounts(state: &AppState, accounts: &[MerchantFreeAccountInput]) -> Result<(), String> {
    let (config, current) = require_verified_merchant(state).await?;
    let payload = accounts.iter().map(|account| serde_json::json!({
        "merchant_id": current.user_id,
        "station_name": account.station_name,
        "station_url": account.station_url,
        "username": account.username,
        "password": account.password,
        "station_kind": account.station_kind,
        "quota": account.quota,
    })).collect::<Vec<_>>();
    let response = state.client
        .post(format!("{}/rest/v1/merchant_free_accounts", config.url))
        .headers(postgrest_headers(&config, &current)?)
        .json(&payload)
        .send().await.map_err(|error| error.to_string())?;
    ensure_success(response).await
}

pub(crate) async fn merchant_free_offers(state: &AppState) -> Result<Vec<MerchantFreeOffer>, String> {
    let config = config()?;
    let response = state.client
        .post(format!("{}/rest/v1/rpc/list_merchant_free_offers", config.url))
        .headers(public_postgrest_headers(&config)?)
        .json(&serde_json::json!({}))
        .send().await.map_err(|error| error.to_string())?;
    Ok(response_json::<Vec<CloudMerchantFreeOffer>>(response).await?.into_iter().map(Into::into).collect())
}

pub(crate) async fn admin_merchant_profiles(state: &AppState) -> Result<Vec<AdminMerchantProfile>, String> {
    let config = config()?;
    let current = require_verified_admin(state).await?;
    let response = state.client
        .get(format!("{}/rest/v1/merchant_profiles", config.url))
        .headers(postgrest_headers(&config, &current)?)
        .query(&[("select", "user_id,merchant_name,qq,qq_link,wechat_qr_url"), ("order", "merchant_name.asc")])
        .send().await.map_err(|error| error.to_string())?;
    Ok(response_json::<Vec<AdminMerchantProfile>>(response).await?)
}

pub(crate) async fn save_admin_merchant_profile(state: &AppState, profile: &AdminMerchantProfileInput) -> Result<(), String> {
    let config = config()?;
    let current = require_verified_admin(state).await?;
    let response = state.client
        .patch(format!("{}/rest/v1/merchant_profiles", config.url))
        .headers(postgrest_headers(&config, &current)?)
        .query(&[("user_id", format!("eq.{}", profile.user_id))])
        .json(&serde_json::json!({
            "user_id": profile.user_id,
            "merchant_name": profile.merchant_name,
            "qq": profile.qq,
            "qq_link": profile.qq_link,
            "wechat_qr_url": profile.wechat_qr_url,
        }))
        .send().await.map_err(|error| error.to_string())?;
    ensure_success(response).await
}

pub(crate) async fn admin_merchant_rate_shares(state: &AppState) -> Result<Vec<AdminMerchantRateShare>, String> {
    let config = config()?;
    let current = require_verified_admin(state).await?;
    let response = state.client
        .get(format!("{}/rest/v1/merchant_rate_shares", config.url))
        .headers(postgrest_headers(&config, &current)?)
        .query(&[("select", "id,merchant_id,station_name,station_url,group_name,multiplier_summary,pinned,published_at,merchant_profiles!inner(merchant_name)"), ("order", "pinned.desc,published_at.desc")])
        .send().await.map_err(|error| error.to_string())?;
    Ok(response_json::<Vec<CloudAdminMerchantRateShare>>(response).await?.into_iter().map(Into::into).collect())
}

pub(crate) async fn save_admin_merchant_rate_share(state: &AppState, share: &AdminMerchantRateShareInput) -> Result<(), String> {
    let config = config()?;
    let current = require_verified_admin(state).await?;
    let payload = serde_json::json!({
        "merchant_id": share.merchant_id,
        "station_name": share.station_name,
        "station_url": share.station_url,
        "group_name": share.group_name,
        "multiplier_summary": share.multiplier_summary,
        "pinned": share.pinned,
        "active": true,
    });
    let response = if let Some(id) = &share.id {
        state.client.patch(format!("{}/rest/v1/merchant_rate_shares", config.url))
            .headers(postgrest_headers(&config, &current)?)
            .query(&[("id", format!("eq.{id}"))])
            .json(&payload)
            .send().await.map_err(|error| error.to_string())?
    } else {
        state.client.post(format!("{}/rest/v1/merchant_rate_shares", config.url))
            .headers(postgrest_headers(&config, &current)?)
            .json(&payload)
            .send().await.map_err(|error| error.to_string())?
    };
    ensure_success(response).await
}

pub(crate) async fn delete_admin_merchant_rate_share(state: &AppState, id: &str) -> Result<(), String> {
    let config = config()?;
    let current = require_verified_admin(state).await?;
    let response = state.client
        .delete(format!("{}/rest/v1/merchant_rate_shares", config.url))
        .headers(postgrest_headers(&config, &current)?)
        .query(&[("id", format!("eq.{id}"))])
        .send().await.map_err(|error| error.to_string())?;
    ensure_success(response).await
}

pub(crate) async fn admin_merchant_free_accounts(state: &AppState) -> Result<Vec<AdminMerchantFreeAccount>, String> {
    let config = config()?;
    let current = require_verified_admin(state).await?;
    let response = state.client
        .get(format!("{}/rest/v1/merchant_free_accounts", config.url))
        .headers(postgrest_headers(&config, &current)?)
        .query(&[("select", "id,merchant_id,station_name,station_url,username,password,station_kind,quota,pinned,created_at,claimed_by,merchant_profiles!inner(merchant_name)"), ("order", "pinned.desc,created_at.desc")])
        .send().await.map_err(|error| error.to_string())?;
    Ok(response_json::<Vec<CloudAdminMerchantFreeAccount>>(response).await?.into_iter().map(Into::into).collect())
}

pub(crate) async fn save_admin_merchant_free_account(state: &AppState, account: &AdminMerchantFreeAccountInput) -> Result<(), String> {
    let config = config()?;
    let current = require_verified_admin(state).await?;
    let payload = serde_json::json!({
        "merchant_id": account.merchant_id,
        "station_name": account.station_name,
        "station_url": account.station_url,
        "username": account.username,
        "password": account.password,
        "station_kind": account.station_kind,
        "quota": account.quota,
        "pinned": account.pinned,
    });
    let response = if let Some(id) = &account.id {
        state.client.patch(format!("{}/rest/v1/merchant_free_accounts", config.url))
            .headers(postgrest_headers(&config, &current)?)
            .query(&[("id", format!("eq.{id}"))])
            .json(&payload)
            .send().await.map_err(|error| error.to_string())?
    } else {
        state.client.post(format!("{}/rest/v1/merchant_free_accounts", config.url))
            .headers(postgrest_headers(&config, &current)?)
            .json(&payload)
            .send().await.map_err(|error| error.to_string())?
    };
    ensure_success(response).await
}

pub(crate) async fn delete_admin_merchant_free_account(state: &AppState, id: &str) -> Result<(), String> {
    let config = config()?;
    let current = require_verified_admin(state).await?;
    let response = state.client
        .delete(format!("{}/rest/v1/merchant_free_accounts", config.url))
        .headers(postgrest_headers(&config, &current)?)
        .query(&[("id", format!("eq.{id}"))])
        .send().await.map_err(|error| error.to_string())?;
    ensure_success(response).await
}

pub(crate) async fn claim_merchant_account(state: &AppState, offer_id: &str) -> Result<ClaimedMerchantAccount, String> {
    let config = config()?;
    let current = verified_session(state, &config).await?;
    let response = state.client
        .post(format!("{}/rest/v1/rpc/claim_merchant_free_account", config.url))
        .headers(postgrest_headers(&config, &current)?)
        .json(&serde_json::json!({ "offer_id": offer_id }))
        .send().await.map_err(|error| error.to_string())?;
    response_json::<Vec<CloudClaimedMerchantAccount>>(response).await?.into_iter().next().map(Into::into)
        .ok_or_else(|| "该免费额度已被领取，请选择其他账号。".into())
}

pub(crate) async fn release_merchant_account(state: &AppState, offer_id: &str) -> Result<(), String> {
    let config = config()?;
    let current = verified_session(state, &config).await?;
    let response = state.client
        .post(format!("{}/rest/v1/rpc/release_merchant_free_account", config.url))
        .headers(postgrest_headers(&config, &current)?)
        .json(&serde_json::json!({ "offer_id": offer_id }))
        .send().await.map_err(|error| error.to_string())?;
    ensure_success(response).await
}

#[derive(Deserialize)]
struct CloudMerchantProfile { merchant_name: String, qq: Option<String>, qq_link: Option<String>, wechat_qr_url: Option<String> }
impl From<CloudMerchantProfile> for MerchantProfile {
    fn from(value: CloudMerchantProfile) -> Self { Self { merchant_name: value.merchant_name, qq: value.qq, qq_link: value.qq_link, wechat_qr_url: value.wechat_qr_url } }
}

#[derive(Deserialize)]
struct CloudMerchantRateShare { id: String, station_name: String, station_url: String, group_name: String, multiplier_summary: String, pinned: bool, published_at: i64, merchant_profiles: CloudMerchantProfile }
impl From<CloudMerchantRateShare> for MerchantRateShare {
    fn from(value: CloudMerchantRateShare) -> Self { Self { id: value.id, merchant_name: value.merchant_profiles.merchant_name, station_name: value.station_name, station_url: value.station_url, group_name: value.group_name, multiplier_summary: value.multiplier_summary, qq: value.merchant_profiles.qq, qq_link: value.merchant_profiles.qq_link, wechat_qr_url: value.merchant_profiles.wechat_qr_url, pinned: value.pinned, published_at: value.published_at } }
}

#[derive(Deserialize)]
struct CloudMerchantFreeOffer { id: String, merchant_name: String, station_name: String, station_url: String, quota: f64, pinned: bool, published_at: i64 }
impl From<CloudMerchantFreeOffer> for MerchantFreeOffer {
    fn from(value: CloudMerchantFreeOffer) -> Self { Self { id: value.id, merchant_name: value.merchant_name, station_name: value.station_name, station_url: value.station_url, quota: value.quota, pinned: value.pinned, published_at: value.published_at } }
}

#[derive(Deserialize)]
struct CloudMerchantName { merchant_name: String }

#[derive(Deserialize)]
struct CloudAdminMerchantRateShare { id: String, merchant_id: String, station_name: String, station_url: String, group_name: String, multiplier_summary: String, pinned: bool, published_at: i64, merchant_profiles: CloudMerchantName }
impl From<CloudAdminMerchantRateShare> for AdminMerchantRateShare {
    fn from(value: CloudAdminMerchantRateShare) -> Self { Self { id: value.id, merchant_id: value.merchant_id, merchant_name: value.merchant_profiles.merchant_name, station_name: value.station_name, station_url: value.station_url, group_name: value.group_name, multiplier_summary: value.multiplier_summary, pinned: value.pinned, published_at: value.published_at } }
}

#[derive(Deserialize)]
struct CloudAdminMerchantFreeAccount { id: String, merchant_id: String, station_name: String, station_url: String, username: String, password: String, station_kind: String, quota: f64, pinned: bool, created_at: i64, claimed_by: Option<String>, merchant_profiles: CloudMerchantName }
impl From<CloudAdminMerchantFreeAccount> for AdminMerchantFreeAccount {
    fn from(value: CloudAdminMerchantFreeAccount) -> Self { Self { id: value.id, merchant_id: value.merchant_id, merchant_name: value.merchant_profiles.merchant_name, station_name: value.station_name, station_url: value.station_url, username: value.username, password: value.password, station_kind: value.station_kind, quota: value.quota, pinned: value.pinned, claimed: value.claimed_by.is_some(), created_at: value.created_at } }
}

#[derive(Deserialize)]
struct CloudClaimedMerchantAccount { id: String, station_name: String, station_url: String, username: String, password: String, station_kind: String }
impl From<CloudClaimedMerchantAccount> for ClaimedMerchantAccount {
    fn from(value: CloudClaimedMerchantAccount) -> Self { Self { id: value.id, station_name: value.station_name, station_url: value.station_url, username: value.username, password: value.password, station_kind: value.station_kind } }
}

#[derive(Deserialize)]
struct CloudNotificationPreferences {
    desktop_enabled: bool,
    sync_enabled: bool,
    alert_enabled: bool,
    offer_enabled: bool,
}

impl From<CloudNotificationPreferences> for NotificationPreferences {
    fn from(value: CloudNotificationPreferences) -> Self {
        Self {
            desktop_enabled: value.desktop_enabled,
            sync_enabled: value.sync_enabled,
            alert_enabled: value.alert_enabled,
            offer_enabled: value.offer_enabled,
        }
    }
}

fn postgrest_headers(
    config: &CloudConfig,
    session: &CloudSession,
) -> Result<header::HeaderMap, String> {
    let mut headers = storage_headers(config, session)?;
    headers.insert(
        "Accept",
        header::HeaderValue::from_static("application/json"),
    );
    Ok(headers)
}

fn public_postgrest_headers(config: &CloudConfig) -> Result<header::HeaderMap, String> {
    let mut headers = auth_headers(config)?;
    headers.insert(
        header::AUTHORIZATION,
        format!("Bearer {}", config.anon_key)
            .parse::<header::HeaderValue>()
            .map_err(|error| error.to_string())?,
    );
    headers.insert(
        "Accept",
        header::HeaderValue::from_static("application/json"),
    );
    Ok(headers)
}

pub(crate) async fn cloud_notification_preferences(
    state: &AppState,
) -> Result<NotificationPreferences, String> {
    let config = config()?;
    let current = verified_session(state, &config).await?;
    let response = state
        .client
        .get(format!(
            "{}/rest/v1/personal_center_notification_preferences",
            config.url
        ))
        .headers(postgrest_headers(&config, &current)?)
        .query(&[
            ("id", "eq.global"),
            (
                "select",
                "desktop_enabled,sync_enabled,alert_enabled,offer_enabled",
            ),
        ])
        .send()
        .await
        .map_err(|error| error.to_string())?;
    response_json::<Vec<CloudNotificationPreferences>>(response)
        .await?
        .into_iter()
        .next()
        .map(Into::into)
        .ok_or_else(|| "Cloud notification preferences are not initialized".to_string())
}

pub(crate) async fn cloud_memberships(state: &AppState) -> Result<Vec<MembershipAccess>, String> {
    let config = config()?;
    let current = verified_session(state, &config).await?;
    let response = state.client
        .get(format!("{}/rest/v1/personal_center_memberships", config.url))
        .headers(postgrest_headers(&config, &current)?)
        .query(&[("select", "station_id,account_id,user_email,plan,access_level,enabled,expires_at,privileges,updated_at"), ("order", "updated_at.desc")])
        .send().await.map_err(|error| error.to_string())?;
    Ok(response_json::<Vec<CloudMembership>>(response)
        .await?
        .into_iter()
        .map(Into::into)
        .collect())
}

#[derive(Deserialize)]
struct CloudMembership {
    station_id: String,
    account_id: String,
    user_email: String,
    plan: String,
    access_level: String,
    enabled: bool,
    expires_at: Option<i64>,
    privileges: Vec<String>,
    updated_at: i64,
}

impl From<CloudMembership> for MembershipAccess {
    fn from(value: CloudMembership) -> Self {
        Self {
            station_id: value.station_id,
            account_id: value.account_id,
            user_email: value.user_email,
            plan: value.plan,
            access_level: value.access_level,
            enabled: value.enabled,
            expires_at: value.expires_at,
            privileges: value.privileges,
            updated_at: value.updated_at,
        }
    }
}

pub(crate) async fn save_cloud_membership(
    state: &AppState,
    membership: &MembershipAccess,
) -> Result<MembershipAccess, String> {
    let config = config()?;
    let current = require_verified_admin(state).await?;
    let response = state
        .client
        .post(format!(
            "{}/rest/v1/personal_center_memberships",
            config.url
        ))
        .headers(postgrest_headers(&config, &current)?)
        .header(
            "Prefer",
            "resolution=merge-duplicates,return=representation",
        )
        .json(&serde_json::json!({
            "station_id": membership.station_id,
            "account_id": membership.account_id,
            "user_email": membership.user_email,
            "plan": membership.plan,
            "access_level": membership.access_level,
            "enabled": membership.enabled,
            "expires_at": membership.expires_at,
            "privileges": membership.privileges,
        }))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    response_json::<Vec<CloudMembership>>(response)
        .await?
        .into_iter()
        .next()
        .map(Into::into)
        .ok_or_else(|| "Cloud membership was not updated".to_string())
}

pub(crate) async fn delete_cloud_membership(
    state: &AppState,
    station_id: &str,
    account_id: &str,
) -> Result<(), String> {
    let config = config()?;
    let current = require_verified_admin(state).await?;
    let response = state
        .client
        .delete(format!(
            "{}/rest/v1/personal_center_memberships",
            config.url
        ))
        .headers(postgrest_headers(&config, &current)?)
        .query(&[
            ("station_id", format!("eq.{station_id}")),
            ("account_id", format!("eq.{account_id}")),
        ])
        .send()
        .await
        .map_err(|error| error.to_string())?;
    ensure_success(response).await
}

pub(crate) async fn cloud_personal_center_audit(
    state: &AppState,
    limit: usize,
) -> Result<Vec<PersonalCenterAuditEntry>, String> {
    let config = config()?;
    let current = require_verified_admin(state).await?;
    let response = state
        .client
        .get(format!(
            "{}/rest/v1/personal_center_audit_events",
            config.url
        ))
        .headers(postgrest_headers(&config, &current)?)
        .query(&[
            ("select", "id,action,subject,detail,created_at".to_string()),
            ("order", "created_at.desc".to_string()),
            ("limit", limit.min(500).to_string()),
        ])
        .send()
        .await
        .map_err(|error| error.to_string())?;
    Ok(
        response_json::<Vec<CloudPersonalCenterAuditEntry>>(response)
            .await?
            .into_iter()
            .map(Into::into)
            .collect(),
    )
}

#[derive(Deserialize)]
struct CloudPersonalCenterAuditEntry {
    id: i64,
    action: String,
    subject: String,
    detail: String,
    created_at: i64,
}

impl From<CloudPersonalCenterAuditEntry> for PersonalCenterAuditEntry {
    fn from(value: CloudPersonalCenterAuditEntry) -> Self {
        Self {
            id: value.id,
            action: value.action,
            subject: value.subject,
            detail: value.detail,
            created_at: value.created_at,
        }
    }
}

#[derive(Deserialize)]
struct CloudNotification {
    id: String,
    audience: String,
    target_email: Option<String>,
    kind: String,
    title: String,
    body: String,
    destination: String,
    published_at: i64,
    expires_at: Option<i64>,
    revoked_at: Option<i64>,
}

#[derive(Deserialize)]
struct CloudNotificationReceipt {
    notification_id: String,
    delivered_at: Option<i64>,
    read_at: Option<i64>,
}

pub(crate) async fn cloud_notifications(
    state: &AppState,
) -> Result<Vec<PersonalCenterNotification>, String> {
    let config = config()?;
    let current = if load_cloud_session().is_ok() {
        verified_session(state, &config).await.ok()
    } else {
        None
    };
    let headers = match current.as_ref() {
        Some(session) => postgrest_headers(&config, session)?,
        None => public_postgrest_headers(&config)?,
    };
    let mut query = vec![
        (
                "select",
            "id,audience,target_email,kind,title,body,destination,published_at,expires_at,revoked_at"
                .to_string(),
        ),
        ("order", "published_at.desc".to_string()),
    ];
    if current.is_none() {
        query.push(("audience", "eq.all".to_string()));
    }
    let notifications = response_json::<Vec<CloudNotification>>(
        state
            .client
            .get(format!(
                "{}/rest/v1/personal_center_notifications",
                config.url
            ))
            .headers(headers.clone())
            .query(&query)
            .send()
            .await
            .map_err(|error| error.to_string())?,
    )
    .await?;
    let receipts = if let Some(session) = current.as_ref() {
        response_json::<Vec<CloudNotificationReceipt>>(
            state
                .client
                .get(format!("{}/rest/v1/notification_receipts", config.url))
                .headers(postgrest_headers(&config, session)?)
                .query(&[
                    ("select", "notification_id,delivered_at,read_at".to_string()),
                    ("user_id", format!("eq.{}", session.user_id)),
                ])
                .send()
                .await
                .map_err(|error| error.to_string())?,
        )
        .await?
    } else {
        Vec::new()
    };
    let receipts = receipts
        .into_iter()
        .map(|receipt| (receipt.notification_id.clone(), receipt))
        .collect::<HashMap<_, _>>();
    Ok(notifications
        .into_iter()
        .map(|notification| {
            let receipt = receipts.get(&notification.id);
            PersonalCenterNotification {
                id: notification.id,
                audience: notification.audience,
                target_email: notification.target_email,
                kind: notification.kind,
                title: notification.title,
                body: notification.body,
                destination: notification.destination,
                published_at: notification.published_at,
                expires_at: notification.expires_at,
                revoked_at: notification.revoked_at,
                delivered_at: receipt
                    .and_then(|value| value.delivered_at)
                    .or_else(|| current.is_none().then_some(notification.published_at)),
                read_at: receipt.and_then(|value| value.read_at),
            }
        })
        .collect())
}

pub(crate) async fn publish_cloud_notification(
    state: &AppState,
    request: &PublishNotificationRequest,
) -> Result<PersonalCenterNotification, String> {
    let config = config()?;
    let current = require_verified_admin(state).await?;
    let response = state
        .client
        .post(format!(
            "{}/rest/v1/personal_center_notifications",
            config.url
        ))
        .headers(postgrest_headers(&config, &current)?)
        .header("Prefer", "return=representation")
        .json(&serde_json::json!({
            "audience": request.audience,
            "target_email": request.target_email,
            "kind": request.kind,
            "title": request.title,
            "body": request.body,
            "destination": request.destination,
            "expires_at": request.expires_at,
        }))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let notification = response_json::<Vec<CloudNotification>>(response)
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| "Cloud notification was not published".to_string())?;
    Ok(PersonalCenterNotification {
        id: notification.id,
        audience: notification.audience,
        target_email: notification.target_email,
        kind: notification.kind,
        title: notification.title,
        body: notification.body,
        destination: notification.destination,
        published_at: notification.published_at,
        expires_at: notification.expires_at,
        revoked_at: notification.revoked_at,
        delivered_at: None,
        read_at: None,
    })
}

pub(crate) async fn cloud_sent_notifications(
    state: &AppState,
) -> Result<Vec<PersonalCenterNotification>, String> {
    let config = config()?;
    let current = require_verified_admin(state).await?;
    let notifications = response_json::<Vec<CloudNotification>>(
        state
            .client
            .get(format!("{}/rest/v1/personal_center_notifications", config.url))
            .headers(postgrest_headers(&config, &current)?)
            .query(&[
                ("select", "id,audience,target_email,kind,title,body,destination,published_at,expires_at,revoked_at"),
                ("order", "published_at.desc"),
            ])
            .send()
            .await
            .map_err(|error| error.to_string())?,
    )
    .await?;
    Ok(notifications
        .into_iter()
        .map(|notification| PersonalCenterNotification {
            id: notification.id,
            audience: notification.audience,
            target_email: notification.target_email,
            kind: notification.kind,
            title: notification.title,
            body: notification.body,
            destination: notification.destination,
            published_at: notification.published_at,
            expires_at: notification.expires_at,
            revoked_at: notification.revoked_at,
            delivered_at: None,
            read_at: None,
        })
        .collect())
}

pub(crate) async fn update_cloud_notification(
    state: &AppState,
    notification_id: &str,
    request: &PublishNotificationRequest,
) -> Result<PersonalCenterNotification, String> {
    let config = config()?;
    let current = require_verified_admin(state).await?;
    let response = state
        .client
        .patch(format!(
            "{}/rest/v1/personal_center_notifications",
            config.url
        ))
        .headers(postgrest_headers(&config, &current)?)
        .header("Prefer", "return=representation")
        .query(&[("id", format!("eq.{notification_id}"))])
        .json(&serde_json::json!({
            "audience": request.audience,
            "target_email": request.target_email,
            "kind": request.kind,
            "title": request.title,
            "body": request.body,
            "destination": request.destination,
            "expires_at": request.expires_at,
        }))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let notification = response_json::<Vec<CloudNotification>>(response)
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| "Cloud notification was not found or has been revoked".to_string())?;
    Ok(PersonalCenterNotification {
        id: notification.id,
        audience: notification.audience,
        target_email: notification.target_email,
        kind: notification.kind,
        title: notification.title,
        body: notification.body,
        destination: notification.destination,
        published_at: notification.published_at,
        expires_at: notification.expires_at,
        revoked_at: notification.revoked_at,
        delivered_at: None,
        read_at: None,
    })
}

pub(crate) async fn revoke_cloud_notification(
    state: &AppState,
    notification_id: &str,
) -> Result<PersonalCenterNotification, String> {
    let config = config()?;
    let current = require_verified_admin(state).await?;
    let response = state
        .client
        .patch(format!(
            "{}/rest/v1/personal_center_notifications",
            config.url
        ))
        .headers(postgrest_headers(&config, &current)?)
        .header("Prefer", "return=representation")
        .query(&[
            ("id", format!("eq.{notification_id}")),
            ("revoked_at", "is.null".to_string()),
        ])
        .json(&serde_json::json!({ "revoked_at": Utc::now().timestamp() }))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let notification = response_json::<Vec<CloudNotification>>(response)
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| {
            "Cloud notification was not found or has already been revoked".to_string()
        })?;
    Ok(PersonalCenterNotification {
        id: notification.id,
        audience: notification.audience,
        target_email: notification.target_email,
        kind: notification.kind,
        title: notification.title,
        body: notification.body,
        destination: notification.destination,
        published_at: notification.published_at,
        expires_at: notification.expires_at,
        revoked_at: notification.revoked_at,
        delivered_at: None,
        read_at: None,
    })
}

pub(crate) async fn delete_cloud_notification(
    state: &AppState,
    notification_id: &str,
) -> Result<(), String> {
    let config = config()?;
    let current = require_verified_admin(state).await?;
    let response = state
        .client
        .delete(format!(
            "{}/rest/v1/personal_center_notifications",
            config.url
        ))
        .headers(postgrest_headers(&config, &current)?)
        .query(&[("id", format!("eq.{notification_id}"))])
        .send()
        .await
        .map_err(|error| error.to_string())?;
    ensure_success(response).await
}

pub(crate) async fn mark_cloud_notification(
    state: &AppState,
    notification_id: &str,
    read: bool,
) -> Result<(), String> {
    let config = config()?;
    if load_cloud_session().is_err() {
        return Ok(());
    }
    let current = verified_session(state, &config).await?;
    let timestamp = Utc::now().timestamp();
    let mut payload = serde_json::json!({
        "notification_id": notification_id,
        "user_id": current.user_id,
        "delivered_at": timestamp,
    });
    if read {
        payload["read_at"] = serde_json::json!(timestamp);
    }
    let response = state
        .client
        .post(format!("{}/rest/v1/notification_receipts", config.url))
        .headers(postgrest_headers(&config, &current)?)
        .header("Prefer", "resolution=merge-duplicates,return=minimal")
        .query(&[("on_conflict", "notification_id,user_id")])
        .json(&payload)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    ensure_success(response).await
}

pub(crate) async fn realtime_session(
    state: &AppState,
) -> Result<PersonalCenterRealtimeSession, String> {
    let config = config()?;
    let current = verified_session(state, &config).await?;
    Ok(PersonalCenterRealtimeSession {
        url: config.url,
        anon_key: config.anon_key,
        access_token: current.access_token,
        user_id: current.user_id,
        is_admin: current.is_admin,
        is_anonymous: false,
        expires_at: current.expires_at,
    })
}

#[derive(Deserialize)]
struct CloudLoginEvent {
    id: i64,
    email: String,
    ip_address: Option<String>,
    user_agent: Option<String>,
    outcome: String,
    failure_reason: Option<String>,
    created_at: i64,
}

pub(crate) async fn cloud_login_events(
    state: &AppState,
    limit: usize,
) -> Result<Vec<PersonalCenterLoginEvent>, String> {
    let config = config()?;
    let current = require_verified_admin(state).await?;
    let response = state
        .client
        .get(format!(
            "{}/rest/v1/personal_center_login_events",
            config.url
        ))
        .headers(postgrest_headers(&config, &current)?)
        .query(&[
            (
                "select",
                "id,email,ip_address,user_agent,outcome,failure_reason,created_at".to_string(),
            ),
            ("order", "created_at.desc".to_string()),
            ("limit", limit.min(500).to_string()),
        ])
        .send()
        .await
        .map_err(|error| error.to_string())?;
    Ok(response_json::<Vec<CloudLoginEvent>>(response)
        .await?
        .into_iter()
        .map(|event| PersonalCenterLoginEvent {
            id: event.id,
            email: event.email,
            ip_address: event.ip_address,
            user_agent: event.user_agent,
            outcome: event.outcome,
            failure_reason: event.failure_reason,
            created_at: event.created_at,
        })
        .collect())
}

fn storage_headers(
    config: &CloudConfig,
    session: &CloudSession,
) -> Result<header::HeaderMap, String> {
    let mut headers = auth_headers(config)?;
    headers.insert(
        header::AUTHORIZATION,
        format!("Bearer {}", session.access_token)
            .parse::<header::HeaderValue>()
            .map_err(|error| error.to_string())?,
    );
    Ok(headers)
}

fn object_path(session: &CloudSession, id: &str) -> String {
    format!("{}/{}.bin", session.user_id, id)
}

pub(crate) async fn list_backups(state: &AppState) -> Result<Vec<CloudBackupSummary>, String> {
    let config = config()?;
    let session = session(state, &config).await?;
    let mut offset = 0;
    let mut backups = Vec::new();
    loop {
        let response = state
            .client
            .post(format!(
                "{}/storage/v1/object/list/{}",
                config.url, BACKUP_BUCKET
            ))
            .headers(storage_headers(&config, &session)?)
            .json(&serde_json::json!({
                "prefix": session.user_id,
                "limit": BACKUP_LIST_PAGE_SIZE,
                "offset": offset,
            }))
            .send()
            .await
            .map_err(|error| error.to_string())?;
        let objects = response_json::<Vec<StorageObject>>(response).await?;
        let count = objects.len();
        backups.extend(objects.into_iter().filter_map(|object| {
            object
                .name
                .strip_suffix(".bin")
                .map(|id| CloudBackupSummary {
                    id: id.to_string(),
                    created_at: object.created_at.unwrap_or_default(),
                    byte_size: object
                        .metadata
                        .and_then(|metadata| metadata.size)
                        .unwrap_or_default(),
                })
        }));
        if count < BACKUP_LIST_PAGE_SIZE {
            break;
        }
        offset += count;
    }
    backups.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(backups)
}

pub(crate) fn local_backup_preview(state: &AppState) -> Result<CloudBackupPreview, String> {
    let store = state
        .store
        .lock()
        .map_err(|_| "Local database is unavailable".to_string())?;
    Ok(CloudBackupPreview {
        id: "local".into(),
        station_count: store.list_stations()?.len(),
        login_profile_count: store.list_login_profiles()?.len(),
        remote_server_count: store.list_remote_servers()?.len(),
    })
}

pub(crate) async fn create_backup(
    state: &AppState,
    recovery_password: String,
) -> Result<CloudBackupSummary, String> {
    validate_recovery_password(&recovery_password)?;
    let payload = build_payload(state)?;
    let encrypted = encrypt_payload(&payload, &recovery_password)?;
    if encrypted.len() > MAX_BACKUP_BYTES {
        return Err("备份超过 25 MB 限制，请清理本地历史记录后重试。".into());
    }
    let config = config()?;
    let session = session(state, &config).await?;
    let id = Uuid::new_v4().to_string();
    let response = state
        .client
        .post(format!(
            "{}/storage/v1/object/{}/{}",
            config.url,
            BACKUP_BUCKET,
            object_path(&session, &id)
        ))
        .headers(storage_headers(&config, &session)?)
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(encrypted.clone())
        .send()
        .await
        .map_err(|error| error.to_string())?;
    ensure_success(response).await?;
    let mut backups = list_backups(state).await?;
    backups.retain(|backup| backup.id == id);
    Ok(backups.pop().unwrap_or(CloudBackupSummary {
        id,
        created_at: Utc::now().to_rfc3339(),
        byte_size: encrypted.len() as u64,
    }))
}

pub(crate) async fn delete_backup(state: &AppState, id: String) -> Result<(), String> {
    if Uuid::parse_str(&id).is_err() {
        return Err("备份标识无效。".into());
    }
    let config = config()?;
    let session = session(state, &config).await?;
    let response = state
        .client
        .delete(format!(
            "{}/storage/v1/object/{}/{}",
            config.url,
            BACKUP_BUCKET,
            object_path(&session, &id)
        ))
        .headers(storage_headers(&config, &session)?)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    ensure_success(response).await
}

pub(crate) async fn preview_backup(
    state: &AppState,
    id: String,
    recovery_password: String,
) -> Result<CloudBackupPreview, String> {
    let payload = download_payload(state, &id, &recovery_password).await?;
    preview_payload(&id, &payload)
}

pub(crate) async fn restore_backup(
    state: &AppState,
    id: String,
    recovery_password: String,
) -> Result<CloudBackupPreview, String> {
    let payload = download_payload(state, &id, &recovery_password).await?;
    let preview = preview_payload(&id, &payload)?;
    restore_payload(state, &payload)?;
    Ok(preview)
}

async fn download_payload(
    state: &AppState,
    id: &str,
    recovery_password: &str,
) -> Result<CloudBackupPayload, String> {
    validate_recovery_password(recovery_password)?;
    let config = config()?;
    let session = session(state, &config).await?;
    let response = state
        .client
        .get(format!(
            "{}/storage/v1/object/{}/{}",
            config.url,
            BACKUP_BUCKET,
            object_path(&session, id)
        ))
        .headers(storage_headers(&config, &session)?)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if response.status() == StatusCode::NOT_FOUND {
        return Err("未找到该云端备份。".into());
    }
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    decrypt_payload(&bytes, recovery_password)
}

fn build_payload(state: &AppState) -> Result<CloudBackupPayload, String> {
    let (database, station_ids, profile_ids, remote_ids) = {
        let store = state
            .store
            .lock()
            .map_err(|_| "本地数据库不可用".to_string())?;
        let temporary = NamedTempFile::new().map_err(|error| error.to_string())?;
        let path = temporary.into_temp_path();
        store.checkpoint_and_copy(path.as_ref())?;
        let database_path: &Path = path.as_ref();
        let database = fs::read(database_path).map_err(|error| error.to_string())?;
        let station_ids: Vec<String> = store
            .list_stations()?
            .into_iter()
            .map(|station| station.id)
            .collect();
        let profile_ids: Vec<String> = store
            .list_login_profiles()?
            .into_iter()
            .map(|profile| profile.id)
            .collect();
        let remote_ids: Vec<String> = store
            .list_remote_servers()?
            .into_iter()
            .map(|server| server.id)
            .collect();
        (database, station_ids, profile_ids, remote_ids)
    };
    let station_secrets = station_ids
        .into_iter()
        .filter_map(|id| {
            load_secret(&id).ok().map(|secret| {
                (
                    id,
                    StationSecretBackup {
                        username: secret.username,
                        password: secret.password,
                    },
                )
            })
        })
        .collect();
    let login_profile_secrets = profile_ids
        .into_iter()
        .filter_map(|id| {
            load_login_profile_secret(&id).ok().map(|secret| {
                (
                    id,
                    StationSecretBackup {
                        username: secret.username,
                        password: secret.password,
                    },
                )
            })
        })
        .collect();
    let remote_passwords = remote_ids
        .iter()
        .filter_map(|id| {
            remote_server_entry(id)
                .ok()?
                .get_password()
                .ok()
                .map(|value| (id.clone(), value))
        })
        .collect();
    let remote_relay_keys = remote_ids
        .into_iter()
        .filter_map(|id| {
            remote_relay_key_entry(&id)
                .ok()?
                .get_password()
                .ok()
                .map(|value| (id, value))
        })
        .collect();
    Ok(CloudBackupPayload {
        version: BACKUP_VERSION,
        database: STANDARD.encode(database),
        station_secrets,
        login_profile_secrets,
        remote_passwords,
        remote_relay_keys,
    })
}

fn validate_recovery_password(password: &str) -> Result<(), String> {
    if password.len() < 12 {
        return Err("恢复密码至少需要 12 个字符。".into());
    }
    Ok(())
}

fn backup_key(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let params = Params::new(65_536, 3, 1, Some(32)).map_err(|error| error.to_string())?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0_u8; 32];
    argon2
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|error| error.to_string())?;
    Ok(key)
}

fn encrypt_payload(payload: &CloudBackupPayload, password: &str) -> Result<Vec<u8>, String> {
    let plaintext = serde_json::to_vec(payload).map_err(|error| error.to_string())?;
    let mut salt = [0_u8; 16];
    OsRng.fill_bytes(&mut salt);
    let key = backup_key(password, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|error| error.to_string())?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_ref())
        .map_err(|_| "无法加密备份。".to_string())?;
    serde_json::to_vec(&EncryptedBackup {
        version: BACKUP_VERSION,
        salt: STANDARD.encode(salt),
        nonce: STANDARD.encode(nonce),
        ciphertext: STANDARD.encode(ciphertext),
    })
    .map_err(|error| error.to_string())
}

fn decrypt_payload(encrypted: &[u8], password: &str) -> Result<CloudBackupPayload, String> {
    let envelope: EncryptedBackup =
        serde_json::from_slice(encrypted).map_err(|_| "云端备份格式无效。".to_string())?;
    if envelope.version != BACKUP_VERSION {
        return Err("该备份版本暂不支持。".into());
    }
    let salt = STANDARD
        .decode(envelope.salt)
        .map_err(|_| "云端备份格式无效。".to_string())?;
    let nonce = STANDARD
        .decode(envelope.nonce)
        .map_err(|_| "云端备份格式无效。".to_string())?;
    let ciphertext = STANDARD
        .decode(envelope.ciphertext)
        .map_err(|_| "云端备份格式无效。".to_string())?;
    let key = backup_key(password, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|error| error.to_string())?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&nonce), ciphertext.as_ref())
        .map_err(|_| "恢复密码错误或云端备份已损坏。".to_string())?;
    let payload: CloudBackupPayload =
        serde_json::from_slice(&plaintext).map_err(|_| "云端备份格式无效。".to_string())?;
    if payload.version != BACKUP_VERSION {
        return Err("该备份版本暂不支持。".into());
    }
    Ok(payload)
}

fn decoded_database(payload: &CloudBackupPayload) -> Result<Vec<u8>, String> {
    STANDARD
        .decode(&payload.database)
        .map_err(|_| "云端备份数据库无效。".to_string())
}

fn validate_database(bytes: &[u8]) -> Result<(tempfile::TempPath, CloudBackupPreview), String> {
    let temporary = NamedTempFile::new().map_err(|error| error.to_string())?;
    fs::write(temporary.path(), bytes).map_err(|error| error.to_string())?;
    let path = temporary.into_temp_path();
    let store = Store::open(path.to_path_buf()).map_err(|_| "云端备份数据库无效。".to_string())?;
    let preview = CloudBackupPreview {
        id: String::new(),
        station_count: store.list_stations()?.len(),
        login_profile_count: store.list_login_profiles()?.len(),
        remote_server_count: store.list_remote_servers()?.len(),
    };
    drop(store);
    Ok((path, preview))
}

fn preview_payload(id: &str, payload: &CloudBackupPayload) -> Result<CloudBackupPreview, String> {
    let bytes = decoded_database(payload)?;
    let (_, mut preview) = validate_database(&bytes)?;
    preview.id = id.to_string();
    Ok(preview)
}

fn restore_payload(state: &AppState, payload: &CloudBackupPayload) -> Result<(), String> {
    let bytes = decoded_database(payload)?;
    let (path, _) = validate_database(&bytes)?;
    let (station_ids, profile_ids, remote_ids) = {
        let mut store = state
            .store
            .lock()
            .map_err(|_| "本地数据库不可用".to_string())?;
        let station_ids = store
            .list_stations()?
            .into_iter()
            .map(|station| station.id)
            .collect::<Vec<_>>();
        let profile_ids = store
            .list_login_profiles()?
            .into_iter()
            .map(|profile| profile.id)
            .collect::<Vec<_>>();
        let remote_ids = store
            .list_remote_servers()?
            .into_iter()
            .map(|server| server.id)
            .collect::<Vec<_>>();
        let restore_path: &Path = path.as_ref();
        let restore_path = restore_path.to_string_lossy();
        store
            .connection
            .execute("ATTACH DATABASE ?1 AS cloud_restore", [&restore_path])
            .map_err(|error| error.to_string())?;
        let transaction = store
            .connection
            .transaction()
            .map_err(|error| error.to_string())?;
        for table in BACKUP_TABLES {
            transaction
                .execute(&format!("DELETE FROM {table}"), [])
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    &format!("INSERT INTO {table} SELECT * FROM cloud_restore.{table}"),
                    [],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())?;
        store
            .connection
            .execute_batch("DETACH DATABASE cloud_restore")
            .map_err(|error| error.to_string())?;
        (station_ids, profile_ids, remote_ids)
    };
    for id in station_ids {
        clear_secret(&id);
    }
    for id in profile_ids {
        clear_login_profile_secret(&id);
    }
    for id in remote_ids {
        if let Ok(entry) = remote_server_entry(&id) {
            let _ = entry.delete_credential();
        }
        if let Ok(entry) = remote_relay_key_entry(&id) {
            let _ = entry.delete_credential();
        }
        if let Ok(entry) = remote_key_passphrase_entry(&id) {
            let _ = entry.delete_credential();
        }
    }
    for (id, secret) in &payload.station_secrets {
        save_secret(
            id,
            &Secret {
                username: secret.username.clone(),
                password: secret.password.clone(),
                access_token: None,
                refresh_token: None,
                newapi_user_id: None,
                newapi_session: None,
            },
        )?;
    }
    for (id, secret) in &payload.login_profile_secrets {
        save_login_profile_secret(id, &secret.username, &secret.password)?;
    }
    for (id, password) in &payload.remote_passwords {
        remote_server_entry(id)?
            .set_password(password)
            .map_err(|error| error.to_string())?;
    }
    for (id, relay_key) in &payload.remote_relay_keys {
        remote_relay_key_entry(id)?
            .set_password(relay_key)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        decrypt_payload, encrypt_payload, CloudBackupPayload, StationSecretBackup, BACKUP_VERSION,
    };
    use std::collections::HashMap;

    fn payload() -> CloudBackupPayload {
        CloudBackupPayload {
            version: BACKUP_VERSION,
            database: "c3FsaXRl".into(),
            station_secrets: HashMap::from([(
                "station-1".into(),
                StationSecretBackup {
                    username: "user".into(),
                    password: "secret".into(),
                },
            )]),
            login_profile_secrets: HashMap::new(),
            remote_passwords: HashMap::new(),
            remote_relay_keys: HashMap::new(),
        }
    }

    #[test]
    fn encrypted_backup_round_trips_and_rejects_another_password() {
        let encrypted = encrypt_payload(&payload(), "a-recovery-password").expect("encrypt");
        assert_eq!(
            decrypt_payload(&encrypted, "a-recovery-password")
                .expect("decrypt")
                .database,
            "c3FsaXRl"
        );
        assert!(decrypt_payload(&encrypted, "another-recovery-password").is_err());
    }
}
