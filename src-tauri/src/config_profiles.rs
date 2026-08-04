use crate::{settings_store::SettingsStore, support::now, Store};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const CONFIG_PROFILES_SETTING: &str = "configProfiles";
const ACTIVE_CONFIG_PROFILE_SETTING: &str = "activeConfigProfileId";
const LAST_CONFIG_PROFILE_APPLIED_AT_SETTING: &str = "lastConfigProfileAppliedAt";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfigProfile {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) application: String,
    pub(crate) station_id: String,
    pub(crate) key_id: String,
    pub(crate) base_url: Option<String>,
    pub(crate) model: Option<String>,
    pub(crate) protocol: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) homepage: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) secret_ref: Option<String>,
    pub(crate) updated_at: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfigProfileRequest {
    pub(crate) id: Option<String>,
    pub(crate) name: String,
    pub(crate) application: String,
    pub(crate) station_id: String,
    pub(crate) key_id: String,
    #[serde(default)]
    pub(crate) base_url: Option<String>,
    #[serde(default)]
    pub(crate) model: Option<String>,
    #[serde(default)]
    pub(crate) protocol: Option<String>,
    #[serde(default)]
    pub(crate) homepage: Option<String>,
    #[serde(default)]
    pub(crate) source: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfigImportRequest {
    pub(crate) application: String,
    pub(crate) name: String,
    pub(crate) base_url: String,
    pub(crate) api_key: String,
    #[serde(default)]
    pub(crate) model: Option<String>,
    #[serde(default)]
    pub(crate) protocol: Option<String>,
    #[serde(default)]
    pub(crate) homepage: Option<String>,
    #[serde(default)]
    pub(crate) source: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfigImportPreview {
    pub(crate) application: String,
    pub(crate) name: String,
    pub(crate) base_url: String,
    pub(crate) model: Option<String>,
    pub(crate) protocol: Option<String>,
    pub(crate) homepage: Option<String>,
    pub(crate) masked_api_key: String,
    pub(crate) matched_station_id: Option<String>,
    pub(crate) matched_station_name: Option<String>,
    pub(crate) matched_key_id: Option<String>,
    pub(crate) matched_key_name: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActiveConfigProfile {
    pub(crate) profile: ConfigProfile,
    pub(crate) applied_at: i64,
    pub(crate) last_test_status: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfigProfileApplyResult {
    pub(crate) active: ActiveConfigProfile,
    pub(crate) backup_files: Vec<String>,
}

pub(crate) trait ConfigProfileStore {
    fn list_config_profiles(&self) -> Result<Vec<ConfigProfile>, String>;
    fn save_config_profile(&self, profile: &ConfigProfile) -> Result<(), String>;
    fn delete_config_profile(&self, id: &str) -> Result<(), String>;
    fn active_config_profile(&self) -> Result<Option<ActiveConfigProfile>, String>;
    fn set_active_config_profile(
        &self,
        profile: &ConfigProfile,
        applied_at: i64,
    ) -> Result<ActiveConfigProfile, String>;
}

impl ConfigProfileStore for Store {
    fn list_config_profiles(&self) -> Result<Vec<ConfigProfile>, String> {
        let raw = self.setting(CONFIG_PROFILES_SETTING)?;
        let mut profiles = match raw.as_deref().filter(|value| !value.trim().is_empty()) {
            Some(value) => serde_json::from_str::<Vec<ConfigProfile>>(value)
                .map_err(|error| format!("Invalid RelayHub config profiles: {error}"))?,
            None => Vec::new(),
        };
        profiles.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
        Ok(profiles)
    }

    fn save_config_profile(&self, profile: &ConfigProfile) -> Result<(), String> {
        let mut profiles = self.list_config_profiles()?;
        if let Some(existing) = profiles.iter_mut().find(|item| item.id == profile.id) {
            *existing = profile.clone();
        } else {
            profiles.push(profile.clone());
        }
        self.save_setting(
            CONFIG_PROFILES_SETTING,
            &serde_json::to_string(&profiles).map_err(|error| error.to_string())?,
        )
    }

    fn delete_config_profile(&self, id: &str) -> Result<(), String> {
        let profiles = self
            .list_config_profiles()?
            .into_iter()
            .filter(|profile| profile.id != id)
            .collect::<Vec<_>>();
        self.save_setting(
            CONFIG_PROFILES_SETTING,
            &serde_json::to_string(&profiles).map_err(|error| error.to_string())?,
        )?;
        if self.setting(ACTIVE_CONFIG_PROFILE_SETTING)?.as_deref() == Some(id) {
            self.save_setting(ACTIVE_CONFIG_PROFILE_SETTING, "")?;
            self.save_setting(LAST_CONFIG_PROFILE_APPLIED_AT_SETTING, "")?;
        }
        Ok(())
    }

    fn active_config_profile(&self) -> Result<Option<ActiveConfigProfile>, String> {
        let Some(id) = self
            .setting(ACTIVE_CONFIG_PROFILE_SETTING)?
            .filter(|value| !value.trim().is_empty())
        else {
            return Ok(None);
        };
        let Some(profile) = self
            .list_config_profiles()?
            .into_iter()
            .find(|profile| profile.id == id)
        else {
            return Ok(None);
        };
        let applied_at = self
            .setting(LAST_CONFIG_PROFILE_APPLIED_AT_SETTING)?
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(profile.updated_at);
        Ok(Some(ActiveConfigProfile {
            profile,
            applied_at,
            last_test_status: "notTested".into(),
        }))
    }

    fn set_active_config_profile(
        &self,
        profile: &ConfigProfile,
        applied_at: i64,
    ) -> Result<ActiveConfigProfile, String> {
        self.save_setting(ACTIVE_CONFIG_PROFILE_SETTING, &profile.id)?;
        self.save_setting(
            LAST_CONFIG_PROFILE_APPLIED_AT_SETTING,
            &applied_at.to_string(),
        )?;
        Ok(ActiveConfigProfile {
            profile: profile.clone(),
            applied_at,
            last_test_status: "notTested".into(),
        })
    }
}

pub(crate) fn new_profile(request: ConfigProfileRequest) -> Result<ConfigProfile, String> {
    let name = request.name.trim().to_string();
    let application = request.application.trim().to_lowercase();
    let station_id = request.station_id.trim().to_string();
    let key_id = request.key_id.trim().to_string();

    if name.is_empty() {
        return Err("Profile name is required".into());
    }
    if !matches!(application.as_str(), "claude" | "codex" | "gemini") {
        return Err("Unsupported client application".into());
    }
    if station_id.is_empty() || key_id.is_empty() {
        return Err("A station and API key are required".into());
    }

    Ok(ConfigProfile {
        id: request
            .id
            .filter(|id| !id.trim().is_empty())
            .unwrap_or_else(|| Uuid::new_v4().to_string()),
        name,
        application,
        station_id,
        key_id,
        base_url: clean_optional(request.base_url),
        model: clean_optional(request.model),
        protocol: clean_optional(request.protocol),
        homepage: clean_optional(request.homepage),
        source: clean_optional(request.source),
        secret_ref: None,
        updated_at: now(),
    })
}

pub(crate) fn new_imported_profile(
    request: &ConfigImportRequest,
    station_id: Option<String>,
    key_id: Option<String>,
    secret_ref: Option<String>,
) -> Result<ConfigProfile, String> {
    let application = request.application.trim().to_lowercase();
    let name = request.name.trim().to_string();
    let base_url = request.base_url.trim().trim_end_matches('/').to_string();

    if !matches!(application.as_str(), "claude" | "codex" | "gemini") {
        return Err("Unsupported client application".into());
    }
    if name.is_empty() {
        return Err("Profile name is required".into());
    }
    if base_url.is_empty() {
        return Err("An endpoint is required".into());
    }
    if station_id.as_deref().unwrap_or_default().trim().is_empty()
        && secret_ref.as_deref().unwrap_or_default().trim().is_empty()
    {
        return Err("An imported profile must have a local key or a secure imported secret".into());
    }

    Ok(ConfigProfile {
        id: Uuid::new_v4().to_string(),
        name,
        application,
        station_id: station_id.unwrap_or_default(),
        key_id: key_id.unwrap_or_default(),
        base_url: Some(base_url),
        model: clean_optional(request.model.clone()),
        protocol: clean_optional(request.protocol.clone()),
        homepage: clean_optional(request.homepage.clone()),
        source: clean_optional(request.source.clone()),
        secret_ref,
        updated_at: now(),
    })
}

pub(crate) fn mask_secret(value: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        return "未提供".into();
    }
    if value.len() <= 8 {
        return "••••••••".into();
    }
    format!(
        "{}••••{}",
        &value[..value
            .char_indices()
            .nth(4)
            .map(|(index, _)| index)
            .unwrap_or(4)],
        &value[value.len().saturating_sub(4)..]
    )
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let value = value.trim().to_string();
        (!value.is_empty()).then_some(value)
    })
}

#[cfg(test)]
mod tests {
    use super::{
        mask_secret, new_imported_profile, new_profile, ConfigImportRequest, ConfigProfileRequest,
    };

    #[test]
    fn normalizes_and_validates_profile_input() {
        let profile = new_profile(ConfigProfileRequest {
            id: None,
            name: "  Daily Codex  ".into(),
            application: "CODEX".into(),
            station_id: " station-1 ".into(),
            key_id: " key-1 ".into(),
            base_url: Some(" https://relay.example/v1/ ".into()),
            model: Some(" gpt-5-codex ".into()),
            protocol: Some(" responses ".into()),
            homepage: None,
            source: None,
        })
        .expect("profile should be valid");

        assert_eq!(profile.name, "Daily Codex");
        assert_eq!(profile.application, "codex");
        assert_eq!(
            profile.base_url.as_deref(),
            Some("https://relay.example/v1/")
        );
        assert_eq!(profile.model.as_deref(), Some("gpt-5-codex"));
    }

    #[test]
    fn rejects_unknown_applications() {
        let result = new_profile(ConfigProfileRequest {
            id: None,
            name: "Unknown".into(),
            application: "unknown".into(),
            station_id: "station-1".into(),
            key_id: "key-1".into(),
            base_url: None,
            model: None,
            protocol: None,
            homepage: None,
            source: None,
        });

        assert!(result.is_err());
    }

    #[test]
    fn imported_profile_keeps_only_a_secret_reference() {
        let profile = new_imported_profile(
            &ConfigImportRequest {
                application: "gemini".into(),
                name: "Imported Gemini".into(),
                base_url: "https://relay.example/v1/".into(),
                api_key: "sk-unused-in-profile-construction".into(),
                model: Some("gemini-2.5-pro".into()),
                protocol: Some("gemini".into()),
                homepage: None,
                source: Some("ccswitch".into()),
            },
            None,
            None,
            Some("imported-secret".into()),
        )
        .expect("imported profile should be valid");

        assert_eq!(
            profile.base_url.as_deref(),
            Some("https://relay.example/v1")
        );
        assert_eq!(profile.secret_ref.as_deref(), Some("imported-secret"));
        assert!(profile.station_id.is_empty());
        assert!(profile.key_id.is_empty());
    }

    #[test]
    fn masks_imported_secrets() {
        assert_eq!(mask_secret("sk-test-1234"), "sk-t••••1234");
        assert_eq!(mask_secret("short"), "••••••••");
    }
}
