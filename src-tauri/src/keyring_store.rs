use keyring::Entry;
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct Secret {
    pub(crate) username: String,
    pub(crate) password: String,
    pub(crate) access_token: Option<String>,
    pub(crate) refresh_token: Option<String>,
    #[serde(default)]
    pub(crate) newapi_user_id: Option<String>,
    #[serde(default)]
    pub(crate) newapi_session: Option<String>,
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
    credential_entry(id)?
        .set_password(&serde_json::to_string(secret).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

pub(crate) fn load_secret(id: &str) -> Result<Secret, String> {
    serde_json::from_str(
        &credential_entry(id)?
            .get_password()
            .map_err(|_| "未找到该站点的安全凭据".to_string())?,
    )
    .map_err(|error| error.to_string())
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
