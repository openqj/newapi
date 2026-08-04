use keyring::Entry;
use serde::{Deserialize, Serialize};

const CURRENT_SECRET_VERSION: u8 = 3;

fn default_secret_version() -> u8 {
    1
}

#[derive(Clone, Deserialize, Serialize, PartialEq)]
pub(crate) struct PersistedCookie {
    pub(crate) name: String,
    pub(crate) value: String,
    pub(crate) domain: String,
    #[serde(default = "default_cookie_path")]
    pub(crate) path: String,
    #[serde(default)]
    pub(crate) expires_at: Option<i64>,
    #[serde(default)]
    pub(crate) secure: bool,
    #[serde(default)]
    pub(crate) http_only: bool,
}

fn default_cookie_path() -> String {
    "/".into()
}

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct Secret {
    #[serde(default = "default_secret_version")]
    pub(crate) version: u8,
    pub(crate) username: String,
    pub(crate) password: String,
    pub(crate) access_token: Option<String>,
    #[serde(default)]
    pub(crate) access_token_expires_at: Option<i64>,
    #[serde(default)]
    pub(crate) refresh_token: Option<String>,
    #[serde(default)]
    pub(crate) requires_reauth: bool,
    #[serde(default)]
    pub(crate) last_refresh_at: Option<i64>,
    #[serde(default)]
    pub(crate) last_refresh_error: Option<String>,
    #[serde(default)]
    pub(crate) next_refresh_retry_at: Option<i64>,
    #[serde(default)]
    pub(crate) newapi_user_id: Option<String>,
    #[serde(default)]
    pub(crate) newapi_session: Option<String>,
    #[serde(default)]
    pub(crate) newapi_cookies: Vec<PersistedCookie>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoginProfileSecret {
    pub(crate) username: String,
    pub(crate) password: String,
    #[serde(default)]
    pub(crate) email: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct CloudSession {
    pub(crate) access_token: String,
    pub(crate) refresh_token: String,
    pub(crate) user_id: String,
    pub(crate) email: String,
    pub(crate) expires_at: i64,
    #[serde(default)]
    pub(crate) is_admin: bool,
    #[serde(default = "default_cloud_role")]
    pub(crate) role: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct MailOAuthToken {
    pub(crate) access_token: String,
    pub(crate) refresh_token: Option<String>,
    pub(crate) expires_at: i64,
    pub(crate) email: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct MailPasswordSecret {
    pub(crate) email: String,
    pub(crate) password: String,
}

fn default_cloud_role() -> String {
    "member".into()
}

pub(crate) fn credential_entry(id: &str) -> Result<Entry, String> {
    Entry::new("api-assistant", id).map_err(|error| error.to_string())
}

pub(crate) fn login_profile_entry(id: &str) -> Result<Entry, String> {
    Entry::new("api-assistant-login-profile", id).map_err(|error| error.to_string())
}

pub(crate) fn remote_server_entry(id: &str) -> Result<Entry, String> {
    Entry::new("api-assistant-remote-server", id).map_err(|error| error.to_string())
}

pub(crate) fn remote_key_passphrase_entry(id: &str) -> Result<Entry, String> {
    Entry::new("api-assistant-remote-key-passphrase", id).map_err(|error| error.to_string())
}

pub(crate) fn remote_relay_key_entry(id: &str) -> Result<Entry, String> {
    Entry::new("api-assistant-remote-relay-key", id).map_err(|error| error.to_string())
}

pub(crate) fn config_profile_entry(id: &str) -> Result<Entry, String> {
    Entry::new("api-assistant-config-profile", id).map_err(|error| error.to_string())
}

pub(crate) fn save_config_profile_secret(id: &str, secret: &str) -> Result<(), String> {
    config_profile_entry(id)?
        .set_password(secret)
        .map_err(|error| error.to_string())
}

pub(crate) fn load_config_profile_secret(id: &str) -> Result<String, String> {
    config_profile_entry(id)?
        .get_password()
        .map_err(|_| "未找到导入配置的安全密钥".to_string())
}

pub(crate) fn clear_config_profile_secret(id: &str) {
    if let Ok(entry) = config_profile_entry(id) {
        let _ = entry.delete_credential();
    }
}

/// Audit records only retain this entry's opaque id.  The actionable relay
/// snapshot, including its key, stays in the operating system credential store.
pub(crate) fn remote_relay_rollback_entry(id: &str) -> Result<Entry, String> {
    Entry::new("api-assistant-remote-relay-rollback", id).map_err(|error| error.to_string())
}

pub(crate) fn cloud_session_entry() -> Result<Entry, String> {
    Entry::new("api-assistant-cloud-session", "current").map_err(|error| error.to_string())
}

pub(crate) fn mail_oauth_entry(provider: &str) -> Result<Entry, String> {
    Entry::new("api-assistant-mail-oauth", provider).map_err(|error| error.to_string())
}

pub(crate) fn mail_password_entry(provider: &str) -> Result<Entry, String> {
    Entry::new("api-assistant-mail-password", provider).map_err(|error| error.to_string())
}

pub(crate) fn save_mail_password(
    provider: &str,
    secret: &MailPasswordSecret,
) -> Result<(), String> {
    mail_password_entry(provider)?
        .set_password(&serde_json::to_string(secret).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

pub(crate) fn load_mail_password(provider: &str) -> Result<MailPasswordSecret, String> {
    serde_json::from_str(
        &mail_password_entry(provider)?
            .get_password()
            .map_err(|_| "未连接邮箱".to_string())?,
    )
    .map_err(|error| error.to_string())
}

pub(crate) fn clear_mail_password(provider: &str) {
    if let Ok(entry) = mail_password_entry(provider) {
        let _ = entry.delete_credential();
    }
}

pub(crate) fn save_mail_oauth_token(provider: &str, token: &MailOAuthToken) -> Result<(), String> {
    mail_oauth_entry(provider)?
        .set_password(&serde_json::to_string(token).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

pub(crate) fn load_mail_oauth_token(provider: &str) -> Result<MailOAuthToken, String> {
    serde_json::from_str(
        &mail_oauth_entry(provider)?
            .get_password()
            .map_err(|_| "未连接邮箱 OAuth".to_string())?,
    )
    .map_err(|error| error.to_string())
}

pub(crate) fn clear_mail_oauth_token(provider: &str) {
    if let Ok(entry) = mail_oauth_entry(provider) {
        let _ = entry.delete_credential();
    }
}

pub(crate) fn save_cloud_session(session: &CloudSession) -> Result<(), String> {
    cloud_session_entry()?
        .set_password(&serde_json::to_string(session).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

pub(crate) fn load_cloud_session() -> Result<CloudSession, String> {
    serde_json::from_str(
        &cloud_session_entry()?
            .get_password()
            .map_err(|_| "未登录云端账户".to_string())?,
    )
    .map_err(|error| error.to_string())
}

pub(crate) fn clear_cloud_session() {
    if let Ok(entry) = cloud_session_entry() {
        let _ = entry.delete_credential();
    }
}

pub(crate) fn save_secret(id: &str, secret: &Secret) -> Result<(), String> {
    let secret = migrate_secret(secret.clone());
    credential_entry(id)?
        .set_password(&serde_json::to_string(&secret).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

pub(crate) fn load_secret(id: &str) -> Result<Secret, String> {
    let secret: Secret = serde_json::from_str(
        &credential_entry(id)?
            .get_password()
            .map_err(|_| "未找到该站点的安全凭据".to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let previous_version = secret.version;
    let migrated = migrate_secret(secret);
    if migrated.version != previous_version {
        save_secret(id, &migrated)?;
    }
    let secret = migrated;
    Ok(secret)
}

fn migrate_secret(mut secret: Secret) -> Secret {
    if secret.version < CURRENT_SECRET_VERSION {
        secret.version = CURRENT_SECRET_VERSION;
    }
    secret
}

pub(crate) fn clear_secret(id: &str) {
    if let Ok(entry) = credential_entry(id) {
        let _ = entry.delete_credential();
    }
}

pub(crate) fn save_login_profile_secret(
    id: &str,
    username: &str,
    email: &str,
    password: &str,
) -> Result<(), String> {
    login_profile_entry(id)?
        .set_password(
            &serde_json::to_string(&LoginProfileSecret {
                username: username.to_string(),
                password: password.to_string(),
                email: email.to_string(),
            })
            .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())
}

pub(crate) fn load_login_profile_secret(id: &str) -> Result<LoginProfileSecret, String> {
    serde_json::from_str(
        &login_profile_entry(id)?
            .get_password()
            .map_err(|_| "未找到该账号的安全凭据".to_string())?,
    )
    .map_err(|error| error.to_string())
}

pub(crate) fn clear_login_profile_secret(id: &str) {
    if let Ok(entry) = login_profile_entry(id) {
        let _ = entry.delete_credential();
    }
}

#[cfg(test)]
mod tests {
    use super::{migrate_secret, Secret};

    #[test]
    fn reads_legacy_secret_without_cookie_fields_and_migrates_version() {
        let secret: Secret = serde_json::from_str(
            r#"{"username":"user","password":"secret","access_token":null,"refresh_token":null}"#,
        )
        .expect("legacy secret should remain readable");

        assert_eq!(secret.version, 1);
        assert!(secret.newapi_cookies.is_empty());
        assert_eq!(migrate_secret(secret).version, 3);
    }
}
