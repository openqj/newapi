use std::{
    env, fs,
    path::{Path, PathBuf},
    time::Duration,
};

use serde_json::{Map, Value};
use toml_edit::{value, DocumentMut, Item, Table};

use crate::{
    services::{
        api_keys::read_api_key,
        gateway::{current_routing_mode, RoutingMode},
        stations::title_from_html,
    },
    settings_store::SettingsStore,
    station_store::StationStore,
    support::{api_base_url, station_base},
    AppState, CodexIntegrationStatus,
};

const PRESERVE_OFFICIAL_AUTH_SETTING: &str = "preserveCodexOfficialAuthOnSwitch";
const DEFAULT_MODEL: &str = "gpt-5-codex";

pub(crate) fn status(state: &AppState) -> Result<CodexIntegrationStatus, String> {
    Ok(CodexIntegrationStatus {
        preserve_official_login: preserve_official_login(state)?,
        config_directory: codex_directory()?.display().to_string(),
    })
}

pub(crate) async fn active_relay_name(state: &AppState) -> Result<Option<String>, String> {
    let config = read_optional(&codex_directory()?.join("config.toml"))?;
    let Some(relay_url) = active_relay_url(&config) else {
        return Ok(None);
    };
    let relay_root = station_base(&relay_url);
    let managed_name = state
        .store
        .lock()
        .map_err(|_| "Local database is unavailable".to_string())?
        .list_stations()?
        .into_iter()
        .find(|station| station_base(&station.base_url) == relay_root)
        .map(|station| station.name)
        .filter(|name| !name.trim().is_empty());
    if managed_name.is_some() {
        return Ok(managed_name);
    }

    let page = state
        .client
        .get(relay_root)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .ok();
    let name = match page {
        Some(response) => response
            .text()
            .await
            .ok()
            .and_then(|html| title_from_html(&html)),
        None => None,
    };
    Ok(name)
}

pub(crate) fn set_preserve_official_login(
    state: &AppState,
    preserve_official_login: bool,
) -> Result<CodexIntegrationStatus, String> {
    state
        .store
        .lock()
        .map_err(|_| "Local database is unavailable".to_string())?
        .save_setting(
            PRESERVE_OFFICIAL_AUTH_SETTING,
            &preserve_official_login.to_string(),
        )?;
    status(state)
}

pub(crate) async fn apply_api_key(
    state: &AppState,
    station_id: String,
    key_id: String,
) -> Result<CodexIntegrationStatus, String> {
    let (station, api_key) = read_api_key(state, &station_id, &key_id).await?;
    let directory = codex_directory()?;
    let preserve_login = preserve_official_login(state)?
        || matches!(current_routing_mode(state)?, RoutingMode::LocalGateway);
    apply_to_directory(
        &directory,
        &format!("{} - {}", station.name, key_id),
        &api_base_url(&station.base_url),
        &api_key,
        preserve_login,
    )?;
    status(state)
}

fn preserve_official_login(state: &AppState) -> Result<bool, String> {
    Ok(state
        .store
        .lock()
        .map_err(|_| "Local database is unavailable".to_string())?
        .setting(PRESERVE_OFFICIAL_AUTH_SETTING)?
        .map(|value| value != "false")
        .unwrap_or(true))
}

fn codex_directory() -> Result<PathBuf, String> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .map(|home| home.join(".codex"))
        .ok_or("Unable to find the Codex configuration directory".to_string())
}

fn active_relay_url(config: &str) -> Option<String> {
    let document = config.parse::<toml::Value>().ok()?;
    let root = document.as_table()?;
    let provider_name = root.get("model_provider")?.as_str()?;
    root.get("model_providers")?
        .as_table()?
        .get(provider_name)?
        .as_table()?
        .get("base_url")?
        .as_str()
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .map(str::to_string)
}

fn apply_to_directory(
    directory: &Path,
    provider_name: &str,
    endpoint: &str,
    api_key: &str,
    preserve_login: bool,
) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let auth_path = directory.join("auth.json");
    let config_path = directory.join("config.toml");
    backup_once(&auth_path, &directory.join("auth.json.relayhub.bak"))?;
    backup_once(&config_path, &directory.join("config.toml.relayhub.bak"))?;

    let current_config = read_optional(&config_path)?;
    let next_config = build_config(
        &current_config,
        provider_name,
        endpoint,
        api_key,
        preserve_login,
    )?;
    let previous_auth = auth_path
        .exists()
        .then(|| read_optional(&auth_path))
        .transpose()?;

    if !preserve_login {
        write_text(
            &auth_path,
            &update_auth(previous_auth.as_deref().unwrap_or(""), api_key)?,
        )?;
    }
    if let Err(error) = write_text(&config_path, &next_config) {
        if !preserve_login {
            restore(&auth_path, previous_auth.as_deref())?;
        }
        return Err(error);
    }
    Ok(())
}

fn build_config(
    source: &str,
    provider_name: &str,
    endpoint: &str,
    api_key: &str,
    preserve_login: bool,
) -> Result<String, String> {
    let mut document = if source.trim().is_empty() {
        DocumentMut::new()
    } else {
        source
            .parse::<DocumentMut>()
            .map_err(|error| format!("Invalid Codex config.toml: {error}"))?
    };
    document["model_provider"] = value("relayhub");
    if document.get("model").is_none() {
        document["model"] = value(DEFAULT_MODEL);
    }
    if document.get("model_reasoning_effort").is_none() {
        document["model_reasoning_effort"] = value("high");
    }
    document["disable_response_storage"] = value(true);

    if document.get("model_providers").is_none() {
        document["model_providers"] = Item::Table(Table::new());
    }
    let providers = document["model_providers"]
        .as_table_mut()
        .ok_or("model_providers must be a TOML table")?;
    if !providers.contains_key("relayhub") {
        providers["relayhub"] = Item::Table(Table::new());
    }
    let provider = providers["relayhub"]
        .as_table_mut()
        .ok_or("model_providers.relayhub must be a TOML table")?;
    provider["name"] = value(provider_name);
    provider["base_url"] = value(endpoint.trim_end_matches('/'));
    provider["wire_api"] = value("responses");
    provider["requires_openai_auth"] = value(true);

    if preserve_login {
        document["experimental_bearer_token"] = value(api_key);
    } else {
        document.remove("experimental_bearer_token");
    }
    Ok(document.to_string())
}

fn update_auth(source: &str, api_key: &str) -> Result<String, String> {
    let mut auth = if source.trim().is_empty() {
        Map::new()
    } else {
        serde_json::from_str::<Value>(source)
            .map_err(|error| format!("Invalid Codex auth.json: {error}"))?
            .as_object()
            .cloned()
            .ok_or("Codex auth.json must be a JSON object")?
    };
    auth.insert("OPENAI_API_KEY".into(), Value::String(api_key.into()));
    serde_json::to_string_pretty(&Value::Object(auth)).map_err(|error| error.to_string())
}

fn read_optional(path: &Path) -> Result<String, String> {
    if path.exists() {
        fs::read_to_string(path).map_err(|error| error.to_string())
    } else {
        Ok(String::new())
    }
}

fn backup_once(source: &Path, backup: &Path) -> Result<(), String> {
    if source.exists() && !backup.exists() {
        fs::copy(source, backup).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn write_text(path: &Path, contents: &str) -> Result<(), String> {
    fs::write(path, contents).map_err(|error| error.to_string())
}

fn restore(path: &Path, source: Option<&str>) -> Result<(), String> {
    match source {
        Some(contents) => write_text(path, contents),
        None if path.exists() => fs::remove_file(path).map_err(|error| error.to_string()),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::{active_relay_url, apply_to_directory};

    #[test]
    fn reads_the_active_provider_url_from_codex_config() {
        let config = r#"
model_provider = "custom"

[model_providers.unused]
base_url = "https://unused.example/v1"

[model_providers.custom]
base_url = "https://relay.example/v1"
"#;

        assert_eq!(
            active_relay_url(config).as_deref(),
            Some("https://relay.example/v1")
        );
    }

    #[test]
    fn ignores_config_without_an_active_relay_url() {
        assert_eq!(
            active_relay_url("model_provider = \"openai\"\n[model_providers.custom]\nbase_url = \"https://relay.example/v1\""),
            None
        );
        assert_eq!(active_relay_url("not valid toml = ["), None);
    }

    #[test]
    fn preserves_official_auth_and_uses_a_config_scoped_token() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(
            directory.path().join("auth.json"),
            r#"{"tokens":{"access_token":"official"}}"#,
        )
        .unwrap();
        std::fs::write(
            directory.path().join("config.toml"),
            "[mcp_servers.files]\ncommand = \"node\"\n",
        )
        .unwrap();

        apply_to_directory(
            directory.path(),
            "Relay",
            "https://relay.test/v1",
            "sk-relay",
            true,
        )
        .unwrap();

        let auth = std::fs::read_to_string(directory.path().join("auth.json")).unwrap();
        let config = std::fs::read_to_string(directory.path().join("config.toml")).unwrap();
        assert!(auth.contains("official"));
        assert!(config.contains("experimental_bearer_token = \"sk-relay\""));
        assert!(config.contains("[mcp_servers.files]"));
        assert!(config.contains("[model_providers.relayhub]"));
    }

    #[test]
    fn writes_the_key_to_auth_when_login_preservation_is_disabled() {
        let directory = tempfile::tempdir().unwrap();

        apply_to_directory(
            directory.path(),
            "Relay",
            "https://relay.test/v1",
            "sk-relay",
            false,
        )
        .unwrap();

        let auth = std::fs::read_to_string(directory.path().join("auth.json")).unwrap();
        let config = std::fs::read_to_string(directory.path().join("config.toml")).unwrap();
        assert!(auth.contains("OPENAI_API_KEY"));
        assert!(auth.contains("sk-relay"));
        assert!(!config.contains("experimental_bearer_token"));
    }
}
