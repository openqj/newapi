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

pub(crate) fn save_secret(id: &str, secret: &Secret) -> Result<(), String> {
    credential_entry(id)?.set_password(&serde_json::to_string(secret).map_err(|error| error.to_string())?).map_err(|error| error.to_string())
}

pub(crate) fn load_secret(id: &str) -> Result<Secret, String> {
    serde_json::from_str(&credential_entry(id)?.get_password().map_err(|_| "未找到该站点的安全凭据".to_string())?).map_err(|error| error.to_string())
}

pub(crate) fn clear_secret(id: &str) {
    if let Ok(entry) = credential_entry(id) { let _ = entry.delete_credential(); }
}

pub(crate) fn save_login_profile_secret(id: &str, username: &str, password: &str) -> Result<(), String> {
    login_profile_entry(id)?.set_password(&serde_json::to_string(&LoginProfileSecret { username: username.to_string(), password: password.to_string() }).map_err(|error| error.to_string())?).map_err(|error| error.to_string())
}

pub(crate) fn load_login_profile_secret(id: &str) -> Result<LoginProfileSecret, String> {
    serde_json::from_str(&login_profile_entry(id)?.get_password().map_err(|_| "未找到该账号的安全凭据".to_string())?).map_err(|error| error.to_string())
}

pub(crate) fn clear_login_profile_secret(id: &str) {
    if let Ok(entry) = login_profile_entry(id) { let _ = entry.delete_credential(); }
}
